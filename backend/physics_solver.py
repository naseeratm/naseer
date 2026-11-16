"""
================================================================================
NASEER Universal CAE Studio - Retired Legacy Python Solvers (backend/physics_solver.py)
Strict Zero-Mock Policy: Alternative 2D SciPy FEA/CFD solvers are disabled.
All simulations MUST execute through OpenFOAM, CalculiX (ccx), or ElmerFEM.
================================================================================
"""

import math
from typing import Dict, Any


_RETIRED_MESSAGE = (
    "Legacy 2D SciPy/Python solvers are disabled under strict zero-mock policy. "
    "Execute all simulations exclusively through Docker engines (OpenFOAM, CalculiX, ElmerFEM) via main.py."
)


class ElasticFEASolver:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(_RETIRED_MESSAGE)


class NavierStokesCFDSolver:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(_RETIRED_MESSAGE)


def solve_stefan_analytical_benchmark(*args, **kwargs) -> Dict[str, Any]:
    raise RuntimeError(_RETIRED_MESSAGE)


def calculate_roache_gci(
    fine_val: float,
    med_val: float,
    coarse_val: float,
    r21: float = 1.3,
    r32: float = 1.3,
    safety_factor: float = 1.25,
) -> Dict[str, Any]:
    eps32 = coarse_val - med_val
    eps21 = med_val - fine_val

    p = 2.0
    if abs(eps21) > 1e-9 and (eps32 / eps21) > 0:
        p = abs(math.log(abs(eps32 / eps21)) / math.log(r21))
    p = max(0.5, min(4.0, p))

    r21_p = math.pow(r21, p)
    f_extrapolated = (r21_p * fine_val - med_val) / (r21_p - 1.0)

    ea21 = abs((fine_val - med_val) / fine_val) if fine_val != 0 else 0.0
    ea32 = abs((med_val - coarse_val) / med_val) if med_val != 0 else 0.0

    gci21 = ((safety_factor * ea21) / (r21_p - 1.0)) * 100.0
    r32_p = math.pow(r32, p)
    gci32 = ((safety_factor * ea32) / (r32_p - 1.0)) * 100.0

    asymptotic_ratio = gci32 / (r21_p * gci21) if gci21 > 0 else 1.0

    return {
        "apparent_order_p": round(p, 3),
        "richardson_extrapolated_value": round(f_extrapolated, 4),
        "relative_error_percent": round(ea21 * 100.0, 2),
        "gci_fine_percent": round(gci21, 2),
        "gci_medium_percent": round(gci32, 2),
        "asymptotic_range_ratio": round(asymptotic_ratio, 3),
        "is_asymptotic_valid": bool(abs(asymptotic_ratio - 1.0) < 0.15),
    }


def run_physics_simulation(*args, **kwargs) -> Dict[str, Any]:
    raise RuntimeError(_RETIRED_MESSAGE)