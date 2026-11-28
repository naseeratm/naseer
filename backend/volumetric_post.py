"""
NASEER Universal CAE Studio — Headless PyVista/VTK Volumetric Post-Processing Engine
====================================================================================
STRICT ZERO-MOCK POLICY:
- Every volumetric slice, 3D RK4 streamline, iso-surface, surface extraction,
  bad-cell coordinate, and binary vertex/scalar buffer is computed strictly from
  real OpenFOAM / CalculiX / ElmerFEM solver outputs on disk (`VTK/*.vtu`,
  `*.vtk`, `*.inp` + `*.frd`/`*.dat`, or `foamToVTK` output).
- Never fabricates synthetic flow trajectories, fake slices, or mock scalar arrays.
- Gracefully reports `HAS_PYVISTA = False` / `VolumetricBackendUnavailableError`
  when `pyvista` / `vtk` is not installed in a lightweight host or API container.

Binary Streaming Container (`NSR1`):
  Bytes [0..4)              : ASCII magic `b"NSR1"`
  Bytes [4..8)              : uint32 little-endian `header_len` (padded to 4-byte alignment)
  Bytes [8..8+header_len)   : UTF-8 JSON header (space-padded to 4-byte boundary)
  Bytes [8+header_len..)    : 4-byte aligned raw little-endian Float32 / Uint32 buffers
"""

from __future__ import annotations

import array
import json
import math
import os
import re
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

try:
    import numpy as np  # type: ignore[import-not-found]

    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore[assignment]
    HAS_NUMPY = False

try:
    import pyvista as pv  # type: ignore[import-not-found]

    try:
        # Ensure headless VTK operation inside Linux containers without X11 display
        pv.OFF_SCREEN = True
    except Exception:
        pass
    HAS_PYVISTA = True
except Exception:
    pv = None  # type: ignore[assignment]
    HAS_PYVISTA = False


BINARY_MAGIC = b"NSR1"
MAX_SURFACE_TRIANGLES = 1_000_000
MAX_STREAMLINE_SEEDS = 500
MAX_BAD_CELL_POINTS = 2000

_FAILURE_SET_TOKENS = (
    "nonortho",
    "skew",
    "concave",
    "zerovol",
    "wrongorient",
    "highaspect",
    "selfintersect",
    "bad",
    "illegal",
    "warped",
)
_BOUNDARY_ONLY_TOKENS = (
    "inlet",
    "outlet",
    "wall",
    "walls",
    "fixedwalls",
    "movingwall",
    "frontandback",
    "symmetry",
    "patch",
    "boundary",
)


class VolumetricBackendUnavailableError(RuntimeError):
    """Raised when headless PyVista/VTK runtime is not installed on the executing node."""


class VolumetricDataUnavailableError(ValueError):
    """Raised when real solver volumetric datasets or requested physical fields are unavailable."""


def _require_pyvista() -> Any:
    if not HAS_PYVISTA or pv is None or not HAS_NUMPY or np is None:
        raise VolumetricBackendUnavailableError(
            "Headless PyVista/VTK volumetric engine is not installed on this node. "
            "Run inside the NASEER Docker CAE worker container."
        )
    return pv


# ---------------------------------------------------------------------------
# 1. Zero-Copy-Friendly `NSR1` Binary Packing & Unpacking
# ---------------------------------------------------------------------------
def _flatten_nested(values: Any) -> Tuple[List[Any], List[int]]:
    if HAS_NUMPY and np is not None and isinstance(values, np.ndarray):
        return values.ravel().tolist(), list(values.shape)
    if isinstance(values, array.array):
        return list(values), [len(values)]
    if isinstance(values, (list, tuple)):
        if len(values) == 0:
            return [], [0]
        if isinstance(values[0], (list, tuple)):
            rows = len(values)
            cols = len(values[0])
            flat: List[Any] = []
            for row in values:
                flat.extend(row)
            return flat, [rows, cols]
        return list(values), [len(values)]
    raise TypeError(f"Unsupported buffer value type: {type(values).__name__}")


def _encode_typed_buffer(name: str, spec: Any) -> Tuple[str, List[int], int, bytes]:
    """Normalize a buffer specification into (dtype_str, shape, count, raw_le_bytes)."""
    explicit_dtype: Optional[str] = None
    explicit_shape: Optional[List[int]] = None
    raw_data = spec

    if isinstance(spec, Mapping):
        explicit_dtype = str(spec.get("dtype") or "").lower() or None
        if spec.get("shape") is not None:
            explicit_shape = [int(d) for d in spec["shape"]]
        raw_data = spec.get("data", [])
    elif isinstance(spec, tuple) and len(spec) == 2 and isinstance(spec[0], str):
        explicit_dtype = spec[0].lower()
        raw_data = spec[1]
    elif isinstance(spec, tuple) and len(spec) == 3 and isinstance(spec[0], str):
        explicit_dtype = spec[0].lower()
        raw_data = spec[1]
        explicit_shape = [int(d) for d in spec[2]]

    # Fast numpy path when installed
    if HAS_NUMPY and np is not None and isinstance(raw_data, np.ndarray):
        arr = raw_data
        if explicit_dtype in {"uint32", "u4"} or (
            explicit_dtype is None
            and (np.issubdtype(arr.dtype, np.integer) or name in {"indices", "line_counts"})
        ):
            dtype_str = "uint32"
            c_arr = np.ascontiguousarray(arr, dtype="<u4")
        else:
            dtype_str = "float32"
            c_arr = np.ascontiguousarray(arr, dtype="<f4")
        shape = explicit_shape or list(c_arr.shape)
        return dtype_str, shape, int(c_arr.size), c_arr.tobytes()

    # Pure-Python stdlib fallback (so pack/unpack works identically on bare Python hosts)
    flat, inferred_shape = _flatten_nested(raw_data)
    shape = explicit_shape or inferred_shape
    if explicit_dtype in {"uint32", "u4"}:
        dtype_str = "uint32"
    elif explicit_dtype in {"float32", "f4"}:
        dtype_str = "float32"
    elif name in {"indices", "line_counts"} or (flat and all(isinstance(v, int) and not isinstance(v, bool) for v in flat[:16])):
        dtype_str = "uint32"
    else:
        dtype_str = "float32"

    count = len(flat)
    if count == 0:
        return dtype_str, shape, 0, b""

    if dtype_str == "uint32":
        encoded = struct.pack(f"<{count}I", *(max(0, int(v)) for v in flat))
    else:
        encoded = struct.pack(f"<{count}f", *(float(v) for v in flat))
    return dtype_str, shape, count, encoded


def pack_mesh_binary(
    metadata: Mapping[str, Any],
    buffers: Mapping[str, Any],
) -> bytes:
    """Pack JSON metadata + typed Float32/Uint32 arrays into a 4-byte aligned `NSR1` binary payload."""
    buffer_descriptors: Dict[str, Dict[str, Any]] = {}
    payload_chunks: List[bytes] = []
    running_offset = 0

    for buf_name, buf_spec in buffers.items():
        dtype_str, shape, count, raw_bytes = _encode_typed_buffer(str(buf_name), buf_spec)
        # Ensure strict 4-byte alignment for every typed array view
        pad = (4 - (running_offset % 4)) % 4
        if pad:
            payload_chunks.append(b"\x00" * pad)
            running_offset += pad
        buffer_descriptors[str(buf_name)] = {
            "dtype": dtype_str,
            "offset": running_offset,
            "byte_length": len(raw_bytes),
            "count": count,
            "shape": shape,
        }
        payload_chunks.append(raw_bytes)
        running_offset += len(raw_bytes)

    header_obj = {
        "format": "NSR1",
        "version": 1,
        "metadata": dict(metadata),
        "buffers": buffer_descriptors,
    }
    header_bytes = json.dumps(header_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    # Pad header with ASCII spaces so (8 + header_len) % 4 == 0
    header_pad = (4 - (len(header_bytes) % 4)) % 4
    if header_pad:
        header_bytes += b" " * header_pad

    prefix = BINARY_MAGIC + struct.pack("<I", len(header_bytes))
    return prefix + header_bytes + b"".join(payload_chunks)


def unpack_mesh_binary(blob: bytes) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Decode an `NSR1` binary payload back into `(metadata, buffers)` with strict bounds & alignment checks."""
    if not isinstance(blob, (bytes, bytearray, memoryview)):
        raise ValueError("NSR1 payload must be a bytes-like object.")
    raw = bytes(blob)
    if len(raw) < 8 or raw[:4] != BINARY_MAGIC:
        raise ValueError("Invalid binary header: expected 'NSR1' magic bytes.")
    header_len = struct.unpack("<I", raw[4:8])[0]
    data_start = 8 + header_len
    if data_start > len(raw):
        raise ValueError("Truncated NSR1 header.")
    if data_start % 4 != 0:
        raise ValueError("NSR1 binary payload is not 4-byte aligned.")

    header = json.loads(raw[8:data_start].decode("utf-8"))
    metadata = dict(header.get("metadata") or {})
    buf_specs = header.get("buffers") or {}
    payload = raw[data_start:]

    decoded_buffers: Dict[str, Any] = {}
    for name, info in buf_specs.items():
        dtype_str = str(info["dtype"]).lower()
        offset = int(info["offset"])
        byte_len = int(info["byte_length"])
        count = int(info["count"])
        shape = [int(d) for d in (info.get("shape") or [count])]

        if offset < 0 or offset % 4 != 0 or offset + byte_len > len(payload):
            raise ValueError(f"Invalid NSR1 buffer slice for '{name}'.")
        chunk = payload[offset : offset + byte_len]

        if HAS_NUMPY and np is not None:
            np_dtype = np.dtype("<u4") if dtype_str == "uint32" else np.dtype("<f4")
            arr = np.frombuffer(chunk, dtype=np_dtype, count=count).copy()
            if shape and math.prod(shape) == count:
                arr = arr.reshape(tuple(shape))
            decoded_buffers[name] = arr
        else:
            if count == 0:
                decoded_buffers[name] = []
            else:
                fmt = f"<{count}I" if dtype_str == "uint32" else f"<{count}f"
                vals = list(struct.unpack(fmt, chunk))
                if len(shape) == 2 and shape[0] * shape[1] == count and shape[1] > 0:
                    cols = shape[1]
                    decoded_buffers[name] = [vals[i : i + cols] for i in range(0, count, cols)]
                else:
                    decoded_buffers[name] = vals

    return metadata, decoded_buffers


# ---------------------------------------------------------------------------
# 2. Pure-Python / PyVista Safe Bad-Cell Coordinate Extraction
# ---------------------------------------------------------------------------
def _parse_ascii_vtk_polydata_points(path: Path) -> List[List[float]]:
    """Pure-Python parser for legacy ASCII VTK `DATASET POLYDATA` `POINTS` blocks."""
    coords: List[List[float]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return coords
    idx = 0
    while idx < len(lines):
        m = re.match(r"^\s*POINTS\s+(\d+)\s+", lines[idx], flags=re.I)
        if m:
            n_pts = int(m.group(1))
            nums: List[float] = []
            idx += 1
            while idx < len(lines) and len(nums) < n_pts * 3:
                for tok in lines[idx].split():
                    try:
                        nums.append(float(tok))
                    except ValueError:
                        break
                idx += 1
            for k in range(0, min(len(nums) - 2, n_pts * 3), 3):
                x, y, z = nums[k], nums[k + 1], nums[k + 2]
                if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
                    coords.append([round(x, 6), round(y, 6), round(z, 6)])
            break
        idx += 1
    return coords


def extract_bad_cell_points(case_dir: Union[str, Path], max_points: int = MAX_BAD_CELL_POINTS) -> List[List[float]]:
    """Extract real checkMesh failure set coordinates from `VTK/` inside `case_dir`."""
    case_path = Path(case_dir)
    vtk_dir = case_path / "VTK"
    if not vtk_dir.is_dir():
        return []
    coords: List[List[float]] = []
    for p in sorted(vtk_dir.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in {".vtk", ".vtp", ".vtu"}:
            continue
        low = p.stem.lower()
        if not any(tok in low for tok in _FAILURE_SET_TOKENS):
            continue
        pts = _parse_ascii_vtk_polydata_points(p) if p.suffix.lower() == ".vtk" else []
        if not pts and HAS_PYVISTA and pv is not None:
            try:
                ds = pv.read(str(p))
                if ds is not None and getattr(ds, "n_points", 0) > 0:
                    for row in ds.points:
                        x, y, z = float(row[0]), float(row[1]), float(row[2])
                        if math.isfinite(x) and math.isfinite(y) and math.isfinite(z):
                            pts.append([round(x, 6), round(y, 6), round(z, 6)])
            except Exception:
                pts = []
        coords.extend(pts)

    if len(coords) <= max_points:
        return coords
    step = len(coords) / float(max_points)
    return [coords[int(i * step)] for i in range(max_points)]


# ---------------------------------------------------------------------------
# 3. Real Solver Dataset Discovery & Loading (OpenFOAM, ElmerFEM, CalculiX)
# ---------------------------------------------------------------------------
def _is_failure_set_file(path: Path) -> bool:
    low = path.stem.lower()
    return any(tok in low for tok in _FAILURE_SET_TOKENS)


def _is_boundary_only_vtk(path: Path, vtk_root: Path) -> bool:
    rel_parts = [part.lower() for part in path.relative_to(vtk_root).parts]
    if len(rel_parts) > 1:
        # OpenFOAM foamToVTK places boundary patches inside subdirectories under VTK/<patchName>/
        return True
    stem = path.stem.lower()
    return any(stem == tok or stem.startswith(f"{tok}_") for tok in _BOUNDARY_ONLY_TOKENS)


def _vtk_time_sort_key(path: Path) -> Tuple[int, float, float]:
    """Sort VTK files preferring higher numeric time step suffix, then modification time."""
    m = re.search(r"_(\d+(?:\.\d+)?)$", path.stem)
    if m:
        try:
            return (1, float(m.group(1)), path.stat().st_mtime)
        except OSError:
            return (1, float(m.group(1)), 0.0)
    try:
        return (0, 0.0, path.stat().st_mtime)
    except OSError:
        return (0, 0.0, 0.0)


def _find_openfoam_volume_vtk(case_path: Path) -> Optional[Path]:
    vtk_dir = case_path / "VTK"
    if not vtk_dir.is_dir():
        return None
    candidates = [
        p
        for p in vtk_dir.rglob("*")
        if p.is_file()
        and p.suffix.lower() in {".vtu", ".vtk"}
        and not _is_failure_set_file(p)
    ]
    if not candidates:
        return None
    internal = [p for p in candidates if not _is_boundary_only_vtk(p, vtk_dir)]
    pool = internal if internal else candidates
    pool.sort(key=_vtk_time_sort_key, reverse=True)
    return pool[0]


def _maybe_run_foam_to_vtk(case_path: Path) -> Optional[Path]:
    """If OpenFOAM case has solved numeric time directories but no VTK output yet, run `foamToVTK -latestTime`."""
    if not (case_path / "system" / "controlDict").is_file():
        return None
    numeric_times: List[float] = []
    for child in case_path.iterdir():
        if not child.is_dir():
            continue
        try:
            t_val = float(child.name)
            if t_val > 0.0:
                numeric_times.append(t_val)
        except ValueError:
            continue
    if not numeric_times:
        return None

    env = dict(os.environ)
    of_bin_candidates = [
        "/usr/lib/openfoam/openfoam2406/platforms/linux64GccDPInt32Opt/bin",
        "/opt/openfoam/platforms/linux64GccDPInt32Opt/bin",
    ]
    extra_paths = [p for p in of_bin_candidates if os.path.isdir(p)]
    if extra_paths:
        env["PATH"] = ":".join(extra_paths) + ":" + env.get("PATH", "")

    foam_to_vtk = shutil.which("foamToVTK", path=env.get("PATH")) or shutil.which("foamToVTK")
    if not foam_to_vtk:
        return None

    try:
        subprocess.run(
            [foam_to_vtk, "-latestTime"],
            cwd=str(case_path),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return _find_openfoam_volume_vtk(case_path)


def _find_elmer_vtu(case_path: Path) -> Optional[Path]:
    vtus = [
        p
        for p in case_path.rglob("*.vtu")
        if p.is_file() and not _is_failure_set_file(p)
    ]
    if not vtus:
        return None
    vtus.sort(key=_vtk_time_sort_key, reverse=True)
    return vtus[0]


def _parse_calculix_inp(inp_path: Path) -> Tuple[Dict[int, Tuple[float, float, float]], Dict[int, Tuple[str, List[int]]]]:
    node_coords: Dict[int, Tuple[float, float, float]] = {}
    elem_conn: Dict[int, Tuple[str, List[int]]] = {}
    mode: Optional[str] = None
    active_etype = ""
    pending_eid: Optional[int] = None
    pending_nodes: List[int] = []

    def _flush() -> None:
        nonlocal pending_eid, pending_nodes
        if pending_eid is not None and pending_nodes:
            elem_conn[pending_eid] = (active_etype, list(pending_nodes))
        pending_eid = None
        pending_nodes = []

    for raw in inp_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("**"):
            continue
        if line.startswith("*"):
            _flush()
            upper = line.upper()
            if upper.startswith("*NODE") and not upper.startswith("*NODE FILE") and not upper.startswith("*NODE PRINT"):
                mode = "node"
            elif upper.startswith("*ELEMENT") and not upper.startswith("*ELEMENT OUTPUT"):
                m = re.search(r"TYPE\s*=\s*([A-Za-z0-9_]+)", upper)
                active_etype = m.group(1) if m else "C3D8"
                mode = "elem"
            else:
                mode = None
            continue

        parts = [p.strip() for p in line.split(",") if p.strip()]
        if mode == "node" and len(parts) >= 4:
            try:
                node_coords[int(float(parts[0]))] = (float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError:
                continue
        elif mode == "elem" and parts:
            try:
                vals = [int(float(p)) for p in parts]
            except ValueError:
                continue
            if pending_eid is None:
                pending_eid = vals[0]
                pending_nodes = vals[1:]
            else:
                pending_nodes.extend(vals)
            if not raw.rstrip().endswith(","):
                _flush()
    _flush()
    return node_coords, elem_conn


def _parse_calculix_dat_fields(
    dat_path: Path,
) -> Tuple[Dict[int, Tuple[float, float, float]], Dict[int, float], Dict[int, float]]:
    """Parse displacements (node -> (ux,uy,uz)), temperatures (node -> T), and von Mises stress (elem -> vm)."""
    disps: Dict[int, Tuple[float, float, float]] = {}
    temps: Dict[int, float] = {}
    vm_by_elem: Dict[int, List[float]] = {}
    if not dat_path.is_file():
        return disps, temps, {}

    section: Optional[str] = None
    for raw in dat_path.read_text(encoding="utf-8", errors="replace").splitlines():
        low = raw.strip().lower()
        if not low:
            continue
        if "displacements" in low and ("for set" in low or "vx" in low or "time" in low):
            section = "disp"
            continue
        if "temperatures" in low and ("for set" in low or "time" in low):
            section = "temp"
            continue
        if "stresses" in low and ("for set" in low or "time" in low):
            section = "stress"
            continue
        if low.startswith(("total ", "forces ", "internal ", "heat ")):
            section = None
            continue

        toks = raw.split()
        if not toks:
            continue
        if section == "disp" and len(toks) >= 4:
            try:
                nid = int(toks[0])
                disps[nid] = (float(toks[1]), float(toks[2]), float(toks[3]))
            except ValueError:
                continue
        elif section == "temp" and len(toks) >= 2:
            try:
                nid = int(toks[0])
                temps[nid] = float(toks[1])
            except ValueError:
                continue
        elif section == "stress" and len(toks) >= 8:
            try:
                eid = int(toks[0])
                # Format: elem  integ_pt  sxx syy szz sxy sxz syz
                s11, s22, s33, s12, s13, s23 = [float(x) for x in toks[2:8]]
                vm = math.sqrt(
                    0.5
                    * (
                        (s11 - s22) ** 2
                        + (s22 - s33) ** 2
                        + (s33 - s11) ** 2
                        + 6.0 * (s12 * s12 + s13 * s13 + s23 * s23)
                    )
                )
                vm_by_elem.setdefault(eid, []).append(vm)
            except ValueError:
                continue

    avg_vm = {eid: sum(vals) / len(vals) for eid, vals in vm_by_elem.items() if vals}
    return disps, temps, avg_vm


def _parse_calculix_frd_fields(
    frd_path: Path,
) -> Tuple[Dict[int, Tuple[float, float, float]], Dict[int, float], Dict[int, float]]:
    """Parse latest step nodal DISP, TEMP, and STRESS von Mises from ASCII CalculiX `.frd`."""
    disps: Dict[int, Tuple[float, float, float]] = {}
    temps: Dict[int, float] = {}
    nodal_vm: Dict[int, float] = {}
    if not frd_path.is_file():
        return disps, temps, nodal_vm

    active_block: Optional[str] = None
    for line in frd_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith(" -4"):
            upper = line.upper()
            if "DISP" in upper:
                active_block = "DISP"
            elif "NDTEMP" in upper or "TEMP" in upper:
                active_block = "TEMP"
            elif "STRESS" in upper:
                active_block = "STRESS"
            else:
                active_block = None
            continue
        if line.startswith(" -3"):
            active_block = None
            continue
        if not line.startswith(" -1") or active_block is None:
            continue
        try:
            nid = int(line[3:13].strip())
            payload = line[13:]
            vals = [float(payload[i : i + 12]) for i in range(0, len(payload), 12) if payload[i : i + 12].strip()]
        except ValueError:
            continue
        if active_block == "DISP" and len(vals) >= 3:
            disps[nid] = (vals[0], vals[1], vals[2])
        elif active_block == "TEMP" and len(vals) >= 1:
            temps[nid] = vals[0]
        elif active_block == "STRESS" and len(vals) >= 6:
            s11, s22, s33, s12, s23, s31 = vals[:6]
            nodal_vm[nid] = math.sqrt(
                0.5
                * (
                    (s11 - s22) ** 2
                    + (s22 - s33) ** 2
                    + (s33 - s11) ** 2
                    + 6.0 * (s12 * s12 + s23 * s23 + s31 * s31)
                )
            )
    return disps, temps, nodal_vm


def _build_calculix_pyvista_grid(case_path: Path) -> Tuple[Optional[Any], Optional[Path]]:
    """Construct a real 3D PyVista UnstructuredGrid from CalculiX `.inp` + `.frd`/`.dat`."""
    pyvista = _require_pyvista()
    inp_files = sorted(case_path.glob("*.inp"))
    if not inp_files:
        return None, None
    inp_path = inp_files[0]
    node_coords, elem_conn = _parse_calculix_inp(inp_path)
    if not node_coords or not elem_conn:
        return None, None

    sorted_nids = sorted(node_coords.keys())
    nid_to_idx = {nid: idx for idx, nid in enumerate(sorted_nids)}
    points = np.asarray([node_coords[nid] for nid in sorted_nids], dtype=np.float64)

    # VTK cell type constants (VTK_TETRA=10, VTK_HEXAHEDRON=12, VTK_WEDGE=13, VTK_PYRAMID=14)
    cells_flat: List[int] = []
    cell_types: List[int] = []
    cell_eids: List[int] = []

    for eid, (etype, nids) in elem_conn.items():
        et = etype.upper()
        try:
            idxs = [nid_to_idx[n] for n in nids]
        except KeyError:
            continue
        if et.startswith("C3D4") and len(idxs) >= 4:
            cells_flat.extend([4, idxs[0], idxs[1], idxs[2], idxs[3]])
            cell_types.append(10)
            cell_eids.append(eid)
        elif et.startswith("C3D10") and len(idxs) >= 4:
            # Corner vertices form valid linear tetrahedron for smooth slicing/contouring
            cells_flat.extend([4, idxs[0], idxs[1], idxs[2], idxs[3]])
            cell_types.append(10)
            cell_eids.append(eid)
        elif et.startswith(("C3D8", "C3D20")) and len(idxs) >= 8:
            cells_flat.extend([8, *idxs[:8]])
            cell_types.append(12)
            cell_eids.append(eid)
        elif et.startswith(("C3D6", "C3D15")) and len(idxs) >= 6:
            cells_flat.extend([6, *idxs[:6]])
            cell_types.append(13)
            cell_eids.append(eid)
        elif et.startswith("C3D5") and len(idxs) >= 5:
            cells_flat.extend([5, *idxs[:5]])
            cell_types.append(14)
            cell_eids.append(eid)

    if not cell_types:
        return None, None

    grid = pyvista.UnstructuredGrid(
        np.asarray(cells_flat, dtype=np.int64),
        np.asarray(cell_types, dtype=np.uint8),
        points,
    )

    dat_files = sorted(case_path.glob("*.dat"))
    frd_files = sorted(case_path.glob("*.frd"))
    dat_disps, dat_temps, dat_elem_vm = _parse_calculix_dat_fields(dat_files[0]) if dat_files else ({}, {}, {})
    frd_disps, frd_temps, frd_nodal_vm = _parse_calculix_frd_fields(frd_files[0]) if frd_files else ({}, {}, {})

    disps = frd_disps or dat_disps
    temps = frd_temps or dat_temps

    if disps:
        disp_arr = np.zeros((len(sorted_nids), 3), dtype=np.float32)
        for nid, vec in disps.items():
            idx = nid_to_idx.get(nid)
            if idx is not None:
                disp_arr[idx] = vec
        grid.point_data["U"] = disp_arr
        grid.point_data["U_mag"] = np.linalg.norm(disp_arr, axis=1).astype(np.float32)

    if temps:
        t_arr = np.zeros((len(sorted_nids),), dtype=np.float32)
        for nid, tval in temps.items():
            idx = nid_to_idx.get(nid)
            if idx is not None:
                t_arr[idx] = tval
        grid.point_data["T"] = t_arr

    if frd_nodal_vm:
        vm_arr = np.zeros((len(sorted_nids),), dtype=np.float32)
        for nid, vm in frd_nodal_vm.items():
            idx = nid_to_idx.get(nid)
            if idx is not None:
                vm_arr[idx] = vm
        grid.point_data["von_mises"] = vm_arr
    elif dat_elem_vm:
        vm_cell = np.asarray([dat_elem_vm.get(eid, 0.0) for eid in cell_eids], dtype=np.float32)
        grid.cell_data["von_mises"] = vm_cell

    return grid, (frd_files[0] if frd_files else (dat_files[0] if dat_files else inp_path))


def _normalize_dataset_fields(dataset: Any) -> Any:
    """Convert cell data to point data (preserving cell data) and add exact vector magnitude scalars."""
    if hasattr(dataset, "combine") and dataset.__class__.__name__ == "MultiBlock":
        dataset = dataset.combine()

    if getattr(dataset, "n_cells", 0) > 0 and len(dataset.cell_data) > 0:
        try:
            dataset = dataset.cell_data_to_point_data(pass_cell_data=True)
        except Exception:
            pass

    # Add real Euclidean magnitude scalar for any 3-component point vector (e.g. U -> U_mag)
    for name in list(dataset.point_data.keys()):
        arr = dataset.point_data[name]
        if getattr(arr, "ndim", 1) == 2 and arr.shape[1] == 3:
            mag_name = f"{name}_mag"
            if mag_name not in dataset.point_data:
                dataset.point_data[mag_name] = np.linalg.norm(arr.astype(np.float64), axis=1).astype(np.float32)

    return dataset


def load_case_volume(case_dir: Union[str, Path]) -> Tuple[Any, Path]:
    """Load real 3D solver volumetric dataset from `case_dir` (OpenFOAM -> Elmer -> CalculiX)."""
    pyvista = _require_pyvista()
    case_path = Path(case_dir).resolve()
    if not case_path.is_dir():
        raise VolumetricDataUnavailableError(f"Case directory does not exist: {case_path}")

    # 1. OpenFOAM internal volume VTK (or invoke foamToVTK -latestTime once if solved time exists)
    of_vtk = _find_openfoam_volume_vtk(case_path)
    if of_vtk is None:
        of_vtk = _maybe_run_foam_to_vtk(case_path)
    if of_vtk is not None:
        ds = pyvista.read(str(of_vtk))
        ds = _normalize_dataset_fields(ds)
        if getattr(ds, "n_points", 0) > 0:
            return ds, of_vtk

    # 2. ElmerFEM or generic solver VTU output
    elmer_vtu = _find_elmer_vtu(case_path)
    if elmer_vtu is not None:
        ds = pyvista.read(str(elmer_vtu))
        ds = _normalize_dataset_fields(ds)
        if getattr(ds, "n_points", 0) > 0:
            return ds, elmer_vtu

    # 3. CalculiX (.inp + .frd / .dat)
    ccx_grid, ccx_src = _build_calculix_pyvista_grid(case_path)
    if ccx_grid is not None and ccx_src is not None:
        ccx_grid = _normalize_dataset_fields(ccx_grid)
        if getattr(ccx_grid, "n_points", 0) > 0:
            return ccx_grid, ccx_src

    raise VolumetricDataUnavailableError(
        "No real volumetric solver dataset (VTK/VTU or CalculiX .inp/.frd/.dat) found in case directory."
    )


# ---------------------------------------------------------------------------
# 4. Field Selection & Triangle Extraction Helpers
# ---------------------------------------------------------------------------
def _list_point_fields(dataset: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    scalars: List[Dict[str, Any]] = []
    vectors: List[Dict[str, Any]] = []
    for name in dataset.point_data.keys():
        arr = np.asarray(dataset.point_data[name])
        if arr.size == 0:
            continue
        if arr.ndim == 1:
            finite = arr[np.isfinite(arr)]
            if finite.size == 0:
                continue
            scalars.append({
                "name": str(name),
                "min": float(np.min(finite)),
                "max": float(np.max(finite)),
            })
        elif arr.ndim == 2 and arr.shape[1] == 3:
            mags = np.linalg.norm(arr.astype(np.float64), axis=1)
            finite = mags[np.isfinite(mags)]
            if finite.size == 0:
                continue
            vectors.append({
                "name": str(name),
                "components": 3,
                "mag_min": float(np.min(finite)),
                "mag_max": float(np.max(finite)),
            })
    return scalars, vectors


def _resolve_scalar_field(dataset: Any, field_name: Optional[str]) -> Tuple[Optional[str], Optional[Any]]:
    """Resolve a 1D scalar point array (or vector magnitude if user names a 3D vector field)."""
    if field_name:
        if field_name in dataset.point_data:
            arr = np.asarray(dataset.point_data[field_name])
            if arr.ndim == 1:
                return field_name, arr.astype(np.float32)
            if arr.ndim == 2 and arr.shape[1] == 3:
                return f"{field_name}_mag", np.linalg.norm(arr.astype(np.float64), axis=1).astype(np.float32)
        if f"{field_name}_mag" in dataset.point_data:
            arr = np.asarray(dataset.point_data[f"{field_name}_mag"])
            if arr.ndim == 1:
                return f"{field_name}_mag", arr.astype(np.float32)
        raise VolumetricDataUnavailableError(
            f"Requested scalar field '{field_name}' not found in dataset. "
            f"Available fields: {sorted(str(k) for k in dataset.point_data.keys())}"
        )

    preferred = ("U_mag", "p", "T", "von_mises", "temperature", "pressure", "k", "epsilon", "omega")
    for cand in preferred:
        if cand in dataset.point_data:
            arr = np.asarray(dataset.point_data[cand])
            if arr.ndim == 1 and arr.size == dataset.n_points:
                return cand, arr.astype(np.float32)

    for name in dataset.point_data.keys():
        arr = np.asarray(dataset.point_data[name])
        if arr.ndim == 1 and arr.size == dataset.n_points:
            return str(name), arr.astype(np.float32)
    return None, None


def _resolve_vector_field(dataset: Any, vector_field: Optional[str]) -> str:
    if vector_field:
        if vector_field in dataset.point_data:
            arr = np.asarray(dataset.point_data[vector_field])
            if arr.ndim == 2 and arr.shape[1] == 3:
                return vector_field
        raise VolumetricDataUnavailableError(
            f"Requested 3D vector field '{vector_field}' not found in dataset."
        )
    for cand in ("U", "velocity", "Velocity", "V", "displacement"):
        if cand in dataset.point_data:
            arr = np.asarray(dataset.point_data[cand])
            if arr.ndim == 2 and arr.shape[1] == 3:
                return cand
    for name in dataset.point_data.keys():
        arr = np.asarray(dataset.point_data[name])
        if arr.ndim == 2 and arr.shape[1] == 3:
            return str(name)
    raise VolumetricDataUnavailableError(
        "No 3D vector field (e.g. velocity 'U') is available in this dataset for streamline integration."
    )


def _extract_triangulated_indices(polydata: Any) -> Any:
    """Extract contiguous Uint32 triangle vertex index array `[i0, i1, i2, ...]` from triangulated PyVista PolyData."""
    faces = np.asarray(polydata.faces, dtype=np.int64)
    if faces.size == 0:
        return np.zeros((0,), dtype="<u4")
    # Fast path when all cells are triangles: faces is [3, i0, i1, i2, 3, ...]
    if faces.size % 4 == 0:
        reshaped = faces.reshape(-1, 4)
        if np.all(reshaped[:, 0] == 3):
            return np.ascontiguousarray(reshaped[:, 1:4].ravel(), dtype="<u4")

    # General fallback for mixed cell sizes
    tris: List[int] = []
    pos = 0
    total = faces.size
    while pos < total:
        n_verts = int(faces[pos])
        pos += 1
        if pos + n_verts > total:
            break
        if n_verts == 3:
            tris.extend((int(faces[pos]), int(faces[pos + 1]), int(faces[pos + 2])))
        elif n_verts > 3:
            v0 = int(faces[pos])
            for k in range(1, n_verts - 1):
                tris.extend((v0, int(faces[pos + k]), int(faces[pos + k + 1])))
        pos += n_verts
    return np.asarray(tris, dtype="<u4")


# ---------------------------------------------------------------------------
# 5. Public Headless Volumetric Post-Processing Operations
# ---------------------------------------------------------------------------
def get_case_volume_metadata(case_dir: Union[str, Path]) -> Dict[str, Any]:
    """Return physical bounds, cell/point counts, scalar/vector fields, and bad-cell coordinates."""
    dataset, source_file = load_case_volume(case_dir)
    scalars, vectors = _list_point_fields(dataset)
    bounds = [float(b) for b in dataset.bounds]
    bad_points = extract_bad_cell_points(case_dir)
    return {
        "available": True,
        "source_file": source_file.name,
        "bounds": bounds,
        "cell_count": int(dataset.n_cells),
        "point_count": int(dataset.n_points),
        "scalars": scalars,
        "vectors": vectors,
        "bad_cell_points": bad_points,
    }


def _extract_surface(dataset: Any) -> Any:
    """Extract outer surface using PyVista 0.49+ `algorithm='dataset_surface'` with legacy fallback."""
    try:
        return dataset.extract_surface(algorithm="dataset_surface")
    except TypeError:
        return dataset.extract_surface()


def export_case_surface_binary(
    case_dir: Union[str, Path],
    field_name: Optional[str] = None,
    max_triangles: int = MAX_SURFACE_TRIANGLES,
) -> bytes:
    """Extract triangulated outer surface mesh (up to 1M triangles) and pack into `NSR1` binary."""
    dataset, source_file = load_case_volume(case_dir)
    surface = _extract_surface(dataset).triangulate()
    if getattr(surface, "n_points", 0) == 0 or getattr(surface, "n_cells", 0) == 0:
        raise VolumetricDataUnavailableError("Extracted surface mesh contains zero triangles.")

    if surface.n_cells > max_triangles and hasattr(surface, "decimate"):
        reduction = max(0.0, min(0.95, 1.0 - (float(max_triangles) / float(surface.n_cells))))
        if reduction > 0.01:
            try:
                surface = surface.decimate(reduction).triangulate()
            except Exception:
                pass

    try:
        surface = surface.compute_normals(point_normals=True, cell_normals=False, inplace=False)
    except Exception:
        pass

    resolved_field, scalar_arr = _resolve_scalar_field(surface, field_name)
    points = np.ascontiguousarray(surface.points, dtype="<f4")
    indices = _extract_triangulated_indices(surface)
    normals = (
        np.ascontiguousarray(surface.point_data["Normals"], dtype="<f4")
        if "Normals" in surface.point_data
        else np.zeros((0, 3), dtype="<f4")
    )

    buffers: Dict[str, Any] = {
        "points": points,
        "indices": indices,
        "normals": normals,
    }
    s_min: Optional[float] = None
    s_max: Optional[float] = None
    if scalar_arr is not None:
        finite = scalar_arr[np.isfinite(scalar_arr)]
        if finite.size > 0:
            s_min = float(np.min(finite))
            s_max = float(np.max(finite))
        buffers["scalars"] = np.ascontiguousarray(scalar_arr, dtype="<f4")

    metadata = {
        "operation": "surface",
        "source_file": source_file.name,
        "field": resolved_field,
        "min": s_min,
        "max": s_max,
        "bounds": [float(b) for b in surface.bounds],
        "point_count": int(points.shape[0]),
        "triangle_count": int(indices.size // 3),
    }
    return pack_mesh_binary(metadata, buffers)


def compute_volumetric_slice(
    case_dir: Union[str, Path],
    axis: str,
    offset_ratio: float,
    field_name: Optional[str] = None,
) -> bytes:
    """Slice a real 3D volume mesh along an X/Y/Z cutting plane and pack triangulated geometry as `NSR1`."""
    axis_clean = str(axis or "").strip().lower()
    if axis_clean not in {"x", "y", "z"}:
        raise VolumetricDataUnavailableError(f"Invalid slice axis '{axis}'. Must be 'x', 'y', or 'z'.")
    if not isinstance(offset_ratio, (int, float)) or not math.isfinite(float(offset_ratio)):
        raise VolumetricDataUnavailableError("offset_ratio must be a finite number in [-0.98, 0.98].")
    ratio = max(-0.98, min(0.98, float(offset_ratio)))

    dataset, source_file = load_case_volume(case_dir)
    xmin, xmax, ymin, ymax, zmin, zmax = [float(b) for b in dataset.bounds]
    cx = 0.5 * (xmin + xmax)
    cy = 0.5 * (ymin + ymax)
    cz = 0.5 * (zmin + zmax)

    if axis_clean == "x":
        normal = [1.0, 0.0, 0.0]
        origin = [cx + 0.5 * (xmax - xmin) * ratio, cy, cz]
    elif axis_clean == "y":
        normal = [0.0, 1.0, 0.0]
        origin = [cx, cy + 0.5 * (ymax - ymin) * ratio, cz]
    else:
        normal = [0.0, 0.0, 1.0]
        origin = [cx, cy, cz + 0.5 * (zmax - zmin) * ratio]

    sliced = dataset.slice(normal=normal, origin=origin)
    if sliced is None or getattr(sliced, "n_points", 0) == 0 or getattr(sliced, "n_cells", 0) == 0:
        raise VolumetricDataUnavailableError(
            f"Volumetric slice at axis={axis_clean}, offset_ratio={ratio:.3f} intersected zero cells."
        )
    sliced = sliced.triangulate()
    resolved_field, scalar_arr = _resolve_scalar_field(sliced, field_name)
    points = np.ascontiguousarray(sliced.points, dtype="<f4")
    indices = _extract_triangulated_indices(sliced)

    buffers: Dict[str, Any] = {
        "points": points,
        "indices": indices,
    }
    s_min: Optional[float] = None
    s_max: Optional[float] = None
    if scalar_arr is not None:
        finite = scalar_arr[np.isfinite(scalar_arr)]
        if finite.size > 0:
            s_min = float(np.min(finite))
            s_max = float(np.max(finite))
        buffers["scalars"] = np.ascontiguousarray(scalar_arr, dtype="<f4")

    metadata = {
        "operation": "slice",
        "source_file": source_file.name,
        "axis": axis_clean,
        "offset_ratio": ratio,
        "origin": origin,
        "normal": normal,
        "field": resolved_field,
        "min": s_min,
        "max": s_max,
        "bounds": [float(b) for b in sliced.bounds],
        "point_count": int(points.shape[0]),
        "triangle_count": int(indices.size // 3),
    }
    return pack_mesh_binary(metadata, buffers)


def compute_volumetric_streamlines(
    case_dir: Union[str, Path],
    vector_field: Optional[str] = None,
    n_seeds: int = 80,
    seed_origin: Optional[Sequence[float]] = None,
    seed_radius: Optional[float] = None,
    max_time: Optional[float] = None,
) -> bytes:
    """Integrate true 3D RK4 streamlines from real solver velocity vectors and pack polylines as `NSR1`."""
    n_seeds_clamped = max(1, min(MAX_STREAMLINE_SEEDS, int(n_seeds)))
    dataset, source_file = load_case_volume(case_dir)
    vec_name = _resolve_vector_field(dataset, vector_field)

    xmin, xmax, ymin, ymax, zmin, zmax = [float(b) for b in dataset.bounds]
    dx = max(1e-9, xmax - xmin)
    dy = max(1e-9, ymax - ymin)
    dz = max(1e-9, zmax - zmin)
    diag = math.sqrt(dx * dx + dy * dy + dz * dz)

    if seed_origin is not None and len(seed_origin) == 3:
        center = [float(seed_origin[0]), float(seed_origin[1]), float(seed_origin[2])]
        fallback_center = [0.5 * (xmin + xmax), 0.5 * (ymin + ymax), 0.5 * (zmin + zmax)]
    else:
        # Inlet-biased seed sphere near xmin (falls back to domain center if zero lines intersect)
        center = [xmin + 0.12 * dx, 0.5 * (ymin + ymax), 0.5 * (zmin + zmax)]
        fallback_center = [0.5 * (xmin + xmax), 0.5 * (ymin + ymax), 0.5 * (zmin + zmax)]

    radius = (
        float(seed_radius)
        if seed_radius is not None and math.isfinite(float(seed_radius)) and float(seed_radius) > 0.0
        else max(1e-6, 0.35 * max(dy, dz, 0.2 * diag))
    )

    # Estimate sensible physical integration bound from real vector magnitude
    vec_arr = np.asarray(dataset.point_data[vec_name], dtype=np.float64)
    speeds = np.linalg.norm(vec_arr, axis=1)
    finite_speeds = speeds[np.isfinite(speeds)]
    if finite_speeds.size == 0 or float(np.max(finite_speeds)) <= 0.0:
        raise VolumetricDataUnavailableError(
            f"Vector field '{vec_name}' is identically zero; no physical streamlines exist."
        )
    mean_speed = max(float(np.mean(finite_speeds[finite_speeds > 0.0])), 1e-6)
    resolved_max_time = (
        float(max_time)
        if max_time is not None and math.isfinite(float(max_time)) and float(max_time) > 0.0
        else max(1e-3, (2.5 * diag) / mean_speed)
    )
    resolved_max_length = (
        max(1e-3, float(max_time) * mean_speed)
        if max_time is not None and math.isfinite(float(max_time)) and float(max_time) > 0.0
        else max(1e-3, 2.5 * diag)
    )

    def _trace(src_center: List[float]) -> Any:
        try:
            return dataset.streamlines(
                vectors=vec_name,
                source_center=src_center,
                source_radius=radius,
                n_points=n_seeds_clamped,
                integration_direction="both",
                max_length=resolved_max_length,
                integrator_type=4,
                max_steps=500,
            )
        except TypeError:
            return dataset.streamlines(
                vectors=vec_name,
                source_center=src_center,
                source_radius=radius,
                n_points=n_seeds_clamped,
                integration_direction="both",
                max_time=resolved_max_time,
                integrator_type=4,
                max_steps=500,
            )

    stream = _trace(center)
    if stream is None or getattr(stream, "n_points", 0) == 0 or getattr(stream, "n_cells", 0) == 0:
        if fallback_center != center:
            stream = _trace(fallback_center)
    if stream is None or getattr(stream, "n_points", 0) == 0 or getattr(stream, "n_cells", 0) == 0:
        raise VolumetricDataUnavailableError(
            f"RK4 streamline integrator produced zero trajectories for vector field '{vec_name}'."
        )

    raw_lines = np.asarray(stream.lines, dtype=np.int64)
    stream_pts = np.asarray(stream.points, dtype=np.float32)
    if vec_name in stream.point_data:
        stream_vecs = np.asarray(stream.point_data[vec_name], dtype=np.float64)
        stream_speeds = np.linalg.norm(stream_vecs, axis=1).astype(np.float32)
    elif f"{vec_name}_mag" in stream.point_data:
        stream_speeds = np.asarray(stream.point_data[f"{vec_name}_mag"], dtype=np.float32)
    else:
        stream_speeds = np.zeros((stream_pts.shape[0],), dtype=np.float32)

    packed_pts: List[Any] = []
    packed_speeds: List[Any] = []
    line_counts: List[int] = []

    pos = 0
    total = raw_lines.size
    while pos < total:
        n_v = int(raw_lines[pos])
        pos += 1
        if pos + n_v > total:
            break
        if n_v >= 2:
            v_ids = raw_lines[pos : pos + n_v]
            packed_pts.append(stream_pts[v_ids])
            packed_speeds.append(stream_speeds[v_ids])
            line_counts.append(n_v)
        pos += n_v

    if not line_counts:
        raise VolumetricDataUnavailableError(
            f"RK4 streamline integrator produced zero multi-point trajectories for '{vec_name}'."
        )

    flat_points = np.ascontiguousarray(np.vstack(packed_pts), dtype="<f4")
    flat_speeds = np.ascontiguousarray(np.concatenate(packed_speeds), dtype="<f4")
    counts_arr = np.asarray(line_counts, dtype="<u4")

    finite_out = flat_speeds[np.isfinite(flat_speeds)]
    s_min = float(np.min(finite_out)) if finite_out.size > 0 else 0.0
    s_max = float(np.max(finite_out)) if finite_out.size > 0 else 0.0

    metadata = {
        "operation": "streamlines",
        "source_file": source_file.name,
        "vector_field": vec_name,
        "seed_count": n_seeds_clamped,
        "streamline_count": int(counts_arr.size),
        "point_count": int(flat_points.shape[0]),
        "min": s_min,
        "max": s_max,
        "bounds": [float(b) for b in stream.bounds],
    }
    return pack_mesh_binary(
        metadata,
        {
            "line_counts": counts_arr,
            "points": flat_points,
            "speed_scalars": flat_speeds,
        },
    )


def compute_volumetric_isosurface(
    case_dir: Union[str, Path],
    field_name: str,
    iso_value: float,
) -> bytes:
    """Compute a real 3D Marching-Cubes/Tetrahedra iso-surface (`contour`) and pack as `NSR1`."""
    if not field_name or not isinstance(field_name, str):
        raise VolumetricDataUnavailableError("field_name must be a non-empty scalar field name.")
    if not isinstance(iso_value, (int, float)) or not math.isfinite(float(iso_value)):
        raise VolumetricDataUnavailableError("iso_value must be a finite numeric value.")
    target_val = float(iso_value)

    dataset, source_file = load_case_volume(case_dir)
    resolved_field, scalar_arr = _resolve_scalar_field(dataset, field_name)
    if resolved_field is None or scalar_arr is None:
        raise VolumetricDataUnavailableError(f"Scalar field '{field_name}' is unavailable for iso-surface extraction.")

    finite = scalar_arr[np.isfinite(scalar_arr)]
    f_min = float(np.min(finite)) if finite.size > 0 else 0.0
    f_max = float(np.max(finite)) if finite.size > 0 else 0.0

    # Ensure scalar array is explicitly attached under resolved_field before contouring
    if resolved_field not in dataset.point_data:
        dataset.point_data[resolved_field] = scalar_arr

    contour = dataset.contour(isosurfaces=[target_val], scalars=resolved_field)
    if contour is None or getattr(contour, "n_points", 0) == 0 or getattr(contour, "n_cells", 0) == 0:
        raise VolumetricDataUnavailableError(
            f"Iso-surface at {resolved_field}={target_val:.6g} produced empty geometry "
            f"(real field range is [{f_min:.6g}, {f_max:.6g}])."
        )
    contour = contour.triangulate()
    try:
        contour = contour.compute_normals(point_normals=True, cell_normals=False, inplace=False)
    except Exception:
        pass

    points = np.ascontiguousarray(contour.points, dtype="<f4")
    indices = _extract_triangulated_indices(contour)
    normals = (
        np.ascontiguousarray(contour.point_data["Normals"], dtype="<f4")
        if "Normals" in contour.point_data
        else np.zeros((0, 3), dtype="<f4")
    )

    metadata = {
        "operation": "isosurface",
        "source_file": source_file.name,
        "field": resolved_field,
        "iso_value": target_val,
        "field_min": f_min,
        "field_max": f_max,
        "bounds": [float(b) for b in contour.bounds],
        "point_count": int(points.shape[0]),
        "triangle_count": int(indices.size // 3),
    }
    return pack_mesh_binary(
        metadata,
        {
            "points": points,
            "indices": indices,
            "normals": normals,
        },
    )
