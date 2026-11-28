"""Verification metrics for the mesh-independence study.

* physics-specific key results: the scalar that is compared across meshes (thermal / CFD / structural)
* Grid Convergence Index following Celik et al., J. Fluids Eng. 130(7), 2008 (the procedure ASME V&V 20 refers to)
* a study orchestrator that runs the real solver on three systematically refined meshes

Everything here is derived from solver output. Where a quantity cannot be derived, ``KeyResultUnavailable`` or
``MeshStudyError`` is raised with a message the UI can show verbatim; nothing is defaulted or guessed.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


class KeyResultUnavailable(ValueError):
    """The requested key result cannot be extracted from the solver output."""


class MeshStudyError(RuntimeError):
    """The study cannot produce a trustworthy GCI (solver failure, mesh did not change, ...)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------------------------
# Key-result registry
# ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class KeyResultSpec:
    id: str
    label: str
    description: str
    unit: str = ""
    caveat: str | None = None
    default: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "unit": self.unit,
            "description": self.description,
            "caveat": self.caveat,
            "default": self.default,
        }


KEY_RESULTS: dict[str, list[KeyResultSpec]] = {
    "thermal": [
        KeyResultSpec(
            "center_temperature",
            "Center temperature",
            "Temperature at the geometric centre of the domain, bilinearly interpolated from the returned temperature "
            "field so that every mesh level is sampled at the same physical point.",
            unit="°C",
            default=True,
        ),
    ],
    "cfd": [
        KeyResultSpec(
            "max_velocity",
            "Maximum velocity magnitude V_max",
            "Largest velocity magnitude |U| over all cells at the final time step.",
            unit="m/s",
            caveat="Peak velocity near the inlet/wall corner depends on how well the boundary layer is resolved and may "
                   "not converge with refinement.",
            default=True,
        ),
        KeyResultSpec(
            "pressure_drop",
            "Pressure drop ΔP (inlet → outlet)",
            "Mean pressure at the inlet minus the outlet (cell layer for structured grids, or boundaryField / postProcessing patch averages for unstructured 3D CAD meshes).",
            caveat="The case is solved transiently with a fixed time step, so temporal error does not decrease with "
                   "mesh refinement. Incompressible OpenFOAM solvers report kinematic pressure p/ρ.",
        ),
        KeyResultSpec(
            "drag_coefficient_cd",
            "Drag coefficient C_d",
            "Streamwise aerodynamic drag coefficient parsed from OpenFOAM postProcessing/forceCoeffs.",
            unit="",
            caveat="Available when an OpenFOAM forceCoeffs functionObject is active (e.g. external aerodynamics).",
        ),
        KeyResultSpec(
            "nusselt_number",
            "Nusselt number Nu",
            "Wall-to-bulk convective heat transfer Nusselt number computed from the solved OpenFOAM temperature field.",
            unit="",
            caveat="Available for CHT and thermal CFD runs solving an energy / temperature field T.",
        ),
    ],
    "structural": [
        KeyResultSpec(
            "max_von_mises",
            "Peak von Mises stress",
            "Largest von Mises stress over all element integration points.",
            unit="Pa",
            caveat="Peak stress at constrained edges, corners or load points is singular and does not converge with "
                   "refinement; the GCI is only meaningful when the peak lies in a smooth region.",
            default=True,
        ),
        KeyResultSpec(
            "max_displacement",
            "Peak displacement magnitude",
            "Largest nodal displacement magnitude.",
            unit="m",
            caveat="With displacement-controlled loading the peak displacement is imposed, so it is trivially "
                   "independent of the mesh.",
        ),
    ],
    "electromagnetic": [
        KeyResultSpec(
            "peak_field",
            "Peak field magnitude",
            "Maximum nodal potential, electric field, magnetic flux density, or acoustic pressure from ElmerFEM.",
            unit="",
            default=True,
        ),
    ],
}


def family_of(physics_type: str) -> str:
    kind = str(physics_type).strip().lower()
    if kind in {"cht_coupled", "multiphase_vof"} or kind.startswith("cfd"):
        return "cfd"
    if kind in {"thermal_structural", "structural_buckling"} or kind.startswith("structural"):
        return "structural"
    if kind.startswith("thermal") or kind == "multiphysics":
        return "thermal"
    if kind in {"electromagnetic", "acoustics"}:
        return "electromagnetic"
    raise KeyResultUnavailable(f"No mesh-study key results are defined for physics type '{physics_type}'.")


def key_result_specs(physics_type: str) -> list[KeyResultSpec]:
    return list(KEY_RESULTS[family_of(physics_type)])


def resolve_key_result(physics_type: str, key_id: str | None) -> KeyResultSpec:
    specs = key_result_specs(physics_type)
    if key_id is None or key_id == "":
        return next(spec for spec in specs if spec.default)
    for spec in specs:
        if spec.id == key_id:
            return spec
    valid = ", ".join(spec.id for spec in specs)
    raise KeyResultUnavailable(f"Unknown key result '{key_id}' for {physics_type}. Valid options: {valid}.")


@dataclass
class KeyValue:
    value: float
    unit: str
    # Added to ``value`` to obtain a ratio-scale quantity for relative errors (273.15 for degC).
    offset: float = 0.0


@dataclass
class MeshStats:
    cells: int
    nodes: int | None
    dimension: int


# ---------------------------------------------------------------------------------------------
# Extraction from solver output
# ---------------------------------------------------------------------------------------------

def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _matrix(value: Any) -> list[list[float]] | None:
    if not isinstance(value, list) or not value or not all(isinstance(row, list) for row in value):
        return None
    cols = len(value[0])
    if cols == 0 or any(len(row) != cols for row in value):
        return None
    numbers = [[_finite(cell) for cell in row] for row in value]
    if any(cell is None for row in numbers for cell in row):
        return None
    return numbers  # type: ignore[return-value]


def bilinear(matrix: Sequence[Sequence[float]], fx: float, fy: float) -> float:
    """Bilinear interpolation at fractional index (fx along columns, fy along rows)."""
    rows, cols = len(matrix), len(matrix[0])
    c0 = min(max(int(math.floor(fx)), 0), cols - 2)
    r0 = min(max(int(math.floor(fy)), 0), rows - 2)
    tx, ty = fx - c0, fy - r0
    top = matrix[r0][c0] * (1 - tx) + matrix[r0][c0 + 1] * tx
    bottom = matrix[r0 + 1][c0] * (1 - tx) + matrix[r0 + 1][c0 + 1] * tx
    return top * (1 - ty) + bottom * ty


_TEMPERATURE_UNITS = {"degc": ("°C", 273.15), "c": ("°C", 273.15), "k": ("K", 0.0)}


def _thermal_key(key_id: str, data: Mapping[str, Any]) -> KeyValue:
    matrix = _matrix(data.get("temperature_matrix"))
    if matrix is not None and len(matrix) >= 2 and len(matrix[0]) >= 2:
        units = data.get("units") if isinstance(data.get("units"), Mapping) else {}
        unit_label, offset = _TEMPERATURE_UNITS.get(str(units.get("temperature", "degC")).lower(), ("°C", 273.15))
        value = bilinear(matrix, (len(matrix[0]) - 1) / 2.0, (len(matrix) - 1) / 2.0)
        return KeyValue(value=value, unit=unit_label or "°C", offset=offset or 273.15)
    temps = data.get("temperatures")
    if isinstance(temps, list) and temps:
        vals = [v for v in (_finite(t.get("temperature") if isinstance(t, Mapping) else t) for t in temps) if v is not None]
        if vals:
            units = data.get("units") if isinstance(data.get("units"), Mapping) else {}
            raw_unit = str(units.get("temperature", "K")).lower()
            unit_label, offset = _TEMPERATURE_UNITS.get(raw_unit, ("K", 0.0))
            return KeyValue(value=sum(vals) / len(vals), unit=unit_label or "K", offset=offset or 0.0)
    center = _finite(data.get("center_temperature"))
    if center is not None:
        return KeyValue(value=center, unit="°C", offset=273.15)
    raise KeyResultUnavailable("The thermal result contains no valid temperature_matrix or nodal temperature list.")


def _openfoam_key(key_id: str, data: Mapping[str, Any]) -> KeyValue:
    metrics = data.get("metrics") if isinstance(data.get("metrics"), Mapping) else None
    if metrics is not None and key_id in metrics:
        entry = metrics[key_id]
        value = _finite(entry.get("value")) if isinstance(entry, Mapping) else _finite(entry)
        if value is None:
            raise KeyResultUnavailable(f"CFD key result '{key_id}' is not a finite number.")
        unit = str(entry.get("unit", "")) if isinstance(entry, Mapping) else ""
        return KeyValue(value=value, unit=unit)

    integrals = data.get("integrals") if isinstance(data.get("integrals"), Mapping) else {}
    if key_id == "drag_coefficient_cd":
        cd_val = _finite(integrals.get("drag_coefficient_cd"))
        if cd_val is None:
            cd_val = _finite(data.get("drag_coefficient_cd"))
        if cd_val is not None:
            return KeyValue(value=cd_val, unit="")
        raise KeyResultUnavailable(
            "CFD key result 'drag_coefficient_cd' is unavailable: no forceCoeffs Cd output was produced by OpenFOAM."
        )
    if key_id == "nusselt_number":
        nu_val = _finite(integrals.get("nusselt_number"))
        if nu_val is None:
            nu_val = _finite(data.get("nusselt_number"))
        if nu_val is not None:
            return KeyValue(value=nu_val, unit="")
        raise KeyResultUnavailable(
            "CFD key result 'nusselt_number' is unavailable: no thermal Nusselt number was produced by OpenFOAM."
        )

    if key_id == "pressure_drop" and metrics is not None and metrics.get("pressure_drop_unavailable_reason"):
        raise KeyResultUnavailable(
            f"CFD key result 'pressure_drop' is unavailable: {metrics['pressure_drop_unavailable_reason']}"
        )
    reason = data.get("metrics_error") or "the solver result carries no field metrics"
    raise KeyResultUnavailable(f"CFD key result '{key_id}' is unavailable: {reason}.")


def _rigid_body_check(displacements: Sequence[Mapping[str, Any]]) -> None:
    """A uniform displacement field is a rigid translation: no strain, so no stress to compare."""
    components = [d.get("components") for d in displacements if isinstance(d.get("components"), Mapping)]
    if not components:
        return
    scale = max(_finite(d.get("magnitude")) or 0.0 for d in displacements)
    if scale <= 0.0:
        return
    spread = max(
        max(c.get(axis, 0.0) for c in components) - min(c.get(axis, 0.0) for c in components) for axis in ("x", "y", "z")
    )
    if spread <= 1e-9 * scale:
        raise KeyResultUnavailable(
            "The structural model moved as a rigid body (uniform displacement field), so no stress develops. "
            "Add a support condition before running a mesh study."
        )


def _structural_key(key_id: str, data: Mapping[str, Any]) -> KeyValue:
    displacements = data.get("displacements") if isinstance(data.get("displacements"), list) else []
    stress = data.get("stress") if isinstance(data.get("stress"), list) else []
    units = data.get("units") if isinstance(data.get("units"), Mapping) else {}
    _rigid_body_check(displacements)
    if key_id == "max_von_mises":
        values = [v for v in (_finite(s.get("von_mises")) for s in stress) if v is not None]
        if not values:
            raise KeyResultUnavailable("The CalculiX output contains no stress rows to take a von Mises maximum from.")
        return KeyValue(value=max(values), unit=str(units.get("von_mises", "Pa")))
    values = [v for v in (_finite(d.get("magnitude")) for d in displacements) if v is not None]
    if not values:
        raise KeyResultUnavailable("The CalculiX output contains no displacement rows.")
    return KeyValue(value=max(values), unit=str(units.get("displacement", "m")))


def _em_key(key_id: str, data: Mapping[str, Any]) -> KeyValue:
    summary = data.get("field_summary") if isinstance(data.get("field_summary"), Mapping) else {}
    val = _finite(summary.get("max"))
    if val is None:
        raise KeyResultUnavailable("ElmerFEM result contains no peak field summary value.")
    return KeyValue(value=val, unit=str(summary.get("unit", "")))


def extract_key_result(key_id: str, physics_type: str, data: Mapping[str, Any]) -> KeyValue:
    family = family_of(physics_type)
    resolve_key_result(physics_type, key_id)
    if family == "thermal":
        return _thermal_key(key_id, data)
    if family == "cfd":
        return _openfoam_key(key_id, data)
    if family == "electromagnetic":
        return _em_key(key_id, data)
    return _structural_key(key_id, data)


def mesh_stats(physics_type: str, data: Mapping[str, Any]) -> MeshStats:
    """Cell/node counts as reported by the solver, plus the dimension that governs accuracy."""
    family = family_of(physics_type)
    if family == "thermal":
        cells, nodes = _finite(data.get("mesh_elements")), _finite(data.get("mesh_nodes"))
        if cells is None or cells <= 0:
            temps = data.get("temperatures") if isinstance(data.get("temperatures"), list) else []
            if temps:
                return MeshStats(cells=len(temps), nodes=len(temps), dimension=3)
            raise KeyResultUnavailable("The thermal result does not report its element count.")
        return MeshStats(cells=int(cells), nodes=int(nodes) if nodes is not None else None, dimension=3 if data.get("temperatures") else 2)
    if family == "cfd":
        metrics = data.get("metrics")
        mesh = metrics.get("mesh") if isinstance(metrics, Mapping) else None
        if isinstance(mesh, Mapping) and mesh.get("cells"):
            nodes_raw = _finite(mesh.get("nodes"))
            if nodes_raw is None:
                mq = data.get("mesh_quality") if isinstance(data.get("mesh_quality"), Mapping) else {}
                nodes_raw = _finite(mq.get("points"))
            return MeshStats(
                cells=int(mesh["cells"]),
                nodes=int(nodes_raw) if nodes_raw is not None and nodes_raw > 0 else None,
                dimension=int(mesh.get("dimension", 3)),
            )
        mq = data.get("mesh_quality") if isinstance(data.get("mesh_quality"), Mapping) else {}
        mq_cells = _finite(mq.get("cells"))
        if mq_cells is not None and mq_cells > 0:
            mq_points = _finite(mq.get("points"))
            return MeshStats(
                cells=int(mq_cells),
                nodes=int(mq_points) if mq_points is not None and mq_points > 0 else None,
                dimension=3,
            )
        elem_fallback = _finite(data.get("mesh_elements"))
        if elem_fallback is not None and elem_fallback > 0:
            nodes_fallback = _finite(data.get("mesh_nodes"))
            return MeshStats(
                cells=int(elem_fallback),
                nodes=int(nodes_fallback) if nodes_fallback is not None and nodes_fallback > 0 else None,
                dimension=3,
            )
        raise KeyResultUnavailable("The CFD result does not report its mesh size.")
    if family == "electromagnetic":
        cells, nodes = _finite(data.get("mesh_elements")), _finite(data.get("mesh_nodes"))
        if cells is None or cells <= 0:
            raise KeyResultUnavailable("The ElmerFEM result does not report its element count.")
        return MeshStats(cells=int(cells), nodes=int(nodes) if nodes is not None else None, dimension=3)
    elements = {s.get("element") for s in (data.get("stress") or []) if isinstance(s, Mapping)}
    nodes = {d.get("node") for d in (data.get("displacements") or []) if isinstance(d, Mapping)}
    elements.discard(None)
    nodes.discard(None)
    if not elements:
        raise KeyResultUnavailable("The structural result does not identify its elements, so the mesh size is unknown.")
    return MeshStats(cells=len(elements), nodes=len(nodes) or None, dimension=3)


# ---------------------------------------------------------------------------------------------
# OpenFOAM field parsing (real solver output)
# ---------------------------------------------------------------------------------------------

_NUMBER = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
_VECTOR = re.compile(rf"\(\s*({_NUMBER})\s+({_NUMBER})\s+({_NUMBER})\s*\)")

_DIMENSION_UNITS = {
    (0, 1, -1, 0, 0, 0, 0): "m/s",
    (0, 2, -2, 0, 0, 0, 0): "m²/s²",  # kinematic pressure p/ρ used by incompressible solvers
    (1, -1, -2, 0, 0, 0, 0): "Pa",
}


def _strip_foam_comments(text: str) -> str:
    cleaned = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", cleaned)


def parse_internal_field(text: str) -> dict[str, Any]:
    """Parse the ``internalField`` of an ASCII OpenFOAM volScalarField/volVectorField file.

    Handles ``uniform``, ``nonuniform List<scalar|vector> N ( ... )`` and the compressed ``N{value}`` form.
    """
    cleaned = _strip_foam_comments(text)
    found = re.search(r"\binternalField\s+(.*?);", cleaned, flags=re.S)
    if not found:
        raise ValueError("no internalField entry found")
    body = found.group(1).strip()
    dims_match = re.search(r"\bdimensions\s*\[([^\]]*)\]", cleaned)
    dimensions = tuple(int(float(x)) for x in dims_match.group(1).split()) if dims_match else None

    if body.startswith("uniform"):
        rest = body[len("uniform"):].strip()
        vector = _VECTOR.fullmatch(rest)
        if vector:
            return {"kind": "vector", "values": [tuple(float(x) for x in vector.groups())], "uniform": True, "dimensions": dimensions}
        return {"kind": "scalar", "values": [float(rest)], "uniform": True, "dimensions": dimensions}

    listing = re.match(r"nonuniform\s+List<(\w+)>\s*(\d+)\s*(.*)$", body, flags=re.S)
    if not listing:
        raise ValueError(f"unsupported internalField form: {body[:40]!r}")
    kind_name, count, rest = listing.group(1), int(listing.group(2)), listing.group(3).strip()
    if kind_name not in ("scalar", "vector"):
        raise ValueError(f"unsupported field type List<{kind_name}>")
    kind = kind_name
    if count == 0:
        return {"kind": kind, "values": [], "uniform": False, "dimensions": dimensions}

    if rest.startswith("{"):
        inner = rest[1:rest.rindex("}")]
        single = _parse_entries(inner, kind)
        if len(single) != 1:
            raise ValueError("malformed compressed list")
        values = single * count
    else:
        inner = rest[rest.index("(") + 1:rest.rindex(")")]
        values = _parse_entries(inner, kind)
    if len(values) != count:
        raise ValueError(f"list declares {count} entries but {len(values)} were parsed")
    return {"kind": kind, "values": values, "uniform": False, "dimensions": dimensions}


def _parse_entries(inner: str, kind: str) -> list[Any]:
    if kind == "vector":
        return [tuple(float(x) for x in m) for m in _VECTOR.findall(inner)]
    return [float(x) for x in re.findall(_NUMBER, inner)]


def _parse_scalar_value_expr(body: str) -> list[float] | None:
    """Parse an OpenFOAM scalar value expression (uniform, nonuniform List<scalar>, or N{val})."""
    expr = body.strip()
    if expr.startswith("uniform"):
        val = _finite(expr[len("uniform"):].strip())
        return [val] if val is not None else None
    listing = re.match(r"nonuniform\s+List<scalar>\s*(\d+)\s*(.*)$", expr, flags=re.S)
    if not listing:
        return None
    count = int(listing.group(1))
    rest = listing.group(2).strip()
    if count == 0:
        return []
    if rest.startswith("{") and "}" in rest:
        inner = rest[1:rest.rindex("}")]
        single = _parse_entries(inner, "scalar")
        return single * count if len(single) == 1 else None
    if "(" in rest and ")" in rest:
        inner = rest[rest.index("(") + 1:rest.rindex(")")]
        vals = _parse_entries(inner, "scalar")
        return vals if len(vals) == count else None
    return None


def _parse_boundary_field_patches(text: str) -> dict[str, dict[str, Any]]:
    """Parse scalar patch values from the ``boundaryField { ... }`` block of an OpenFOAM field file."""
    cleaned = _strip_foam_comments(text)
    bf_match = re.search(r"\bboundaryField\s*\{", cleaned)
    if not bf_match:
        return {}
    start = bf_match.end()
    depth = 1
    pos = start
    n = len(cleaned)
    while pos < n and depth > 0:
        ch = cleaned[pos]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        pos += 1
    if depth != 0:
        return {}
    bf_body = cleaned[start:pos - 1]

    patches: dict[str, dict[str, Any]] = {}
    i = 0
    m_len = len(bf_body)
    while i < m_len:
        m = re.search(r"([A-Za-z0-9_.\-\"]+)\s*\{", bf_body[i:])
        if not m:
            break
        patch_name = m.group(1).strip('"')
        block_start = i + m.end()
        b_depth = 1
        j = block_start
        while j < m_len and b_depth > 0:
            if bf_body[j] == "{":
                b_depth += 1
            elif bf_body[j] == "}":
                b_depth -= 1
            j += 1
        if b_depth != 0:
            break
        block_text = bf_body[block_start:j - 1]
        i = j

        type_m = re.search(r"\btype\s+([A-Za-z0-9_]+)\s*;", block_text)
        patch_type = type_m.group(1) if type_m else None
        val_m = re.search(r"\bvalue\s+(.*?);", block_text, flags=re.S)
        mean_val: float | None = None
        count = 0
        if val_m:
            parsed_vals = _parse_scalar_value_expr(val_m.group(1))
            if parsed_vals:
                mean_val = sum(parsed_vals) / len(parsed_vals)
                count = len(parsed_vals)
        patches[patch_name] = {"type": patch_type, "mean": mean_val, "count": count}
    return patches


def _detect_case_dimension(case: Path, *, structured_nz: int | None = None) -> int:
    """Return 2 ONLY if constant/polyMesh/boundary has an 'empty' patch (or structured nz==1 without boundary), else 3."""
    boundary_path = case / "constant" / "polyMesh" / "boundary"
    if boundary_path.is_file():
        try:
            cleaned = _strip_foam_comments(boundary_path.read_text(encoding="utf-8", errors="replace"))
            if re.search(r"\btype\s+empty\s*;", cleaned):
                return 2
            return 3
        except OSError:
            pass
    if structured_nz is not None and structured_nz == 1:
        return 2
    return 3


def _parse_polymesh_n_cells(case: Path) -> int | None:
    """Read exact nCells from constant/polyMesh/owner FoamFile note or checkMesh.log."""
    owner_path = case / "constant" / "polyMesh" / "owner"
    if owner_path.is_file():
        try:
            with owner_path.open("r", encoding="utf-8", errors="replace") as fh:
                head = fh.read(4096)
            m = re.search(r"\bnCells\s*:\s*(\d+)", head)
            if m:
                return int(m.group(1))
        except OSError:
            pass
    check_log = case / "checkMesh.log"
    if check_log.is_file():
        try:
            txt = check_log.read_text(encoding="utf-8", errors="replace")
            m = re.search(r"^\s*cells:\s*(\d+)", txt, flags=re.M)
            if m:
                return int(m.group(1))
        except OSError:
            pass
    return None


def _parse_postprocessing_patch_pressure(case: Path) -> dict[str, float]:
    """Read inlet/outlet mean pressure from OpenFOAM postProcessing surfaceFieldValue files when present."""
    pp_dir = case / "postProcessing"
    if not pp_dir.is_dir():
        return {}
    found: dict[str, float] = {}
    for dat in sorted(pp_dir.rglob("*.dat")):
        path_lower = str(dat.relative_to(pp_dir)).lower()
        role = "inlet" if ("inlet" in path_lower or "inflow" in path_lower) else (
            "outlet" if ("outlet" in path_lower or "outflow" in path_lower) else None
        )
        if not role:
            continue
        try:
            lines = dat.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        header = " ".join(ln for ln in lines[:12] if ln.strip().startswith("#")).lower()
        if "p" not in header and "pressure" not in path_lower:
            continue
        data_lines = [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("#")]
        if not data_lines:
            continue
        toks = data_lines[-1].replace("(", " ").replace(")", " ").split()
        if len(toks) >= 2:
            val = _finite(toks[1])
            if val is not None:
                found[role] = val
    return found


def _parse_postprocessing_force_coeffs(case: Path) -> float | None:
    """Read latest streamwise drag coefficient Cd from OpenFOAM postProcessing forceCoeffs output."""
    pp_dir = case / "postProcessing"
    if not pp_dir.is_dir():
        return None
    for dat in sorted(pp_dir.rglob("*.dat")):
        rel_lower = str(dat.relative_to(pp_dir)).lower()
        if "forcecoeff" not in rel_lower and "coefficient" not in dat.name.lower():
            continue
        try:
            lines = dat.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        cd_col: int | None = None
        for ln in lines[:20]:
            s = ln.strip()
            if s.startswith("#"):
                cols = s.lstrip("#").split()
                for idx, col_name in enumerate(cols):
                    if col_name.lower() == "cd":
                        cd_col = idx
                        break
        data_lines = [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("#")]
        if not data_lines:
            continue
        toks = data_lines[-1].split()
        target_idx = cd_col if cd_col is not None else 2
        if len(toks) > target_idx:
            val = _finite(toks[target_idx])
            if val is not None:
                return val
    return None


def _select_patch_by_role(patches: Mapping[str, Mapping[str, Any]], role: str) -> tuple[str, float] | None:
    """Match an inlet or outlet patch with a finite scalar mean value."""
    tokens = ("inlet", "inflow") if role == "inlet" else ("outlet", "outflow")
    # Prefer exact patch name first (case-insensitive), then substring match.
    for name, info in patches.items():
        if name.lower() == role and info.get("mean") is not None:
            return name, float(info["mean"])
    for name, info in patches.items():
        lname = name.lower()
        if any(tok in lname for tok in tokens) and info.get("mean") is not None:
            return name, float(info["mean"])
    return None


def _latest_time_directory(case: Path, required: Sequence[str]) -> Path:
    candidates: list[tuple[float, Path]] = []
    for entry in case.iterdir():
        if not entry.is_dir():
            continue
        try:
            stamp = float(entry.name)
        except ValueError:
            continue
        if all((entry / name).is_file() for name in required):
            candidates.append((stamp, entry))
    if not candidates:
        raise KeyResultUnavailable(f"no time directory containing {', '.join(required)} was found")
    return max(candidates, key=lambda item: item[0])[1]


def compute_openfoam_metrics(case_dir: str | Path) -> dict[str, Any]:
    """Key CFD metrics from the final time step of a real OpenFOAM case.

    Supports both:
    - Structured ``blockMesh`` cases carrying ``mesh_metadata.json`` (with ``nx, ny, nz`` indexing), and
    - Arbitrary unstructured 3D CAD meshes (``snappyHexMesh``, ``gmshToFoam``, or custom OpenFOAM archives)
      without ``mesh_metadata.json``.
    """
    case = Path(case_dir)
    p_field_name = "p"
    try:
        time_dir = _latest_time_directory(case, ("U", "p"))
    except KeyResultUnavailable:
        time_dir = _latest_time_directory(case, ("U", "p_rgh"))
        p_field_name = "p_rgh"

    u_text = (time_dir / "U").read_text(encoding="utf-8", errors="replace")
    p_text = (time_dir / p_field_name).read_text(encoding="utf-8", errors="replace")
    velocity = parse_internal_field(u_text)
    pressure = parse_internal_field(p_text)
    if velocity["kind"] != "vector" or pressure["kind"] != "scalar":
        raise KeyResultUnavailable("U/p fields have unexpected types")

    max_velocity = max(math.sqrt(ux * ux + uy * uy + uz * uz) for ux, uy, uz in velocity["values"])
    pressure_unit = _DIMENSION_UNITS.get(pressure["dimensions"] or (), "")
    if not pressure_unit and pressure["dimensions"]:
        pressure_unit = "dimensions [" + " ".join(str(d) for d in pressure["dimensions"]) + "]"
    velocity_unit = _DIMENSION_UNITS.get(velocity["dimensions"] or (), "m/s")

    meta_path = case / "mesh_metadata.json"
    structured_dims: tuple[int, int, int] | None = None
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            cells_meta = meta.get("cells") if isinstance(meta, Mapping) else None
            if isinstance(cells_meta, Mapping) and all(axis in cells_meta for axis in ("nx", "ny", "nz")):
                structured_dims = (int(cells_meta["nx"]), int(cells_meta["ny"]), int(cells_meta["nz"]))
        except (OSError, ValueError, TypeError):
            structured_dims = None

    cd_val = _parse_postprocessing_force_coeffs(case)

    if structured_dims is not None:
        nx, ny, nz = structured_dims
        total = nx * ny * nz
        if len(velocity["values"]) not in (1, total) or len(pressure["values"]) not in (1, total):
            raise KeyResultUnavailable(
                f"field sizes ({len(velocity['values'])}, {len(pressure['values'])}) do not match the {total}-cell mesh"
            )
        dimension = _detect_case_dimension(case, structured_nz=nz)
        effective_cells = nx * ny if dimension == 2 else total
        p = pressure["values"] if len(pressure["values"]) == total else pressure["values"] * total
        inlet = [p[nx * (j + ny * k)] for k in range(nz) for j in range(ny)]
        outlet = [p[nx - 1 + nx * (j + ny * k)] for k in range(nz) for j in range(ny)]
        drop = sum(inlet) / len(inlet) - sum(outlet) / len(outlet)
        out: dict[str, Any] = {
            "time_directory": time_dir.name,
            "mesh": {"nx": nx, "ny": ny, "nz": nz, "cells": effective_cells, "cells_total": total, "dimension": dimension},
            "max_velocity": {"value": max_velocity, "unit": velocity_unit},
            "pressure_drop": {
                "value": drop,
                "unit": pressure_unit,
                "definition": "mean(p) of the cell layer at the inlet minus mean(p) of the cell layer at the outlet",
            },
        }
        if cd_val is not None:
            out["drag_coefficient_cd"] = {"value": cd_val, "unit": ""}
        return out

    # Unstructured / 3D CAD mesh path (snappyHexMesh, gmshToFoam, or custom OpenFOAM archive)
    if not velocity["uniform"] and len(velocity["values"]) > 0:
        total = len(velocity["values"])
    elif not pressure["uniform"] and len(pressure["values"]) > 0:
        total = len(pressure["values"])
    else:
        poly_cells = _parse_polymesh_n_cells(case)
        if poly_cells is None or poly_cells <= 0:
            raise KeyResultUnavailable(
                "Could not determine unstructured mesh cell count from U/p internalField, polyMesh/owner, or checkMesh.log."
            )
        total = poly_cells

    dimension = _detect_case_dimension(case)
    patches = _parse_boundary_field_patches(p_text)
    inlet_patch = _select_patch_by_role(patches, "inlet")
    outlet_patch = _select_patch_by_role(patches, "outlet")
    if inlet_patch is None or outlet_patch is None:
        pp_pressures = _parse_postprocessing_patch_pressure(case)
        if inlet_patch is None and "inlet" in pp_pressures:
            inlet_patch = ("postProcessing:inlet", pp_pressures["inlet"])
        if outlet_patch is None and "outlet" in pp_pressures:
            outlet_patch = ("postProcessing:outlet", pp_pressures["outlet"])

    out = {
        "time_directory": time_dir.name,
        "mesh": {"cells": total, "cells_total": total, "dimension": dimension, "topology": "unstructured"},
        "max_velocity": {"value": max_velocity, "unit": velocity_unit},
    }
    if inlet_patch is not None and outlet_patch is not None:
        inlet_name, inlet_p = inlet_patch
        outlet_name, outlet_p = outlet_patch
        out["pressure_drop"] = {
            "value": inlet_p - outlet_p,
            "unit": pressure_unit,
            "definition": f"mean({p_field_name}) on patch '{inlet_name}' minus patch '{outlet_name}'",
        }
    else:
        out["pressure_drop_unavailable_reason"] = (
            f"unstructured {p_field_name} field has no numeric inlet/outlet boundaryField values or postProcessing patch averages"
        )
    if cd_val is not None:
        out["drag_coefficient_cd"] = {"value": cd_val, "unit": ""}
    return out


# ---------------------------------------------------------------------------------------------
# Grid Convergence Index (Celik et al., 2008)
# ---------------------------------------------------------------------------------------------

GCI_SAFETY_FACTOR = 1.25
GCI_THRESHOLD_PERCENT = 5.0
MIN_RECOMMENDED_REFINEMENT_RATIO = 1.3


def _round(value: float | None, digits: int = 10) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return float(f"{value:.{digits}g}")


def compute_gci(
    values: Sequence[float],
    cells: Sequence[int],
    dimension: int,
    offset: float = 0.0,
    safety_factor: float = GCI_SAFETY_FACTOR,
    threshold_percent: float = GCI_THRESHOLD_PERCENT,
) -> dict[str, Any]:
    """Celik procedure for three grids. ``values`` and ``cells`` are ordered coarse → medium → fine.

    ``offset`` is added to the values before relative errors are formed, so quantities on an interval scale (°C)
    are evaluated on their ratio scale (K). The absolute uncertainty is independent of the offset.
    """
    if len(values) != 3 or len(cells) != 3:
        raise ValueError("exactly three grid levels are required")
    phi3, phi2, phi1 = (float(v) for v in values)
    n3, n2, n1 = (float(c) for c in cells)
    if not (0 < n3 < n2 < n1):
        raise ValueError("cell counts must increase strictly from coarse to fine")
    r21 = (n1 / n2) ** (1.0 / dimension)
    r32 = (n2 / n3) ** (1.0 / dimension)
    b1, b2, b3 = phi1 + offset, phi2 + offset, phi3 + offset
    eps21, eps32 = phi2 - phi1, phi3 - phi2
    tolerance = 1e-12 * max(abs(b1), abs(b2), abs(b3), 1e-300)

    warnings: list[str] = []
    result: dict[str, Any] = {
        "dimension": dimension,
        "r21": _round(r21),
        "r32": _round(r32),
        "convergence_type": None,
        "observed_order": None,
        "extrapolated_value": None,
        "extrapolated_error_percent": None,
        "gci_fine_percent": None,
        "gci_medium_percent": None,
        "asymptotic_ratio": None,
        "uncertainty_fine": None,
        "grid_independent": None,
        "safety_factor": safety_factor,
        "gci_threshold_percent": threshold_percent,
        "warnings": warnings,
    }
    if min(r21, r32) < MIN_RECOMMENDED_REFINEMENT_RATIO:
        warnings.append(
            f"Refinement ratio r = {min(r21, r32):.3g} is below the recommended minimum of "
            f"{MIN_RECOMMENDED_REFINEMENT_RATIO}; the GCI estimate is less reliable."
        )

    zero21, zero32 = abs(eps21) <= tolerance, abs(eps32) <= tolerance
    if zero21 and zero32:
        result.update(convergence_type="converged", extrapolated_value=_round(phi1), gci_fine_percent=0.0,
                      gci_medium_percent=0.0, uncertainty_fine=0.0, grid_independent=True)
        warnings.append("All three levels agree to floating-point precision; the discrete solution is mesh independent.")
        return result
    if zero21:
        result.update(convergence_type="converged", extrapolated_value=_round(phi1), gci_fine_percent=0.0,
                      uncertainty_fine=0.0, grid_independent=True)
        warnings.append("Fine and medium results agree to floating-point precision; the observed order is undefined.")
        return result
    if zero32:
        result.update(convergence_type="indeterminate")
        warnings.append("Coarse and medium agree but the fine result differs; the observed order is undefined.")
        return result
    if b1 == 0.0 or b2 == 0.0:
        result.update(convergence_type="indeterminate")
        warnings.append("A key result is exactly zero, so relative errors are undefined.")
        return result

    ratio = eps21 / eps32  # R in Stern et al. / Celik: 0<R<1 monotonic convergence, R<0 oscillatory, R>1 divergence
    if 0.0 < ratio < 1.0:
        kind = "monotonic"
    elif -1.0 < ratio < 0.0:
        kind = "oscillatory"
    else:
        kind = "divergent"
    result["convergence_type"] = kind
    if kind == "divergent":
        result["grid_independent"] = False
        warnings.append(
            "The key result changes more between the fine and medium grids than between the medium and coarse grids "
            f"(R = {ratio:.3g}); it does not converge with refinement, so no GCI is reported."
        )
        return result

    sign = 1.0 if ratio > 0 else -1.0
    ln_ratio = math.log(abs(eps32 / eps21))
    p = abs(ln_ratio) / math.log(r21)
    try:
        for _ in range(200):
            q = math.log((r21 ** p - sign) / (r32 ** p - sign))
            p_next = abs(ln_ratio + q) / math.log(r21)
            converged = abs(p_next - p) < 1e-10
            p = p_next
            if converged:
                break
        rp21, rp32 = r21 ** p, r32 ** p
        if not math.isfinite(p) or p < 1e-3 or rp21 <= 1.0 or rp32 <= 1.0:
            raise ValueError("observed order did not converge")
    except (ValueError, OverflowError, ZeroDivisionError):
        result["convergence_type"] = "indeterminate"
        warnings.append("The observed order of convergence could not be determined from these three grids.")
        return result

    extrapolated = (rp21 * b1 - b2) / (rp21 - 1.0)
    e_a21 = abs((b1 - b2) / b1)
    e_a32 = abs((b2 - b3) / b2)
    gci21 = safety_factor * e_a21 / (rp21 - 1.0)
    gci32 = safety_factor * e_a32 / (rp32 - 1.0)
    asymptotic = gci32 / (rp21 * gci21) if gci21 > 0 else None

    result.update(
        observed_order=_round(p),
        extrapolated_value=_round(extrapolated - offset),
        extrapolated_error_percent=_round(abs((extrapolated - b1) / extrapolated) * 100.0) if extrapolated != 0 else None,
        gci_fine_percent=_round(gci21 * 100.0),
        gci_medium_percent=_round(gci32 * 100.0),
        asymptotic_ratio=_round(asymptotic),
        uncertainty_fine=_round(gci21 * abs(b1)),
    )
    if kind == "oscillatory":
        warnings.append("The key result converges oscillatorily; the GCI is indicative only and no verdict is given.")
    else:
        result["grid_independent"] = bool(gci21 * 100.0 <= threshold_percent)
    if p < 0.5 or p > 6.0:
        warnings.append(f"Observed order p = {p:.3g} is outside the plausible 0.5–6 range; the grids may not be asymptotic.")
    if asymptotic is not None and not 0.9 <= asymptotic <= 1.1:
        warnings.append(f"Asymptotic ratio {asymptotic:.3g} is not close to 1; the grids may not be in the asymptotic range.")
    return result


# ---------------------------------------------------------------------------------------------
# Study orchestration
# ---------------------------------------------------------------------------------------------

# (level, factor on the user's mesh size). The user's mesh is the medium level; refinement ratio is 2.
LEVELS: tuple[tuple[str, float], ...] = (("coarse", 2.0), ("medium", 1.0), ("fine", 0.5))
# call_calculix_solver builds an n × n × n block with n = 2 unless mesh.divisions is given.
STRUCTURAL_DEFAULT_DIVISIONS = 2


def _base_divisions(payload: Mapping[str, Any]) -> dict[str, int]:
    mesh = payload.get("mesh") if isinstance(payload.get("mesh"), Mapping) else {}
    divisions = mesh.get("divisions") if isinstance(mesh.get("divisions"), Mapping) else {}
    result = {}
    for axis in ("x", "y", "z"):
        raw = divisions.get(axis, mesh.get(f"n{axis}", STRUCTURAL_DEFAULT_DIVISIONS))
        result[axis] = max(1, int(raw))
    return result


def _has_cad_source(payload: Mapping[str, Any]) -> bool:
    return bool(
        payload.get("cad_stl_b64")
        or payload.get("cad_file_b64")
        or payload.get("uploaded_file_path")
        or payload.get("inp_deck")
    )


def refine_payload(physics_type: str, base: Mapping[str, Any], factor: float) -> dict[str, Any]:
    """Return a copy of the solver payload with the mesh scaled by ``factor`` (cell size × factor)."""
    payload = json.loads(json.dumps(base))
    if family_of(physics_type) == "structural" and not _has_cad_source(base):
        # Parametric CalculiX box deck is driven by divisions.
        divisions = {axis: max(1, int(round(n / factor))) for axis, n in _base_divisions(base).items()}
        payload["mesh"] = {**(payload.get("mesh") if isinstance(payload.get("mesh"), dict) else {}), "divisions": divisions}
        return payload
    base_size = _finite(base.get("mesh_size"))
    if base_size is None or base_size <= 0:
        raise MeshStudyError("INVALID_MESH", "mesh_size must be a positive number.")
    new_size = base_size * factor
    payload["mesh_size"] = new_size
    existing_mesh_settings = payload.get("mesh_settings") if isinstance(payload.get("mesh_settings"), dict) else {}
    payload["mesh_settings"] = {**existing_mesh_settings, "mesh_size": new_size}

    if bool(base.get("external_aero")):
        base_aero_size = _finite(base.get("aero_base_cell_size"))
        if base_aero_size is not None and base_aero_size > 0:
            payload["aero_base_cell_size"] = base_aero_size * factor
        else:
            payload["aero_base_cell_size"] = new_size
        base_surface_level = int(_finite(base.get("aero_surface_level")) or 2)
        if factor > 1.0:
            payload["aero_surface_level"] = max(1, base_surface_level - 1)
        elif factor < 1.0:
            payload["aero_surface_level"] = min(4, base_surface_level + 1)
        else:
            payload["aero_surface_level"] = base_surface_level
    return payload


def run_mesh_study(
    base_payload: Mapping[str, Any],
    physics_type: str,
    key_result_id: str | None,
    execute: Callable[[dict[str, Any]], Mapping[str, Any]],
    *,
    on_level_start: Callable[[int, int, str, dict[str, Any]], None] | None = None,
    on_level_complete: Callable[[int, int, dict[str, Any], list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    """Run the solver on coarse/medium/fine meshes and compute the GCI of the chosen key result."""
    spec = resolve_key_result(physics_type, key_result_id)
    family = family_of(physics_type)
    uses_divisions = family == "structural" and not _has_cad_source(base_payload)

    levels: list[dict[str, Any]] = []
    solver_name: str | None = None
    unit = spec.unit
    offset = 0.0
    dimension = 2
    total_levels = len(LEVELS)
    for idx, (name, factor) in enumerate(LEVELS, start=1):
        payload = refine_payload(physics_type, base_payload, factor)
        if on_level_start is not None:
            on_level_start(idx, total_levels, name, payload)
        outcome = execute(payload)
        if outcome.get("status") == "error" or outcome.get("error"):
            raise MeshStudyError("SOLVER_ERROR", f"Mesh level '{name}' failed: {outcome.get('error', 'solver error')}")
        data = outcome.get("data") if isinstance(outcome.get("data"), Mapping) else outcome
        try:
            value = extract_key_result(spec.id, physics_type, data)
            stats = mesh_stats(physics_type, data)
        except KeyResultUnavailable as exc:
            raise MeshStudyError("KEY_RESULT_UNAVAILABLE", f"Mesh level '{name}': {exc}") from exc
        solver_name = solver_name or outcome.get("solver") or data.get("solver") or data.get("solver_type")
        unit, offset, dimension = value.unit or unit, value.offset, stats.dimension
        level_entry = {
            "level": name,
            "mesh_size": None if uses_divisions else payload.get("mesh_size"),
            "divisions": payload["mesh"]["divisions"] if uses_divisions else None,
            "cells": stats.cells,
            "nodes": stats.nodes,
            "key_result": value.value,
        }
        levels.append(level_entry)
        if on_level_complete is not None:
            on_level_complete(idx, total_levels, dict(level_entry), [dict(l) for l in levels])

    cells = [level["cells"] for level in levels]
    if not (cells[0] < cells[1] < cells[2]):
        raise MeshStudyError(
            "MESH_NOT_REFINED",
            f"The solver did not change its mesh between levels (cells: {cells[0]}, {cells[1]}, {cells[2]}). "
            "A GCI would be meaningless, so none was computed."
            + (" Structural models start at 2 divisions per direction; a model already at 1 cannot be coarsened."
               if uses_divisions else ""),
        )
    for level in levels:
        level["relative_size"] = _round((cells[2] / level["cells"]) ** (1.0 / dimension))

    gci = compute_gci([l["key_result"] for l in levels], cells, dimension, offset=offset)
    if uses_divisions and levels[0].get("divisions") and min(levels[0]["divisions"].values()) <= 1:
        gci["warnings"].append(
            "The coarse level has a single element in at least one direction, so it cannot resolve stress gradients "
            "and is unlikely to be in the asymptotic range; refine the base mesh and re-run before trusting the verdict."
        )
    basis_note = (
        "Relative errors are formed on absolute temperature (K); the absolute uncertainty is independent of that choice."
        if offset else None
    )
    return {
        "schema_version": 2,
        "physics_type": physics_type,
        "solver": solver_name,
        "key_result": {**spec.to_dict(), "unit": unit},
        "levels": levels,
        "basis_note": basis_note,
        "parameters": json.loads(json.dumps(base_payload)),
        **gci,
    }
