"""NASEER Universal CAE Studio — Automated International V&V Regression Suite.

Implements 6 canonical international verification & validation benchmarks aligned with:
- ASME V&V 20 (CFD & Heat Transfer)
- NASA Turbulence Modeling Resource (TMR 2D Channel Flow)
- NAFEMS Structural FEA & Modal Frequency Benchmarks
- ASME Electrostatic Verification (ElmerFEM Laplace Field)

Strict Zero-Mock Policy:
- Every benchmark executes the real solver (OpenFOAM, CalculiX ccx, ElmerFEM) via
  `universal_dispatcher.execute_simulation`, Celery worker, or live FastAPI endpoint.
- If a required solver binary is missing or offline, the benchmark MUST return
  status `SKIPPED_NO_BINARY` (or `ERROR`), NEVER a fabricated PASS or synthetic number.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

# ---------------------------------------------------------------------------
# 1. Canonical Analytical Constants & Benchmark Definitions
# ---------------------------------------------------------------------------
_BETA1_L = 1.875104068711961  # First root of cos(beta*L)*cosh(beta*L) + 1 = 0
_CANTILEVER_L = 1.0
_CANTILEVER_H_STATIC = 0.08
_CANTILEVER_B_STATIC = 0.05
_CANTILEVER_E = 200.0e9
_CANTILEVER_F = 10000.0
_CANTILEVER_I_STATIC = (_CANTILEVER_B_STATIC * (_CANTILEVER_H_STATIC ** 3)) / 12.0
_CANTILEVER_W_EXACT = (_CANTILEVER_F / _CANTILEVER_L) * (_CANTILEVER_L ** 4) / (8.0 * _CANTILEVER_E * _CANTILEVER_I_STATIC)

_MODAL_H = 0.08
_MODAL_RHO = 7850.0
_MODAL_F1_EXACT = ((_BETA1_L ** 2) / (2.0 * math.pi * (_CANTILEVER_L ** 2))) * math.sqrt(
    (_CANTILEVER_E * (_MODAL_H ** 2)) / (12.0 * _MODAL_RHO)
)


VV_BENCHMARKS: List[Dict[str, Any]] = [
    {
        "id": "ASME-VV20-CFD-01",
        "standard": "ASME V&V 20-2009",
        "domain": "CFD_Incompressible",
        "title": "Hagen-Poiseuille Laminar Channel Flow (Re_H = 100)",
        "title_ar": "جريان هاغن-بوازوي الصفائحي داخل قناة (Re_H = 100)",
        "required_solver_key": "openfoam",
        "solver_name": "OpenFOAM (simpleFoam)",
        "quantity": "Peak Centerline Velocity U_max",
        "formula": "U_max = (3/2) * U_avg = 1.5 * 0.01 = 0.015 m/s",
        "reference_value": 0.015,
        "unit": "m/s",
        "tolerance_percent": 5.0,
        "reference_citation": "White, F.M. Viscous Fluid Flow; ASME V&V 20-2009 Analytical Poiseuille Benchmark",
        "payload": {
            "simulation_type": "CFD_Incompressible",
            "width_x": 1.0,
            "height_y": 0.1,
            "depth_z": 0.02,
            "mesh_size": 0.008,
            "velocity": 0.01,
            "density": 1000.0,
            "dynamic_viscosity": 0.01,
            "fluid_properties": {
                "density": 1000.0,
                "dynamic_viscosity": 0.01,
                "thermal_conductivity": 0.6,
            },
            "turbulence_model": "laminar",
            "max_iterations": 300,
            "convergence_tolerance": 1e-5,
            "parallel_cores": 1,
        },
    },
    {
        "id": "NASA-TMR-CFD-02",
        "standard": "NASA TMR (2DC) / Dean 1978",
        "domain": "CFD_Incompressible",
        "title": "Turbulent Channel Flow (k-omega SST, Re_H ~ 20,300)",
        "title_ar": "جريان القناة المضطرب (k-omega SST, Re_H ~ 20,300)",
        "required_solver_key": "openfoam",
        "solver_name": "OpenFOAM (simpleFoam + kOmegaSST)",
        "quantity": "Turbulent Peak-to-Bulk Ratio U_max / U_avg",
        "formula": "1.05 <= U_max / U_avg <= 1.38 (nominal ~1.18) with wallShearStress > 0",
        "reference_value": 1.18,
        "unit": "ratio",
        "tolerance_percent": 17.0,
        "valid_range": [1.05, 1.38],
        "reference_citation": "NASA Turbulence Modeling Resource (2DC); Dean, R.B. (1978) J. Fluids Eng. 100(2)",
        "payload": {
            "simulation_type": "CFD_Incompressible",
            "width_x": 2.0,
            "height_y": 0.2,
            "depth_z": 0.04,
            "mesh_size": 0.015,
            "velocity": 1.5,
            "density": 1.225,
            "dynamic_viscosity": 1.81e-5,
            "fluid_properties": {
                "density": 1.225,
                "dynamic_viscosity": 1.81e-5,
                "thermal_conductivity": 0.0257,
            },
            "turbulence_model": "kOmegaSST",
            "max_iterations": 250,
            "convergence_tolerance": 1e-4,
            "parallel_cores": 1,
        },
    },
    {
        "id": "ASME-VV20-THM-01",
        "standard": "ASME V&V 20 / NAFEMS T1",
        "domain": "Thermal_Steady",
        "title": "Fourier 2D Steady Heat Conduction Plate",
        "title_ar": "التوصيل الحراري المستقر ثنائي الأبعاد (قانون فورييه)",
        "required_solver_key": "calculix",
        "solver_name": "CalculiX (ccx *HEAT TRANSFER)",
        "quantity": "Centerline Temperature T_center (cross-checked with q'' = 4000 W/m2)",
        "formula": "T(L/2) = (T_left + T_right)/2 = 60.0 degC; q'' = k*dT/L = 4000.0 W/m2",
        "reference_value": 60.0,
        "secondary_reference_value": 4000.0,
        "unit": "°C",
        "tolerance_percent": 0.5,
        "reference_citation": "Fourier Analytical Conduction; NAFEMS T1 Benchmark Series",
        "payload": {
            "simulation_type": "Thermal_Steady",
            "width_x": 1.0,
            "height_y": 1.0,
            "depth_z": 0.05,
            "mesh_size": 0.1,
            "thermal_conductivity_k": 50.0,
            "material": {
                "thermal_conductivity_k": 50.0,
                "density": 7850.0,
                "specific_heat": 460.0,
            },
            "bc_left_temp": 373.15,
            "bc_right_temp": 293.15,
            "bc_top_type": "adiabatic",
            "bc_bottom_type": "adiabatic",
            "parallel_cores": 1,
        },
    },
    {
        "id": "NAFEMS-FEA-01",
        "standard": "NAFEMS LE / Euler-Bernoulli",
        "domain": "Structural_Static",
        "title": "Uniformly Loaded 3D Cantilever Beam (Quadratic C3D20R)",
        "title_ar": "انحراف العارضة الكابولية ثلاثية الأبعاد (عناصر تربيعية C3D20R)",
        "required_solver_key": "calculix",
        "solver_name": "CalculiX (ccx C3D20R *STATIC)",
        "quantity": "Tip Max Deflection w_max",
        "formula": "w_max = q*L^4 / (8*E*I) = 0.00292969 m (2.9297 mm)",
        "reference_value": round(_CANTILEVER_W_EXACT, 8),
        "unit": "m",
        "tolerance_percent": 5.0,
        "reference_citation": "NAFEMS Linear Elastic Cantilever Verification; Timoshenko & Goodier",
        "payload": {
            "simulation_type": "Structural_Static",
            "width_x": _CANTILEVER_L,
            "height_y": _CANTILEVER_H_STATIC,
            "depth_z": _CANTILEVER_B_STATIC,
            "mesh_size": 0.04,
            "element_order": 2,
            "support_type": "cantilever",
            "material": {
                "young_modulus": _CANTILEVER_E,
                "poisson_ratio": 0.3,
                "density": _MODAL_RHO,
            },
            "force_n": _CANTILEVER_F,
            "parallel_cores": 1,
        },
    },
    {
        "id": "NAFEMS-FEA-02",
        "standard": "NAFEMS FV12 / Modal Cantilever",
        "domain": "Structural_Dynamic",
        "title": "Cantilever Beam Fundamental Natural Frequency (Mode 1)",
        "title_ar": "التردد الطبيعي الأساسي للعارضة الكابولية (النمط الأول)",
        "required_solver_key": "calculix",
        "solver_name": "CalculiX (ccx C3D20R *FREQUENCY)",
        "quantity": "Fundamental Frequency f_1",
        "formula": "f_1 = (1.8751^2 / (2*pi*L^2)) * sqrt(E*I / (rho*A)) = 65.2304 Hz",
        "reference_value": round(_MODAL_F1_EXACT, 4),
        "unit": "Hz",
        "tolerance_percent": 5.0,
        "reference_citation": "NAFEMS Free Vibration Benchmark Series; Blevins Formulas for Natural Frequency",
        "payload": {
            "simulation_type": "Structural_Dynamic",
            "width_x": _CANTILEVER_L,
            "height_y": _MODAL_H,
            "depth_z": _MODAL_H,
            "mesh_size": 0.04,
            "element_order": 2,
            "support_type": "cantilever",
            "material": {
                "young_modulus": _CANTILEVER_E,
                "poisson_ratio": 0.3,
                "density": _MODAL_RHO,
            },
            "modes_count": 5,
            "parallel_cores": 1,
        },
    },
    {
        "id": "ASME-EM-01",
        "standard": "ASME / ElmerFEM Electrostatics",
        "domain": "Electromagnetic",
        "title": "Parallel-Plate Electrostatic Laplace Potential Field (100 V -> 0 V)",
        "title_ar": "المجال الكهروستاتيكي بين لوحين متوازيين (معادلة لابلاس)",
        "required_solver_key": "elmer",
        "solver_name": "ElmerFEM (StatElecSolve)",
        "quantity": "Domain Mean Electrostatic Potential phi_avg",
        "formula": "phi(x) = 100*(1 - x/L) => phi_avg = 50.0 V, phi_min = 0 V, phi_max = 100 V",
        "reference_value": 50.0,
        "unit": "V",
        "tolerance_percent": 3.0,
        "reference_citation": "Jackson, Classical Electrodynamics; ElmerFEM StatElecSolve Verification",
        "payload": {
            "simulation_type": "Electromagnetic",
            "width_x": 1.0,
            "height_y": 0.5,
            "depth_z": 0.1,
            "mesh_size": 0.1,
            "em_parameters": {
                "em_submode": "Electrostatic",
                "source_value": 100.0,
                "reference_value": 0.0,
                "relative_permittivity": 1.0,
                "electrical_conductivity": 1.0,
            },
            "parallel_cores": 1,
        },
    },
]

VV_BENCHMARK_BY_ID: Dict[str, Dict[str, Any]] = {b["id"]: b for b in VV_BENCHMARKS}


def list_vv_benchmarks(capabilities: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
    """Return benchmark catalog annotated with live solver readiness."""
    out: List[Dict[str, Any]] = []
    for spec in VV_BENCHMARKS:
        req_key = spec["required_solver_key"]
        cap_entry = capabilities.get(req_key) if isinstance(capabilities, Mapping) else None
        if isinstance(cap_entry, Mapping):
            available = bool(cap_entry.get("available"))
            version = cap_entry.get("version")
        else:
            available = bool(cap_entry) if cap_entry is not None else False
            version = None

        out.append({
            "id": spec["id"],
            "standard": spec["standard"],
            "domain": spec["domain"],
            "title": spec["title"],
            "title_ar": spec["title_ar"],
            "required_solver_key": req_key,
            "solver_name": spec["solver_name"],
            "solver_available": available,
            "solver_version": version,
            "quantity": spec["quantity"],
            "formula": spec["formula"],
            "reference_value": spec["reference_value"],
            "unit": spec["unit"],
            "tolerance_percent": spec["tolerance_percent"],
            "reference_citation": spec["reference_citation"],
        })
    return out


# ---------------------------------------------------------------------------
# 2. Pure Deterministic Result Extraction & Evaluation
# ---------------------------------------------------------------------------
def _unwrap_solver_result(raw_result: Mapping[str, Any]) -> Dict[str, Any]:
    """Flatten canonical envelope { data: {...}, vtk_data: ... } while keeping top-level fields."""
    merged: Dict[str, Any] = dict(raw_result)
    inner = raw_result.get("data")
    if isinstance(inner, Mapping):
        for k, v in inner.items():
            if k not in merged or merged[k] in (None, {}, []):
                merged[k] = v
        # Prefer inner integrals / modes if top-level lacks them
        if isinstance(inner.get("integrals"), Mapping) and not merged.get("integrals"):
            merged["integrals"] = dict(inner["integrals"])
        if isinstance(inner.get("modes"), list) and not merged.get("modes"):
            merged["modes"] = list(inner["modes"])
    return merged


def _safe_float(val: Any) -> Optional[float]:
    if isinstance(val, bool) or val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _extract_vtk_max(merged: Mapping[str, Any], candidate_keys: tuple[str, ...]) -> Optional[float]:
    vtk = merged.get("vtk_data")
    if not isinstance(vtk, Mapping):
        return None
    scalars = vtk.get("scalars")
    if not isinstance(scalars, Mapping):
        return None
    for key in candidate_keys:
        vals = scalars.get(key)
        if isinstance(vals, list) and vals:
            nums = [float(v) for v in vals if isinstance(v, (int, float)) and math.isfinite(float(v))]
            if nums:
                return max(nums)
    return None


def evaluate_benchmark_result(
    benchmark_id: str,
    raw_result: Mapping[str, Any],
    *,
    runtime_sec: Optional[float] = None,
) -> Dict[str, Any]:
    """Evaluate a real solver output against the canonical analytical benchmark."""
    spec = VV_BENCHMARK_BY_ID.get(benchmark_id)
    if spec is None:
        raise ValueError(f"Unknown V&V benchmark ID: {benchmark_id}")

    merged = _unwrap_solver_result(raw_result)
    raw_status = str(merged.get("status", "")).upper()
    if raw_status in {"ERROR", "FAILED", "FAILURE"} or merged.get("error"):
        err_msg = str(merged.get("error") or "Solver returned an error status.")
        return {
            "benchmark_id": benchmark_id,
            "standard": spec["standard"],
            "title": spec["title"],
            "title_ar": spec["title_ar"],
            "solver": merged.get("solver") or spec["solver_name"],
            "status": "FAIL",
            "simulated_value": None,
            "reference_value": spec["reference_value"],
            "unit": spec["unit"],
            "relative_error_percent": None,
            "tolerance_percent": spec["tolerance_percent"],
            "runtime_sec": round(runtime_sec, 3) if runtime_sec is not None else _safe_float(merged.get("process_time")),
            "details": f"Solver failed: {err_msg}",
            "provenance": merged.get("provenance") if isinstance(merged.get("provenance"), Mapping) else {},
        }

    integrals = merged.get("integrals") if isinstance(merged.get("integrals"), Mapping) else {}
    ref_val = float(spec["reference_value"])
    tol_pct = float(spec["tolerance_percent"])

    sim_val: Optional[float] = None
    extra_checks: List[str] = []
    extra_ok = True

    if benchmark_id == "ASME-VV20-CFD-01":
        sim_val = (
            _safe_float(integrals.get("max_velocity_mps"))
            or _safe_float(merged.get("max_velocity"))
            or _extract_vtk_max(merged, ("U_mag", "U"))
        )
        if sim_val is None:
            extra_ok = False
            extra_checks.append("Missing max_velocity_mps in OpenFOAM result")

    elif benchmark_id == "NASA-TMR-CFD-02":
        u_max = (
            _safe_float(integrals.get("max_velocity_mps"))
            or _safe_float(merged.get("max_velocity"))
            or _extract_vtk_max(merged, ("U_mag", "U"))
        )
        u_inlet = float(spec["payload"]["velocity"])
        if u_max is not None and u_inlet > 0:
            sim_val = u_max / u_inlet
            low, high = spec["valid_range"]
            if not (low <= sim_val <= high):
                extra_ok = False
                extra_checks.append(f"U_max/U_avg={sim_val:.4f} outside turbulent envelope [{low}, {high}]")
        else:
            extra_ok = False
            extra_checks.append("Missing max_velocity_mps in OpenFOAM turbulent result")

        wss = _safe_float(integrals.get("wall_shear_stress_max_pa"))
        yplus = _safe_float(integrals.get("y_plus_avg"))
        if wss is not None:
            extra_checks.append(f"tau_w_max={wss:.5f} Pa")
            if wss <= 0.0:
                extra_ok = False
                extra_checks.append("Non-positive wall shear stress")
        if yplus is not None:
            extra_checks.append(f"y+_avg={yplus:.2f}")
            if yplus <= 0.0:
                extra_ok = False
                extra_checks.append("Non-positive yPlus")
        if wss is None and yplus is None:
            extra_ok = False
            extra_checks.append("Missing OpenFOAM turbulent wall diagnostics (yPlus / wallShearStress)")

    elif benchmark_id == "ASME-VV20-THM-01":
        sim_val = _safe_float(merged.get("center_temperature"))
        if sim_val is None:
            t_mat = merged.get("temperature_matrix")
            if isinstance(t_mat, list) and t_mat and isinstance(t_mat[0], list) and t_mat[0]:
                sim_val = _safe_float(t_mat[len(t_mat) // 2][len(t_mat[0]) // 2])
        q_sim = _safe_float(merged.get("calculated_heat_flux")) or _safe_float(integrals.get("heat_flux_w_m2"))
        if q_sim is not None:
            q_ref = float(spec["secondary_reference_value"])
            q_err = abs(q_sim - q_ref) / max(abs(q_ref), 1e-12) * 100.0
            extra_checks.append(f"q''={q_sim:.2f} W/m² (ref {q_ref:.1f}, err {q_err:.2f}%)")
            if q_err > 1.5:
                extra_ok = False
                extra_checks.append("Heat flux error exceeds 1.5%")

    elif benchmark_id == "NAFEMS-FEA-01":
        sim_val = (
            _safe_float(integrals.get("max_displacement_m"))
            or _extract_vtk_max(merged, ("displacement", "U_mag"))
        )
        vm_max = _safe_float(integrals.get("max_von_mises_pa"))
        if vm_max is not None:
            extra_checks.append(f"sigma_vM_max={vm_max / 1e6:.2f} MPa")

    elif benchmark_id == "NAFEMS-FEA-02":
        modes = merged.get("modes")
        if isinstance(modes, list) and modes:
            positive_freqs: List[float] = []
            for m in modes:
                if not isinstance(m, Mapping):
                    continue
                f_hz = _safe_float(m.get("frequency_hz"))
                if f_hz is None:
                    eig = _safe_float(m.get("eigenvalue"))
                    col3 = _safe_float(m.get("frequency_or_factor"))
                    if eig is not None and eig > 0.0:
                        f_hz = math.sqrt(eig) / (2.0 * math.pi)
                    elif col3 is not None and col3 > 0.0:
                        # CalculiX column 3 is omega (rad/s)
                        f_hz = col3 / (2.0 * math.pi)
                if f_hz is not None and f_hz > 1.0:
                    positive_freqs.append(f_hz)
            if positive_freqs:
                sim_val = min(positive_freqs)
                extra_checks.append(f"parsed {len(positive_freqs)} elastic modes")
        if sim_val is None:
            extra_ok = False
            extra_checks.append("No positive elastic eigenfrequency parsed from CalculiX *FREQUENCY output")

    elif benchmark_id == "ASME-EM-01":
        sim_val = _safe_float(integrals.get("field_average"))
        f_min = _safe_float(integrals.get("field_min"))
        f_max = _safe_float(integrals.get("field_max"))
        if f_min is not None and f_max is not None:
            extra_checks.append(f"phi range=[{f_min:.2f}, {f_max:.2f}] V")
            if abs(f_max - 100.0) > 2.0 or abs(f_min - 0.0) > 2.0:
                extra_ok = False
                extra_checks.append("Boundary potentials do not satisfy [0 V, 100 V]")

    if sim_val is None:
        return {
            "benchmark_id": benchmark_id,
            "standard": spec["standard"],
            "title": spec["title"],
            "title_ar": spec["title_ar"],
            "solver": merged.get("solver") or spec["solver_name"],
            "status": "FAIL",
            "simulated_value": None,
            "reference_value": ref_val,
            "unit": spec["unit"],
            "relative_error_percent": None,
            "tolerance_percent": tol_pct,
            "runtime_sec": round(runtime_sec, 3) if runtime_sec is not None else _safe_float(merged.get("process_time")),
            "details": "; ".join(extra_checks) or "Required physical quantity missing from solver output.",
            "provenance": merged.get("provenance") if isinstance(merged.get("provenance"), Mapping) else {},
        }

    rel_err = abs(sim_val - ref_val) / max(abs(ref_val), 1e-12) * 100.0
    passed = (rel_err <= tol_pct) and extra_ok
    detail_str = "; ".join(extra_checks) if extra_checks else f"Relative error {rel_err:.3f}% vs tolerance {tol_pct:.2f}%"

    return {
        "benchmark_id": benchmark_id,
        "standard": spec["standard"],
        "title": spec["title"],
        "title_ar": spec["title_ar"],
        "solver": merged.get("solver") or spec["solver_name"],
        "status": "PASS" if passed else "FAIL",
        "simulated_value": round(sim_val, 8),
        "reference_value": ref_val,
        "unit": spec["unit"],
        "relative_error_percent": round(rel_err, 4),
        "tolerance_percent": tol_pct,
        "runtime_sec": round(runtime_sec, 3) if runtime_sec is not None else _safe_float(merged.get("process_time")),
        "details": detail_str,
        "provenance": merged.get("provenance") if isinstance(merged.get("provenance"), Mapping) else {},
    }


# ---------------------------------------------------------------------------
# 3. Live Solver Execution (Local / Custom Runner / Remote FastAPI HTTP)
# ---------------------------------------------------------------------------
def _run_via_http_api(api_url: str, payload: Dict[str, Any], timeout_sec: float = 300.0) -> Dict[str, Any]:
    base = api_url.rstrip("/")
    req_body = json.dumps({**payload, "execution_mode": "celery"}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/run-simulation",
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            init_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {"status": "ERROR", "error": f"HTTP {exc.code}: {body[:400]}"}
    except Exception as exc:
        return {"status": "ERROR", "error": f"HTTP request failed: {exc}"}

    if init_data.get("status") == "SOLVED_REALTIME" or init_data.get("data"):
        return init_data

    task_id = init_data.get("task_id")
    if not task_id:
        return {"status": "ERROR", "error": f"No task_id returned from {base}/api/run-simulation"}

    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        time.sleep(1.5)
        try:
            with urllib.request.urlopen(f"{base}/api/jobs/{task_id}", timeout=20.0) as poll_resp:
                job = json.loads(poll_resp.read().decode("utf-8"))
        except Exception as exc:
            return {"status": "ERROR", "error": f"Polling /api/jobs/{task_id} failed: {exc}"}
        st = str(job.get("status", "")).upper()
        if st in {"SUCCESS", "COMPLETED", "SOLVED_REALTIME"}:
            return job.get("result") if isinstance(job.get("result"), dict) else job
        if st in {"FAILURE", "FAILED", "ERROR"}:
            return {"status": "ERROR", "error": str(job.get("error") or "Worker job failed")}
    return {"status": "ERROR", "error": f"Benchmark timed out after {timeout_sec:.0f}s (task {task_id})"}


def run_vv_benchmark(
    benchmark_id: str,
    *,
    api_url: Optional[str] = None,
    executor: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    capabilities: Optional[Mapping[str, Any]] = None,
    timeout_sec: float = 300.0,
) -> Dict[str, Any]:
    """Execute a single international V&V benchmark strictly on real solvers (Zero-Mock)."""
    spec = VV_BENCHMARK_BY_ID.get(benchmark_id)
    if spec is None:
        raise ValueError(f"Unknown V&V benchmark ID: {benchmark_id}")

    req_key = spec["required_solver_key"]
    started = time.perf_counter()

    if api_url:
        raw_result = _run_via_http_api(api_url, dict(spec["payload"]), timeout_sec=timeout_sec)
        elapsed = time.perf_counter() - started
        return evaluate_benchmark_result(benchmark_id, raw_result, runtime_sec=elapsed)

    # Check capability availability before local/worker execution
    caps = capabilities
    if caps is None and executor is None:
        from universal_dispatcher import probe_worker_capabilities

        caps = probe_worker_capabilities()

    if isinstance(caps, Mapping) and req_key in caps:
        entry = caps.get(req_key)
        avail = bool(entry.get("available")) if isinstance(entry, Mapping) else bool(entry)
        if not avail:
            return {
                "benchmark_id": benchmark_id,
                "standard": spec["standard"],
                "title": spec["title"],
                "title_ar": spec["title_ar"],
                "solver": spec["solver_name"],
                "status": "SKIPPED_NO_BINARY",
                "simulated_value": None,
                "reference_value": spec["reference_value"],
                "unit": spec["unit"],
                "relative_error_percent": None,
                "tolerance_percent": spec["tolerance_percent"],
                "runtime_sec": 0.0,
                "details": f"Required solver binary '{req_key}' is not installed/online on this node (Zero-Mock policy: no fabricated pass).",
                "provenance": {},
            }

    run_fn = executor
    if run_fn is None:
        from universal_dispatcher import execute_simulation

        run_fn = execute_simulation

    try:
        raw_result = run_fn(dict(spec["payload"]))
    except Exception as exc:
        elapsed = time.perf_counter() - started
        return evaluate_benchmark_result(
            benchmark_id,
            {"status": "ERROR", "error": str(exc)},
            runtime_sec=elapsed,
        )

    elapsed = time.perf_counter() - started
    return evaluate_benchmark_result(benchmark_id, raw_result, runtime_sec=elapsed)


def run_vv_suite(
    benchmark_ids: Optional[List[str]] = None,
    *,
    api_url: Optional[str] = None,
    executor: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    capabilities: Optional[Mapping[str, Any]] = None,
    timeout_sec: float = 300.0,
    on_benchmark_start: Optional[Callable[..., None]] = None,
    on_benchmark_complete: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    """Run one, several, or all 6 international V&V benchmarks and build a signed certificate."""
    import inspect

    selected = benchmark_ids or [b["id"] for b in VV_BENCHMARKS]
    invalid = [bid for bid in selected if bid not in VV_BENCHMARK_BY_ID]
    if invalid:
        raise ValueError(f"Invalid benchmark IDs: {', '.join(invalid)}")

    if capabilities is None and executor is None and not api_url:
        from universal_dispatcher import probe_worker_capabilities

        capabilities = probe_worker_capabilities()

    started_utc = datetime.now(timezone.utc).isoformat()
    t0 = time.perf_counter()
    results: List[Dict[str, Any]] = []
    total = len(selected)

    def _invoke_complete_cb(idx_val: int, total_val: int, bench_res: Dict[str, Any], all_res: List[Dict[str, Any]]) -> None:
        if on_benchmark_complete is None:
            return
        try:
            sig = inspect.signature(on_benchmark_complete)
            params = list(sig.parameters.values())
            has_varargs = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
            pos_count = sum(
                1
                for p in params
                if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
            )
            if has_varargs or pos_count >= 4:
                on_benchmark_complete(idx_val, total_val, bench_res, all_res)
            elif pos_count == 3:
                on_benchmark_complete(bench_res, idx_val, total_val)
            else:
                on_benchmark_complete(bench_res)
        except (TypeError, ValueError):
            on_benchmark_complete(idx_val, total_val, bench_res, all_res)

    for idx, bid in enumerate(selected, start=1):
        if on_benchmark_start is not None:
            on_benchmark_start(idx, total, bid)
        bench_result = run_vv_benchmark(
            bid,
            api_url=api_url,
            executor=executor,
            capabilities=capabilities,
            timeout_sec=timeout_sec,
        )
        results.append(bench_result)
        _invoke_complete_cb(idx, total, dict(bench_result), [dict(r) for r in results])
    total_sec = round(time.perf_counter() - t0, 3)

    passed_count = sum(1 for r in results if r["status"] == "PASS")
    failed_count = sum(1 for r in results if r["status"] == "FAIL")
    skipped_count = sum(1 for r in results if r["status"] == "SKIPPED_NO_BINARY")

    if failed_count > 0:
        overall = "FAIL"
    elif passed_count == len(results) and passed_count > 0:
        overall = "CERTIFIED_PASS"
    elif passed_count > 0 and skipped_count > 0:
        overall = "PARTIAL_PASS"
    else:
        overall = "SKIPPED_NO_SOLVERS"

    canonical_payload = {
        "certificate_standard": "NASEER-VV-CERT-v1 (ASME V&V 20 / NAFEMS / NASA TMR)",
        "generated_at_utc": started_utc,
        "overall_status": overall,
        "summary": {
            "total": len(results),
            "passed": passed_count,
            "failed": failed_count,
            "skipped": skipped_count,
            "total_runtime_sec": total_sec,
        },
        "solver_capabilities": dict(capabilities) if isinstance(capabilities, Mapping) else {},
        "results": results,
    }
    digest = hashlib.sha256(
        json.dumps(canonical_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    canonical_payload["sha256_integrity_hash"] = digest
    return canonical_payload


# ---------------------------------------------------------------------------
# 4. Certificate Formatting (JSON & Markdown)
# ---------------------------------------------------------------------------
def generate_vv_certificate_json(report: Mapping[str, Any]) -> str:
    return json.dumps(report, indent=2, ensure_ascii=False)


def generate_vv_certificate_markdown(report: Mapping[str, Any]) -> str:
    summary = report.get("summary", {})
    lines = [
        "# NASEER Universal CAE Studio — International V&V Verification Certificate",
        "",
        f"- **Standard Framework:** `{report.get('certificate_standard', 'ASME V&V 20 / NAFEMS / NASA TMR')}`",
        f"- **Generated (UTC):** `{report.get('generated_at_utc', '')}`",
        f"- **Overall Verdict:** **{report.get('overall_status', 'UNKNOWN')}**",
        f"- **Results:** `{summary.get('passed', 0)} PASS` / `{summary.get('failed', 0)} FAIL` / `{summary.get('skipped', 0)} SKIPPED` (Total: {summary.get('total', 0)}, Runtime: {summary.get('total_runtime_sec', 0)} s)",
        f"- **SHA-256 Integrity Digest:** `{report.get('sha256_integrity_hash', '')}`",
        "",
        "## Benchmark Verification Matrix",
        "",
        "| Benchmark ID | Standard | Solver | Simulated | Reference | Unit | Rel. Error (%) | Tolerance (%) | Verdict |",
        "| :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | :---: |",
    ]
    for r in report.get("results", []):
        sim_str = f"{r['simulated_value']:.6g}" if isinstance(r.get("simulated_value"), (int, float)) else "—"
        ref_str = f"{r['reference_value']:.6g}" if isinstance(r.get("reference_value"), (int, float)) else "—"
        err_str = f"{r['relative_error_percent']:.3f}%" if isinstance(r.get("relative_error_percent"), (int, float)) else "—"
        tol_str = f"<= {r['tolerance_percent']:.2f}%"
        lines.append(
            f"| `{r['benchmark_id']}` | {r['standard']} | {r['solver']} | {sim_str} | {ref_str} | {r['unit']} | {err_str} | {tol_str} | **{r['status']}** |"
        )

    lines.extend([
        "",
        "## Engineering Notes & Zero-Mock Attestation",
        "",
        "1. Every `PASS` verdict above was computed directly from real physics solver binaries (`OpenFOAM`, `CalculiX ccx`, `ElmerFEM`) without mock fallback or pre-baked values.",
        "2. Any missing solver binary is reported explicitly as `SKIPPED_NO_BINARY`.",
        "",
        "### Detailed Diagnostics",
    ])
    for r in report.get("results", []):
        lines.append(f"- **`{r['benchmark_id']}` ({r['status']})**: {r.get('details', '')} *(runtime: {r.get('runtime_sec')} s)*")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 5. CLI Entry Point
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run NASEER International V&V Regression Suite (NAFEMS / ASME V&V 20 / NASA TMR).")
    parser.add_argument(
        "--benchmark",
        default="all",
        help=f"Benchmark ID or 'all'. Valid IDs: {', '.join(VV_BENCHMARK_BY_ID.keys())}",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Optional live FastAPI backend URL (e.g. http://127.0.0.1:8000). If omitted, runs directly inside the local/Docker worker environment.",
    )
    parser.add_argument(
        "--out-dir",
        default=".",
        help="Directory to write vv_verification_certificate.json and VV_VERIFICATION_CERTIFICATE.md",
    )
    parser.add_argument("--timeout", type=float, default=300.0, help="Per-benchmark timeout in seconds.")
    args = parser.parse_args(argv)

    selected = None if args.benchmark.strip().lower() == "all" else [args.benchmark.strip()]
    report = run_vv_suite(selected, api_url=args.api_url, timeout_sec=args.timeout)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "vv_verification_certificate.json"
    md_path = out_dir / "VV_VERIFICATION_CERTIFICATE.md"
    json_path.write_text(generate_vv_certificate_json(report), encoding="utf-8")
    md_path.write_text(generate_vv_certificate_markdown(report), encoding="utf-8")

    print(generate_vv_certificate_markdown(report))
    print(f"Saved certificate JSON: {json_path.resolve()}")
    print(f"Saved certificate MD:   {md_path.resolve()}")
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
