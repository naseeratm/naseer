import math
import os
import shutil
import uuid
from enum import Enum
from json import JSONDecodeError
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

from backend.file_parser import parse_engineering_file
from backend.vv_metrics import KeyResultUnavailable, MeshStudyError, key_result_specs, run_mesh_study
from cae_repository import JobRepository
from universal_dispatcher import (
    call_gmsh_mesher,
    celery_app,
    classify_physics,
    execute_simulation,
    preview_cad_geometry,
    probe_worker_capabilities,
)

job_repository = JobRepository()

app = FastAPI(title="NASEER Universal CAE Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# 1. Pydantic Models for Input Validation
# ---------------------------------------------------------
class PhysicsType(str, Enum):
    CFD_INCOMPRESSIBLE = "CFD_Incompressible"
    CFD_COMPRESSIBLE = "CFD_Compressible"
    STRUCTURAL_STATIC = "Structural_Static"
    STRUCTURAL_DYNAMIC = "Structural_Dynamic"
    STRUCTURAL_BUCKLING = "Structural_Buckling"
    THERMAL_TRANSIENT = "Thermal_Transient"
    THERMAL_STEADY = "Thermal_Steady"
    THERMAL_RADIATION = "Thermal_Radiation"
    THERMAL_STRUCTURAL = "Thermal_Structural"
    CHT_COUPLED = "CHT_Coupled"
    MULTIPHASE_VOF = "Multiphase_VOF"
    ELECTROMAGNETIC = "Electromagnetic"
    ACOUSTICS = "Acoustics"
    MULTIPHYSICS = "Multiphysics"
    # UI studio canonical aliases
    CFD = "CFD"
    FEA = "FEA"
    THERMAL = "Thermal"


class ExecutionMode(str, Enum):
    DIRECT = "direct"
    CELERY = "celery"


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    simulation_type: PhysicsType
    execution_mode: ExecutionMode = ExecutionMode.CELERY
    velocity: Optional[float] = Field(default=1.0, description="Velocity in m/s")
    temperature: Optional[float] = Field(default=293.15, description="Temperature value")
    temperature_unit: Optional[str] = Field(default="K", pattern="^(K|C|F)$")
    pressure: Optional[float] = Field(default=101325.0, description="Absolute pressure in Pa")
    displacement: Optional[float] = Field(default=0.0, description="Structural displacement in meters")
    mesh_size: Optional[float] = Field(default=0.1, gt=0.0, description="Characteristic mesh size")
    width_x: Optional[float] = Field(default=1.0, description="Domain width in meters")
    height_y: Optional[float] = Field(default=0.4, description="Domain height in meters")
    depth_z: Optional[float] = Field(default=0.1, description="Domain depth in meters")

    # Material & thermal properties
    thermal_conductivity_k: Optional[float] = Field(default=400.0, description="Thermal conductivity in W/(m K)")
    young_modulus: Optional[float] = Field(default=210e9, description="Young's Modulus in Pa")
    poisson_ratio: Optional[float] = Field(default=0.3, description="Poisson's ratio")
    density: Optional[float] = Field(default=7850.0, description="Density in kg/m3")
    specific_heat: Optional[float] = Field(default=460.0, description="Specific heat capacity in J/(kg K)")
    thermal_expansion: Optional[float] = Field(default=1.2e-5, description="Thermal expansion coeff (1/K)")

    # Boundary temperatures
    bc_left_temp: Optional[float] = Field(default=373.15, description="Left edge (x = 0) temperature")
    bc_right_temp: Optional[float] = Field(default=293.15, description="Right edge (x = width) temperature")
    bc_top_temp: Optional[float] = Field(default=293.15, description="Top edge (y = height) temperature")
    bc_bottom_temp: Optional[float] = Field(default=293.15, description="Bottom edge (y = 0) temperature")

    # Extended CAE controls preserved for OpenFOAM / CalculiX / ElmerFEM / Gmsh
    turbulence_model: Optional[str] = Field(default="laminar")
    fluid_properties: Optional[Dict[str, Any]] = None
    fluid_density: Optional[float] = None
    dynamic_viscosity: Optional[float] = None
    time_mode: Optional[str] = Field(default="steady")
    time_step: Optional[float] = None
    end_time: Optional[float] = None
    gravity_enabled: Optional[bool] = False
    gravity_y: Optional[float] = Field(default=-9.81)
    discretization_scheme: Optional[str] = Field(default="second_order")
    relaxation_p: Optional[float] = None
    relaxation_u: Optional[float] = None
    relaxation_t: Optional[float] = None
    residual_target: Optional[float] = None
    heat_flux: Optional[float] = None
    convection_h: Optional[float] = None
    emissivity: Optional[float] = None
    ambient_temp_c: Optional[float] = None
    pressure_load_mpa: Optional[float] = None
    force_n: Optional[float] = None
    support_type: Optional[str] = Field(default="cantilever")
    nonlinear: Optional[bool] = False
    modes_count: Optional[int] = None
    contact_type: Optional[str] = Field(default="Bonded")
    solver_iterations: Optional[int] = None
    element_order: Optional[int] = Field(default=1)
    inflation_layers: Optional[int] = None
    first_layer_height: Optional[float] = None
    growth_rate: Optional[float] = None
    boundary_markers: Optional[List[Dict[str, Any]]] = None
    region_box: Optional[Dict[str, Any]] = None
    cad_stl_b64: Optional[str] = None
    cad_file_b64: Optional[str] = None
    cad_filename: Optional[str] = None
    uploaded_file_path: Optional[str] = None
    inp_deck: Optional[str] = None
    openfoam_archive_b64: Optional[str] = None
    em_parameters: Optional[Dict[str, Any]] = None
    em_submode: Optional[str] = None
    electrical_conductivity: Optional[float] = None
    relative_permeability: Optional[float] = None
    relative_permittivity: Optional[float] = None
    current_density: Optional[float] = None

    @field_validator(
        "velocity", "pressure", "displacement", "temperature", "width_x", "height_y", "depth_z",
        "thermal_conductivity_k", "young_modulus", "poisson_ratio", "density",
        "bc_left_temp", "bc_right_temp", "bc_top_temp", "bc_bottom_temp",
    )
    @classmethod
    def validate_finite_numbers(cls, value: Optional[float], info: ValidationInfo) -> Optional[float]:
        if value is not None:
            if isinstance(value, bool) or math.isnan(value) or math.isinf(value):
                raise ValueError("Numeric fields must be finite numbers.")
            if info.field_name in ("width_x", "height_y", "depth_z") and value <= 0.0:
                raise ValueError(f"{info.field_name} must be strictly greater than 0 (meters).")
            if info.field_name in ("thermal_conductivity_k", "young_modulus", "density") and value <= 0.0:
                raise ValueError(f"{info.field_name} must be strictly greater than 0.")
        return value

    @model_validator(mode="after")
    def normalize_and_validate_physics(self) -> "SimulationRequest":
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

        for name in ("bc_left_temp", "bc_right_temp", "bc_top_temp", "bc_bottom_temp"):
            value = getattr(self, name)
            if value is None or name not in self.model_fields_set:
                continue
            t_kelvin = to_kelvin(value)
            if t_kelvin < 50.0 or t_kelvin > 5000.0:
                raise ValueError(f"{name} ({t_kelvin:.2f} K after normalization) outside physical bounds.")
            setattr(self, name, t_kelvin)
        self.temperature_unit = "K"

        if self.simulation_type == PhysicsType.CFD_COMPRESSIBLE:
            if self.pressure is None or self.pressure <= 0.0:
                raise ValueError("Compressible CFD requires a strictly positive absolute pressure (Pa).")
        return self

    def to_solver_payload(self) -> dict:
        payload = self.model_dump(mode="json")

        def or_default(name: str, default: float) -> float:
            value = getattr(self, name)
            return value if value is not None else default

        width_x = or_default("width_x", 1.0)
        height_y = or_default("height_y", 0.4)
        depth_z = or_default("depth_z", 0.1)
        mesh_size = or_default("mesh_size", 0.1)
        conductivity = or_default("thermal_conductivity_k", 400.0)
        young = or_default("young_modulus", 210e9)
        poisson = or_default("poisson_ratio", 0.3)
        rho = or_default("density", 7850.0)
        cp_val = or_default("specific_heat", 460.0)
        alpha_val = or_default("thermal_expansion", 1.2e-5)

        payload.update({
            "width_x": width_x,
            "height_y": height_y,
            "depth_z": depth_z,
            "mesh_size": mesh_size,
        })
        payload["domain"] = {"width_x": width_x, "height_y": height_y, "depth_z": depth_z}
        payload["mesh_settings"] = {"mesh_size": mesh_size}
        payload["material_properties"] = {
            "thermal_conductivity_k": conductivity,
            "young_modulus": young,
            "poisson_ratio": poisson,
            "density": rho,
            "specific_heat": cp_val,
            "thermal_expansion": alpha_val,
        }
        payload["material"] = payload["material_properties"]

        fluid_props = dict(payload.get("fluid_properties") or {})
        if self.fluid_density is not None and self.fluid_density > 0:
            fluid_props.setdefault("density", self.fluid_density)
        if self.dynamic_viscosity is not None and self.dynamic_viscosity > 0:
            fluid_props.setdefault("viscosity", self.dynamic_viscosity)
        if fluid_props:
            payload["fluid_properties"] = fluid_props

        def kelvin_to_celsius(name: str, default_kelvin: float) -> dict:
            return {"value": or_default(name, default_kelvin) - 273.15}

        extra_bcs = payload.get("boundary_conditions") if isinstance(payload.get("boundary_conditions"), dict) else {}
        payload["boundary_conditions"] = {
            **extra_bcs,
            "left_edge_x0": kelvin_to_celsius("bc_left_temp", 373.15),
            "right_edge_x1": kelvin_to_celsius("bc_right_temp", 293.15),
            "top_edge_y1": kelvin_to_celsius("bc_top_temp", 293.15),
            "bottom_edge_y0": kelvin_to_celsius("bc_bottom_temp", 293.15),
        }
        return payload


class MeshGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    width_x: float = Field(default=1.0, gt=0.0)
    height_y: float = Field(default=0.4, gt=0.0)
    depth_z: float = Field(default=0.2, gt=0.0)
    mesh_size: float = Field(default=0.05, gt=0.0)
    dimension: int = Field(default=3, ge=2, le=3)
    element_order: int = Field(default=1, ge=1, le=2)
    inflation_layers: int = Field(default=0, ge=0, le=30)
    first_layer_height: float = Field(default=0.002, gt=0.0)
    growth_rate: float = Field(default=1.2, ge=1.0, le=3.0)
    cad_stl_b64: Optional[str] = None
    cad_file_b64: Optional[str] = None
    cad_filename: Optional[str] = None
    uploaded_file_path: Optional[str] = None
    execution_mode: ExecutionMode = ExecutionMode.CELERY


class CadPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    cad_stl_b64: Optional[str] = None
    cad_file_b64: Optional[str] = None
    cad_filename: Optional[str] = None
    uploaded_file_path: Optional[str] = None


class ParametricSweepRequest(SimulationRequest):
    sweep_parameter: str = Field(default="velocity")
    values: List[float] = Field(..., min_length=2, max_length=25)


# ---------------------------------------------------------
# 2. Exception Handlers
# ---------------------------------------------------------
@app.exception_handler(JSONDecodeError)
async def json_decode_error_handler(request: Request, exc: JSONDecodeError):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"success": False, "code": "INVALID_JSON", "error": f"Malformed JSON request at line {exc.lineno}"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = [
        {"loc": list(error.get("loc", ())), "msg": str(error.get("msg", "")), "type": str(error.get("type", ""))}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"success": False, "code": "INVALID_REQUEST", "details": details},
    )


# ---------------------------------------------------------
# 3. API Routes (Unified Port 8000 Authority)
# ---------------------------------------------------------
@app.get("/api/health")
async def health_check():
    """Live probe of container solvers (from worker container if online), Redis broker, and active Celery workers."""
    local_solvers = probe_worker_capabilities()
    redis_ok = False
    workers_online = 0
    worker_names: List[str] = []
    worker_solvers = local_solvers
    try:
        conn = celery_app.connection_for_read()
        conn.ensure_connection(max_retries=1)
        conn.close()
        redis_ok = True
        inspector = celery_app.control.inspect(timeout=1.2)
        ping_res = inspector.ping() or {}
        if isinstance(ping_res, dict):
            worker_names = list(ping_res.keys())
            workers_online = len(worker_names)
        if workers_online > 0:
            try:
                async_probe = celery_app.send_task("universal_dispatcher.probe_capabilities")
                probed = async_probe.get(timeout=5.0)
                if isinstance(probed, dict):
                    worker_solvers = probed
            except Exception:
                worker_solvers = local_solvers
    except Exception:
        redis_ok = False

    return {
        "status": "ONLINE" if redis_ok and workers_online > 0 else ("API_ONLY_NO_WORKER" if redis_ok else "DEGRADED"),
        "service": "NASEER_CAE_API",
        "port": 8000,
        "redis": redis_ok,
        "workers_online": workers_online,
        "worker_names": worker_names,
        "solvers": worker_solvers,
    }


@app.post("/api/upload-model")
async def upload_model(file: UploadFile = File(...), directives: str = Form(default="")):
    """Parse uploaded CAD/mesh/script (.stl, .step, .inp, .zip, .mac, .csv) and persist on shared workspace."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    upload_dir = Path(os.getenv("NASEER_JOB_DIR", "/app/jobs" if Path("/app/jobs").exists() else "jobs")) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "model.stl").name
    stored_path = upload_dir / f"{uuid.uuid4().hex[:10]}_{safe_name}"
    stored_path.write_bytes(raw)

    parsed = parse_engineering_file(raw, safe_name)
    return {
        "success": True,
        "upload_id": stored_path.stem,
        "uploaded_file_path": str(stored_path),
        "filename": safe_name,
        "size_bytes": len(raw),
        "directives": directives,
        **parsed,
    }


@app.post("/api/run-simulation")
async def run_simulation(request: SimulationRequest):
    payload = request.to_solver_payload()
    physics_type = classify_physics(payload)

    if payload["execution_mode"] == "celery":
        task_id = str(uuid.uuid4())
        try:
            job_repository.create(task_id, {**payload, "physics_type": physics_type})
            celery_app.send_task(
                "universal_dispatcher.run_simulation",
                args=[payload],
                kwargs={},
                task_id=task_id,
            )
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={"success": True, "task_id": task_id, "status": "QUEUED", "physics_type": physics_type},
            )
        except Exception as e:
            job_repository.update(task_id, status="FAILED", error=str(e))
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"success": False, "code": "BROKER_UNAVAILABLE", "error": str(e)},
            )
    else:
        result = execute_simulation(payload)
        if result.get("status") == "error":
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "code": "SIMULATION_FAILED", "error": result.get("error"), "result": result},
            )
        return {"success": True, "result": result}


@app.get("/api/jobs/{task_id}")
async def get_job_status(task_id: str):
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} does not exist."},
        )
    return job


@app.post("/api/jobs/{task_id}/cancel")
async def cancel_job(task_id: str):
    """Revoke running/queued Celery task and mark CANCELLED in SQLite repository."""
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} does not exist."})
    try:
        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")
    except Exception:
        pass
    updated = job_repository.update(
        task_id,
        status="CANCELLED",
        progress=job.get("progress", 0),
        error="Cancelled by engineer",
    )
    return {"success": True, "task_id": task_id, "status": "CANCELLED", "job": updated}


@app.get("/api/verify-job/{task_id}")
async def verify_job_provenance(task_id: str):
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} not found."})
    res = job.get("result") or {}
    return {
        "success": True,
        "task_id": task_id,
        "status": job.get("status"),
        "provenance": res.get("provenance", {}),
        "solver": res.get("solver"),
        "physics_type": res.get("physics_type"),
        "convergence": res.get("convergence", {}),
        "created_at": job.get("created_at"),
        "completed_at": job.get("completed_at"),
    }


@app.post("/api/cad-preview")
async def cad_preview_endpoint(request: CadPreviewRequest):
    """Tessellate uploaded .STL/.STEP/.IGES/.INP/.MSH CAD via real Gmsh/meshio on Docker worker or local."""
    payload = request.model_dump(mode="json")
    local_caps = probe_worker_capabilities()
    has_local_gmsh = bool(local_caps.get("gmsh", {}).get("available"))
    try:
        if has_local_gmsh:
            preview_res = preview_cad_geometry(payload)
        else:
            task = celery_app.send_task("universal_dispatcher.preview_cad", args=[payload])
            preview_res = task.get(timeout=45.0)
        return {"success": True, **preview_res}
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"success": False, "code": "CAD_PREVIEW_FAILED", "error": str(exc)},
        )


@app.post("/api/mesh-generate")
async def generate_mesh_endpoint(request: MeshGenerateRequest):
    """Run real Gmsh 2D/3D meshing on parametric domain or uploaded CAD STL/STEP."""
    payload = request.model_dump(mode="json")
    if request.execution_mode == ExecutionMode.CELERY:
        task_id = str(uuid.uuid4())
        try:
            job_repository.create(task_id, {"action": "mesh_generate", **payload})
            celery_app.send_task("universal_dispatcher.generate_mesh", args=[payload], task_id=task_id)
            return JSONResponse(status_code=202, content={"success": True, "task_id": task_id, "status": "QUEUED"})
        except Exception as exc:
            job_repository.update(task_id, status="FAILED", error=str(exc))
            return JSONResponse(status_code=503, content={"success": False, "code": "BROKER_UNAVAILABLE", "error": str(exc)})
    try:
        mesh_res = call_gmsh_mesher(payload)
        return {"success": True, "mesh": mesh_res}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"success": False, "code": "MESHER_FAILED", "error": str(exc)})


@app.post("/api/parametric-sweep")
async def run_parametric_sweep(request: ParametricSweepRequest):
    """Dispatch each parametric sweep sample as a genuine Celery solver job."""
    base = request.to_solver_payload()
    param_name = base.pop("sweep_parameter", "velocity")
    values = base.pop("values", [])
    physics_type = classify_physics(base)

    runs: List[Dict[str, Any]] = []
    for val in values:
        run_payload = dict(base)
        if param_name == "velocity":
            run_payload["velocity"] = float(val)
        elif param_name in {"heat_flux", "heatFlux"}:
            run_payload["heat_flux"] = float(val)
        elif param_name in {"temperature", "bc_left_temp"}:
            t_k = float(val) + 273.15 if float(val) < 150.0 else float(val)
            run_payload["bc_left_temp"] = t_k
            run_payload["temperature"] = t_k
        elif param_name in {"pressure_load_mpa", "force"}:
            run_payload["pressure_load_mpa"] = float(val)
        elif param_name == "mesh_size":
            run_payload["mesh_size"] = max(1e-4, float(val))
        else:
            run_payload[param_name] = float(val)

        task_id = str(uuid.uuid4())
        job_repository.create(task_id, {**run_payload, "sweep_parameter": param_name, "sweep_value": val})
        celery_app.send_task("universal_dispatcher.run_simulation", args=[run_payload], kwargs={}, task_id=task_id)
        runs.append({"value": float(val), "task_id": task_id, "status": "QUEUED"})

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "success": True,
            "physics_type": physics_type,
            "sweep_parameter": param_name,
            "runs": runs,
        },
    )


# ---------------------------------------------------------
# 4. Mesh Independence Study (Celik GCI)
# ---------------------------------------------------------
class MeshStudyRequest(SimulationRequest):
    key_result: Optional[str] = None


def _study_error(code: str, message: str, http_status: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> JSONResponse:
    return JSONResponse(status_code=http_status, content={"success": False, "code": code, "error": message})


@app.get("/api/mesh-study/key-results")
def mesh_study_key_results(simulation_type: str):
    try:
        specs = key_result_specs(simulation_type)
    except KeyResultUnavailable as exc:
        return _study_error("UNSUPPORTED_PHYSICS", str(exc))
    return {"success": True, "simulation_type": simulation_type, "key_results": [spec.to_dict() for spec in specs]}


@app.post("/api/mesh-study")
def mesh_independence_study(request: MeshStudyRequest):
    payload = request.to_solver_payload()
    key_result = payload.pop("key_result", None)
    physics_type = classify_physics(payload)

    local_caps = probe_worker_capabilities()
    has_local_solvers = any(
        bool(local_caps.get(k, {}).get("available"))
        for k in ("openfoam", "calculix", "elmer")
    )

    def _run_level_via_worker_or_local(level_payload: dict) -> dict:
        if has_local_solvers:
            return execute_simulation({**level_payload, "execution_mode": "direct"})
        try:
            task = celery_app.send_task(
                "universal_dispatcher.run_simulation",
                args=[{**level_payload, "execution_mode": "celery"}],
            )
            res = task.get(timeout=180.0)
            return res if isinstance(res, dict) else {"status": "error", "error": "Invalid worker response"}
        except Exception as exc:
            return {"status": "error", "error": f"Worker execution failed: {exc}"}

    try:
        study = run_mesh_study(payload, physics_type, key_result, _run_level_via_worker_or_local)
    except KeyResultUnavailable as exc:
        return _study_error("KEY_RESULT_UNAVAILABLE", str(exc))
    except MeshStudyError as exc:
        return _study_error(exc.code, str(exc))
    return {"success": True, "study": study}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)