from fastapi import FastAPI, Request
import uvicorn
from physics_solver import solve_simulation

app = FastAPI()

@app.get("/api/health")
def health_check():
    return {"status": "ONLINE", "message": "Physics Engine & Dispatcher Ready"}

@app.post("/api/run-simulation")
async def run_simulation(request: Request):
    data = await request.json()
    results = solve_simulation(data)
    return results


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)