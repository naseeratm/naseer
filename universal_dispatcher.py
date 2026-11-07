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
import math
import json
import logging
import re
import math
from time import perf_counter
from typing import Any, Callable, Dict, Mapping, Optional
from pathlib import Path

from celery import Celery

from physics_solver import solve_simulation
from cae_repository import JobRepository
from backend.report_generator import generate_academic_report
from backend.result_schema import canonicalize_result


PhysicsResult = Dict[str, Any]


class OpenFOAMVerificationError(RuntimeError):
    """Raised when the OpenFOAM verification gate rejects a finished solver run."""

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
    result_expires=int(os.getenv("CAE_RESULT_EXPIRES_SECONDS", "86400")),
    task_soft_time_limit=int(os.getenv("CAE_TASK_SOFT_TIME_LIMIT_SECONDS", "900")),
    task_time_limit=int(os.getenv("CAE_TASK_TIME_LIMIT_SECONDS", "960")),
    task_default_retry_delay=int(os.getenv("CAE_TASK_RETRY_DELAY_SECONDS", "30")),
)


def _task_progress(task: Any, progress: int, message: str, **extra: Any) -> None:
    """Publish a stable metadata shape that API clients can consume."""
    task.update_state(
        state="STARTED",
        meta={
            "progress": max(0, min(100, progress)),
            "status_message": message,
            "logs": [message],
            **extra,
        },
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
    ).lower().replace("-", "_").replace(" ", "_")

    # Explicit values take precedence over keyword matching in free-form text.
    if explicit_type == "cfd_incompressible":
        return "CFD_Incompressible"
    if explicit_type == "cfd_compressible":
        return "CFD_Compressible"
    if explicit_type.startswith("cfd_") and "compressible" in explicit_type:
        return "CFD_Compressible"
    if explicit_type.startswith("cfd_"):
        return "CFD_Incompressible"
    if explicit_type == "structural_static":
        return "Structural_Static"
    if explicit_type == "structural_dynamic":
        return "Structural_Dynamic"
    if explicit_type == "thermal_transient":
        return "Thermal_Transient"
    if explicit_type == "thermal_radiation":
        return "Thermal_Radiation"
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


def parse_openfoam_residuals(log_text: str) -> Dict[str, Dict[str, Any]]:
    """Parse OpenFOAM's common residual output into normalized series."""
    residuals: Dict[str, Dict[str, Any]] = {}
    patterns = (
        re.compile(r"Solving for\s+([A-Za-z_][\w]*).*?Initial residual\s*=\s*([^\s,]+)", re.I),
        re.compile(r"Solved for\s+([A-Za-z_][\w]*)[^\\n]*Initial residual\s*=\s*([^\s,]+)", re.I),
        re.compile(r"^.*?([A-Za-z_][\w]*)\s*:.*?initial residual\s*=\s*([^\s,]+)", re.I | re.M),
        re.compile(r"Initial residual\s*=\s*([^\s,]+).*?Final residual\s*=\s*([^\s,]+)", re.I),
    )
    for match in patterns[0].finditer(log_text):
        field, initial = match.groups()
        try:
            value = float(initial)
            if math.isfinite(value):
                residuals.setdefault(field.lower(), {"values": [], "initial": value, "final": value, "iterations": 0})["values"].append(value)
        except ValueError:
            continue
    for match in patterns[1].finditer(log_text):
        field, initial = match.groups()
        try:
            value = float(initial)
            if math.isfinite(value):
                residuals.setdefault(field.lower(), {"values": [], "initial": value, "final": value, "iterations": 0})["values"].append(value)
        except ValueError:
            continue
    for value in residuals.values():
        value["values"] = [v for v in value["values"] if v >= 0]
        value["iterations"] = len(value["values"])
        value["initial"] = value["values"][0] if value["values"] else None
        value["final"] = value["values"][-1] if value["values"] else None
    return residuals


def _numeric_field_stats(text: str) -> Dict[str, Any]:
    uniform = re.search(r"uniform\s*\(([^)]*)\)", text)
    if uniform:
        numbers = [float(v) for v in uniform.group(1).split() if re.match(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$", v)]
        if numbers:
            return {"kind": "vector", "components": numbers, "minimum": min(numbers), "maximum": max(numbers), "mean": sum(numbers) / len(numbers)}
    scalar = re.search(r"uniform\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)", text)
    if scalar:
        value = float(scalar.group(1))
        return {"kind": "scalar", "minimum": value, "maximum": value, "mean": value, "values": [value]}
    values = [float(v) for v in re.findall(r"(?<![A-Za-z])([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)", text)]
    if values:
        return {"kind": "scalar", "minimum": min(values), "maximum": max(values), "mean": sum(values) / len(values), "values": values[-1000:]}
    return {"kind": "unknown", "minimum": None, "maximum": None, "mean": None, "values": []}


def temperature_to_kelvin(data: Mapping[str, Any], default: float = 298.15) -> float:
    """Normalize a simulation temperature to an absolute Kelvin value."""
    boundary_conditions = data.get("boundary_conditions")
    boundary_conditions = boundary_conditions if isinstance(boundary_conditions, Mapping) else {}
    raw_temperature = data.get(
        "temperature",
        data.get("temperature_k", boundary_conditions.get("temperature", default)),
    )
    try:
        temperature = float(raw_temperature)
    except (TypeError, ValueError):
        temperature = default

    unit = str(
        data.get("temperature_unit", boundary_conditions.get("temperature_unit", ""))
    ).lower().replace("-", "_").replace(" ", "")
    explicitly_kelvin = unit in {"k", "kelvin", "celsius_k"}

    if explicitly_kelvin:
        temperature_kelvin = temperature
    elif unit in {"c", "degc", "celsius"}:
        temperature_kelvin = temperature + 273.15
    elif temperature < 100.0:
        temperature_kelvin = temperature + 273.15
    else:
        temperature_kelvin = temperature

    return temperature_kelvin if temperature_kelvin > 0.0 else default


def parse_openfoam_fields(case_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Read latest time U/p dictionaries and normalize their basic statistics."""
    time_dirs = [p for p in case_dir.iterdir() if p.is_dir() and re.fullmatch(r"(?:\d+(?:\.\d*)?)", p.name)]
    time_dirs.sort(key=lambda p: float(p.name), reverse=True)
    fields: Dict[str, Dict[str, Any]] = {}
    for name in ("p", "U"):
        content = ""
        source = None
        for time_dir in time_dirs:
            candidate = time_dir / name
            if candidate.exists():
                source = candidate
                content = candidate.read_text(encoding="utf-8", errors="replace")
                break
        if not content:
            candidate = case_dir / "0" / name
            if candidate.exists():
                source = candidate
                content = candidate.read_text(encoding="utf-8", errors="replace")
        if source:
            fields["pressure" if name == "p" else "velocity"] = {
                "time_directory": source.parent.name,
                "source": str(source),
                **_numeric_field_stats(content),
            }
    return fields


_OPENFOAM_FAILURE_PATTERNS = (
    ("Floating point exception", re.compile(r"Floating point exception", re.I)),
    ("FatalError", re.compile(r"FatalError|FOAM FATAL (?:IO )?ERROR")),
    ("SIGFPE", re.compile(r"SIGFPE")),
    ("NaN", re.compile(r"(?<![A-Za-z0-9_])-?nan(?![A-Za-z0-9_])", re.I)),
)


def _is_solution_time_directory(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        return float(path.name) > 0.0
    except ValueError:
        return False


def verify_openfoam_convergence(case_dir: Path, solver_name: str) -> dict:
    """Strict post-run gate: a case is valid only if its log is clean and time steps were written."""
    case_dir = Path(case_dir)
    log_path = case_dir / "solver.log"
    if not log_path.is_file():
        return {"valid": False, "error": f"{solver_name}: solver.log was not produced; the solver did not run."}

    log_text = log_path.read_text(encoding="utf-8", errors="replace")
    for label, pattern in _OPENFOAM_FAILURE_PATTERNS:
        match = pattern.search(log_text)
        if match:
            line_start = log_text.rfind("\n", 0, match.start()) + 1
            line_end = log_text.find("\n", match.end())
            context = log_text[line_start:line_end if line_end != -1 else None].strip()[:300]
            return {
                "valid": False,
                "error": f"{solver_name} diverged or crashed ({label} detected in solver.log): {context}",
            }

    if not any(_is_solution_time_directory(entry) for entry in case_dir.iterdir()):
        return {
            "valid": False,
            "error": f"{solver_name} produced no time-step directories beyond the initial '0/' folder.",
        }
    return {"valid": True, "error": None}


def _write_block_mesh_boundary_summary(case_dir: Path, nx: int, ny: int, nz: int,
                                       width: float, height: float, depth: float) -> None:
    summary = {
        "dimensions": {"x": width, "y": height, "z": depth},
        "cells": {"nx": nx, "ny": ny, "nz": nz, "total": nx * ny * nz},
        "patches": ["inlet", "outlet", "walls", "frontAndBack"],
    }
    (case_dir / "mesh_metadata.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def call_openfoam_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Create and execute a geometry-aware OpenFOAM case."""
    physics_type = classify_physics(data)
    compressible = physics_type == "CFD_Compressible"
    candidates = (
        ("rhoSimpleFoam", "rhoPimpleFoam", "sonicFoam") if compressible
        else ("icoFoam", "simpleFoam", "pimpleFoam")
    )
    resolved = {name: shutil.which(name) for name in candidates}
    executable = next((path for path in resolved.values() if path), None)
    block_mesh = shutil.which("blockMesh")
    if not executable or not block_mesh:
        raise RuntimeError(
            "OpenFOAM environment validation failed: blockMesh and one of "
            + ", ".join(candidates)
            + " must be available on PATH"
        )

    configured_root = os.getenv("OPENFOAM_CASE_ROOT")
    root = Path(configured_root) if configured_root else (Path("/app/jobs") if Path("/app/jobs").exists() else Path.cwd() / "jobs")
    root.mkdir(parents=True, exist_ok=True)
    case_dir = root / f"openfoam-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "constant").mkdir()
    (case_dir / "system").mkdir()
    (case_dir / "0").mkdir()

    (case_dir / "constant" / "transportProperties").write_text(
        "FoamFile { version 2.0; format ascii; class dictionary; location \"constant\"; object transportProperties; }\n"
        "transportModel Newtonian;\n"
        "nu [0 2 -1 0 0 0 0] 1e-3;\n",
        encoding="utf-8",
    )
    (case_dir / "0" / "rho").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object rho; }\n'
        "dimensions [1 -3 0 0 0 0 0];\ninternalField uniform 1.176;\n"
        "boundaryField {\n"
        + (
            " inlet { type fixedValue; value uniform 1.176; }\n"
            " outlet { type zeroGradient; }\n"
            if compressible else
            " inlet { type calculated; value uniform 1.176; }\n"
            " outlet { type calculated; value uniform 1.176; }\n"
        )
        + " walls { type calculated; value uniform 1.176; }\n"
        + " frontAndBack { type empty; }\n"
        + "}",
        encoding="utf-8",
    )
    (case_dir / "constant" / "turbulenceProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object turbulenceProperties; }\n'
        "simulationType laminar;",
        encoding="utf-8",
    )
    (case_dir / "constant" / "polyMesh").mkdir()
    domain = data.get("domain", {}) if isinstance(data.get("domain"), Mapping) else {}
    width = float(domain.get("width_x", domain.get("width", data.get("width_x", 1.0))))
    height = float(domain.get("height_y", domain.get("height", data.get("height_y", 1.0))))
    depth = float(domain.get("depth_z", domain.get("depth", 0.1)))
    if width <= 0 or height <= 0 or depth <= 0:
        raise ValueError("OpenFOAM domain dimensions must be positive")
    mesh = data.get("mesh_settings", {}) if isinstance(data.get("mesh_settings"), Mapping) else {}
    size = float(mesh.get("mesh_size", data.get("mesh_size", 0.1)))
    if size <= 0:
        raise ValueError("mesh_size must be positive")
    nx = max(4, min(200, int(round(width / size))))
    ny = max(4, min(200, int(round(height / size))))
    nz = max(1, min(20, int(round(depth / (size * 0.1)))))
    (case_dir / "system" / "blockMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
        "convertToMeters 1;\n"
        f"vertices ( (0 0 0) ({width} 0 0) ({width} {height} 0) (0 {height} 0) "
        f"(0 0 {depth}) ({width} 0 {depth}) ({width} {height} {depth}) (0 {height} {depth}) );\n"
        "blocks ( hex (0 1 2 3 4 5 6 7) "
        f"({nx} {ny} {nz}) simpleGrading (1 1 1) );\n"
        "edges (); boundary (\n"
        " inlet { type patch; faces ((0 4 7 3)); }\n"
        " outlet { type patch; faces ((1 2 6 5)); }\n"
        " walls { type wall; faces ((0 1 5 4) (3 7 6 2)); }\n"
        " frontAndBack { type empty; faces ((0 3 2 1) (4 5 6 7)); }\n"
        "); mergePatchPairs ();",
        encoding="utf-8",
    )
    (case_dir / "system" / "controlDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
        f"application {Path(executable).stem};\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
        + (
            "endTime 1000;\ndeltaT 1;\nwriteInterval 100;\npurgeWrite 0;\nwriteFormat ascii;\n"
            if compressible else
            "endTime 1;\ndeltaT 0.001;\nwriteInterval 1;\npurgeWrite 0;\nwriteFormat ascii;\n"
        )
        +
        "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;",
        encoding="utf-8",
    )
    div_schemes = (
        'divSchemes { default Gauss linear; div(phi,U) Gauss upwind; div(phi,h) Gauss upwind; div(phi,K) Gauss upwind; div(phid,p) Gauss upwind; '
        '"div(((rho*nuEff)*dev2(T(grad(U)))))" Gauss linear; }'
        if compressible else
        "divSchemes { default Gauss linear; }"
    )
    (case_dir / "system" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        "ddtSchemes { default Euler; }\n"
        "gradSchemes { default Gauss linear; }\n"
        + div_schemes + "\n"
        + "laplacianSchemes { default Gauss linear corrected; }\n"
        + "interpolationSchemes { default linear; }\n"
        + "snGradSchemes { default corrected; }",
        encoding="utf-8",
    )
    pressure_solver = (
        "solvers { p { solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol 0.01; }\n"
        if compressible else
        "solvers { p { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }\n"
    )
    (case_dir / "system" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        + pressure_solver
        + (
            "pFinal { $p; relTol 0; }\n"
            if compressible else
            "pFinal { $p; relTol 0; }\n"
        )
        + (
            "U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0.1; }\n"
            if compressible else
            "U { solver PBiCG; preconditioner DILU; tolerance 1e-6; relTol 0; }\n"
        )
        + (
            "UFinal { $U; relTol 0; }\n"
            if compressible else
            "UFinal { $U; tolerance 1e-6; relTol 0; }\n"
        )
        + "rho { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }\n"
        + "rhoFinal { solver PCG; preconditioner DIC; tolerance 1e-7; relTol 0; }\n"
        + "h { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0.1; }\n"
        + (
            "hFinal { $h; relTol 0; } }\n"
            if compressible else
            "hFinal { $h; relTol 0; } }\n"
        )
        + (
            "PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 101325; }\n"
            "PIMPLE { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 101325; }\n"
            if compressible else
            "PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }\n"
            "PIMPLE { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }\n"
        )
        + (
            "SIMPLE { nNonOrthogonalCorrectors 2; consistent yes; residualControl { p 1e-4; U 1e-5; h 1e-5; } }\n"
            "relaxationFactors { fields { rho 0.3; p 0.1; } equations { rho 0.3; U 0.3; h 0.3; T 0.3; \"rho.*\" 0.3; } }"
            if compressible else
            "SIMPLE { nNonOrthogonalCorrectors 0; residualControl { p 1e-4; U 1e-5; e 1e-5; } }\n"
            "relaxationFactors { fields { rho 0.7; p 0.3; } equations { rho 0.7; U 0.7; e 0.7; h 0.7; } }"
        ),
        encoding="utf-8",
    )
    if compressible:
        (case_dir / "system" / "fvOptions").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object fvOptions; }\n'
            "limitTemperature1\n"
            "{\n"
            "    type limitTemperature;\n"
            "    active true;\n"
            "    selectionMode all;\n"
            "    min 200;\n"
            "    max 3000;\n"
            "}\n",
            encoding="utf-8",
        )
    raw_bc = data.get("boundary_conditions", {})
    boundary_conditions = raw_bc if isinstance(raw_bc, Mapping) else {}
    velocity = float(data.get("velocity", boundary_conditions.get("velocity", boundary_conditions.get("inlet_velocity_mps", 1.0))))
    pressure = float(data.get("pressure", boundary_conditions.get("pressure", 101325.0 if compressible else 0.0)))
    temperature_kelvin = temperature_to_kelvin(data)
    cp = 1004.0
    specific_gas_constant = 8314.46261815324 / 28.96
    enthalpy = cp * temperature_kelvin
    (case_dir / "0" / "U").write_text(
        'FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n'
        "dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (0 0 0);\n"
        "boundaryField {\n"
        f" inlet {{ type fixedValue; value uniform ({velocity} 0 0); }}\n"
        + (
            " outlet { type inletOutlet; inletValue uniform (0 0 0); value uniform (0 0 0); }\n"
            if compressible else
            " outlet { type inletOutlet; inletValue uniform (0 0 0); value uniform (0 0 0); }\n"
        )
        + " walls { type noSlip; }\n"
        " frontAndBack { type empty; }\n"
        "}",
        encoding="utf-8",
    )
    p_header = (
        f"dimensions [1 -1 -2 0 0 0 0];\ninternalField uniform {pressure:.8g};\n"
        if compressible else
        "dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;\n"
    )
    (case_dir / "0" / "p").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n'
        + p_header
        + "boundaryField {\n"
        + " inlet { type zeroGradient; }\n"
        + (
            f" outlet {{ type waveTransmissive; phi phi; rho rho; psi thermo:psi; gamma 1.4; fieldInf {pressure:.8g}; lInf 1; value uniform {pressure:.8g}; }}\n"
            if compressible else
            f" outlet {{ type fixedValue; value uniform {pressure:.8g}; }}\n"
        )
        + " walls { type zeroGradient; }\n"
        + " frontAndBack { type empty; }\n"
        + "}",
        encoding="utf-8",
    )
    if compressible:
        (case_dir / "0" / "T").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object T; }\n'
            f"dimensions [0 0 0 1 0 0 0];\ninternalField uniform {temperature_kelvin:.8g};\n"
            f"boundaryField {{ inlet {{ type fixedValue; value uniform {temperature_kelvin:.8g}; }} outlet {{ type inletOutlet; inletValue uniform {temperature_kelvin:.8g}; value uniform {temperature_kelvin:.8g}; }} walls {{ type fixedValue; value uniform {temperature_kelvin:.8g}; }} frontAndBack {{ type empty; }} }}",
            encoding="utf-8",
        )
        (case_dir / "0" / "h").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object h; }\n'
            f"dimensions [0 2 -2 0 0 0 0];\ninternalField uniform {enthalpy:.8g};\n"
            f"boundaryField {{ inlet {{ type fixedValue; value uniform {enthalpy:.8g}; }} outlet {{ type inletOutlet; inletValue uniform {enthalpy:.8g}; value uniform {enthalpy:.8g}; }} walls {{ type fixedValue; value uniform {enthalpy:.8g}; }} frontAndBack {{ type empty; }} }}",
            encoding="utf-8",
        )
        (case_dir / "constant" / "turbulenceProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object turbulenceProperties; }\n'
            "simulationType laminar;",
            encoding="utf-8",
        )
        (case_dir / "constant" / "thermophysicalProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object thermophysicalProperties; }\n'
            "thermoType { type heRhoThermo; mixture pureMixture; transport const; thermo hConst; equationOfState perfectGas; specie specie; energy sensibleEnthalpy; }\n"
            f"mixture {{ specie {{ molWeight 28.96; }} thermodynamics {{ Cp {cp:.8g}; Hf 0; }} transport {{ mu 1.8e-5; Pr 0.7; }} }}\np {pressure:.8g};\nT {temperature_kelvin:.8g};\n",
            encoding="utf-8",
        )

    environment = os.environ.copy()
    environment.update({
        "WM_PROJECT_DIR": "/usr/share/openfoam",
        "WM_PROJECT_INST_DIR": "/usr/share",
        "WM_PROJECT_VERSION": "v1912",
        "FOAM_ETC": "/usr/share/openfoam/etc",
        "FOAM_APPBIN": "/usr/bin",
        "FOAM_LIBBIN": "/usr/lib",
    })

    def run(command: list[str]) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            command, cwd=case_dir, env=environment, text=True,
            capture_output=True, timeout=120, check=False,
        )
        # The log is written before any failure is raised so the verification gate always has evidence.
        with (case_dir / "solver.log").open("a", encoding="utf-8") as stream:
            stream.write(result.stdout or "")
            stream.write(result.stderr or "")
        if result.returncode != 0:
            raise subprocess.CalledProcessError(
                result.returncode, command, output=result.stdout, stderr=result.stderr,
            )
        return result

    try:
        run([block_mesh])
        _write_block_mesh_boundary_summary(case_dir, nx, ny, nz, width, height, depth)
        run([executable])
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"OpenFOAM execution failed: {(exc.stderr or exc.stdout or '')[-4000:]}"
        ) from exc

    solver_name = Path(executable).stem
    verification = verify_openfoam_convergence(case_dir, solver_name)
    if not verification["valid"]:
        raise OpenFOAMVerificationError(verification["error"])

    log = ""
    for name in ("solver.log", "openfoam.log"):
        artifact = case_dir / name
        if artifact.exists():
            log += artifact.read_text(encoding="utf-8", errors="replace")
    residuals = parse_openfoam_residuals(log)
    fields = parse_openfoam_fields(case_dir)
    pressure_path = case_dir / "pressure.json"
    velocity_path = case_dir / "velocity.json"
    pressure_path.write_text(json.dumps(fields.get("pressure", {}), indent=2), encoding="utf-8")
    velocity_path.write_text(json.dumps(fields.get("velocity", {}), indent=2), encoding="utf-8")
    result = {
        "status": "SOLVED_REALTIME",
        "solver": "OpenFOAM",
        "solver_variant": "compressible" if compressible else "incompressible",
        "executable": executable,
        "case_directory": str(case_dir),
        "artifacts": {
            "case_directory": str(case_dir),
            "log": str(case_dir / "solver.log"),
            "pressure": str(case_dir / "pressure.json"),
            "velocity": str(case_dir / "velocity.json"),
        },
        "residuals": residuals,
        "convergence": {
            "converged": bool(residuals and all(item["values"] and item["values"][-1] < 1e-4 for item in residuals.values())),
            "residuals": residuals,
        },
        "pressure": fields.get("pressure", {}),
        "velocity": fields.get("velocity", {}),
        "input": dict(data),
    }
    result["units"] = {"pressure": "Pa", "velocity": "m/s", "residual": "dimensionless"}
    result["artifacts"]["mesh_metadata"] = str(case_dir / "mesh_metadata.json")
    return canonicalize_result(result, physics_type=physics_type, input_data=data, solver="OpenFOAM")


def _numbered_dat_rows(path: Path, heading_tokens: tuple[str, ...], column_count: int):
    if not path.exists():
        return []
    rows = []
    active = False
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip().lower()
        if not line:
            continue
        if line.startswith(" ") and False:
            continue
        if any(token in line for token in heading_tokens):
            active = True
            continue
        if active and line.startswith("*"):
            active = False
            continue
        if active and line and not any(token in line for token in ("displacements", "stresses", "forces", "factor")):
            fields = line.replace("d", "e").replace("D", "E").split()
            try:
                identifier = int(float(fields[0]))
                values = [float(value) for value in fields[-column_count:]]
                if len(values) == column_count:
                    rows.append((identifier, values))
            except (ValueError, IndexError):
                continue
    return rows


def _parse_calculix_dat_displacements(path: Path) -> list[dict[str, Any]]:
    result = []
    for node, values in _numbered_dat_rows(path, ("displacements",), 3):
        ux, uy, uz = values
        result.append({
            "node": node, "u": ux, "v": uy, "w": uz,
            "components": {"x": ux, "y": uy, "z": uz},
            "magnitude": math.sqrt(ux * ux + uy * uy + uz * uz),
        })
    return result


def _parse_calculix_dat_reactions(path: Path) -> list[dict[str, Any]]:
    result = []
    for node, values in _numbered_dat_rows(path, ("forces", "reaction"), 3):
        rx, ry, rz = values
        result.append({
            "node": node, "fx": rx, "fy": ry, "fz": rz,
            "components": {"x": rx, "y": ry, "z": rz},
            "magnitude": math.sqrt(rx * rx + ry * ry + rz * rz),
        })
    return result


def _parse_calculix_dat_stress(path: Path) -> list[dict[str, Any]]:
    result = []
    for element, values in _numbered_dat_rows(path, ("stresses",), 6):
        s11, s22, s33, s12, s13, s23 = values
        vm = math.sqrt(0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2
                              + 6 * (s12 * s12 + s13 * s13 + s23 * s23)))
        result.append({
            "element": element,
            "s11": s11, "s22": s22, "s33": s33,
            "s12": s12, "s13": s13, "s23": s23,
            "von_mises": vm,
        })
    return result


def call_openfoam_compressible_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Explicit compressible route, separate from incompressible OpenFOAM."""
    payload = dict(data)
    boundary_conditions = payload.get("boundary_conditions", {})
    boundary_conditions = boundary_conditions if isinstance(boundary_conditions, Mapping) else {}
    velocity = float(payload.get(
        "velocity",
        boundary_conditions.get("velocity", boundary_conditions.get("inlet_velocity_mps", 1.0)),
    ))
    mach_number = float(payload.get("mach_number", velocity / 343.0))
    if mach_number < 0.3:
        payload["simulation_type"] = "CFD_Incompressible"
        payload["solver_route_reason"] = "low_mach_safe_incompressible"
        payload["requested_physics_type"] = "CFD_Compressible"
        payload["routed_mach_number"] = mach_number
        payload["pressure_incompressible_routing"] = True
        return call_openfoam_solver(payload)

    payload["simulation_type"] = "CFD_Compressible"
    return call_openfoam_solver(payload)


def call_calculix_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Generate and solve a configurable three-dimensional static solid."""
    ccx = shutil.which("ccx")
    if not ccx:
        raise RuntimeError("CalculiX ccx is not installed in the worker container")

    # Keep jobs under the application so this integration works both in Docker and locally.
    jobs_dir = Path(os.getenv("NASEER_JOB_DIR", "jobs"))
    jobs_dir.mkdir(parents=True, exist_ok=True)
    case_dir = jobs_dir / f"calculix-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    inp = case_dir / "model.inp"

    geometry = data.get("geometry", data)
    dimensions = geometry.get("dimensions", geometry) if isinstance(geometry, Mapping) else {}
    def positive(name: str, alias: str, default: float) -> float:
        return float(dimensions.get(name, dimensions.get(alias, geometry.get(name, geometry.get(alias, default)))))

    length = positive("length_x", "length", positive("x", "width", 1.0))
    height = positive("length_y", "height", 1.0)
    depth = positive("length_z", "depth", 1.0)
    mesh = data.get("mesh", {})
    divisions = geometry.get("divisions", mesh.get("divisions", {})) if isinstance(mesh, Mapping) else {}
    if not isinstance(divisions, Mapping):
        divisions = {}
    nx = max(1, int(divisions.get("x", mesh.get("nx", 2))))
    ny = max(1, int(divisions.get("y", mesh.get("ny", 2))))
    nz = max(1, int(divisions.get("z", mesh.get("nz", 2))))

    material = data.get("material", data.get("material_properties", {}))
    E = float(material.get("young_modulus", material.get("youngs_modulus", material.get("elastic_modulus", material.get("E", 210000)))))
    nu = float(material.get("poisson_ratio", material.get("poissons_ratio", material.get("nu", 0.3))))
    density = float(material.get("density", 0.0))
    name = "MATERIAL"

    nodes = {}
    coordinates = []
    node_id = 1
    for k in range(nz + 1):
        for j in range(ny + 1):
            for i in range(nx + 1):
                nodes[(i, j, k)] = node_id
                coordinates.append((node_id, length * i / nx, height * j / ny, depth * k / nz))
                node_id += 1
    elements = []
    element_id = 1
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                n000 = nodes[(i, j, k)]
                n100 = nodes[(i + 1, j, k)]
                n110 = nodes[(i + 1, j + 1, k)]
                n010 = nodes[(i, j + 1, k)]
                n001 = nodes[(i, j, k + 1)]
                n101 = nodes[(i + 1, j, k + 1)]
                n111 = nodes[(i + 1, j + 1, k + 1)]
                n011 = nodes[(i, j + 1, k + 1)]
                elements.append((element_id, n000, n100, n110, n010, n001, n101, n111, n011))
                element_id += 1

    def node_set(predicate) -> list[int]:
        return [nid for (i, j, k), nid in nodes.items()
                if predicate(length * i / nx, height * j / ny, depth * k / nz)]

    def face_nodes(face: str) -> list[int]:
        tol = 1e-12
        face = face.lower()
        if face in {"xmin", "x_min", "left"}:
            return node_set(lambda x, y, z: abs(x) < tol)
        if face in {"xmax", "x_max", "right"}:
            return node_set(lambda x, y, z: abs(x - length) < tol)
        if face in {"ymin", "y_min", "bottom"}:
            return node_set(lambda x, y, z: abs(y) < tol)
        if face in {"ymax", "y_max", "top"}:
            return node_set(lambda x, y, z: abs(y - height) < tol)
        if face in {"zmin", "z_min", "front"}:
            return node_set(lambda x, y, z: abs(z) < tol)
        if face in {"zmax", "z_max", "back"}:
            return node_set(lambda x, y, z: abs(z - depth) < tol)
        return []

    inp.write_text(
        "*HEADING\nNaseer configurable CalculiX static solid\n"
        "*NODE\n" + "".join("%d,%.15g,%.15g,%.15g\n" % n for n in coordinates) +
        "*ELEMENT,TYPE=C3D8,ELSET=SOLID\n" + "".join(",".join(map(str, e)) + "\n" for e in elements) +
        f"*SOLID SECTION,ELSET=SOLID,MATERIAL={name}\n"
        f"*MATERIAL,NAME={name}\n*ELASTIC\n{E},{nu}\n" +
        (f"*DENSITY\n{density}\n" if density else ""),
        encoding="utf-8",
    )

    with inp.open("a", encoding="utf-8") as f:
        f.write(f"*NSET,NSET=ALL\n{','.join(map(str, range(1, len(coordinates) + 1)))}\n")
        constraints = data.get("constraints", [])
        if isinstance(constraints, Mapping):
            constraints = [constraints]
        for index, constraint in enumerate(constraints):
            if not isinstance(constraint, Mapping):
                continue
            face = constraint.get("face") or constraint.get("surface")
            ids = face_nodes(str(face)) if face else list(constraint.get("nodes", []))
            if not ids:
                continue
            dofs = constraint.get("dof", constraint.get("dofs", [1, 2, 3]))
            if isinstance(dofs, (str, int)):
                dofs = [int(dofs)]
            dofs = [int(d) for d in dofs]
            values = constraint.get("value", constraint.get("displacement", 0.0))
            if not isinstance(values, (list, tuple)):
                values = [values]
            values += [0.0] * max(0, len(dofs) - len(values))
            f.write(f"*NSET,NSET=CONSTRAINT_{index}\n" + ",".join(map(str, ids)) + "\n")
            for dof, value in zip(dofs, values):
                f.write(f"*BOUNDARY\nCONSTRAINT_{index},{dof},{dof},{float(value)}\n")

        load_cards: list[str] = []
        loads = data.get("loads", [])
        if isinstance(loads, Mapping):
            loads = [loads]
        if "force" in data and not loads:
            loads = [data["force"]]
        for index, load in enumerate(loads):
            if not isinstance(load, Mapping):
                continue
            components = load.get("components", load.get("force", [0, 0, 0]))
            if isinstance(components, Mapping):
                components = [components.get("x", 0), components.get("y", 0), components.get("z", 0)]
            components = [float(v) for v in components]
            ids = face_nodes(str(load["face"])) if load.get("face") else list(load.get("nodes", []))
            if load.get("nodes") and load["nodes"] and isinstance(load["nodes"][0], int):
                ids = list(load["nodes"])
            if ids:
                f.write(f"*NSET,NSET=LOAD_{index}\n" + ",".join(map(str, ids)) + "\n")
                if load.get("direction") and not any(components):
                    direction = str(load["direction"]).lower()
                    components = [float(load.get("value", load.get("magnitude", 0)))] if direction == "x" else components
                    if direction == "y": components = [0, float(load.get("value", load.get("magnitude", 0))), 0]
                    if direction == "z": components = [0, 0, float(load.get("value", load.get("magnitude", 0)))]
                total = float(load.get("total", load.get("value", load.get("magnitude", 1.0))))
                if "pressure" in load:
                    face_name = str(load.get("face", "")).lower()
                    normal = {"xmin": (-1, 0, 0), "xmax": (1, 0, 0), "ymin": (0, -1, 0),
                              "ymax": (0, 1, 0), "zmin": (0, 0, -1), "zmax": (0, 0, 1)}
                    components = [float(v) for v in normal.get(face_name, (0, 0, 0))]
                    area = {"xmin": height * depth, "xmax": height * depth,
                            "ymin": length * depth, "ymax": length * depth,
                            "zmin": length * height, "zmax": length * height}.get(face_name, length * height)
                    total = float(load["pressure"]) * area
                if load.get("force_per_node"):
                    nodal = components if any(components) else [total * (1 if str(load.get("direction")).lower() == axis else 0) for axis in ("x","y","z")]
                else:
                    if load.get("direction") and any(components):
                        nodal = [v / len(ids) for v in components]
                    elif abs(sum(components)) > 1e-30:
                        nodal = [v * total / len(ids) for v in components]
                    else:
                        nodal = [total / len(ids), 0, 0]
                for dof, value in enumerate(nodal, start=1):
                    if abs(value) > 0:
                        load_cards.append(f"*CLOAD\nLOAD_{index},{dof},{value:.15g}\n")
        # Legacy displacement remains available as a prescribed top edge displacement.
        if "displacement" in data and not constraints:
            value = float(data["displacement"])
            ids = face_nodes("top")
            f.write(f"*NSET,NSET=TOP\n{','.join(map(str, ids))}\n*BOUNDARY\nTOP,1,3,{0}\nTOP,2,2,{value}\n")

        f.write(
            "*STEP\n*STATIC\n"
            + "".join(load_cards)
            + "*NODE PRINT,NSET=ALL\nU\n*NODE PRINT,NSET=ALL\nRF\n"
            + "*EL PRINT,ELSET=SOLID\nS\n"
            + "*NODE FILE\nU\n*EL FILE\nS\n"
            + "*END STEP\n"
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

    result = {
        "status": "SOLVED_REALTIME",
        "solver": "CalculiX",
        "executable": ccx,
        "case_directory": str(case_dir),
        "model": str(inp),
        "dat_output": (case_dir / "model.dat").read_text(encoding="utf-8", errors="replace")
        if (case_dir / "model.dat").exists() else "",
        "displacements": _parse_calculix_dat_displacements(case_dir / "model.dat"),
        "stress": _parse_calculix_dat_stress(case_dir / "model.dat"),
        "reactions": _parse_calculix_dat_reactions(case_dir / "model.dat"),
        "stdout": result.stdout[-4000:],
        "input": dict(data),
    }
    result["units"] = {
        "displacement": "m",
        "stress": "Pa",
        "reaction": "N",
        "von_mises": "Pa",
    }
    result["artifacts"] = {
        "input_deck": str(inp),
        "dat_output": str(case_dir / "model.dat"),
        "case_directory": str(case_dir),
    }
    result["convergence"] = {
        "converged": (case_dir / "model.dat").exists(),
        "status": "completed" if (case_dir / "model.dat").exists() else "not_reported",
        "residuals": {},
    }
    return canonicalize_result(result, physics_type=classify_physics(data), input_data=data, solver="CalculiX")


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
            "CFD_Compressible": call_openfoam_compressible_solver,
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
        return canonicalize_result(
            response,
            physics_type=physics_type,
            input_data=data,
            solver=merged.get("solver") or merged.get("solver_type"),
        )
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        failure: Dict[str, Any] = {}
        if isinstance(exc, OpenFOAMVerificationError):
            failure["errors"] = [{"code": "OPENFOAM_VERIFICATION_FAILED", "message": str(exc)}]
        return canonicalize_result({
            "physics_type": "Thermal_Transient",
            "recommended_solver": _recommended_engine("Thermal_Transient"),
            "status": "error",
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": [],
            "data": {},
            "error": str(exc) if isinstance(exc, OpenFOAMVerificationError) else f"Universal dispatcher failed: {exc}",
            **failure,
        }, physics_type="Thermal_Transient", input_data=data, solver="unknown")


_JOB_REPOSITORY: Optional[Any] = None


def _job_repository() -> Optional[Any]:
    global _JOB_REPOSITORY
    if _JOB_REPOSITORY is None:
        try:
            _JOB_REPOSITORY = JobRepository()
        except Exception:
            logging.getLogger(__name__).exception("Job repository is unavailable")
            return None
    return _JOB_REPOSITORY


def _record_job_state(task_id: Optional[str], status: str, **fields: Any) -> None:
    """Persist job state in the canonical repository; persistence problems must not mask solver results."""
    if not task_id:
        return
    repository = _job_repository()
    if repository is not None:
        try:
            repository.update(task_id, status=status, **fields)
        except Exception:
            logging.getLogger(__name__).exception("Could not persist job %s state %s", task_id, status)


@celery_app.task(
    name="universal_dispatcher.run_simulation",
    bind=True,
    autoretry_for=(OSError, subprocess.SubprocessError),
    retry_backoff=True,
    retry_kwargs={"max_retries": int(os.getenv("CAE_TASK_MAX_RETRIES", "2"))},
    soft_time_limit=int(os.getenv("CAE_TASK_SOFT_TIME_LIMIT_SECONDS", "900")),
    time_limit=int(os.getenv("CAE_TASK_TIME_LIMIT_SECONDS", "960")),
)
def run_simulation_task(self, data: Dict[str, Any]) -> PhysicsResult:
    """Execute simulation work outside the FastAPI process."""
    physics_type = classify_physics(data)
    task_id = getattr(self.request, "id", None)
    _record_job_state(task_id, "RUNNING", progress=10)
    _task_progress(
        self, 10, "Preparing simulation input",
        physics_type=physics_type,
        recommended_solver=_recommended_engine(physics_type),
    )
    _task_progress(self, 35, "Routing simulation to solver", physics_type=physics_type)
    result = execute_simulation(data)
    if isinstance(result, dict) and (result.get("status") == "error" or result.get("error")):
        # Verification or solver failures must never be reported as COMPLETED.
        message = str(result.get("error") or "Simulation failed")
        result["logs"] = result.get("logs", ["Preparing simulation input", "Routing simulation to solver", message])
        _record_job_state(task_id, "FAILED", progress=100, logs=result["logs"], result=result, error=message)
        return result
    if isinstance(result, dict):
        result["task_progress"] = 100
        result["logs"] = result.get("logs", [
            "Preparing simulation input",
            "Routing simulation to solver",
            "Simulation completed",
        ])
    _task_progress(self, 100, "Simulation completed", physics_type=physics_type)
    _record_job_state(
        task_id, "COMPLETED", progress=100,
        logs=result.get("logs") if isinstance(result, dict) else None, result=result,
    )
    return result
