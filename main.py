import os
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Query
import uvicorn
from celery.result import AsyncResult
from fastapi.responses import FileResponse, Response
from universal_dispatcher import (
    celery_app,
    classify_and_route_simulation,
    execute_simulation,
)
from cae_repository import JobRepository

app = FastAPI()

TASK_STATES = {
    "PENDING": "QUEUED",
    "RECEIVED": "QUEUED",
    "STARTED": "RUNNING",
    "RETRY": "RETRYING",
    "REVOKED": "CANCELLED",
    "SUCCESS": "COMPLETED",
    "FAILURE": "FAILED",
}
RESULT_EXPIRES_SECONDS = int(os.getenv("CAE_RESULT_EXPIRES_SECONDS", "86400"))
JOBS_ROOT = Path(os.getenv("CAE_JOBS_ROOT", "/app/jobs")).resolve()
job_repository = JobRepository()


def _task_meta(task: AsyncResult) -> dict[str, Any]:
    if isinstance(task.info, dict):
        return task.info
    return {}


def _safe_artifact(path_value: Any) -> Path | None:
    if not isinstance(path_value, (str, os.PathLike)):
        return None
    candidate = Path(path_value)
    if not candidate.is_absolute():
        candidate = JOBS_ROOT / candidate
    candidate = candidate.resolve()
    try:
        candidate.relative_to(JOBS_ROOT)
    except (ValueError, RuntimeError):
        return None
    return candidate if candidate.is_file() else None


def _normalized_task(task_id: str, task: AsyncResult) -> dict[str, Any]:
    raw_state = task.state or "PENDING"
    status = TASK_STATES.get(raw_state, raw_state.lower())
    meta = _task_meta(task)
    progress = meta.get("progress")
    if progress is None:
        if task.successful():
            progress = 100
        elif status == "QUEUED":
            progress = 0
        elif status == "FAILED":
            progress = 0
        else:
            progress = 50

    payload: dict[str, Any] = {
        "task_id": task_id,
        "status": status,
        "state": raw_state,
        "ready": task.ready(),
        "progress": progress,
        "meta": meta or None,
        "result_expires_seconds": RESULT_EXPIRES_SECONDS,
    }
    if task.successful():
        payload["result"] = task.result
        if isinstance(task.result, dict):
            payload["artifacts"] = task.result.get("artifacts", [])
    elif task.failed():
        payload["error"] = str(task.result)
        payload["traceback"] = getattr(task, "traceback", None)
        payload["logs"] = meta.get("logs", [])
    else:
        payload["logs"] = meta.get("logs", [])
        if raw_state == "REVOKED":
            payload["status"] = "CANCELLED"
    return payload

@app.get("/api/health")
def health_check():
    return {"status": "ONLINE", "message": "Physics Engine & Dispatcher Ready"}

@app.post("/api/run-simulation")
async def run_simulation(request: Request):
    data = await request.json()

    # Keep synchronous execution available for local development and simple
    # thermal jobs, while the full Docker stack uses queued workers by default.
    execution_mode = str(data.pop("execution_mode", "async")).lower()
    if execution_mode in {"direct", "sync", "synchronous"}:
        result = execute_simulation(data)
        return result

    try:
        submitted = classify_and_route_simulation(data)
        task_id = submitted["task_id"]
        job_repository.create(task_id, data)
        return submitted
    except Exception as exc:
        # Broker outages must not turn a valid thermal job into an API 500.
        # Fall back to the deterministic local solver and report the fallback.
        fallback = execute_simulation(data)
        fallback["execution_mode"] = "direct_fallback"
        fallback["broker_warning"] = (
            f"Celery queue unavailable; executed locally: {exc}"
        )
        return fallback


@app.get("/api/tasks/{task_id}")
async def task_status(task_id: str):
    task = AsyncResult(task_id, app=celery_app)
    payload = _normalized_task(task_id, task)
    status = payload["status"]
    persisted = job_repository.update(
        task_id,
        status=status,
        progress=int(payload.get("progress", 0)),
        logs=payload.get("logs", []),
        artifacts=payload.get("artifacts", []),
        result=payload.get("result"),
        error=payload.get("error"),
    )
    return persisted or payload


@app.get("/api/task-status/{task_id}")
async def task_status_poll(task_id: str):
    """Polling alias with the Docker API contract."""
    return await task_status(task_id)


@app.get("/api/tasks/{task_id}/logs")
async def task_logs(task_id: str):
    task = AsyncResult(task_id, app=celery_app)
    meta = _task_meta(task)
    result_logs = task.result.get("logs", []) if task.successful() and isinstance(task.result, dict) else []
    logs = meta.get("logs") or result_logs or []
    if isinstance(logs, str):
        logs = [logs]
    persisted = job_repository.update(task_id, status=_normalized_task(task_id, task)["status"], logs=logs)
    return {"task_id": task_id, "status": _normalized_task(task_id, task)["status"], "logs": logs, "job": persisted}


@app.post("/api/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    terminate: bool = Query(False),
    signal: str = Query("SIGTERM"),
):
    task = AsyncResult(task_id, app=celery_app)
    task.revoke(terminate=terminate, signal=signal if terminate else None)
    job_repository.update(task_id, status="CANCELLED", logs=["Job explicitly cancelled by user"])
    return {"task_id": task_id, "status": "CANCELLED", "revoked": True, "terminate": terminate}


@app.get("/api/jobs")
async def list_jobs(project_id: str | None = Query(None)):
    return {"success": True, "jobs": job_repository.list(project_id)}


@app.get("/api/jobs/{task_id}")
async def job_status_alias(task_id: str):
    return await task_status(task_id)


@app.get("/api/jobs/{task_id}/logs")
async def job_logs_alias(task_id: str):
    return await task_logs(task_id)


@app.post("/api/jobs/{task_id}/cancel")
async def job_cancel_alias(task_id: str, terminate: bool = Query(False), signal: str = Query("SIGTERM")):
    return await cancel_task(task_id, terminate, signal)


@app.get("/api/jobs/{task_id}/artifacts")
async def job_artifacts(task_id: str):
    job = job_repository.get(task_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"task_id": task_id, "status": job["status"], "artifacts": job["artifacts"]}


app.add_api_route(
    "/api/tasks/{task_id}/revoke", cancel_task, methods=["POST"], include_in_schema=False
)


@app.get("/api/tasks/{task_id}/result/download")
async def download_task_result(task_id: str):
    task = AsyncResult(task_id, app=celery_app)
    if not task.ready():
        raise HTTPException(status_code=409, detail="Task result is not ready")
    if task.failed():
        raise HTTPException(status_code=404, detail="Task failed and has no result")

    result = task.result
    candidates: list[Any] = []
    if isinstance(result, dict):
        for key in ("artifact", "result_file", "download_path", "output_file"):
            if result.get(key):
                candidates.append(result[key])
        candidates.extend(result.get("artifacts", []) if isinstance(result.get("artifacts"), list) else [])

    for candidate in candidates:
        if isinstance(candidate, dict):
            candidate = candidate.get("path") or candidate.get("file_path")
        artifact = _safe_artifact(candidate)
        if artifact:
            return FileResponse(
                artifact,
                filename=artifact.name,
                media_type="application/octet-stream",
                headers={"Content-Disposition": f'attachment; filename="{artifact.name}"'},
            )

    body = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="task-{task_id}.json"'},
    )


# Compatibility aliases used by clients that shorten the result path.
app.add_api_route(
    "/api/tasks/{task_id}/result", download_task_result, methods=["GET"], include_in_schema=False
)
app.add_api_route(
    "/api/tasks/{task_id}/download", download_task_result, methods=["GET"], include_in_schema=False
)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)