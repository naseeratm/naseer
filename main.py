import io
import math
import os
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from enum import Enum
from json import JSONDecodeError
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

from backend.file_parser import parse_engineering_file
from backend.vv_metrics import KeyResultUnavailable, MeshStudyError, key_result_specs, run_mesh_study
from cae_repository import JobRepository
from enterprise_security import EnterpriseSecurityService, SecurityError
from object_storage import ObjectStorageError, ObjectStorageService
from universal_dispatcher import (
    call_gmsh_mesher,
    celery_app,
    classify_physics,
    compute_wall_clock_sec,
    execute_simulation,
    preview_cad_geometry,
    probe_worker_capabilities,
    sample_node_telemetry,
)
from vv_regression_suite import (
    VV_BENCHMARK_BY_ID,
    generate_vv_certificate_markdown,
    list_vv_benchmarks,
    run_vv_suite,
)

job_repository = JobRepository()
security_service = EnterpriseSecurityService(job_repository.engine)
object_storage = ObjectStorageService()

app = FastAPI(title="NASEER Universal CAE Engine API")


def _resolve_allowed_origins() -> List[str]:
    configured = (os.getenv("NASEER_ALLOWED_ORIGINS") or "").strip()
    if configured:
        origins = [o.strip().rstrip("/") for o in configured.split(",") if o.strip() and o.strip() != "*"]
        if origins:
            return origins
    defaults = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    app_url = (os.getenv("APP_URL") or "").strip().rstrip("/")
    if app_url and app_url.startswith(("http://", "https://")) and app_url not in defaults:
        defaults.append(app_url)
    return defaults


app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
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
    material_model: Optional[str] = Field(default="linear_elastic")
    yield_stress_pa: Optional[float] = None
    tangent_modulus_pa: Optional[float] = None
    hyper_c10_pa: Optional[float] = None
    hyper_d1_inv_pa: Optional[float] = None
    modes_count: Optional[int] = None
    contact_type: Optional[str] = Field(default="Bonded")
    friction_coeff: Optional[float] = None
    mrf_enabled: Optional[bool] = False
    mrf_omega_rad_s: Optional[float] = None
    mrf_radius: Optional[float] = None
    mrf_axis: Optional[Any] = None
    mrf_origin: Optional[List[float]] = None
    solver_iterations: Optional[int] = None
    parallel_cores: Optional[int] = Field(default=1, ge=1, le=64)
    element_order: Optional[int] = Field(default=1)
    inflation_layers: Optional[int] = None
    first_layer_height: Optional[float] = None
    growth_rate: Optional[float] = None
    boundary_markers: Optional[List[Dict[str, Any]]] = None
    boundary_patches: Optional[List[Dict[str, Any]]] = None
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
        "yield_stress_pa", "tangent_modulus_pa", "hyper_c10_pa", "hyper_d1_inv_pa",
        "friction_coeff", "mrf_omega_rad_s", "mrf_radius",
    )
    @classmethod
    def validate_finite_numbers(cls, value: Optional[float], info: ValidationInfo) -> Optional[float]:
        if value is not None:
            if isinstance(value, bool) or math.isnan(value) or math.isinf(value):
                raise ValueError("Numeric fields must be finite numbers.")
            if info.field_name in ("width_x", "height_y", "depth_z", "mrf_radius") and value <= 0.0:
                raise ValueError(f"{info.field_name} must be strictly greater than 0 (meters).")
            if info.field_name in ("thermal_conductivity_k", "young_modulus", "density", "yield_stress_pa", "hyper_c10_pa") and value <= 0.0:
                raise ValueError(f"{info.field_name} must be strictly greater than 0.")
            if info.field_name in ("friction_coeff", "hyper_d1_inv_pa", "tangent_modulus_pa") and value < 0.0:
                raise ValueError(f"{info.field_name} must be non-negative.")
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


@app.exception_handler(SecurityError)
async def security_error_handler(request: Request, exc: SecurityError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "code": "SECURITY_POLICY_VIOLATION", "error": exc.detail},
    )


@app.exception_handler(ObjectStorageError)
async def object_storage_error_handler(request: Request, exc: ObjectStorageError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "code": "OBJECT_STORAGE_ERROR", "error": exc.detail},
    )


# ---------------------------------------------------------
# 3. API Routes (Unified Port 8000 Authority)
# ---------------------------------------------------------
def _inspect_celery_cluster() -> Dict[str, Any]:
    """Query live Redis broker and Celery control plane for worker nodes, cores, and active/queued tasks."""
    local_solvers = probe_worker_capabilities()
    host_cores = os.cpu_count() or 1
    mpi_cores_per_worker = max(1, int(os.getenv("NASEER_MPI_CORES_PER_WORKER", str(min(host_cores, 4)))))
    redis_ok = False
    workers_online = 0
    worker_names: List[str] = []
    workers_detail: List[Dict[str, Any]] = []
    active_tasks_count = 0
    queued_tasks_count = 0
    total_cluster_cores = 0
    worker_solvers = local_solvers

    try:
        conn = celery_app.connection_for_read()
        conn.ensure_connection(max_retries=1)
        conn.close()
        redis_ok = True
        inspector = celery_app.control.inspect(timeout=1.5)
        ping_res = inspector.ping() or {}
        if isinstance(ping_res, dict) and ping_res:
            worker_names = sorted(ping_res.keys())
            workers_online = len(worker_names)
            stats_res = inspector.stats() or {}
            active_res = inspector.active() or {}
            reserved_res = inspector.reserved() or {}

            for w_name in worker_names:
                w_stats = stats_res.get(w_name, {}) if isinstance(stats_res, dict) else {}
                pool_info = w_stats.get("pool", {}) if isinstance(w_stats, dict) else {}
                concurrency = int(pool_info.get("max-concurrency") or 1)
                w_active = active_res.get(w_name, []) if isinstance(active_res, dict) else []
                w_reserved = reserved_res.get(w_name, []) if isinstance(reserved_res, dict) else []
                n_active = len(w_active) if isinstance(w_active, list) else 0
                n_queued = len(w_reserved) if isinstance(w_reserved, list) else 0
                active_tasks_count += n_active
                queued_tasks_count += n_queued
                node_cores = max(concurrency, mpi_cores_per_worker)
                total_cluster_cores += node_cores
                workers_detail.append({
                    "name": w_name,
                    "status": "ONLINE",
                    "pid": w_stats.get("pid"),
                    "concurrency": concurrency,
                    "mpi_cores": node_cores,
                    "active_tasks": n_active,
                    "queued_tasks": n_queued,
                })

            try:
                async_probe = celery_app.send_task("universal_dispatcher.probe_capabilities")
                probed = async_probe.get(timeout=4.0)
                if isinstance(probed, dict):
                    worker_solvers = probed
            except Exception:
                worker_solvers = local_solvers
    except Exception:
        redis_ok = False

    if total_cluster_cores == 0:
        total_cluster_cores = host_cores

    return {
        "status": "ONLINE" if redis_ok and workers_online > 0 else ("API_ONLY_NO_WORKER" if redis_ok else "DEGRADED"),
        "service": "NASEER_CAE_API",
        "port": 8000,
        "redis": redis_ok,
        "workers_online": workers_online,
        "worker_names": worker_names,
        "workers": workers_detail,
        "total_cluster_cores": total_cluster_cores,
        "host_cpu_cores": host_cores,
        "mpi_cores_per_worker": mpi_cores_per_worker,
        "active_tasks_count": active_tasks_count,
        "queued_tasks_count": queued_tasks_count,
        "solvers": worker_solvers,
    }


@app.get("/api/health")
async def health_check():
    """Live probe of container solvers (from worker container if online), Redis broker, and active Celery workers."""
    return _inspect_celery_cluster()


@app.get("/api/cluster/status")
async def cluster_status():
    """Detailed HPC cluster telemetry for multi-worker scaling and live node monitoring."""
    return _inspect_celery_cluster()


@app.post("/api/upload-model")
async def upload_model(http_request: Request, file: UploadFile = File(...), directives: str = Form(default="")):
    """Parse uploaded CAD/mesh/script (.stl, .step, .inp, .zip, .mac, .csv) and persist on shared workspace."""
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
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
async def run_simulation(request: SimulationRequest, http_request: Request):
    actor = security_service.resolve_actor(
        http_request.headers.get("authorization"),
        require_role="engineer",
    )
    client_ip = http_request.client.host if http_request.client else "local"
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
            security_service.record_audit(
                actor_email=actor["email"],
                actor_role=actor["role"],
                workspace_id=actor.get("workspace_id", "ws-default"),
                action="simulation.submit",
                resource=f"job:{task_id}",
                status="allowed",
                detail={"physics_type": physics_type, "execution_mode": "celery"},
                ip_address=client_ip,
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
        security_service.record_audit(
            actor_email=actor["email"],
            actor_role=actor["role"],
            workspace_id=actor.get("workspace_id", "ws-default"),
            action="simulation.run_direct",
            resource=f"physics:{physics_type}",
            status="allowed" if result.get("status") != "error" else "failed",
            detail={"physics_type": physics_type, "execution_mode": "direct"},
            ip_address=client_ip,
        )
        if result.get("status") == "error":
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "code": "SIMULATION_FAILED", "error": result.get("error"), "result": result},
            )
        return {"success": True, "result": result}


_compute_wall_clock_sec = compute_wall_clock_sec


@app.get("/api/jobs/{task_id}")
async def get_job_status(task_id: str, http_request: Request):
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="viewer")
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} does not exist."},
        )
    status_upper = str(job.get("status", "")).upper()
    job_wall = _compute_wall_clock_sec(
        job.get("created_at"),
        job.get("completed_at") if status_upper not in {"QUEUED", "RUNNING"} else None,
    )
    if job_wall is not None:
        job["wall_clock_sec"] = job_wall
    if status_upper in {"QUEUED", "RUNNING"}:
        try:
            async_res = celery_app.AsyncResult(task_id)
            meta = async_res.info if isinstance(async_res.info, dict) else {}
            if meta:
                if isinstance(meta.get("progress"), (int, float)):
                    job["progress"] = max(int(job.get("progress") or 0), int(meta["progress"]))
                if isinstance(meta.get("logs"), list) and meta["logs"]:
                    job["logs"] = meta["logs"]
                if isinstance(meta.get("live_residuals"), dict) and meta["live_residuals"]:
                    job["live_residuals"] = meta["live_residuals"]
                if isinstance(meta.get("current_iteration"), int):
                    job["current_iteration"] = meta["current_iteration"]
                if isinstance(meta.get("status_message"), str):
                    job["status_message"] = meta["status_message"]
                if isinstance(meta.get("telemetry"), dict) and meta["telemetry"]:
                    tel = dict(meta["telemetry"])
                    if job_wall is not None:
                        tel["job_wall_clock_sec"] = job_wall
                    job["telemetry"] = tel
        except Exception:
            pass
    return job


@app.get("/api/telemetry/live")
def get_live_hpc_telemetry():
    """Return real OS/Docker CPU load, memory usage, and active job wall-clock time (Zero-Mock)."""
    cluster = _inspect_celery_cluster()
    workers_online = int(cluster.get("workers_online", 0)) if isinstance(cluster, dict) else 0
    telemetry: Optional[Dict[str, Any]] = None
    source = "api_container"

    # Prefer live worker telemetry from active running job metadata first (zero extra queue roundtrip)
    active_job_info: Optional[Dict[str, Any]] = None
    try:
        recent = job_repository.list()[:5]
        for j in recent:
            st = str(j.get("status", "")).upper()
            if st in {"RUNNING", "QUEUED"}:
                tid = j.get("task_id")
                wall_sec = _compute_wall_clock_sec(j.get("created_at"), None)
                active_job_info = {
                    "task_id": tid,
                    "status": st,
                    "progress": j.get("progress", 0),
                    "created_at": j.get("created_at"),
                    "wall_clock_sec": wall_sec,
                    "physics_type": (j.get("input") or {}).get("physics_type") or (j.get("input") or {}).get("simulation_type"),
                }
                if tid:
                    try:
                        meta = celery_app.AsyncResult(tid).info
                        if isinstance(meta, dict):
                            if isinstance(meta.get("current_iteration"), int):
                                active_job_info["current_iteration"] = meta["current_iteration"]
                            if isinstance(meta.get("status_message"), str):
                                active_job_info["status_message"] = meta["status_message"]
                            if isinstance(meta.get("telemetry"), dict) and meta["telemetry"]:
                                telemetry = dict(meta["telemetry"])
                                source = "docker_worker_job"
                    except Exception:
                        pass
                break
    except Exception:
        pass

    if telemetry is None and workers_online > 0:
        try:
            task = celery_app.send_task("universal_dispatcher.sample_telemetry")
            sampled = task.get(timeout=2.5)
            if isinstance(sampled, dict):
                telemetry = sampled
                source = "docker_worker"
        except Exception:
            telemetry = None

    if telemetry is None:
        telemetry = sample_node_telemetry()
        source = "api_container"

    return {
        "success": True,
        "source": source,
        "workers_online": workers_online,
        "total_cluster_cores": cluster.get("total_cluster_cores") if isinstance(cluster, dict) else telemetry.get("cpu_cores"),
        "telemetry": telemetry,
        "active_job": active_job_info,
    }


@app.post("/api/jobs/{task_id}/cancel")
async def cancel_job(task_id: str, http_request: Request):
    """Revoke running/queued Celery task and mark CANCELLED in SQLite repository."""
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
    client_ip = http_request.client.host if http_request.client else "local"
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
    security_service.record_audit(
        actor_email=actor["email"],
        actor_role=actor["role"],
        workspace_id=actor.get("workspace_id", "ws-default"),
        action="simulation.cancel",
        resource=f"job:{task_id}",
        status="allowed",
        detail={},
        ip_address=client_ip,
    )
    return {"success": True, "task_id": task_id, "status": "CANCELLED", "job": updated}


@app.get("/api/jobs/{task_id}/export-case")
async def export_job_case_archive(task_id: str, http_request: Request):
    """Stream a ZIP archive of the real solver case directory (OpenFOAM/CalculiX/Elmer files, VTK, logs)."""
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="viewer")
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} not found."})

    res = job.get("result") or {}
    nested = res.get("data") if isinstance(res.get("data"), dict) else {}
    artifacts = res.get("artifacts") if isinstance(res.get("artifacts"), dict) else {}
    case_dir_raw = (
        res.get("case_directory")
        or artifacts.get("case_directory")
        or nested.get("case_directory")
    )
    if not case_dir_raw or not isinstance(case_dir_raw, str):
        raise HTTPException(
            status_code=404,
            detail={"success": False, "code": "CASE_ARTIFACTS_UNAVAILABLE", "error": "No solver case directory recorded for this job."},
        )

    case_path = Path(case_dir_raw).resolve()
    allowed_roots = [
        Path(p).resolve()
        for p in (
            os.getenv("NASEER_JOB_DIR", ""),
            os.getenv("OPENFOAM_CASE_ROOT", ""),
            os.getenv("CAE_WORK_DIR", ""),
            "/app/jobs",
            "/shared_jobs",
            str(Path.cwd() / "jobs"),
        )
        if p
    ]
    if not any(case_path == root or root in case_path.parents for root in allowed_roots):
        raise HTTPException(
            status_code=403,
            detail={"success": False, "code": "INVALID_CASE_PATH", "error": "Case directory lies outside allowed job storage."},
        )
    if not case_path.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"success": False, "code": "CASE_DIR_MISSING", "error": "Solver case directory no longer exists on disk."},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(case_path.rglob("*")):
            if not file_path.is_file() or file_path.is_symlink():
                continue
            try:
                if file_path.stat().st_size > 100 * 1024 * 1024:
                    continue
                zf.write(file_path, arcname=str(file_path.relative_to(case_path)))
            except OSError:
                continue

    short_id = "".join(ch for ch in task_id[:12] if ch.isalnum() or ch in "-_") or "case"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="naseer-case-{short_id}.zip"'},
    )


@app.get("/api/verify-job/{task_id}")
async def verify_job_provenance(task_id: str, http_request: Request):
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="viewer")
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
async def cad_preview_endpoint(request: CadPreviewRequest, http_request: Request):
    """Tessellate uploaded .STL/.STEP/.IGES/.INP/.MSH CAD via real Gmsh/meshio on Docker worker or local."""
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
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
async def generate_mesh_endpoint(request: MeshGenerateRequest, http_request: Request):
    """Run real Gmsh 2D/3D meshing on parametric domain or uploaded CAD STL/STEP."""
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
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
async def run_parametric_sweep(request: ParametricSweepRequest, http_request: Request):
    """Dispatch each parametric sweep sample as a genuine Celery solver job."""
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
    client_ip = http_request.client.host if http_request.client else "local"
    base = request.to_solver_payload()
    param_name = base.pop("sweep_parameter", "velocity")
    values = base.pop("values", [])
    physics_type = classify_physics(base)
    security_service.record_audit(
        actor_email=actor["email"],
        actor_role=actor["role"],
        workspace_id=actor.get("workspace_id", "ws-default"),
        action="simulation.parametric_sweep",
        resource=f"physics:{physics_type}",
        status="allowed",
        detail={"parameter": param_name, "samples": len(values)},
        ip_address=client_ip,
    )

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
def mesh_independence_study(request: MeshStudyRequest, http_request: Request):
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
    client_ip = http_request.client.host if http_request.client else "local"
    payload = request.to_solver_payload()
    key_result = payload.pop("key_result", None)
    physics_type = classify_physics(payload)
    security_service.record_audit(
        actor_email=actor["email"],
        actor_role=actor["role"],
        workspace_id=actor.get("workspace_id", "ws-default"),
        action="simulation.mesh_study",
        resource=f"physics:{physics_type}",
        status="allowed",
        detail={"key_result": key_result},
        ip_address=client_ip,
    )

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


# ---------------------------------------------------------
# 5. Automated International V&V Regression Suite (Phase 2)
# ---------------------------------------------------------
class VVRunRequest(BaseModel):
    benchmark_id: str = Field(default="all")
    execution_mode: ExecutionMode = Field(default=ExecutionMode.CELERY)


@app.get("/api/vv/benchmarks")
def get_vv_benchmarks():
    """Return the 6 canonical ASME/NAFEMS/NASA TMR benchmarks with live solver binary availability."""
    cluster = _inspect_celery_cluster()
    solvers = cluster.get("solvers") if isinstance(cluster, dict) else probe_worker_capabilities()
    return {
        "success": True,
        "cluster_status": cluster.get("status") if isinstance(cluster, dict) else "UNKNOWN",
        "workers_online": cluster.get("workers_online", 0) if isinstance(cluster, dict) else 0,
        "benchmarks": list_vv_benchmarks(solvers),
    }


@app.post("/api/vv/run")
def run_vv_benchmarks_endpoint(request: VVRunRequest, http_request: Request):
    """Execute one or all 6 international V&V benchmarks strictly on real solvers (Zero-Mock)."""
    actor = security_service.resolve_actor(
        http_request.headers.get("authorization"),
        require_role="engineer",
    )
    client_ip = http_request.client.host if http_request.client else "local"
    bid = (request.benchmark_id or "all").strip()
    if bid.lower() == "all":
        selected = None
    elif bid in VV_BENCHMARK_BY_ID:
        selected = [bid]
    else:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "code": "INVALID_BENCHMARK_ID",
                "error": f"Unknown benchmark_id '{bid}'. Valid IDs: {', '.join(VV_BENCHMARK_BY_ID.keys())} or 'all'.",
            },
        )

    cluster = _inspect_celery_cluster()
    cluster_solvers = cluster.get("solvers") if isinstance(cluster, dict) else probe_worker_capabilities()
    workers_online = int(cluster.get("workers_online", 0)) if isinstance(cluster, dict) else 0
    local_caps = probe_worker_capabilities()
    has_local_solvers = any(
        bool(local_caps.get(k, {}).get("available"))
        for k in ("openfoam", "calculix", "elmer")
    )

    def _dispatch_vv_solver(level_payload: Dict[str, Any]) -> Dict[str, Any]:
        if request.execution_mode == ExecutionMode.CELERY and workers_online > 0:
            task = celery_app.send_task(
                "universal_dispatcher.run_simulation",
                args=[{**level_payload, "execution_mode": "celery"}],
            )
            res = task.get(timeout=240.0)
            return res if isinstance(res, dict) else {"status": "ERROR", "error": "Invalid worker response"}
        if has_local_solvers:
            return execute_simulation({**level_payload, "execution_mode": "direct"})
        return {
            "status": "ERROR",
            "error": "No online Celery solver worker and no local solver binaries found on API container.",
        }

    report = run_vv_suite(
        selected,
        executor=_dispatch_vv_solver,
        capabilities=cluster_solvers,
    )
    security_service.record_audit(
        actor_email=actor["email"],
        actor_role=actor["role"],
        workspace_id=actor.get("workspace_id", "ws-default"),
        action="vv.run_suite",
        resource=f"benchmark:{bid}",
        status="allowed",
        detail={"overall_status": report.get("overall_status"), "passed": report.get("summary", {}).get("passed")},
        ip_address=client_ip,
    )
    return {
        "success": True,
        "report": report,
        "certificate_markdown": generate_vv_certificate_markdown(report),
    }


# ---------------------------------------------------------
# 6. Enterprise Multi-Tenant Auth, RBAC, S3 Storage & Cloud Packs (Phase 4)
# ---------------------------------------------------------
class AdminBootstrapRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    full_name: str = Field(..., min_length=2, max_length=128)
    password: str = Field(..., min_length=10, max_length=128)
    workspace_name: str = Field(default="NASEER Engineering Organization", max_length=128)
    admin_passcode: Optional[str] = Field(default=None, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class CreateUserRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    full_name: str = Field(..., min_length=2, max_length=128)
    password: str = Field(..., min_length=10, max_length=128)
    role: str = Field(default="engineer")


class UpdateRoleRequest(BaseModel):
    role: str = Field(..., min_length=3, max_length=32)


ENTERPRISE_DEPLOY_PACKS: Dict[str, tuple[str, str, str]] = {
    "k8s": ("deploy/k8s/naseer-cae-stack.yaml", "naseer-cae-k8s-stack.yaml", "text/yaml; charset=utf-8"),
    "slurm": ("deploy/slurm/submit_naseer_job.sbatch", "submit_naseer_job.sbatch", "text/x-shellscript; charset=utf-8"),
    "compose-enterprise": ("docker-compose.enterprise.yml", "docker-compose.enterprise.yml", "text/yaml; charset=utf-8"),
    "cicd": (".github/workflows/ci-cd.yml", "naseer-ci-cd.yml", "text/yaml; charset=utf-8"),
}


@app.get("/api/enterprise/status")
def get_enterprise_status(http_request: Request):
    sec = security_service.status_summary()
    storage = object_storage.status()
    actor = None
    auth_header = http_request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        try:
            actor = security_service.verify_access_token(auth_header[7:].strip())
        except SecurityError:
            actor = None
    return {
        "success": True,
        "security": sec,
        "storage": storage,
        "current_actor": actor,
        "deploy_packs": list(ENTERPRISE_DEPLOY_PACKS.keys()),
    }


@app.post("/api/enterprise/auth/bootstrap")
def bootstrap_enterprise_admin(body: AdminBootstrapRequest, http_request: Request):
    client_ip = http_request.client.host if http_request.client else "local"
    user, token = security_service.bootstrap_admin(
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        workspace_name=body.workspace_name,
        admin_passcode=body.admin_passcode,
        ip_address=client_ip,
    )
    return {"success": True, "user": user, "access_token": token, "token_type": "bearer"}


@app.post("/api/enterprise/auth/login")
def login_enterprise_user(body: LoginRequest, http_request: Request):
    client_ip = http_request.client.host if http_request.client else "local"
    user, token = security_service.authenticate(body.email, body.password, ip_address=client_ip)
    return {"success": True, "user": user, "access_token": token, "token_type": "bearer"}


@app.get("/api/enterprise/auth/me")
def get_enterprise_me(http_request: Request):
    actor = security_service.resolve_actor(http_request.headers.get("authorization"))
    return {"success": True, "actor": actor, "auth_mode": security_service.auth_mode()}


@app.get("/api/enterprise/users")
def list_enterprise_users(http_request: Request):
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="admin")
    return {"success": True, "users": security_service.list_users()}


@app.post("/api/enterprise/users")
def create_enterprise_user(body: CreateUserRequest, http_request: Request):
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="admin")
    client_ip = http_request.client.host if http_request.client else "local"
    user = security_service.create_user(
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        role=body.role,
        actor=actor,
        ip_address=client_ip,
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content={"success": True, "user": user})


@app.patch("/api/enterprise/users/{user_id}/role")
def update_enterprise_user_role(user_id: str, body: UpdateRoleRequest, http_request: Request):
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="admin")
    client_ip = http_request.client.host if http_request.client else "local"
    user = security_service.update_user_role(
        user_id=user_id,
        new_role=body.role,
        actor=actor,
        ip_address=client_ip,
    )
    return {"success": True, "user": user}


@app.get("/api/enterprise/audit-logs")
def get_enterprise_audit_logs(http_request: Request, limit: int = 100):
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="viewer")
    return {"success": True, "logs": security_service.list_audit_logs(limit=limit)}


@app.get("/api/enterprise/storage/status")
def get_enterprise_storage_status(http_request: Request):
    security_service.resolve_actor(http_request.headers.get("authorization"), require_role="viewer")
    return {
        "success": True,
        "storage": object_storage.status(),
        "archives": object_storage.list_archives(limit=50),
    }


@app.post("/api/enterprise/storage/archive/{task_id}")
def archive_job_to_object_storage(task_id: str, http_request: Request):
    actor = security_service.resolve_actor(http_request.headers.get("authorization"), require_role="engineer")
    client_ip = http_request.client.host if http_request.client else "local"
    job = job_repository.get(task_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "JOB_NOT_FOUND", "error": f"Job {task_id} does not exist."},
        )
    result = job.get("result") or {}
    nested = result.get("data") if isinstance(result.get("data"), dict) else {}
    artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
    provenance = result.get("provenance") if isinstance(result.get("provenance"), dict) else {}
    case_dir = (
        result.get("case_directory")
        or artifacts.get("case_directory")
        or nested.get("case_directory")
        or result.get("case_dir")
        or nested.get("case_dir")
        or provenance.get("case_dir")
    )
    if not case_dir or not isinstance(case_dir, str):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "CASE_DIR_MISSING", "error": "No solver case directory recorded for this job."},
        )
    allowed_roots = [
        Path(p).resolve()
        for p in (
            os.getenv("CAE_WORK_DIR", "/tmp/naseer_cae_jobs"),
            os.getenv("NASEER_JOB_DIR", "/app/jobs"),
            os.getenv("OPENFOAM_CASE_ROOT", ""),
            "/shared_jobs",
            "/app/jobs",
            str(Path.cwd() / "jobs"),
        )
        if p
    ]
    archive_info = object_storage.archive_case_directory(
        task_id=task_id,
        case_dir=str(case_dir),
        allowed_roots=allowed_roots,
    )
    security_service.record_audit(
        actor_email=actor["email"],
        actor_role=actor["role"],
        workspace_id=actor.get("workspace_id", "ws-default"),
        action="storage.archive_case",
        resource=f"job:{task_id}",
        status="allowed",
        detail={"backend": archive_info["backend"], "uri": archive_info["uri"], "sha256": archive_info["sha256"]},
        ip_address=client_ip,
    )
    return {"success": True, "archive": archive_info}


@app.get("/api/enterprise/deploy/{pack_name}")
def download_enterprise_deploy_pack(pack_name: str):
    entry = ENTERPRISE_DEPLOY_PACKS.get((pack_name or "").strip().lower())
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "success": False,
                "code": "UNKNOWN_DEPLOY_PACK",
                "error": f"Unknown deployment pack '{pack_name}'. Valid options: {', '.join(ENTERPRISE_DEPLOY_PACKS.keys())}.",
            },
        )
    rel_path, download_name, media_type = entry
    base_dir = Path(__file__).resolve().parent
    target_path = (base_dir / rel_path).resolve()
    if not target_path.is_relative_to(base_dir) or not target_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "code": "DEPLOY_PACK_NOT_FOUND", "error": f"Pack file '{rel_path}' is missing."},
        )
    return Response(
        content=target_path.read_bytes(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
# NASEER_CACHE
import time as _nt, threading as _nth
_CC=[0.0,None]
_CL=_nth.Lock()
_orig_icc=_inspect_celery_cluster
def _inspect_celery_cluster(*a,**k):
    d=_CC[1]; ttl=30.0 if (isinstance(d,dict) and d.get('workers_online',0)>0) else 3.0
    if d is not None and _nt.time()-_CC[0]<ttl: return d
    with _CL:
        d=_CC[1]; ttl=30.0 if (isinstance(d,dict) and d.get('workers_online',0)>0) else 3.0
        if d is not None and _nt.time()-_CC[0]<ttl: return d
        r=_orig_icc(*a,**k); _CC[1]=r; _CC[0]=_nt.time(); return r
