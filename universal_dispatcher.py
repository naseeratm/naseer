"""
Universal simulation routing layer.

External solver integrations are intentionally isolated behind wrappers so the
application can use deterministic local fallback solvers until those tools are
installed and configured.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from time import perf_counter
from typing import Any, Callable, Dict, Mapping
from pathlib import Path

from celery import Celery

from physics_solver import solve_simulation
from backend.report_generator import generate_academic_report


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
    explicit_type = str(
        input_data.get("simulation_type") or input_data.get("physics_type") or ""
    ).lower()

    # Explicit values take precedence over keyword matching in free-form text.
    if explicit_type == "cfd_incompressible":
        return "CFD_Incompressible"
    if explicit_type == "cfd_compressible":
        return "CFD_Compressible"
    if explicit_type == "structural_static":
        return "Structural_Static"
    if explicit_type == "structural_dynamic":
        return "Structural_Dynamic"

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
    """Create and run a small incompressible OpenFOAM cavity case."""
    executable = shutil.which("icoFoam") or shutil.which("simpleFoam")
    block_mesh = shutil.which("blockMesh")
    if not executable or not block_mesh:
        raise RuntimeError(
            "OpenFOAM is not installed in the worker container "
            "(blockMesh and a flow solver are required)"
        )

    case_dir = Path("/app/jobs") / f"openfoam-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "constant").mkdir()
    (case_dir / "system").mkdir()
    (case_dir / "0").mkdir()

    (case_dir / "constant" / "transportProperties").write_text(
        "FoamFile { version 2.0; format ascii; class dictionary; location \"constant\"; object transportProperties; }\n"
        "nu [0 2 -1 0 0 0 0] 1e-3;\n",
        encoding="utf-8",
    )
    (case_dir / "constant" / "polyMesh").mkdir()
    size = float(data.get("mesh_size", 0.1))
    cells = max(4, min(100, int(round(1.0 / size))))
    (case_dir / "system" / "blockMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
        "convertToMeters 1;\nvertices ( (0 0 0) (1 0 0) (1 1 0) (0 1 0) "
        "(0 0 0.1) (1 0 0.1) (1 1 0.1) (0 1 0.1) );\n"
        "blocks ( hex (0 1 2 3 4 5 6 7) "
        f"({cells} {cells} 1) simpleGrading (1 1 1) );\n"
        "edges (); boundary (); mergePatchPairs ();",
        encoding="utf-8",
    )
    (case_dir / "system" / "controlDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
        "application icoFoam;\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
        "endTime 100;\ndeltaT 0.001;\nwriteInterval 100;\npurgeWrite 0;\nwriteFormat ascii;\n"
        "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;",
        encoding="utf-8",
    )
    (case_dir / "system" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        "ddtSchemes { default Euler; }\n"
        "gradSchemes { default Gauss linear; }\n"
        "divSchemes { default Gauss linear; }\n"
        "laplacianSchemes { default Gauss linear corrected; }\n"
        "interpolationSchemes { default linear; }\n"
        "snGradSchemes { default corrected; }",
        encoding="utf-8",
    )
    (case_dir / "system" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers { p { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }\n"
        "pFinal { $p; relTol 0; }\n"
        "U { solver PBiCG; preconditioner DILU; tolerance 1e-6; relTol 0; } }\n"
        "PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }",
        encoding="utf-8",
    )
    velocity = float(data.get("velocity", data.get("boundary_conditions", {}).get("velocity", 1.0)))
    (case_dir / "0" / "U").write_text(
        'FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n'
        "dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (0 0 0);\n"
        f"boundaryField {{ \"\" {{ type fixedValue; value uniform ({velocity} 0 0); }} }}",
        encoding="utf-8",
    )
    (case_dir / "0" / "p").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n'
        "dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;\n"
        "boundaryField { \"\" { type zeroGradient; } }",
        encoding="utf-8",
    )

    environment = os.environ.copy()
    environment.update({
        "WM_PROJECT_DIR": "/usr/share/openfoam",
        "WM_PROJECT_INST_DIR": "/usr/share",
        "WM_PROJECT_VERSION": "v1912",
        "FOAM_ETC": "/usr/share/openfoam/etc",
        "FOAM_APPBIN": "/usr/lib/openfoam/openfoam-v1912/platforms/linux64GccDPInt32Opt/bin",
        "FOAM_LIBBIN": "/usr/lib/openfoam/openfoam-v1912/platforms/linux64GccDPInt32Opt/lib",
        "LD_LIBRARY_PATH": "/usr/lib/openfoam/openfoam-v1912/platforms/linux64GccDPInt32Opt/lib:"
        + environment.get("LD_LIBRARY_PATH", ""),
    })

    def run(command: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            command, cwd=case_dir, env=environment, text=True,
            capture_output=True, timeout=120, check=True,
        )

    try:
        run([block_mesh])
        run([executable])
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"OpenFOAM execution failed: {exc.stderr[-4000:] or exc.stdout[-4000:]}"
        ) from exc

    return {
        "status": "SOLVED_REALTIME",
        "solver": "OpenFOAM",
        "executable": executable,
        "case_directory": str(case_dir),
        "input": dict(data),
    }


def call_calculix_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Execute a linear static CalculiX cube model."""
    ccx = shutil.which("ccx")
    if not ccx:
        raise RuntimeError("CalculiX ccx is not installed in the worker container")

    case_dir = Path("/app/jobs") / f"calculix-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    inp = case_dir / "model.inp"
    applied_displacement = float(data.get("displacement", 0.001))
    inp.write_text(
        "*HEADING\nNaseer CalculiX validation cube\n"
        "*NODE\n1,0,0,0\n2,1,0,0\n3,1,1,0\n4,0,1,0\n"
        "5,0,0,1\n6,1,0,1\n7,1,1,1\n8,0,1,1\n"
        "*ELEMENT,TYPE=C3D8,ELSET=SOLID\n1,1,2,3,4,5,6,7,8\n"
        "*SOLID SECTION,ELSET=SOLID,MATERIAL=STEEL\n"
        "*MATERIAL,NAME=STEEL\n*ELASTIC\n210000,0.3\n"
        "*DENSITY\n7.85e-9\n"
        "*BOUNDARY\n1,1,3,0\n2,1,3,0\n3,1,3,0\n4,1,3,0\n"
        f"5,2,3,0\n6,2,3,0\n7,2,3,{applied_displacement}\n8,2,3,{applied_displacement}\n"
        "*STEP\n*STATIC\n*END STEP\n",
        encoding="utf-8",
    )
    try:
        result = subprocess.run(
            [ccx, "model"], cwd=case_dir, text=True, capture_output=True,
            timeout=120, check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"CalculiX execution failed: {exc.stderr[-4000:] or exc.stdout[-4000:]}"
        ) from exc

    return {
        "status": "SOLVED_REALTIME",
        "solver": "CalculiX",
        "executable": ccx,
        "case_directory": str(case_dir),
        "dat_output": (case_dir / "model.dat").read_text(encoding="utf-8", errors="replace")
        if (case_dir / "model.dat").exists() else "",
        "stdout": result.stdout[-4000:],
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
        response = {
            "physics_type": physics_type,
            "recommended_solver": _recommended_engine(physics_type),
            "status": str(merged.get("status", "SOLVED_REALTIME")),
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": [],
            "data": dict(merged),
        }
        response["academic_report"] = generate_academic_report(response)
        return response
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
