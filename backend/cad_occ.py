"""
NASEER Universal CAE Studio — OpenCASCADE CAD Preparation Engine (Zero-Mock).

Provides real ISO-10303-21 STEP / IGES unit detection, SI meter scaling,
multi-body assembly inspection & contact interface detection, Boolean fluid
volume extraction (external wind-tunnel enclosure & internal fluid cavity),
and conformal CHT / disjoint contact multi-body preparation via OpenCASCADE
(`gmsh.model.occ`).

STRICT ZERO-MOCK POLICY:
- Every unit scale, solid volume, center of mass, bounding box, contact gap,
  Boolean cavity, and preview tessellation is computed strictly from real
  STEP/IGES headers and OpenCASCADE kernel geometry (`gmsh.model.occ`).
- Never fabricates body counts, synthetic cavities, or fake contact pairs.
- Always guards Gmsh initialization/finalization with a re-entrant lock and
  strict `try ... finally: if gmsh.isInitialized(): gmsh.finalize()`.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

try:
    import gmsh  # type: ignore

    HAS_GMSH = True
except Exception:
    gmsh = None  # type: ignore
    HAS_GMSH = False


class CadBackendUnavailableError(RuntimeError):
    """Raised when OpenCASCADE (gmsh.model.occ) is unavailable in this process."""


class CadPreparationError(ValueError):
    """Raised when CAD geometry cannot satisfy the requested engineering operation."""


_GMSH_LOCK = threading.RLock()

UNIT_SCALE_TO_METERS: Dict[str, float] = {
    "m": 1.0,
    "mm": 1e-3,
    "cm": 1e-2,
    "in": 0.0254,
}

SUPPORTED_CAD_EXTENSIONS = {".step", ".stp", ".iges", ".igs", ".brep"}

_IGES_UNIT_FLAG_MAP: Dict[int, Tuple[str, float]] = {
    1: ("in", 0.0254),
    2: ("mm", 1e-3),
    6: ("m", 1.0),
    10: ("cm", 1e-2),
}

_VALID_BODY_ROLES = {"solid", "fluid", "contact_master", "contact_slave"}


def _sanitize_stem(filename: str) -> str:
    stem = Path(filename or "cad_model").stem
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-")
    return cleaned[:48] or "cad_model"


def _sanitize_identifier(name: str, fallback: str = "body") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", str(name or "").strip()).strip("_")
    return cleaned[:48] or fallback


def _get_uploads_dir(jobs_dir: Optional[Path] = None) -> Path:
    if jobs_dir is not None:
        uploads = Path(jobs_dir) / "uploads"
        uploads.mkdir(parents=True, exist_ok=True)
        return uploads
    env_job_dir = os.getenv("NASEER_JOB_DIR")
    if env_job_dir:
        uploads = Path(env_job_dir) / "uploads"
    elif Path("/app/jobs").exists():
        uploads = Path("/app/jobs/uploads")
    else:
        uploads = Path.cwd() / "jobs" / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    return uploads


def _require_gmsh() -> None:
    if not HAS_GMSH or gmsh is None:
        raise CadBackendUnavailableError(
            "OpenCASCADE CAD preparation requires Gmsh (`gmsh.model.occ`) in the worker runtime."
        )


@contextlib.contextmanager
def _gmsh_session(model_name: str = "naseer_cad_occ"):
    """Thread-safe Gmsh/OpenCASCADE session with strict lifecycle cleanup."""
    _require_gmsh()
    with _GMSH_LOCK:
        if gmsh.isInitialized():
            gmsh.finalize()
        gmsh.initialize()
        try:
            gmsh.option.setNumber("General.Terminal", 0)
            gmsh.option.setNumber("General.Verbosity", 1)
            gmsh.model.add(model_name)
            yield gmsh
        finally:
            try:
                if gmsh.isInitialized():
                    gmsh.finalize()
            except Exception:
                pass


def _parse_iges_global_fields(text: str) -> List[str]:
    """Extract parameter fields from IGES Global ('G') section lines."""
    global_chunks: List[str] = []
    for raw_line in text.splitlines():
        if len(raw_line) >= 73 and raw_line[72].upper() == "G":
            global_chunks.append(raw_line[:72])
    if not global_chunks:
        return []
    combined = "".join(global_chunks).strip()
    if not combined:
        return []

    param_delim = ","
    record_delim = ";"
    idx = 0
    # IGES field 1 can redefine parameter delimiter via Hollerith string e.g. 1H,
    m_p = re.match(r"^\s*1H(.)", combined)
    if m_p:
        param_delim = m_p.group(1)
        idx = m_p.end()
        if idx < len(combined) and combined[idx] == param_delim:
            idx += 1
        m_r = re.match(r"^\s*1H(.)", combined[idx:])
        if m_r:
            record_delim = m_r.group(1)

    # Re-parse cleanly from start preserving Hollerith fields
    fields: List[str] = []
    pos = 0
    n = len(combined)
    while pos < n:
        while pos < n and combined[pos] in " \t\r\n":
            pos += 1
        if pos >= n or combined[pos] == record_delim:
            break
        # Hollerith string nH<n chars>
        m_h = re.match(r"(\d+)H", combined[pos:])
        if m_h:
            h_len = int(m_h.group(1))
            start = pos + len(m_h.group(0))
            val = combined[start : start + h_len]
            fields.append(val)
            pos = start + h_len
            while pos < n and combined[pos] not in (param_delim, record_delim):
                pos += 1
            if pos < n and combined[pos] == param_delim:
                pos += 1
        else:
            next_p = combined.find(param_delim, pos)
            next_r = combined.find(record_delim, pos)
            stops = [p for p in (next_p, next_r) if p != -1]
            stop = min(stops) if stops else n
            fields.append(combined[pos:stop].strip())
            if stop < n and combined[stop] == record_delim:
                break
            pos = stop + 1
    return fields


def detect_cad_units(
    raw_bytes: bytes,
    filename: str,
    unit_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Detect physical length units strictly from ISO-10303-21 STEP or IGES headers.

    Returns:
      {
        "detected_unit": "mm" | "cm" | "m" | "in" | "unknown",
        "effective_unit": "mm" | "cm" | "m" | "in" | "unknown",
        "scale_to_meters": float,
        "source": "step_header" | "iges_header" | "heuristic_warning" | "unknown",
        "warning": Optional[str],
        "override_applied": bool,
      }
    """
    ext = Path(filename or "").suffix.lower()
    text = raw_bytes.decode("utf-8", errors="ignore")

    detected_unit = "unknown"
    scale_to_meters = 1.0
    source = "unknown"
    warning: Optional[str] = None

    if ext in (".step", ".stp"):
        # Check imperial conversion units first because STEP imperial files
        # define CONVERSION_BASED_UNIT('INCH', ...) backed by SI_UNIT(.MILLI.,.METRE.).
        upper_text = text.upper()
        conv_match = re.search(
            r"CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'",
            upper_text,
        )
        if conv_match:
            conv_name = conv_match.group(1).strip()
            if "INCH" in conv_name or conv_name == "IN":
                detected_unit = "in"
                scale_to_meters = UNIT_SCALE_TO_METERS["in"]
                source = "step_header"

        if detected_unit == "unknown":
            # Look for explicit SI_UNIT length declarations
            # Prefer declarations co-occurring with LENGTH_UNIT if present
            length_unit_blocks = re.findall(
                r"LENGTH_UNIT\s*\(\s*\).*?SI_UNIT\s*\(\s*([^,\)]+)\s*,\s*\.METRE\.\s*\)"
                r"|SI_UNIT\s*\(\s*([^,\)]+)\s*,\s*\.METRE\.\s*\).*?LENGTH_UNIT\s*\(\s*\)",
                upper_text,
                flags=re.DOTALL,
            )
            prefix_token: Optional[str] = None
            for grp_a, grp_b in length_unit_blocks:
                tok = (grp_a or grp_b or "").strip()
                if tok:
                    prefix_token = tok
                    break

            if prefix_token is None:
                si_match = re.search(
                    r"SI_UNIT\s*\(\s*([^,\)]+)\s*,\s*\.METRE\.\s*\)",
                    upper_text,
                )
                if si_match:
                    prefix_token = si_match.group(1).strip()

            if prefix_token is not None:
                if ".MILLI." in prefix_token:
                    detected_unit = "mm"
                    scale_to_meters = UNIT_SCALE_TO_METERS["mm"]
                    source = "step_header"
                elif ".CENTI." in prefix_token:
                    detected_unit = "cm"
                    scale_to_meters = UNIT_SCALE_TO_METERS["cm"]
                    source = "step_header"
                elif prefix_token == "$" or prefix_token == "":
                    detected_unit = "m"
                    scale_to_meters = UNIT_SCALE_TO_METERS["m"]
                    source = "step_header"
                else:
                    warning = (
                        f"Unrecognized STEP SI_UNIT prefix '{prefix_token}'; "
                        "verify length unit manually."
                    )
            else:
                warning = (
                    "No ISO-10303-21 SI_UNIT/CONVERSION_BASED_UNIT length token found "
                    "in STEP file; assuming meters unless overridden."
                )

    elif ext in (".iges", ".igs"):
        fields = _parse_iges_global_fields(text)
        # IGES Global Section Field 14 (1-based) = index 13 is Unit Flag;
        # Note: field 1 is param delim, field 2 is record delim, ...
        # Standard IGES Global Section:
        # 1: Param delim, 2: Record delim, 3: Product ID, 4: File name,
        # 5: System ID, 6: Preprocessor ver, 7: Int bits, 8: Float exp,
        # 9: Float sig, 10: Double exp, 11: Double sig, 12: Recv prod ID,
        # 13: Model space scale, 14: Units flag, 15: Units name
        unit_flag_int: Optional[int] = None
        if len(fields) >= 14:
            raw_flag = fields[13].strip()
            if raw_flag.isdigit():
                unit_flag_int = int(raw_flag)
            elif len(fields) >= 15 and fields[14].strip().isdigit():
                # Some minimal IGES writers omit leading empty delimiter fields
                unit_flag_int = int(fields[14].strip())

        if unit_flag_int in _IGES_UNIT_FLAG_MAP:
            detected_unit, scale_to_meters = _IGES_UNIT_FLAG_MAP[unit_flag_int]
            source = "iges_header"
        else:
            # Fallback check IGES Global unit name field (index 14)
            unit_name = fields[14].strip().upper() if len(fields) >= 15 else ""
            if unit_name in ("MM", "MILLIMETER", "MILLIMETERS"):
                detected_unit, scale_to_meters, source = "mm", 1e-3, "iges_header"
            elif unit_name in ("CM", "CENTIMETER", "CENTIMETERS"):
                detected_unit, scale_to_meters, source = "cm", 1e-2, "iges_header"
            elif unit_name in ("IN", "INCH", "INCHES"):
                detected_unit, scale_to_meters, source = "in", 0.0254, "iges_header"
            elif unit_name in ("M", "METER", "METERS", "METRE"):
                detected_unit, scale_to_meters, source = "m", 1.0, "iges_header"
            else:
                warning = (
                    "Could not resolve IGES Global Section unit flag; "
                    "assuming meters unless overridden."
                )

    elif ext == ".brep":
        detected_unit = "m"
        scale_to_meters = 1.0
        source = "unknown"
        warning = (
            "BREP format does not embed physical unit headers; treating coordinates as SI meters "
            "unless overridden."
        )
    else:
        warning = f"Unsupported CAD unit header inspection for '{ext or 'unknown'}'."

    override_applied = False
    effective_unit = detected_unit
    norm_override = str(unit_override or "").strip().lower()
    if norm_override and norm_override != "auto":
        if norm_override not in UNIT_SCALE_TO_METERS:
            raise CadPreparationError(
                f"Unsupported unit_override '{unit_override}'. Allowed values: m, mm, cm, in."
            )
        effective_unit = norm_override
        scale_to_meters = UNIT_SCALE_TO_METERS[norm_override]
        override_applied = True
        warning = None

    return {
        "detected_unit": detected_unit,
        "effective_unit": effective_unit,
        "scale_to_meters": float(scale_to_meters),
        "source": source,
        "warning": warning,
        "override_applied": override_applied,
    }


def _extract_step_solid_names(raw_bytes: bytes, filename: str) -> List[str]:
    ext = Path(filename or "").suffix.lower()
    if ext not in (".step", ".stp"):
        return []
    text = raw_bytes.decode("utf-8", errors="ignore")
    names: List[str] = []
    for pattern in (
        r"MANIFOLD_SOLID_BREP\s*\(\s*'([^']*)'",
        r"ADVANCED_BREP_SHAPE_REPRESENTATION\s*\(\s*'([^']*)'",
        r"PRODUCT\s*\(\s*'[^']*'\s*,\s*'([^']*)'",
    ):
        found = [m.strip() for m in re.findall(pattern, text, flags=re.IGNORECASE) if m.strip()]
        if found:
            names = found
            break
    return names


def _bbox_from_entities(model_occ: Any, dimtags: Sequence[Tuple[int, int]]) -> List[float]:
    xmin = ymin = zmin = float("inf")
    xmax = ymax = zmax = float("-inf")
    for dim, tag in dimtags:
        bx0, by0, bz0, bx1, by1, bz1 = model_occ.getBoundingBox(dim, tag)
        xmin = min(xmin, bx0)
        ymin = min(ymin, by0)
        zmin = min(zmin, bz0)
        xmax = max(xmax, bx1)
        ymax = max(ymax, by1)
        zmax = max(zmax, bz1)
    if not math.isfinite(xmin):
        return [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    return [float(xmin), float(ymin), float(zmin), float(xmax), float(ymax), float(zmax)]


def _aabb_min_distance(b1: Sequence[float], b2: Sequence[float]) -> float:
    dx = max(0.0, max(b1[0] - b2[3], b2[0] - b1[3]))
    dy = max(0.0, max(b1[1] - b2[4], b2[1] - b1[4]))
    dz = max(0.0, max(b1[2] - b2[5], b2[2] - b1[5]))
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _import_and_scale_cad(
    g: Any,
    raw_bytes: bytes,
    filename: str,
    unit_override: Optional[str] = None,
) -> Tuple[Dict[str, Any], List[Tuple[int, int]]]:
    """Import STEP/IGES/BREP into active Gmsh OCC model and apply SI meter scaling."""
    ext = Path(filename or "").suffix.lower()
    if ext not in SUPPORTED_CAD_EXTENSIONS:
        raise CadPreparationError(
            f"Unsupported CAD format '{ext or 'unknown'}'. "
            f"Supported OpenCASCADE formats: {', '.join(sorted(SUPPORTED_CAD_EXTENSIONS))}."
        )
    if not raw_bytes:
        raise CadPreparationError("Empty CAD file payload.")

    unit_info = detect_cad_units(raw_bytes, filename, unit_override=unit_override)

    # Prevent OpenCASCADE's STEP/IGES reader from silently converting METRE/INCH files into MM.
    # Locking OCCTargetUnit to the file's native unit keeps coordinates faithful to the file,
    # and our explicit `occ.dilate(..., scale_to_meters)` below performs the exact SI conversion.
    _occ_unit_map = {"m": "M", "mm": "MM", "cm": "CM", "in": "IN"}
    native_occ_unit = _occ_unit_map.get(str(unit_info.get("detected_unit") or "").lower(), "")
    if ext in (".step", ".stp", ".iges", ".igs") and native_occ_unit:
        try:
            g.option.setString("Geometry.OCCTargetUnit", native_occ_unit)
        except Exception:
            pass

    with tempfile.TemporaryDirectory(prefix="naseer_cad_occ_") as tmp_dir:
        tmp_path = Path(tmp_dir) / f"input{ext}"
        tmp_path.write_bytes(raw_bytes)
        try:
            imported = g.model.occ.importShapes(str(tmp_path))
        except Exception as exc:
            raise CadPreparationError(f"OpenCASCADE failed to import '{filename}': {exc}") from exc

    g.model.occ.synchronize()
    all_entities = g.model.occ.getEntities()
    if not imported and not all_entities:
        raise CadPreparationError(f"No valid B-Rep geometry entities found in '{filename}'.")

    # Apply explicit SI meter scaling in OpenCASCADE before any measurements/Booleans.
    # Note: Gmsh's OCCT STEP/IGES reader reads coordinates in the file's native units or mm
    # depending on Geometry.OCCTargetUnit. Setting OCCTargetUnit explicitly or scaling raw
    # coordinates cleanly: let's inspect raw pre-scale bbox vs OCCTargetUnit behavior!
    # By default in Gmsh, Geometry.OCCTargetUnit is "" (no auto-scaling, keeps file numbers).
    # So multiplying by unit_info["scale_to_meters"] converts native units -> SI meters cleanly!
    scale = float(unit_info["scale_to_meters"])
    if abs(scale - 1.0) > 1e-12:
        # Only dilate top-level dim entities to avoid double-scaling sub-entities
        top_dim = max((d for d, _ in all_entities), default=3)
        top_entities = [e for e in all_entities if e[0] == top_dim]
        if not top_entities:
            top_entities = list(all_entities)
        g.model.occ.dilate(top_entities, 0.0, 0.0, 0.0, scale, scale, scale)
        g.model.occ.synchronize()

    solids = sorted(g.model.getEntities(3), key=lambda dt: dt[1])
    if solids and unit_info["detected_unit"] == "unknown" and not unit_info["override_applied"]:
        bbox = _bbox_from_entities(g.model.occ, solids)
        max_dim = max(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2])
        if max_dim > 100.0:
            unit_info["source"] = "heuristic_warning"
            unit_info["warning"] = (
                f"Unit header missing and model spans {max_dim:.1f} units (>100). "
                "If this CAD model was authored in millimeters, select 'mm' unit override."
            )
    return unit_info, solids


def _collect_bodies_and_interfaces(
    g: Any,
    solids: Sequence[Tuple[int, int]],
    fallback_names: Optional[Sequence[str]] = None,
    role_by_tag: Optional[Mapping[int, str]] = None,
    name_by_tag: Optional[Mapping[int, str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """Enumerate 3D solids and compute real pairwise body-to-body contact/shared interfaces."""
    bodies: List[Dict[str, Any]] = []
    surface_bboxes: Dict[int, List[float]] = {}

    for idx, (dim, tag) in enumerate(solids):
        vol = float(abs(g.model.occ.getMass(dim, tag)))
        com = [float(c) for c in g.model.occ.getCenterOfMass(dim, tag)]
        bbox = [float(v) for v in g.model.occ.getBoundingBox(dim, tag)]
        boundary = g.model.getBoundary([(dim, tag)], oriented=False, recursive=False)
        surface_tags = sorted({int(abs(t)) for d, t in boundary if d == 2})
        for st in surface_tags:
            if st not in surface_bboxes:
                surface_bboxes[st] = [float(v) for v in g.model.occ.getBoundingBox(2, st)]

        raw_name = ""
        if name_by_tag and tag in name_by_tag:
            raw_name = str(name_by_tag[tag])
        if not raw_name:
            try:
                raw_name = str(g.model.getEntityName(dim, tag) or "").strip()
            except Exception:
                raw_name = ""
        if not raw_name and fallback_names and idx < len(fallback_names):
            raw_name = fallback_names[idx]
        if not raw_name:
            raw_name = f"Solid_{tag}"

        role = "solid"
        if role_by_tag and tag in role_by_tag and role_by_tag[tag] in _VALID_BODY_ROLES:
            role = role_by_tag[tag]

        bodies.append(
            {
                "body_id": f"body_{idx + 1}",
                "occ_tag": int(tag),
                "name": raw_name,
                "volume_m3": round(vol, 9),
                "center_of_mass": [round(c, 6) for c in com],
                "bbox": [round(v, 6) for v in bbox],
                "surface_tags": surface_tags,
                "role": role,
            }
        )

    assembly_bbox = _bbox_from_entities(g.model.occ, solids) if solids else [0.0] * 6
    lx = max(0.0, assembly_bbox[3] - assembly_bbox[0])
    ly = max(0.0, assembly_bbox[4] - assembly_bbox[1])
    lz = max(0.0, assembly_bbox[5] - assembly_bbox[2])
    diag = math.sqrt(lx * lx + ly * ly + lz * lz)
    total_vol = sum(b["volume_m3"] for b in bodies)

    dimensions = {
        "length": round(lx, 6),
        "width": round(ly, 6),
        "height": round(lz, 6),
        "diagonal": round(diag, 6),
        "bbox": [round(v, 6) for v in assembly_bbox],
        "total_volume_m3": round(total_vol, 9),
    }

    # Detect pairwise body-to-body touching / mating interfaces
    interfaces: List[Dict[str, Any]] = []
    near_tol = max(1e-4, 2e-3 * diag) if diag > 0 else 1e-4
    conformal_tol = max(1e-6, 1e-5 * diag) if diag > 0 else 1e-6
    iface_idx = 0

    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            ba = bodies[i]
            bb = bodies[j]
            if _aabb_min_distance(ba["bbox"], bb["bbox"]) > near_tol * 2.0:
                continue

            shared_faces = sorted(set(ba["surface_tags"]) & set(bb["surface_tags"]))
            if shared_faces:
                iface_idx += 1
                interfaces.append(
                    {
                        "id": f"interface_{iface_idx}",
                        "body_a": ba["body_id"],
                        "body_b": bb["body_id"],
                        "gap_m": 0.0,
                        "interface_type": "conformal_shared",
                        "face_tags_a": shared_faces,
                        "face_tags_b": shared_faces,
                    }
                )
                continue

            min_gap = float("inf")
            mating_a: List[int] = []
            mating_b: List[int] = []

            for fa in ba["surface_tags"]:
                box_a = surface_bboxes.get(fa)
                if box_a is None:
                    continue
                for fb in bb["surface_tags"]:
                    box_b = surface_bboxes.get(fb)
                    if box_b is None:
                        continue
                    aabb_d = _aabb_min_distance(box_a, box_b)
                    if aabb_d > near_tol:
                        continue
                    try:
                        dist, _ = g.model.occ.getDistance(2, fa, 2, fb)
                        d_val = float(dist)
                    except Exception:
                        d_val = aabb_d
                    if d_val <= near_tol:
                        if d_val < min_gap:
                            min_gap = d_val
                        if fa not in mating_a:
                            mating_a.append(fa)
                        if fb not in mating_b:
                            mating_b.append(fb)

            if mating_a and mating_b and math.isfinite(min_gap):
                iface_idx += 1
                interfaces.append(
                    {
                        "id": f"interface_{iface_idx}",
                        "body_a": ba["body_id"],
                        "body_b": bb["body_id"],
                        "gap_m": round(min_gap, 7),
                        "interface_type": "conformal_shared" if min_gap <= conformal_tol else "near_contact",
                        "face_tags_a": sorted(mating_a),
                        "face_tags_b": sorted(mating_b),
                    }
                )

    return bodies, interfaces, dimensions


def _tessellate_multibody_preview(
    g: Any,
    bodies: Sequence[Dict[str, Any]],
    dimensions: Mapping[str, Any],
    patch_by_surface: Optional[Mapping[int, str]] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Generate a clean triangulated surface mesh preview from the active OCC model,
    including per-triangle `triangle_patches` and `triangle_bodies` mappings.
    """
    diag = float(dimensions.get("diagonal") or 0.0)
    if diag <= 1e-9:
        diag = 1.0
    max_lc = max(diag / 14.0, 1e-5)
    min_lc = max(diag / 48.0, 1e-6)
    g.option.setNumber("Mesh.CharacteristicLengthMin", min_lc)
    g.option.setNumber("Mesh.CharacteristicLengthMax", max_lc)
    g.option.setNumber("Mesh.Algorithm", 6)  # Frontal-Delaunay 2D

    g.model.mesh.generate(2)

    node_tags, node_coords, _ = g.model.mesh.getNodes()
    tag_to_idx: Dict[int, int] = {}
    flat_points: List[float] = []
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for k, ntag in enumerate(node_tags):
        tag_to_idx[int(ntag)] = k
        px = round(float(node_coords[3 * k]), 6)
        py = round(float(node_coords[3 * k + 1]), 6)
        pz = round(float(node_coords[3 * k + 2]), 6)
        flat_points.extend([px, py, pz])
        if px < min_x:
            min_x = px
        if py < min_y:
            min_y = py
        if pz < min_z:
            min_z = pz
        if px > max_x:
            max_x = px
        if py > max_y:
            max_y = py
        if pz > max_z:
            max_z = pz

    if not math.isfinite(min_x):
        min_x = min_y = min_z = max_x = max_y = max_z = 0.0

    # Map each surface tag to its owning body index (first body containing it)
    surface_to_body_idx: Dict[int, int] = {}
    for b_idx, body in enumerate(bodies):
        for st in body.get("surface_tags", []):
            if int(st) not in surface_to_body_idx:
                surface_to_body_idx[int(st)] = b_idx

    # Map each surface tag to physical group name if present
    surface_to_patch: Dict[int, str] = dict(patch_by_surface or {})
    for dim, phys_tag in g.model.getPhysicalGroups(2):
        pname = g.model.getPhysicalName(dim, phys_tag) or f"surface_group_{phys_tag}"
        for ent_tag in g.model.getEntitiesForPhysicalGroup(dim, phys_tag):
            surface_to_patch[int(ent_tag)] = pname

    patch_name_to_id: Dict[str, int] = {}
    patch_summaries: List[Dict[str, Any]] = []
    flat_triangles: List[int] = []
    triangle_patches: List[int] = []
    triangle_bodies: List[int] = []

    surfaces = sorted(g.model.getEntities(2), key=lambda dt: dt[1])
    for _, surf_tag in surfaces:
        elem_types, _, elem_node_tags = g.model.mesh.getElements(2, surf_tag)
        surf_tris: List[Tuple[int, int, int]] = []
        for etype, enodes in zip(elem_types, elem_node_tags):
            if etype == 2:  # 3-node triangle
                for m in range(0, len(enodes), 3):
                    a = tag_to_idx.get(int(enodes[m]))
                    b = tag_to_idx.get(int(enodes[m + 1]))
                    c = tag_to_idx.get(int(enodes[m + 2]))
                    if a is not None and b is not None and c is not None:
                        surf_tris.append((a, b, c))
            elif etype == 3:  # 4-node quad -> split into 2 tris
                for m in range(0, len(enodes), 4):
                    a = tag_to_idx.get(int(enodes[m]))
                    b = tag_to_idx.get(int(enodes[m + 1]))
                    c = tag_to_idx.get(int(enodes[m + 2]))
                    d = tag_to_idx.get(int(enodes[m + 3]))
                    if None not in (a, b, c, d):
                        surf_tris.append((a, b, c))
                        surf_tris.append((a, c, d))

        if not surf_tris:
            continue

        pname = surface_to_patch.get(int(surf_tag), f"Face_{surf_tag}")
        if pname not in patch_name_to_id:
            pid = len(patch_summaries)
            patch_name_to_id[pname] = pid
            lower_p = pname.lower()
            if "inlet" in lower_p:
                ptype = "inlet"
            elif "outlet" in lower_p:
                ptype = "outlet"
            elif "farfield" in lower_p or "symmetry" in lower_p:
                ptype = "farfield"
            elif "interface" in lower_p or "contact" in lower_p:
                ptype = "interface"
            else:
                ptype = "wall"
            patch_summaries.append(
                {
                    "id": str(pid),
                    "name": pname,
                    "type": ptype,
                    "dim": 2,
                    "face_count": 0,
                    "surface_tags": [],
                }
            )
        pid = patch_name_to_id[pname]
        patch_summaries[pid]["face_count"] += len(surf_tris)
        if int(surf_tag) not in patch_summaries[pid]["surface_tags"]:
            patch_summaries[pid]["surface_tags"].append(int(surf_tag))

        b_idx = surface_to_body_idx.get(int(surf_tag), 0)
        for a, b, c in surf_tris:
            flat_triangles.extend([a, b, c])
            triangle_patches.append(pid)
            triangle_bodies.append(b_idx)

    tri_cap = 360000
    vtk_data = {
        "points": flat_points[:180000],
        "triangles": flat_triangles[:tri_cap],
        "triangle_patches": triangle_patches[: tri_cap // 3],
        "triangle_bodies": triangle_bodies[: tri_cap // 3],
        "patches": patch_summaries,
        "scalars": {},
        "active_field": "",
        "bounds": {"min": [min_x, min_y, min_z], "max": [max_x, max_y, max_z]},
        "node_count": len(node_tags),
        "triangle_count": len(flat_triangles) // 3,
        "is_preview": True,
    }
    return vtk_data, patch_summaries


def inspect_cad_assembly(
    raw_bytes: bytes,
    filename: str,
    unit_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Import STEP/IGES/BREP into OpenCASCADE, apply SI scaling, enumerate all 3D
    solid bodies, detect body-to-body interfaces, and generate multi-body preview.
    """
    fallback_names = _extract_step_solid_names(raw_bytes, filename)
    with _gmsh_session("naseer_cad_inspect") as g:
        unit_info, solids = _import_and_scale_cad(
            g, raw_bytes, filename, unit_override=unit_override
        )
        if not solids:
            raise CadPreparationError(
                f"No 3D solid volumes were found in '{filename}'. "
                "Ensure the CAD file contains closed B-Rep solids."
            )
        bodies, interfaces, dimensions = _collect_bodies_and_interfaces(
            g, solids, fallback_names=fallback_names
        )
        vtk_data, patches = _tessellate_multibody_preview(g, bodies, dimensions)

    return {
        "status": "ok",
        "filename": Path(filename).name,
        "unit_info": unit_info,
        "dimensions": dimensions,
        "body_count": len(bodies),
        "bodies": bodies,
        "interface_count": len(interfaces),
        "interfaces": interfaces,
        "patches": patches,
        "vtk_data": vtk_data,
    }


def _classify_enclosure_surfaces(
    g: Any,
    fluid_tags: Sequence[int],
    box_bounds: Tuple[float, float, float, float, float, float],
    flow_axis: str = "x",
) -> Tuple[Dict[str, List[int]], Dict[int, str]]:
    """Classify enclosure faces into inlet, outlet, farfield, and obstacle."""
    bx0, by0, bz0, bx1, by1, bz1 = box_bounds
    diag = math.sqrt((bx1 - bx0) ** 2 + (by1 - by0) ** 2 + (bz1 - bz0) ** 2)
    tol = max(1e-5, 1e-4 * diag)

    boundary = g.model.getBoundary(
        [(3, t) for t in fluid_tags], oriented=False, recursive=False
    )
    surface_tags = sorted({int(abs(t)) for d, t in boundary if d == 2})

    groups: Dict[str, List[int]] = {
        "inlet": [],
        "outlet": [],
        "farfield": [],
        "obstacle": [],
    }
    patch_by_surface: Dict[int, str] = {}

    for st in surface_tags:
        sx0, sy0, sz0, sx1, sy1, sz1 = g.model.occ.getBoundingBox(2, st)
        on_xmin = abs(sx0 - bx0) <= tol and abs(sx1 - bx0) <= tol
        on_xmax = abs(sx0 - bx1) <= tol and abs(sx1 - bx1) <= tol
        on_ymin = abs(sy0 - by0) <= tol and abs(sy1 - by0) <= tol
        on_ymax = abs(sy0 - by1) <= tol and abs(sy1 - by1) <= tol
        on_zmin = abs(sz0 - bz0) <= tol and abs(sz1 - bz0) <= tol
        on_zmax = abs(sz0 - bz1) <= tol and abs(sz1 - bz1) <= tol

        if flow_axis == "y":
            if on_ymin:
                grp = "inlet"
            elif on_ymax:
                grp = "outlet"
            elif on_xmin or on_xmax or on_zmin or on_zmax:
                grp = "farfield"
            else:
                grp = "obstacle"
        elif flow_axis == "z":
            if on_zmin:
                grp = "inlet"
            elif on_zmax:
                grp = "outlet"
            elif on_xmin or on_xmax or on_ymin or on_ymax:
                grp = "farfield"
            else:
                grp = "obstacle"
        else:
            if on_xmin:
                grp = "inlet"
            elif on_xmax:
                grp = "outlet"
            elif on_ymin or on_ymax or on_zmin or on_zmax:
                grp = "farfield"
            else:
                grp = "obstacle"

        groups[grp].append(st)
        patch_by_surface[st] = grp

    return groups, patch_by_surface


def _is_internal_cavity_candidate(
    g: Any,
    vol_tag: int,
    tight_bbox: Sequence[float],
    box_vol: float,
) -> bool:
    """
    Determine whether a cut-complement volume is a true internal fluid cavity
    (sealed void or open-ended internal passage capped by the tight bbox)
    versus exterior space wrapping around the outside of the solid.
    """
    xmin, ymin, zmin, xmax, ymax, zmax = tight_bbox
    dx = max(xmax - xmin, 1e-9)
    dy = max(ymax - ymin, 1e-9)
    dz = max(zmax - zmin, 1e-9)
    diag = math.sqrt(dx * dx + dy * dy + dz * dz)
    tol = max(1e-5, 1e-3 * diag)

    vol = float(abs(g.model.occ.getMass(3, vol_tag)))
    if vol <= max(1e-15, 1e-9 * box_vol):
        return False

    vx0, vy0, vz0, vx1, vy1, vz1 = g.model.occ.getBoundingBox(3, vol_tag)
    t_x0 = abs(vx0 - xmin) <= tol
    t_x1 = abs(vx1 - xmax) <= tol
    t_y0 = abs(vy0 - ymin) <= tol
    t_y1 = abs(vy1 - ymax) <= tol
    t_z0 = abs(vz0 - zmin) <= tol
    t_z1 = abs(vz1 - zmax) <= tol

    touched_faces = sum([t_x0, t_x1, t_y0, t_y1, t_z0, t_z1])
    if touched_faces == 0:
        # Completely enclosed internal void
        return True

    # Exterior shroud around a sphere/cylinder or 4-face corner fillet touches >= 4 bbox faces
    if touched_faces >= 4:
        return False

    spans_axes = sum([t_x0 and t_x1, t_y0 and t_y1, t_z0 and t_z1])
    strictly_interior_axes = sum(
        [
            (not t_x0) and (not t_x1),
            (not t_y0) and (not t_y1),
            (not t_z0) and (not t_z1),
        ]
    )
    if spans_axes > 1 or strictly_interior_axes < 1:
        return False

    # Reject exterior corner voids (e.g. L-bracket outer quadrant) that contain
    # a point slightly inside any of the 8 corners of the tight bounding box.
    eps_x = min(0.02 * dx, tol * 2.0)
    eps_y = min(0.02 * dy, tol * 2.0)
    eps_z = min(0.02 * dz, tol * 2.0)
    corner_probes = [
        (xmin + eps_x, ymin + eps_y, zmin + eps_z),
        (xmin + eps_x, ymin + eps_y, zmax - eps_z),
        (xmin + eps_x, ymax - eps_y, zmin + eps_z),
        (xmin + eps_x, ymax - eps_y, zmax - eps_z),
        (xmax - eps_x, ymin + eps_y, zmin + eps_z),
        (xmax - eps_x, ymin + eps_y, zmax - eps_z),
        (xmax - eps_x, ymax - eps_y, zmin + eps_z),
        (xmax - eps_x, ymax - eps_y, zmax - eps_z),
    ]
    for px, py, pz in corner_probes:
        if vx0 - tol <= px <= vx1 + tol and vy0 - tol <= py <= vy1 + tol and vz0 - tol <= pz <= vz1 + tol:
            try:
                if g.model.isInside(3, vol_tag, [px, py, pz]):
                    return False
            except Exception:
                # Fallback: if candidate touches all 3 faces meeting at this corner, it is an exterior corner
                if (t_x0 or t_x1) and (t_y0 or t_y1) and (t_z0 or t_z1):
                    return False

    return True


def extract_fluid_volume(
    raw_bytes: bytes,
    filename: str,
    mode: str,
    params: Optional[Mapping[str, Any]] = None,
    jobs_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Perform real OpenCASCADE Boolean fluid volume extraction.

    Supported modes:
      - "external_enclosure": Wind-tunnel enclosure subtracted around the solid(s),
        tagging `inlet`, `outlet`, `farfield`, `obstacle` and `fluid` Physical Groups.
      - "internal_cavity": Auto-capped internal fluid cavity extracted by subtracting
        the solid from its tight bounding box and discarding exterior space.
        Raises CadPreparationError if no closed/cappable internal cavity exists.
    """
    norm_mode = str(mode or "").strip().lower()
    if norm_mode not in ("external_enclosure", "internal_cavity"):
        raise CadPreparationError(
            f"Unsupported fluid extraction mode '{mode}'. "
            "Use 'external_enclosure' or 'internal_cavity'."
        )

    cfg = dict(params or {})
    unit_override = cfg.get("unit_override")
    uploads_dir = _get_uploads_dir(jobs_dir=jobs_dir)
    out_filename = f"prepared_{norm_mode}_{_sanitize_stem(filename)}_{uuid.uuid4().hex[:8]}.brep"
    out_path = (uploads_dir / out_filename).resolve()
    meta_path = out_path.with_suffix(".json")

    with _gmsh_session(f"naseer_fluid_{norm_mode}") as g:
        unit_info, solids = _import_and_scale_cad(
            g, raw_bytes, filename, unit_override=unit_override
        )
        if not solids:
            raise CadPreparationError(
                f"Cannot extract fluid volume: no 3D solid bodies found in '{filename}'."
            )

        solid_bbox = _bbox_from_entities(g.model.occ, solids)
        xmin, ymin, zmin, xmax, ymax, zmax = solid_bbox
        lx = xmax - xmin
        ly = ymax - ymin
        lz = zmax - zmin
        char_len = max(lx, ly, lz)
        if char_len <= 1e-9:
            raise CadPreparationError("Imported CAD geometry has zero spatial extent.")

        patch_by_surface: Dict[int, str] = {}
        role_by_tag: Dict[int, str] = {}
        name_by_tag: Dict[int, str] = {}

        if norm_mode == "external_enclosure":
            upstream_mult = float(cfg.get("upstream_mult", 3.0))
            downstream_mult = float(cfg.get("downstream_mult", 6.0))
            lateral_mult = float(cfg.get("lateral_mult", 2.5))
            keep_solids = bool(cfg.get("keep_solids", False))
            flow_axis = str(cfg.get("flow_axis", "x")).strip().lower()
            if flow_axis not in ("x", "y", "z"):
                flow_axis = "x"

            if upstream_mult <= 0 or downstream_mult <= 0 or lateral_mult <= 0:
                raise CadPreparationError(
                    "Enclosure padding multipliers (upstream, downstream, lateral) must be positive."
                )
            if upstream_mult > 100 or downstream_mult > 200 or lateral_mult > 100:
                raise CadPreparationError("Enclosure padding multipliers exceed physical limits.")

            pad_lx = max(lx, 0.1 * char_len)
            pad_ly = max(ly, 0.1 * char_len)
            pad_lz = max(lz, 0.1 * char_len)

            if flow_axis == "y":
                bx0 = xmin - lateral_mult * pad_lx
                bx1 = xmax + lateral_mult * pad_lx
                by0 = ymin - upstream_mult * pad_ly
                by1 = ymax + downstream_mult * pad_ly
                bz0 = zmin - lateral_mult * pad_lz
                bz1 = zmax + lateral_mult * pad_lz
            elif flow_axis == "z":
                bx0 = xmin - lateral_mult * pad_lx
                bx1 = xmax + lateral_mult * pad_lx
                by0 = ymin - lateral_mult * pad_ly
                by1 = ymax + lateral_mult * pad_ly
                bz0 = zmin - upstream_mult * pad_lz
                bz1 = zmax + downstream_mult * pad_lz
            else:
                bx0 = xmin - upstream_mult * pad_lx
                bx1 = xmax + downstream_mult * pad_lx
                by0 = ymin - lateral_mult * pad_ly
                by1 = ymax + lateral_mult * pad_ly
                bz0 = zmin - lateral_mult * pad_lz
                bz1 = zmax + lateral_mult * pad_lz

            box_tag = g.model.occ.addBox(bx0, by0, bz0, bx1 - bx0, by1 - by0, bz1 - bz0)
            try:
                out_dimtags, _ = g.model.occ.cut(
                    [(3, box_tag)],
                    list(solids),
                    removeObject=True,
                    removeTool=not keep_solids,
                )
            except Exception as exc:
                raise CadPreparationError(
                    f"OpenCASCADE Boolean enclosure subtraction failed: {exc}"
                ) from exc

            g.model.occ.synchronize()
            fluid_tags = sorted({int(t) for d, t in out_dimtags if d == 3})
            if not fluid_tags:
                raise CadPreparationError(
                    "Boolean enclosure subtraction produced no valid fluid volume."
                )

            groups, patch_by_surface = _classify_enclosure_surfaces(
                g, fluid_tags, (bx0, by0, bz0, bx1, by1, bz1), flow_axis=flow_axis
            )
            for grp_name, stags in groups.items():
                if stags:
                    pg = g.model.addPhysicalGroup(2, stags)
                    g.model.setPhysicalName(2, pg, grp_name)

            pg_fluid = g.model.addPhysicalGroup(3, fluid_tags)
            g.model.setPhysicalName(3, pg_fluid, "fluid")
            for idx, ft in enumerate(fluid_tags):
                role_by_tag[ft] = "fluid"
                name_by_tag[ft] = "Fluid_Enclosure" if idx == 0 else f"Fluid_Enclosure_{idx + 1}"

            if keep_solids:
                kept_solid_tags = sorted(
                    {int(t) for d, t in g.model.getEntities(3) if int(t) not in fluid_tags}
                )
                if kept_solid_tags:
                    pg_solid = g.model.addPhysicalGroup(3, kept_solid_tags)
                    g.model.setPhysicalName(3, pg_solid, "solid")
                    for idx, st in enumerate(kept_solid_tags):
                        role_by_tag[st] = "solid"
                        name_by_tag[st] = f"Solid_{idx + 1}"

            final_solids = sorted(g.model.getEntities(3), key=lambda dt: dt[1])
            fluid_volume_m3 = sum(
                float(abs(g.model.occ.getMass(3, ft))) for ft in fluid_tags
            )

        else:
            # Internal fluid cavity extraction
            if lx <= 1e-9 or ly <= 1e-9 or lz <= 1e-9:
                raise CadPreparationError(
                    "Cannot extract internal cavity from a degenerate 2D/planar solid."
                )
            box_vol = lx * ly * lz
            tight_box = g.model.occ.addBox(xmin, ymin, zmin, lx, ly, lz)
            try:
                out_dimtags, _ = g.model.occ.cut(
                    [(3, tight_box)],
                    list(solids),
                    removeObject=True,
                    removeTool=True,
                )
            except Exception as exc:
                raise CadPreparationError(
                    f"OpenCASCADE Boolean internal cavity extraction failed: {exc}"
                ) from exc

            g.model.occ.synchronize()
            candidates = sorted({int(t) for d, t in out_dimtags if d == 3})
            if not candidates:
                raise CadPreparationError(
                    "No internal fluid cavity found: the imported solid has no internal void or passage."
                )

            seed_point = cfg.get("seed_point")
            selected_tags: List[int] = []
            if isinstance(seed_point, (list, tuple)) and len(seed_point) == 3:
                sp = [float(seed_point[0]), float(seed_point[1]), float(seed_point[2])]
                for tag in candidates:
                    try:
                        if g.model.isInside(3, tag, sp):
                            selected_tags.append(tag)
                    except Exception:
                        vx0, vy0, vz0, vx1, vy1, vz1 = g.model.occ.getBoundingBox(3, tag)
                        if vx0 <= sp[0] <= vx1 and vy0 <= sp[1] <= vy1 and vz0 <= sp[2] <= vz1:
                            selected_tags.append(tag)
                if not selected_tags:
                    raise CadPreparationError(
                        f"No internal fluid cavity contains seed_point {sp}."
                    )
            else:
                for tag in candidates:
                    if _is_internal_cavity_candidate(g, tag, solid_bbox, box_vol):
                        selected_tags.append(tag)

            if not selected_tags:
                raise CadPreparationError(
                    "No closed or cappable internal fluid cavity was detected in this geometry. "
                    "Verify the part is hollow or use External Wind Tunnel extraction instead."
                )

            # Discard exterior complement volumes so only the extracted internal cavity remains
            exterior_dimtags = [(3, t) for t in candidates if t not in selected_tags]
            if exterior_dimtags:
                g.model.occ.remove(exterior_dimtags, recursive=True)
                g.model.occ.synchronize()

            fluid_tags = sorted(int(t) for _, t in g.model.getEntities(3))
            if not fluid_tags:
                raise CadPreparationError("Internal cavity volume vanished after cleanup.")

            # Classify cavity openings (faces lying on tight bbox planes) vs internal walls
            diag = math.sqrt(lx * lx + ly * ly + lz * lz)
            tol = max(1e-5, 1e-4 * diag)
            boundary = g.model.getBoundary(
                [(3, t) for t in fluid_tags], oriented=False, recursive=False
            )
            surface_tags = sorted({int(abs(t)) for d, t in boundary if d == 2})

            opening_faces: List[int] = []
            wall_faces: List[int] = []
            for st in surface_tags:
                sx0, sy0, sz0, sx1, sy1, sz1 = g.model.occ.getBoundingBox(2, st)
                on_outer_plane = (
                    (abs(sx0 - xmin) <= tol and abs(sx1 - xmin) <= tol)
                    or (abs(sx0 - xmax) <= tol and abs(sx1 - xmax) <= tol)
                    or (abs(sy0 - ymin) <= tol and abs(sy1 - ymin) <= tol)
                    or (abs(sy0 - ymax) <= tol and abs(sy1 - ymax) <= tol)
                    or (abs(sz0 - zmin) <= tol and abs(sz1 - zmin) <= tol)
                    or (abs(sz0 - zmax) <= tol and abs(sz1 - zmax) <= tol)
                )
                if on_outer_plane:
                    opening_faces.append(st)
                else:
                    wall_faces.append(st)

            # Sort opening faces by centroid along X, then Y, then Z so inlet/outlet are deterministic
            def _surf_centroid(stag: int) -> Tuple[float, float, float]:
                c = g.model.occ.getCenterOfMass(2, stag)
                return (float(c[0]), float(c[1]), float(c[2]))

            opening_faces.sort(key=_surf_centroid)
            for idx, st in enumerate(opening_faces):
                if idx == 0:
                    pname = "inlet"
                elif idx == 1:
                    pname = "outlet"
                else:
                    pname = f"opening_{idx + 1}"
                pg = g.model.addPhysicalGroup(2, [st])
                g.model.setPhysicalName(2, pg, pname)
                patch_by_surface[st] = pname

            if wall_faces:
                pg_w = g.model.addPhysicalGroup(2, wall_faces)
                g.model.setPhysicalName(2, pg_w, "walls")
                for st in wall_faces:
                    patch_by_surface[st] = "walls"

            pg_fluid = g.model.addPhysicalGroup(3, fluid_tags)
            g.model.setPhysicalName(3, pg_fluid, "fluid")
            for idx, ft in enumerate(fluid_tags):
                role_by_tag[ft] = "fluid"
                name_by_tag[ft] = "Fluid_Cavity" if idx == 0 else f"Fluid_Cavity_{idx + 1}"

            final_solids = sorted(g.model.getEntities(3), key=lambda dt: dt[1])
            fluid_volume_m3 = sum(
                float(abs(g.model.occ.getMass(3, ft))) for ft in fluid_tags
            )

        # Persist real OpenCASCADE B-Rep geometry before meshing
        g.write(str(out_path))

        bodies, interfaces, dimensions = _collect_bodies_and_interfaces(
            g, final_solids, role_by_tag=role_by_tag, name_by_tag=name_by_tag
        )
        vtk_data, patches = _tessellate_multibody_preview(
            g, bodies, dimensions, patch_by_surface=patch_by_surface
        )

    metadata = {
        "prepared_file_path": str(out_path),
        "prepared_filename": out_filename,
        "source_filename": Path(filename).name,
        "mode": norm_mode,
        "unit_info": {
            **unit_info,
            "stored_unit": "m",
        },
        "fluid_volume_m3": round(fluid_volume_m3, 9),
        "dimensions": dimensions,
        "bodies": bodies,
        "interfaces": interfaces,
        "patches": patches,
    }
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        **metadata,
        "metadata_path": str(meta_path),
        "vtk_data": vtk_data,
    }


def prepare_multibody_assembly(
    raw_bytes: bytes,
    filename: str,
    body_assignments: Optional[Sequence[Mapping[str, Any]]] = None,
    conformal_cht: bool = True,
    unit_override: Optional[str] = None,
    jobs_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Prepare a multi-body CAD assembly in OpenCASCADE:
      - conformal_cht=True: executes `gmsh.model.occ.fragment` to imprint shared
        conformal interfaces between touching fluid/solid regions and tags
        Physical Volume (`fluid_*`, `solid_*`) and Physical Surface (`interface_*`) groups.
      - conformal_cht=False: keeps bodies topologically disjoint for CalculiX
        `*CONTACT PAIR` / `*TIE` workflows with separate node IDs and named contact face groups.
    """
    fallback_names = _extract_step_solid_names(raw_bytes, filename)
    uploads_dir = _get_uploads_dir(jobs_dir=jobs_dir)
    mode_tag = "conformal_cht" if conformal_cht else "disjoint_contact"
    out_filename = f"prepared_{mode_tag}_{_sanitize_stem(filename)}_{uuid.uuid4().hex[:8]}.brep"
    out_path = (uploads_dir / out_filename).resolve()
    meta_path = out_path.with_suffix(".json")

    assignment_by_id: Dict[str, Mapping[str, Any]] = {}
    assignment_by_tag: Dict[int, Mapping[str, Any]] = {}
    for entry in body_assignments or []:
        if not isinstance(entry, Mapping):
            continue
        if entry.get("body_id"):
            assignment_by_id[str(entry["body_id"])] = entry
        if entry.get("occ_tag") is not None:
            try:
                assignment_by_tag[int(entry["occ_tag"])] = entry
            except (TypeError, ValueError):
                pass

    with _gmsh_session(f"naseer_multibody_{mode_tag}") as g:
        unit_info, solids = _import_and_scale_cad(
            g, raw_bytes, filename, unit_override=unit_override
        )
        if not solids:
            raise CadPreparationError(
                f"No 3D solid volumes found in '{filename}' for multi-body preparation."
            )

        # Resolve per-original-solid role & name before any Boolean fragmentation
        orig_specs: List[Dict[str, Any]] = []
        for idx, (_, tag) in enumerate(solids):
            bid = f"body_{idx + 1}"
            spec = assignment_by_id.get(bid) or assignment_by_tag.get(int(tag)) or {}
            role = str(spec.get("role") or "solid").strip().lower()
            if role not in _VALID_BODY_ROLES:
                role = "solid"
            default_name = fallback_names[idx] if idx < len(fallback_names) else f"Solid_{tag}"
            name = str(spec.get("name") or default_name).strip() or default_name
            orig_specs.append(
                {
                    "body_id": bid,
                    "orig_tag": int(tag),
                    "role": role,
                    "name": name,
                }
            )

        role_by_tag: Dict[int, str] = {}
        name_by_tag: Dict[int, str] = {}
        patch_by_surface: Dict[int, str] = {}

        if conformal_cht and len(solids) >= 2:
            try:
                _, out_map = g.model.occ.fragment(list(solids), [])
            except Exception as exc:
                raise CadPreparationError(
                    f"OpenCASCADE conformal assembly fragmentation failed: {exc}"
                ) from exc
            g.model.occ.synchronize()

            for idx, mapped_children in enumerate(out_map):
                spec = orig_specs[idx] if idx < len(orig_specs) else {
                    "body_id": f"body_{idx + 1}",
                    "role": "solid",
                    "name": f"Solid_{idx + 1}",
                }
                child_vol_tags = sorted({int(t) for d, t in mapped_children if d == 3})
                for vtag in child_vol_tags:
                    role_by_tag[vtag] = spec["role"]
                    name_by_tag[vtag] = spec["name"]
                if child_vol_tags:
                    pg = g.model.addPhysicalGroup(3, child_vol_tags)
                    group_prefix = "fluid" if spec["role"] == "fluid" else "solid"
                    g.model.setPhysicalName(
                        3, pg, f"{group_prefix}_{_sanitize_identifier(spec['name'], spec['body_id'])}"
                    )
        else:
            for spec in orig_specs:
                vtag = spec["orig_tag"]
                role_by_tag[vtag] = spec["role"]
                name_by_tag[vtag] = spec["name"]
                pg = g.model.addPhysicalGroup(3, [vtag])
                group_prefix = "fluid" if spec["role"] == "fluid" else "solid"
                g.model.setPhysicalName(
                    3, pg, f"{group_prefix}_{_sanitize_identifier(spec['name'], spec['body_id'])}"
                )

        final_solids = sorted(g.model.getEntities(3), key=lambda dt: dt[1])
        bodies, interfaces, dimensions = _collect_bodies_and_interfaces(
            g, final_solids, role_by_tag=role_by_tag, name_by_tag=name_by_tag
        )

        # Register interface/contact Physical Surface groups
        for iface in interfaces:
            fa = iface.get("face_tags_a") or []
            fb = iface.get("face_tags_b") or []
            if conformal_cht and iface.get("interface_type") == "conformal_shared":
                shared = sorted(set(fa) | set(fb))
                if shared:
                    pname = f"interface_{iface['body_a']}_{iface['body_b']}"
                    pg = g.model.addPhysicalGroup(2, shared)
                    g.model.setPhysicalName(2, pg, pname)
                    for st in shared:
                        patch_by_surface[st] = pname
            else:
                if fa:
                    pname_a = f"contact_{iface['body_a']}_{iface['body_b']}_a"
                    pg_a = g.model.addPhysicalGroup(2, fa)
                    g.model.setPhysicalName(2, pg_a, pname_a)
                    for st in fa:
                        patch_by_surface[st] = pname_a
                if fb and fb != fa:
                    pname_b = f"contact_{iface['body_a']}_{iface['body_b']}_b"
                    pg_b = g.model.addPhysicalGroup(2, fb)
                    g.model.setPhysicalName(2, pg_b, pname_b)
                    for st in fb:
                        patch_by_surface[st] = pname_b

        g.write(str(out_path))
        vtk_data, patches = _tessellate_multibody_preview(
            g, bodies, dimensions, patch_by_surface=patch_by_surface
        )

    metadata = {
        "prepared_file_path": str(out_path),
        "prepared_filename": out_filename,
        "source_filename": Path(filename).name,
        "conformal_cht": bool(conformal_cht),
        "unit_info": {
            **unit_info,
            "stored_unit": "m",
        },
        "dimensions": dimensions,
        "body_count": len(bodies),
        "bodies": bodies,
        "interface_count": len(interfaces),
        "interfaces": interfaces,
        "patches": patches,
    }
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        **metadata,
        "metadata_path": str(meta_path),
        "vtk_data": vtk_data,
    }
