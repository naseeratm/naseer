import os
import math
from enum import Enum
from typing import Optional
import uuid
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from json import JSONDecodeError
from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator
import uvicorn

from universal_dispatcher import execute_simulation, celery_app, classify_physics
from backend.vv_metrics import KeyResultUnavailable, MeshStudyError, key_result_specs, run_mesh_study
from cae_repository import JobRepository

job_repository = JobRepository()

app = FastAPI(title="NASEER CAE Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# 1. Pydantic Models for Input Validation (صمام أمان المدخلات)
# ---------------------------------------------------------
class PhysicsType(str, Enum):
    CFD_INCOMPRESSIBLE = "CFD_Incompressible"
    CFD_COMPRESSIBLE = "CFD_Compressible"
    STRUCTURAL_STATIC = "Structural_Static"
    STRUCTURAL_DYNAMIC = "Structural_Dynamic"
    THERMAL_TRANSIENT = "Thermal_Transient"

class ExecutionMode(str, Enum):
    DIRECT = "direct"
    CELERY = "celery"

class SimulationRequest(BaseModel):
    simulation_type: PhysicsType
    execution_mode: ExecutionMode = ExecutionMode.CELERY
    velocity: Optional[float] = Field(default=1.0, description="Velocity in m/s")
    temperature: Optional[float] = Field(default=293.15, description="Temperature value")
    temperature_unit: Optional[str] = Field(default="K", pattern="^(K|C|F)$")
    pressure: Optional[float] = Field(default=101325.0, description="Absolute pressure in Pa")
    displacement: Optional[float] = Field(default=0.0, description="Structural displacement in meters")
    mesh_size: Optional[float] = Field(default=0.1, gt=0.0, description="Characteristic mesh size")
    width_x: Optional[float] = Field(default=1.0, description="Domain width in meters")
    height_y: Optional[float] = Field(default=1.0, description="Domain height in meters")
    thermal_conductivity_k: Optional[float] = Field(default=400.0, description="Thermal conductivity in W/(m K); 400 is copper")
    # Boundary temperatures are expressed in `temperature_unit` when sent; the defaults below are in Kelvin.
    bc_left_temp: Optional[float] = Field(default=373.15, description="Left edge (x = 0) temperature")
    bc_right_temp: Optional[float] = Field(default=293.15, description="Right edge (x = width) temperature")
    bc_top_temp: Optional[float] = Field(default=293.15, description="Top edge (y = height) temperature")
    bc_bottom_temp: Optional[float] = Field(default=293.15, description="Bottom edge (y = 0) temperature")

    @field_validator(
        "velocity", "pressure", "displacement", "temperature", "width_x", "height_y",
        "thermal_conductivity_k", "bc_left_temp", "bc_right_temp", "bc_top_temp", "bc_bottom_temp",
    )
    @classmethod
    def validate_finite_numbers(cls, value: Optional[float], info: ValidationInfo) -> Optional[float]:
        if value is not None:
            if isinstance(value, bool) or math.isnan(value) or math.isinf(value):
                raise ValueError("Numeric fields must be finite numbers.")
            if info.field_name in ("width_x", "height_y") and value <= 0.0:
                raise ValueError(f"{info.field_name} must be strictly greater than 0 (meters).")
            if info.field_name == "thermal_conductivity_k" and value <= 0.0:
                raise ValueError("thermal_conductivity_k must be strictly greater than 0 W/(m K).")
        return value

    @model_validator(mode="after")
    def normalize_and_validate_physics(self) -> "SimulationRequest":
        # تحويل الحرارة إلى كلفن والتأكد من النطاق الفيزيائي
        unit = self.temperature_unit

        def to_kelvin(value: float) -> float:
            if unit == "C":
                return value + 273.15
            if unit == "F":
                return (value - 32) * 5 / 9 + 273.15
            return value

        if self.temperature is not None:
            t_kelvin = to_kelvin(self.temperature)
            if t_kelvin < 50.0 or t_kelvin > 5000.0:
                raise ValueError(f"Normalized temperature ({t_kelvin:.2f} K) outside physical bounds [50K, 5000K].")
            self.temperature = t_kelvin
            self.temperature_unit = "K"

        # Only values supplied by the client are in `temperature_unit`; untouched defaults are already Kelvin.
        for name in ("bc_left_temp", "bc_right_temp", "bc_top_temp", "bc_bottom_temp"):
            value = getattr(self, name)
            if value is None or name not in self.model_fields_set:
                continue
            t_kelvin = to_kelvin(value)
            if t_kelvin < 50.0 or t_kelvin > 5000.0:
                raise ValueError(f"{name} ({t_kelvin:.2f} K after normalization) outside physical bounds [50K, 5000K].")
            setattr(self, name, t_kelvin)
        self.temperature_unit = "K"

        # اشتراط ضغط موجب للجريان الانضغاطي
        if self.simulation_type == PhysicsType.CFD_COMPRESSIBLE:
            if self.pressure is None or self.pressure <= 0.0:
                raise ValueError("Compressible CFD requires a strictly positive absolute pressure (Pa).")
        return self

    def to_solver_payload(self) -> dict:
        """Dump the request and expose the settings in the nested shapes the solvers read."""
        payload = self.model_dump(mode="json")
        # An explicit null from the client must not reach the solvers, so fall back to the declared defaults.
        def or_default(name: str, default: float) -> float:
            value = getattr(self, name)
            return value if value is not None else default

        width_x = or_default("width_x", 1.0)
        height_y = or_default("height_y", 1.0)
        mesh_size = or_default("mesh_size", 0.1)
        conductivity = or_default("thermal_conductivity_k", 400.0)
        payload.update({
            "width_x": width_x, "height_y": height_y, "mesh_size": mesh_size,
            "thermal_conductivity_k": conductivity,
        })
        payload["domain"] = {"width_x": width_x, "height_y": height_y}
        payload["mesh_settings"] = {"mesh_size": mesh_size}
        payload["material_properties"] = {"thermal_conductivity_k": conductivity}

        # The SciPy thermal solver works in degC, while the request is normalized to Kelvin.
        def celsius(name: str, default_kelvin: float) -> dict:
            return {"value": or_default(name, default_kelvin) - 273.15}

        payload["boundary_conditions"] = {
            "left_edge_x0": celsius("bc_left_temp", 373.15),
            "right_edge_x1": celsius("bc_right_temp", 293.15),
            "top_edge_y1": celsius("bc_top_temp", 293.15),
            "bottom_edge_y0": celsius("bc_bottom_temp", 293.15),
        }
        return payload

# ---------------------------------------------------------
# 2. Exception Handlers (إدارة الأخطاء وتوحيد الردود)
# ---------------------------------------------------------
@app.exception_handler(JSONDecodeError)
async def json_decode_error_handler(request: Request, exc: JSONDecodeError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"success": False, "code": "INVALID_JSON", "error": f"Malformed JSON request at line {exc.lineno}"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # exc.errors() may embed raw exceptions (ctx) that are not JSON serializable, so only safe fields are returned.
    details = [
        {"loc": list(error.get("loc", ())), "msg": str(error.get("msg", "")), "type": str(error.get("type", ""))}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"success": False, "code": "INVALID_REQUEST", "details": details}
    )

# ---------------------------------------------------------
# 3. API Routes (المسارات الموحدة)
# ---------------------------------------------------------
@app.get("/api/health")
async def health_check():
    return {"status": "ONLINE", "service": "NASEER_CAE_API"}

@app.post("/api/run-simulation")
async def run_simulation(request: SimulationRequest):
    payload = request.to_solver_payload()
    
    if payload["execution_mode"] == "celery":
        task_id = str(uuid.uuid4())
        try:
            # Register the job first so the worker can always update an existing record.
            job_repository.create(task_id, payload)
            celery_app.send_task(
                "universal_dispatcher.run_simulation",
                args=[payload],
                kwargs={},
                task_id=task_id,
            )
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={"success": True, "task_id": task_id, "status": "QUEUED"}
            )
        except Exception as e:
            job_repository.update(task_id, status="FAILED", error=str(e))
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"success": False, "code": "BROKER_UNAVAILABLE", "error": str(e)}
            )
    else:
        # التشغيل المباشر لأغراض التطوير
        result = execute_simulation(payload)
        if result.get("status") == "error":
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "code": "SIMULATION_FAILED", "error": result.get("error"), "result": result}
            )
        return {"success": True, "result": result}

@app.get("/api/jobs/{task_id}")
async def get_job_status(task_id: str):
    # التحقق من وجود المهمة فعلياً في المستودع
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} does not exist."}
        )
    return job


# ---------------------------------------------------------
# 4. Mesh Independence Study (Celik GCI) — real multi-grid runs
# ---------------------------------------------------------
class MeshStudyRequest(SimulationRequest):
    # Which physics-specific scalar to compare across meshes; None selects the default for the physics type.
    key_result: Optional[str] = None


def _study_error(code: str, message: str, http_status: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> JSONResponse:
    return JSONResponse(status_code=http_status, content={"success": False, "code": code, "error": message})


@app.get("/api/mesh-study/key-results")
def mesh_study_key_results(simulation_type: str):
    """Key results the study can compare for a physics type (single source of truth for the UI)."""
    try:
        specs = key_result_specs(simulation_type)
    except KeyResultUnavailable as exc:
        return _study_error("UNSUPPORTED_PHYSICS", str(exc))
    return {"success": True, "simulation_type": simulation_type, "key_results": [spec.to_dict() for spec in specs]}


# A plain `def` so FastAPI runs it in a worker thread: three solver runs must not block the event loop.
@app.post("/api/mesh-study")
def mesh_independence_study(request: MeshStudyRequest):
    """Run the solver on coarse/medium/fine meshes and compute the Grid Convergence Index of a key result."""
    payload = request.to_solver_payload()
    key_result = payload.pop("key_result", None)
    payload["execution_mode"] = "direct"
    physics_type = classify_physics(payload)
    try:
        study = run_mesh_study(payload, physics_type, key_result, execute_simulation)
    except KeyResultUnavailable as exc:
        return _study_error("KEY_RESULT_UNAVAILABLE", str(exc))
    except MeshStudyError as exc:
        return _study_error(exc.code, str(exc))
    return {"success": True, "study": study}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)