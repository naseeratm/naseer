from fastapi import FastAPI, Request
import uvicorn
from celery.result import AsyncResult
from universal_dispatcher import celery_app, classify_and_route_simulation

app = FastAPI()

@app.get("/api/health")
def health_check():
    return {"status": "ONLINE", "message": "Physics Engine & Dispatcher Ready"}

@app.post("/api/run-simulation")
async def run_simulation(request: Request):
    data = await request.json()
    results = classify_and_route_simulation(data)
    return results


@app.get("/api/tasks/{task_id}")
async def task_status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)
    payload = {
        "task_id": task_id,
        "status": result.state,
        "ready": result.ready(),
    }
    if result.successful():
        payload["result"] = result.result
    elif result.failed():
        payload["error"] = str(result.result)
    else:
        payload["meta"] = result.info if isinstance(result.info, dict) else None
    return payload


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)