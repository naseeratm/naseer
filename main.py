from fastapi import FastAPI, Request
import uvicorn
from celery.result import AsyncResult
from universal_dispatcher import (
    celery_app,
    classify_and_route_simulation,
    execute_simulation,
)

app = FastAPI()

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
        return execute_simulation(data)

    try:
        return classify_and_route_simulation(data)
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
    payload = {
        "task_id": task_id,
        "status": task.state,
        "ready": task.ready(),
    }
    if task.successful():
        payload["result"] = task.result
    elif task.failed():
        payload["status"] = "FAILURE"
        payload["error"] = str(task.result)
    else:
        payload["meta"] = task.info if isinstance(task.info, dict) else None
    return payload


@app.get("/api/task-status/{task_id}")
async def task_status_poll(task_id: str):
    """Polling alias with the Docker API contract."""
    return await task_status(task_id)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)