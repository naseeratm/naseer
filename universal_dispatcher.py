"""
Universal simulation routing layer.

External solver integrations are intentionally isolated behind wrappers so the
application can use deterministic local fallback solvers until those tools are
installed and configured.
"""

from __future__ import annotations

from time import perf_counter
from typing import Any, Callable, Dict, Mapping

from celery import Celery

from physics_solver import solve_simulation


PhysicsResult = Dict[str, Any]

REDIS_URL = __import__("os").getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
celery_app = Celery(
    "universal_cae",
    broker=REDIS_URL,
    backend=__import__("os").getenv("CELERY_RESULT_BACKEND", REDIS_URL),
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)


def _flatten_text(value: Any) -> str:
    if isinstance(value, Mapping):
        parts: list[str] = []
        for key, item in value.items():
            parts.extend([str(key), _flatten_text(item)])
        return " ".join(parts)
    if isinstance(value, (list, tuple, set)):
        return " ".join(_flatten_text(item) for item in value)
    return str(value)


def classify_and_route_simulation(input_data: Mapping[str, Any]) -> PhysicsResult:
    """Submit a classified case to a Celery worker."""
    task = run_simulation_task.delay(dict(input_data))
    return {
        "task_id": task.id,
        "status": "QUEUED",
        "physics_type": classify_physics(input_data),
        "recommended_solver": _recommended_engine(classify_physics(input_data)),
    }


def classify_physics(input_data: Mapping[str, Any]) -> str:
    text = _flatten_text(input_data).lower()

    has_cfd = any(token in text for token in (
        "velocity", "velocity_inlet", "cfd", "navier", "airfoil", "fluid", "incompressible",
        "mach", "compressible", "aerodynamics", "pressure based",
    ))
    has_structural = any(token in text for token in (
        "stress", "structural", "fea", "displacement", "von mises", "elastic", "mechanical",
    ))
    has_thermal = any(token in text for token in (
        "thermal", "temperature", "heat_flux", "heat flux", "convection", "conduction",
        "radiation", "transient",
    ))

    physics_signals = sum((has_cfd, has_structural, has_thermal))
    if physics_signals > 1:
        return "Multiphysics"

    explicit_type = str(
        input_data.get("simulation_type") or input_data.get("physics_type") or ""
    ).lower()

    if "radiation" in text:
        return "Thermal_Radiation"
    if "transient" in text or "transient" in explicit_type:
        return "Thermal_Transient" if has_thermal else "Structural_Dynamic"
    if "dynamic" in text or "modal" in text or "impact" in text:
        return "Structural_Dynamic"
    if "compressible" in text:
        return "CFD_Compressible"
    if has_cfd:
        return "CFD_Incompressible"
    if has_structural:
        return "Structural_Static"
    if has_thermal:
        return "Thermal_Transient" if "thermal_transient" in explicit_type else "Thermal_Radiation" if "radiation" in explicit_type else "Thermal_Transient"

    return "Thermal_Transient"


def _recommended_engine(physics_type: str) -> str:
    engines = {
        "CFD_Incompressible": "OpenFOAM",
        "CFD_Compressible": "OpenFOAM-Compressible",
        "Structural_Static": "CalculiX",
        "Structural_Dynamic": "CalculiX-CCX",
        "Thermal_Transient": "Deterministic Thermal Solver",
        "Thermal_Radiation": "OpenRadioss / Thermal Solver",
        "Multiphysics": "Universal Coupled Solver",
    }
    return engines.get(physics_type, "Deterministic Thermal Solver")


def call_openfoam_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """OpenFOAM integration boundary."""
    return {
        "status": "SOLVER_READY",
        "message": "OpenFOAM wrapper is available for backend execution.",
        "input": dict(data),
    }


def call_calculix_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """CalculiX integration boundary."""
    return {
        "status": "SOLVER_READY",
        "message": "CalculiX wrapper is available for backend execution.",
        "input": dict(data),
    }


def call_gmsh_mesher(data: Mapping[str, Any]) -> PhysicsResult:
    """Gmsh integration boundary."""
    return {
        "status": "MESHER_READY",
        "message": "Gmsh meshing wrapper is available for backend execution.",
        "input": dict(data),
    }


def _thermal_fallback(data: Mapping[str, Any]) -> PhysicsResult:
    thermal_data = dict(data)
    if not str(thermal_data.get("simulation_type", "")).startswith("2D_"):
        thermal_data["simulation_type"] = "2D_thermal_steady_state"
    try:
        return solve_simulation(thermal_data)
    except NameError:
        thermal_data["simulation_type"] = "2D_thermal_steady_state"
        return solve_simulation(thermal_data)


def execute_simulation(data: Dict[str, Any]) -> PhysicsResult:
    started = perf_counter()
    try:
        physics_type = classify_physics(data)
        routes: Dict[str, Callable[[Mapping[str, Any]], PhysicsResult]] = {
            "CFD_Incompressible": call_openfoam_solver,
            "CFD_Compressible": call_openfoam_solver,
            "Structural_Static": call_calculix_solver,
            "Structural_Dynamic": call_calculix_solver,
        }

        if physics_type.startswith("Thermal_") or physics_type == "Multiphysics":
            result = _thermal_fallback(data)
        else:
            result = routes[physics_type](data)

        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        merged = result if isinstance(result, Mapping) else {}
        return {
            "physics_type": physics_type,
            "recommended_solver": _recommended_engine(physics_type),
            "status": str(merged.get("status", "SOLVED_REALTIME")),
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": [],
            "data": dict(merged),
        }
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        return {
            "physics_type": "Thermal_Transient",
            "recommended_solver": _recommended_engine("Thermal_Transient"),
            "status": "error",
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": [],
            "data": {},
            "error": f"Universal dispatcher failed: {exc}",
        }


@celery_app.task(name="universal_dispatcher.run_simulation", bind=True)
def run_simulation_task(self, data: Dict[str, Any]) -> PhysicsResult:
    """Execute simulation work outside the FastAPI process."""
    self.update_state(state="STARTED", meta={"physics_type": classify_physics(data)})
    return execute_simulation(data)
