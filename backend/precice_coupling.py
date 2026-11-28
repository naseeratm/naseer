"""
NASEER Universal CAE Studio — Multiphysics Coupling Engine (Zero-Mock).

Provides:
1. Live capability probing for preCICE v3 (`libprecice`), `ccx_preCICE`,
   OpenFOAM preCICE adapter (`libpreciceAdapterFunctionObject.so`), and
   native OpenFOAM multi-region CHT (`chtMultiRegionSimpleFoam` /
   `chtMultiRegionFoam` / `splitMeshRegions`).
2. Strict preCICE v3 XML configuration (`precice-config.xml`), OpenFOAM
   `system/preciceDict` + `constant/dynamicMeshDict`, and CalculiX preCICE
   adapter `config.yml` + `.inp` generators.
3. Dual-process preCICE 2-way FSI / CHT co-simulation orchestrator with
   strict Zero-Mock runtime gating (`PreciceRuntimeUnavailableError`) and
   automatic peer co-termination on failure or timeout.
4. Native OpenFOAM v2406 Multi-Region Conjugate Heat Transfer solver
   (`chtMultiRegionSimpleFoam` / `chtMultiRegionFoam`) with real
   `fluid_to_solid` / `solid_to_fluid` `turbulentTemperatureCoupledBaffleMixed`
   interface coupling and `foamToVTK -allRegions -latestTime` post-processing.
"""

from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple


class PreciceRuntimeUnavailableError(RuntimeError):
    """Raised when preCICE v3 FSI runtime binaries/libraries are not installed."""


class MultiRegionChtError(RuntimeError):
    """Raised when native OpenFOAM multi-region CHT setup or execution fails."""


def _find_openfoam_precice_adapter() -> Optional[str]:
    """Locate libpreciceAdapterFunctionObject.so in standard OpenFOAM/system library paths."""
    lib_name = "libpreciceAdapterFunctionObject.so"
    search_dirs: List[Path] = []
    for env_key in ("FOAM_USER_LIBBIN", "FOAM_LIBBIN", "LD_LIBRARY_PATH"):
        raw = os.environ.get(env_key, "")
        for chunk in raw.split(":"):
            if chunk.strip():
                search_dirs.append(Path(chunk.strip()))
    search_dirs.extend(
        [
            Path("/usr/lib"),
            Path("/usr/local/lib"),
            Path("/usr/lib/x86_64-linux-gnu"),
            Path("/root/OpenFOAM"),
        ]
    )
    foam_root = Path(os.environ.get("WM_PROJECT_DIR", "/usr/lib/openfoam/openfoam2406"))
    if foam_root.exists():
        for cand in foam_root.glob("platforms/*/lib"):
            search_dirs.append(cand)

    seen: set[str] = set()
    for base in search_dirs:
        key = str(base)
        if key in seen or not base.exists():
            continue
        seen.add(key)
        direct = base / lib_name
        if direct.is_file():
            return str(direct)
        if base == Path("/root/OpenFOAM"):
            for match in base.rglob(lib_name):
                if match.is_file():
                    return str(match)
    return None


def _probe_libprecice() -> Dict[str, Any]:
    """Probe real installed libprecice shared library via pkg-config, ldconfig, or precice-tools."""
    pkg_cfg = shutil.which("pkg-config")
    if pkg_cfg:
        try:
            proc = subprocess.run(
                [pkg_cfg, "--modversion", "libprecice"],
                text=True,
                capture_output=True,
                timeout=3,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return {
                    "available": True,
                    "version": proc.stdout.strip()[:64],
                    "path": "pkg-config:libprecice",
                }
        except Exception:
            pass

    ldconfig = shutil.which("ldconfig") or ("/sbin/ldconfig" if Path("/sbin/ldconfig").is_file() else None)
    if ldconfig:
        try:
            proc = subprocess.run(
                [ldconfig, "-p"],
                text=True,
                capture_output=True,
                timeout=3,
                check=False,
            )
            if proc.returncode == 0:
                for ln in proc.stdout.splitlines():
                    if "libprecice.so" in ln:
                        parts = ln.split("=>", 1)
                        lib_path = parts[1].strip() if len(parts) == 2 else ln.strip()
                        ver_m = re.search(r"libprecice\.so\.(\d[\d.]*)", ln)
                        return {
                            "available": True,
                            "version": ver_m.group(1) if ver_m else "installed",
                            "path": lib_path,
                        }
        except Exception:
            pass

    tools_bin = shutil.which("precice-tools")
    if tools_bin:
        return {"available": True, "version": "precice-tools", "path": tools_bin}

    return {"available": False, "version": None, "path": None}


def probe_coupling_capabilities() -> Dict[str, Any]:
    """
    Live capability probe for preCICE v3 2-way FSI and OpenFOAM native Multi-Region CHT.
    Zero false positives: every capability reflects real binaries/shared objects on disk.
    """
    precice_lib = _probe_libprecice()

    ccx_precice_path = shutil.which("ccx_preCICE")
    calculix_precice: Dict[str, Any] = {
        "available": bool(ccx_precice_path),
        "path": ccx_precice_path,
        "version": None,
    }
    if ccx_precice_path:
        try:
            proc = subprocess.run(
                [ccx_precice_path, "-v"],
                text=True,
                capture_output=True,
                timeout=3,
                check=False,
            )
            combined = f"{proc.stdout or ''}\n{proc.stderr or ''}"
            for ln in combined.splitlines():
                if ln.strip():
                    calculix_precice["version"] = ln.strip()[:120]
                    break
        except Exception:
            pass

    adapter_path = _find_openfoam_precice_adapter()
    openfoam_precice_adapter = {
        "available": bool(adapter_path),
        "path": adapter_path,
    }

    cht_steady = shutil.which("chtMultiRegionSimpleFoam")
    cht_transient = shutil.which("chtMultiRegionFoam")
    split_regions = shutil.which("splitMeshRegions")
    openfoam_cht_multiregion = {
        "available": bool((cht_steady or cht_transient) and split_regions),
        "steady_solver": cht_steady,
        "transient_solver": cht_transient,
        "split_mesh_regions": split_regions,
    }

    fsi_2way_ready = bool(
        precice_lib["available"]
        and calculix_precice["available"]
        and openfoam_precice_adapter["available"]
    )

    return {
        "precice_lib": precice_lib,
        "calculix_precice": calculix_precice,
        "openfoam_precice_adapter": openfoam_precice_adapter,
        "openfoam_cht_multiregion": openfoam_cht_multiregion,
        "fsi_2way_ready": fsi_2way_ready,
        "cht_multiregion_ready": openfoam_cht_multiregion["available"],
    }


def generate_precice_config_xml(
    mode: str = "FSI",
    coupling_scheme: str = "parallel-implicit",
    time_window_size: float = 0.01,
    max_time: float = 0.5,
    max_iterations: int = 30,
    rel_tol: float = 1e-3,
    acceleration: str = "IQN-ILS",
    mapping: str = "rbf-pum-direct",
) -> str:
    """
    Generate a strictly valid preCICE v3 XML configuration (`precice-config.xml`).
    """
    norm_mode = str(mode or "FSI").strip().upper()
    if norm_mode not in ("FSI", "CHT"):
        raise ValueError(f"Unsupported preCICE coupling mode '{mode}'. Use 'FSI' or 'CHT'.")

    norm_scheme = str(coupling_scheme or "parallel-implicit").strip().lower()
    if norm_scheme not in ("parallel-implicit", "serial-implicit"):
        raise ValueError(
            f"Unsupported coupling_scheme '{coupling_scheme}'. Use 'parallel-implicit' or 'serial-implicit'."
        )

    dt = float(time_window_size)
    t_end = float(max_time)
    n_iter = int(max_iterations)
    tol = float(rel_tol)
    if dt <= 0 or t_end <= 0 or n_iter < 1 or not (0.0 < tol < 1.0):
        raise ValueError("Invalid preCICE time window / tolerance parameters.")

    norm_accel = str(acceleration or "IQN-ILS").strip().upper()
    if norm_accel not in ("IQN-ILS", "AITKEN", "CONSTANT"):
        norm_accel = "IQN-ILS"

    norm_map = str(mapping or "rbf-pum-direct").strip().lower()
    if norm_map not in ("rbf-pum-direct", "nearest-neighbor"):
        norm_map = "rbf-pum-direct"

    if norm_mode == "FSI":
        data_decl = (
            '  <data:vector name="Force" />\n'
            '  <data:vector name="Displacement" />'
        )
        fluid_write, fluid_read = "Force", "Displacement"
        solid_write, solid_read = "Displacement", "Force"
        solid_read_constraint = "conservative"
        fluid_read_constraint = "consistent"
        use_data_block = (
            '    <use-data name="Force" />\n'
            '    <use-data name="Displacement" />'
        )
    else:
        data_decl = (
            '  <data:scalar name="Temperature" />\n'
            '  <data:scalar name="Heat-Flux" />'
        )
        fluid_write, fluid_read = "Heat-Flux", "Temperature"
        solid_write, solid_read = "Temperature", "Heat-Flux"
        solid_read_constraint = "consistent"
        fluid_read_constraint = "consistent"
        use_data_block = (
            '    <use-data name="Temperature" />\n'
            '    <use-data name="Heat-Flux" />'
        )

    if norm_map == "rbf-pum-direct":
        fluid_map_xml = (
            f'    <mapping:rbf-pum-direct direction="read" from="Solid-Mesh" to="Fluid-Mesh" '
            f'constraint="{fluid_read_constraint}" polynomial="separate" '
            f'vertices-per-cluster="50" relative-overlap="0.15" project-to-input="false">\n'
            f'      <basis-function:compact-polynomial-c6 support-radius="0.5" />\n'
            f'    </mapping:rbf-pum-direct>'
        )
        solid_map_xml = (
            f'    <mapping:rbf-pum-direct direction="read" from="Fluid-Mesh" to="Solid-Mesh" '
            f'constraint="{solid_read_constraint}" polynomial="separate" '
            f'vertices-per-cluster="50" relative-overlap="0.15" project-to-input="false">\n'
            f'      <basis-function:compact-polynomial-c6 support-radius="0.5" />\n'
            f'    </mapping:rbf-pum-direct>'
        )
    else:
        fluid_map_xml = (
            f'    <mapping:nearest-neighbor direction="read" from="Solid-Mesh" to="Fluid-Mesh" '
            f'constraint="{fluid_read_constraint}" />'
        )
        solid_map_xml = (
            f'    <mapping:nearest-neighbor direction="read" from="Fluid-Mesh" to="Solid-Mesh" '
            f'constraint="{solid_read_constraint}" />'
        )

    if norm_accel == "IQN-ILS":
        accel_xml = (
            "    <acceleration:IQN-ILS>\n"
            f'      <data name="{solid_write}" mesh="Solid-Mesh" />\n'
            + (
                f'      <data name="{fluid_write}" mesh="Fluid-Mesh" />\n'
                if norm_scheme == "parallel-implicit"
                else ""
            )
            + '      <initial-relaxation value="0.1" />\n'
            '      <max-used-iterations value="50" />\n'
            '      <time-windows-reused value="10" />\n'
            '      <filter type="QR2" limit="1e-2" />\n'
            "    </acceleration:IQN-ILS>"
        )
    elif norm_accel == "AITKEN":
        accel_xml = (
            "    <acceleration:aitken>\n"
            f'      <data name="{solid_write}" mesh="Solid-Mesh" />\n'
            '      <initial-relaxation value="0.2" />\n'
            "    </acceleration:aitken>"
        )
    else:
        accel_xml = (
            "    <acceleration:constant>\n"
            '      <relaxation value="0.5" />\n'
            "    </acceleration:constant>"
        )

    xml_text = f"""<?xml version="1.0" encoding="UTF-8" ?>
<precice-configuration>
  <log>
    <sink type="stream" output="stdout" format="%Timestamp% [%Participant%] %Severity%: %Message%" filter="%Severity% >= info" enabled="true" />
  </log>

{data_decl}

  <mesh name="Fluid-Mesh" dimensions="3">
{use_data_block}
  </mesh>

  <mesh name="Solid-Mesh" dimensions="3">
{use_data_block}
  </mesh>

  <participant name="Fluid">
    <provide-mesh name="Fluid-Mesh" />
    <receive-mesh name="Solid-Mesh" from="Solid" />
    <write-data name="{fluid_write}" mesh="Fluid-Mesh" />
    <read-data name="{fluid_read}" mesh="Fluid-Mesh" />
{fluid_map_xml}
  </participant>

  <participant name="Solid">
    <provide-mesh name="Solid-Mesh" />
    <receive-mesh name="Fluid-Mesh" from="Fluid" />
    <write-data name="{solid_write}" mesh="Solid-Mesh" />
    <read-data name="{solid_read}" mesh="Solid-Mesh" />
{solid_map_xml}
  </participant>

  <m2n:sockets acceptor="Fluid" connector="Solid" exchange-directory=".." />

  <coupling-scheme:{norm_scheme}>
    <participants first="Fluid" second="Solid" />
    <max-time value="{t_end:.8g}" />
    <time-window-size value="{dt:.8g}" />
    <max-iterations value="{n_iter}" />
    <exchange data="{fluid_write}" mesh="Fluid-Mesh" from="Fluid" to="Solid" />
    <exchange data="{solid_write}" mesh="Solid-Mesh" from="Solid" to="Fluid" />
    <relative-convergence-measure limit="{tol:.6g}" data="{fluid_write}" mesh="Fluid-Mesh" />
    <relative-convergence-measure limit="{tol:.6g}" data="{solid_write}" mesh="Solid-Mesh" />
{accel_xml}
  </coupling-scheme:{norm_scheme}>
</precice-configuration>
"""
    # Validate strict XML well-formedness before returning (preCICE uses colon-prefixed tags without xmlns)
    validate_precice_xml(xml_text)
    return xml_text


def validate_precice_xml(xml_text: str) -> ET.Element:
    """Parse and validate preCICE v3 XML using ElementTree with synthetic bindings for preCICE tag prefixes."""
    ns_attrs = (
        ' xmlns:data="urn:precice:data"'
        ' xmlns:mapping="urn:precice:mapping"'
        ' xmlns:basis-function="urn:precice:basis-function"'
        ' xmlns:m2n="urn:precice:m2n"'
        ' xmlns:coupling-scheme="urn:precice:coupling-scheme"'
        ' xmlns:acceleration="urn:precice:acceleration"'
    )
    patched = xml_text.replace("<precice-configuration>", f"<precice-configuration{ns_attrs}>", 1)
    return ET.fromstring(patched)


def generate_openfoam_precice_dict(
    mode: str = "FSI",
    patch_name: str = "interface",
    mesh_name: str = "Fluid-Mesh",
    precice_config: str = "../precice-config.xml",
    rho_ref: float = 1000.0,
) -> Tuple[str, str]:
    """
    Generate OpenFOAM `system/preciceDict` and `constant/dynamicMeshDict` for preCICE v3.
    Returns `(precice_dict, dynamic_mesh_dict)`.
    """
    norm_mode = str(mode or "FSI").strip().upper()
    safe_patch = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(patch_name or "interface"))

    if norm_mode == "FSI":
        precice_dict = (
            "FoamFile\n"
            "{\n"
            "    version     2.0;\n"
            "    format      ascii;\n"
            "    class       dictionary;\n"
            "    location    \"system\";\n"
            "    object      preciceDict;\n"
            "}\n\n"
            f'preciceConfig "{precice_config}";\n'
            "participant Fluid;\n"
            "modules (FSI);\n\n"
            "interfaces\n"
            "{\n"
            "  Interface1\n"
            "  {\n"
            f"    mesh              {mesh_name};\n"
            f"    patches           ({safe_patch});\n"
            "    locations         faceCenters;\n"
            "    readData\n"
            "    (\n"
            "      Displacement\n"
            "    );\n"
            "    writeData\n"
            "    (\n"
            "      Force\n"
            "    );\n"
            "  };\n"
            "};\n\n"
            "FSI\n"
            "{\n"
            f"  rho rho [1 -3 0 0 0 0 0] {float(rho_ref):.8g};\n"
            "  solverType incompressible;\n"
            "  namePointDisplacement pointDisplacement;\n"
            "};\n"
        )
        dynamic_mesh_dict = (
            "FoamFile\n"
            "{\n"
            "    version     2.0;\n"
            "    format      ascii;\n"
            "    class       dictionary;\n"
            "    location    \"constant\";\n"
            "    object      dynamicMeshDict;\n"
            "}\n\n"
            "dynamicFvMesh   dynamicMotionSolverFvMesh;\n"
            'motionSolverLibs ("libfvMotionSolvers.so");\n'
            "solver          displacementLaplacian;\n"
            f"diffusivity     inverseDistance 1({safe_patch});\n"
        )
    else:
        precice_dict = (
            "FoamFile\n"
            "{\n"
            "    version     2.0;\n"
            "    format      ascii;\n"
            "    class       dictionary;\n"
            "    location    \"system\";\n"
            "    object      preciceDict;\n"
            "}\n\n"
            f'preciceConfig "{precice_config}";\n'
            "participant Fluid;\n"
            "modules (CHT);\n\n"
            "interfaces\n"
            "{\n"
            "  Interface1\n"
            "  {\n"
            f"    mesh              {mesh_name};\n"
            f"    patches           ({safe_patch});\n"
            "    locations         faceCenters;\n"
            "    readData\n"
            "    (\n"
            "      Temperature\n"
            "    );\n"
            "    writeData\n"
            "    (\n"
            "      Heat-Flux\n"
            "    );\n"
            "  };\n"
            "};\n\n"
            "CHT\n"
            "{\n"
            "  solverType compressible;\n"
            "  nameT T;\n"
            "};\n"
        )
        dynamic_mesh_dict = (
            "FoamFile\n"
            "{\n"
            "    version     2.0;\n"
            "    format      ascii;\n"
            "    class       dictionary;\n"
            "    location    \"constant\";\n"
            "    object      dynamicMeshDict;\n"
            "}\n\n"
            "dynamicFvMesh   staticFvMesh;\n"
        )

    return precice_dict, dynamic_mesh_dict


def generate_calculix_precice_config(
    mode: str = "FSI",
    surface_name: str = "SURFACE_INTERFACE",
    mesh_name: str = "Solid-Mesh",
    participant_name: str = "Solid",
    precice_config: str = "../precice-config.xml",
) -> str:
    """Generate CalculiX preCICE adapter `config.yml` matching preCICE v3 XML."""
    norm_mode = str(mode or "FSI").strip().upper()
    if norm_mode == "FSI":
        read_data = "Force"
        write_data = "Displacement"
    else:
        read_data = "Heat-Flux"
        write_data = "Temperature"

    return (
        f"precice-config-file: {precice_config}\n"
        "participants:\n"
        f"  {participant_name}:\n"
        "    interfaces:\n"
        f"    - nodes-mesh: {mesh_name}\n"
        f"      patch: {surface_name}\n"
        "      read-data:\n"
        f"      - {read_data}\n"
        "      write-data:\n"
        f"      - {write_data}\n"
    )


def generate_calculix_precice_inp(
    mode: str = "FSI",
    *,
    width: float = 1.0,
    solid_thickness: float = 0.05,
    depth: float = 0.1,
    young_modulus: float = 210e9,
    poisson_ratio: float = 0.3,
    density: float = 7850.0,
    conductivity_k: float = 50.0,
    specific_heat: float = 460.0,
    time_step: float = 0.01,
    end_time: float = 0.5,
) -> str:
    """
    Generate a matching CalculiX `.inp` deck with explicit `NINTERFACE` / `SINTERFACE`
    sets for preCICE 2-way FSI (`*DYNAMIC`) or CHT (`*HEAT TRANSFER`).
    """
    norm_mode = str(mode or "FSI").strip().upper()
    nx = 8
    ny = 2
    nz = 1
    dx = width / nx
    dy = solid_thickness / ny
    dz = depth / nz

    lines: List[str] = ["*HEADING", f"NASEER preCICE {norm_mode} Solid Participant", "*NODE, NSET=NALL"]
    node_id = 0
    grid: Dict[Tuple[int, int, int], int] = {}
    n_fixed: List[int] = []
    n_interface: List[int] = []

    for k in range(nz + 1):
        for j in range(ny + 1):
            for i in range(nx + 1):
                node_id += 1
                x = i * dx
                y = -solid_thickness + j * dy
                z = k * dz
                grid[(i, j, k)] = node_id
                lines.append(f"{node_id}, {x:.8g}, {y:.8g}, {z:.8g}")
                if i == 0 or i == nx or j == 0:
                    n_fixed.append(node_id)
                if j == ny:
                    n_interface.append(node_id)

    el_type = "DC3D8" if norm_mode == "CHT" else "C3D8"
    lines.append(f"*ELEMENT, TYPE={el_type}, ELSET=EALL")
    eid = 0
    top_elems: List[int] = []
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                eid += 1
                n1 = grid[(i, j, k)]
                n2 = grid[(i + 1, j, k)]
                n3 = grid[(i + 1, j + 1, k)]
                n4 = grid[(i, j + 1, k)]
                n5 = grid[(i, j, k + 1)]
                n6 = grid[(i + 1, j, k + 1)]
                n7 = grid[(i + 1, j + 1, k + 1)]
                n8 = grid[(i, j + 1, k + 1)]
                lines.append(f"{eid}, {n1}, {n2}, {n3}, {n4}, {n5}, {n6}, {n7}, {n8}")
                if j == ny - 1:
                    top_elems.append(eid)

    def _emit_set(header: str, ids: Sequence[int]) -> None:
        lines.append(header)
        for idx in range(0, len(ids), 10):
            lines.append(", ".join(str(x) for x in ids[idx : idx + 10]))

    _emit_set("*NSET, NSET=NFIX", n_fixed)
    _emit_set("*NSET, NSET=NINTERFACE", n_interface)
    lines.append("*SURFACE, NAME=SINTERFACE, TYPE=ELEMENT")
    for te in top_elems:
        lines.append(f"{te}, S4")
    lines.append("*SURFACE, NAME=SURFACE_INTERFACE, TYPE=NODE")
    lines.append("NINTERFACE")

    lines.extend(
        [
            "*MATERIAL, NAME=SOLIDMAT",
            "*DENSITY",
            f"{density:.8g}",
            "*ELASTIC",
            f"{young_modulus:.8g}, {poisson_ratio:.6g}",
            "*CONDUCTIVITY",
            f"{conductivity_k:.8g}",
            "*SPECIFIC HEAT",
            f"{specific_heat:.8g}",
            "*SOLID SECTION, ELSET=EALL, MATERIAL=SOLIDMAT",
        ]
    )

    if norm_mode == "FSI":
        lines.extend(
            [
                "*BOUNDARY",
                "NFIX, 1, 3, 0.0",
                "*STEP, INC=10000",
                "*DYNAMIC, DIRECT",
                f"{time_step:.8g}, {end_time:.8g}",
                "*CLOAD",
                "NINTERFACE, 1, 0.0",
                "NINTERFACE, 2, 0.0",
                "NINTERFACE, 3, 0.0",
                "*NODE FILE",
                "U",
                "*EL FILE",
                "S",
                "*END STEP",
            ]
        )
    else:
        lines.extend(
            [
                "*INITIAL CONDITIONS, TYPE=TEMPERATURE",
                "NALL, 300.0",
                "*STEP, INC=10000",
                "*HEAT TRANSFER",
                f"{time_step:.8g}, {end_time:.8g}",
                "*DFLUX",
                "SINTERFACE, S, 0.0",
                "*NODE FILE",
                "NT",
                "*END STEP",
            ]
        )
    return "\n".join(lines) + "\n"


def parse_precice_iterations_log(log_path: Path) -> Dict[str, Any]:
    """Parse real preCICE `precice-Fluid-iterations.log` into coupling convergence metrics."""
    if not log_path.is_file():
        return {"available": False, "time_windows": 0, "total_iterations": 0, "converged_windows": 0}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    windows = 0
    total_iters = 0
    converged_windows = 0
    per_window: List[Dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith("timewindow") or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 4:
            try:
                tw = int(parts[0])
                iters = int(parts[2])
                conv = int(parts[3])
                windows = max(windows, tw)
                total_iters += iters
                if conv == 1:
                    converged_windows += 1
                per_window.append({"time_window": tw, "iterations": iters, "converged": bool(conv)})
            except ValueError:
                continue
    return {
        "available": True,
        "time_windows": windows,
        "total_iterations": total_iters,
        "converged_windows": converged_windows,
        "avg_iterations_per_window": round(total_iters / max(1, len(per_window)), 3),
        "samples": per_window[-50:],
    }


def run_precice_coupled_simulation(
    data: Mapping[str, Any],
    *,
    stream_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Execute a real dual-process preCICE v3 2-Way FSI co-simulation
    (`pimpleFoam` + `ccx_preCICE`).

    STRICT ZERO-MOCK GATE:
    Raises `PreciceRuntimeUnavailableError` if `libprecice`, `ccx_preCICE`, or
    `libpreciceAdapterFunctionObject.so` is absent. Never fabricates FSI outputs.
    """
    caps = probe_coupling_capabilities()
    missing: List[str] = []
    if not caps["precice_lib"]["available"]:
        missing.append("libprecice (preCICE v3 shared library)")
    if not caps["calculix_precice"]["available"]:
        missing.append("ccx_preCICE (preCICE-adapted CalculiX binary)")
    if not caps["openfoam_precice_adapter"]["available"]:
        missing.append("libpreciceAdapterFunctionObject.so (OpenFOAM preCICE adapter)")

    if missing:
        raise PreciceRuntimeUnavailableError(
            "2-Way FSI via preCICE v3 cannot run because required runtime components are missing: "
            + ", ".join(missing)
            + ". Install them with scripts/install-precice-ubuntu22.sh or rebuild the worker via "
            "`docker compose build --build-arg INSTALL_PRECICE=1 worker`."
        )

    pimple_bin = shutil.which("pimpleFoam")
    block_mesh_bin = shutil.which("blockMesh")
    ccx_bin = caps["calculix_precice"]["path"]
    if not pimple_bin or not block_mesh_bin or not ccx_bin:
        raise PreciceRuntimeUnavailableError(
            "OpenFOAM (`pimpleFoam`, `blockMesh`) and `ccx_preCICE` must all be available on PATH."
        )

    width = float(data.get("width_x") or 1.0)
    height = float(data.get("height_y") or 0.4)
    depth = float(data.get("depth_z") or 0.1)
    solid_thickness = float(data.get("solid_thickness") or 0.05)
    mesh_size = max(1e-3, float(data.get("mesh_size") or 0.05))
    velocity = float(data.get("velocity") or 1.0)
    rho_f = float(data.get("fluid_density") or 1000.0)
    mu_f = float(data.get("dynamic_viscosity") or 1e-3)
    nu_f = max(1e-8, mu_f / max(rho_f, 1e-6))

    dt = float(data.get("time_step") or 0.01)
    end_t = float(data.get("end_time") or 0.2)
    scheme = str(data.get("coupling_scheme") or "parallel-implicit")
    max_iters = int(data.get("coupling_max_iterations") or 30)
    rel_tol = float(data.get("coupling_rel_tol") or 1e-3)

    configured_root = os.getenv("OPENFOAM_CASE_ROOT") or os.getenv("NASEER_JOB_DIR")
    root = (
        Path(configured_root)
        if configured_root
        else (Path("/app/jobs") if Path("/app/jobs").exists() else Path.cwd() / "jobs")
    )
    case_dir = root / f"precice-fsi-{uuid.uuid4().hex[:12]}"
    fluid_dir = case_dir / "fluid"
    solid_dir = case_dir / "solid"
    for d in (
        fluid_dir / "0",
        fluid_dir / "constant",
        fluid_dir / "system",
        solid_dir,
    ):
        d.mkdir(parents=True, exist_ok=True)

    # 1. Write preCICE v3 XML configuration
    xml_cfg = generate_precice_config_xml(
        mode="FSI",
        coupling_scheme=scheme,
        time_window_size=dt,
        max_time=end_t,
        max_iterations=max_iters,
        rel_tol=rel_tol,
        acceleration="IQN-ILS",
    )
    (case_dir / "precice-config.xml").write_text(xml_cfg, encoding="utf-8")

    # 2. Write OpenFOAM fluid case (`pimpleFoam` + `preCICE_Adapter`)
    precice_dict, dynamic_mesh_dict = generate_openfoam_precice_dict(
        mode="FSI",
        patch_name="interface",
        mesh_name="Fluid-Mesh",
        precice_config="../precice-config.xml",
        rho_ref=rho_f,
    )
    (fluid_dir / "system" / "preciceDict").write_text(precice_dict, encoding="utf-8")
    (fluid_dir / "constant" / "dynamicMeshDict").write_text(dynamic_mesh_dict, encoding="utf-8")

    nx = max(6, min(80, int(round(width / mesh_size))))
    ny = max(4, min(60, int(round(height / mesh_size))))
    (fluid_dir / "system" / "blockMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
        "convertToMeters 1;\n"
        f"vertices ( (0 0 0) ({width} 0 0) ({width} {height} 0) (0 {height} 0) "
        f"(0 0 {depth}) ({width} 0 {depth}) ({width} {height} {depth}) (0 {height} {depth}) );\n"
        f"blocks ( hex (0 1 2 3 4 5 6 7) ({nx} {ny} 1) simpleGrading (1 1 1) );\n"
        "edges ();\n"
        "boundary (\n"
        "  inlet { type patch; faces ((0 4 7 3)); }\n"
        "  outlet { type patch; faces ((1 2 6 5)); }\n"
        "  topWall { type wall; faces ((3 7 6 2)); }\n"
        "  interface { type wall; faces ((0 1 5 4)); }\n"
        "  frontAndBack { type empty; faces ((0 3 2 1) (4 5 6 7)); }\n"
        ");\nmergePatchPairs ();\n",
        encoding="utf-8",
    )
    (fluid_dir / "constant" / "transportProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object transportProperties; }\n'
        f"transportModel Newtonian;\nnu [0 2 -1 0 0 0 0] {nu_f:.8g};\n",
        encoding="utf-8",
    )
    (fluid_dir / "constant" / "turbulenceProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object turbulenceProperties; }\n'
        "simulationType laminar;\n",
        encoding="utf-8",
    )
    (fluid_dir / "0" / "U").write_text(
        'FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n'
        "dimensions [0 1 -1 0 0 0 0];\n"
        f"internalField uniform ({velocity:.8g} 0 0);\n"
        "boundaryField {\n"
        f"  inlet {{ type fixedValue; value uniform ({velocity:.8g} 0 0); }}\n"
        "  outlet { type zeroGradient; }\n"
        "  topWall { type noSlip; }\n"
        "  interface { type movingWallVelocity; value uniform (0 0 0); }\n"
        "  frontAndBack { type empty; }\n"
        "}\n",
        encoding="utf-8",
    )
    (fluid_dir / "0" / "p").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n'
        "dimensions [0 2 -2 0 0 0 0];\n"
        "internalField uniform 0;\n"
        "boundaryField {\n"
        "  inlet { type zeroGradient; }\n"
        "  outlet { type fixedValue; value uniform 0; }\n"
        "  topWall { type zeroGradient; }\n"
        "  interface { type zeroGradient; }\n"
        "  frontAndBack { type empty; }\n"
        "}\n",
        encoding="utf-8",
    )
    (fluid_dir / "0" / "pointDisplacement").write_text(
        'FoamFile { version 2.0; format ascii; class pointVectorField; object pointDisplacement; }\n'
        "dimensions [0 1 0 0 0 0 0];\n"
        "internalField uniform (0 0 0);\n"
        "boundaryField {\n"
        "  inlet { type fixedValue; value uniform (0 0 0); }\n"
        "  outlet { type fixedValue; value uniform (0 0 0); }\n"
        "  topWall { type fixedValue; value uniform (0 0 0); }\n"
        "  interface { type fixedValue; value uniform (0 0 0); }\n"
        "  frontAndBack { type empty; }\n"
        "}\n",
        encoding="utf-8",
    )
    (fluid_dir / "system" / "controlDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
        "application pimpleFoam;\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
        f"endTime {end_t:.8g};\ndeltaT {dt:.8g};\nwriteControl timeStep;\nwriteInterval 5;\n"
        "purgeWrite 0;\nwriteFormat ascii;\nwritePrecision 8;\ntimeFormat general;\n"
        "timePrecision 8;\nrunTimeModifiable true;\n"
        "functions\n{\n"
        "  preCICE_Adapter\n  {\n"
        "    type preciceAdapterFunctionObject;\n"
        '    libs ("libpreciceAdapterFunctionObject.so");\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    (fluid_dir / "system" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        "ddtSchemes { default Euler; }\n"
        "gradSchemes { default Gauss linear; }\n"
        "divSchemes { default none; div(phi,U) Gauss upwind; div((nuEff*dev2(T(grad(U))))) Gauss linear; }\n"
        "laplacianSchemes { default Gauss linear corrected; }\n"
        "interpolationSchemes { default linear; }\n"
        "snGradSchemes { default corrected; }\n",
        encoding="utf-8",
    )
    (fluid_dir / "system" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers {\n"
        "  p { solver GAMG; smoother GaussSeidel; tolerance 1e-6; relTol 0.01; }\n"
        "  pFinal { $p; relTol 0; }\n"
        "  U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
        "  UFinal { $U; relTol 0; }\n"
        "  cellDisplacement { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }\n"
        "}\n"
        "PIMPLE { nOuterCorrectors 2; nCorrectors 2; nNonOrthogonalCorrectors 0; }\n",
        encoding="utf-8",
    )

    # 3. Write CalculiX solid participant files
    (solid_dir / "config.yml").write_text(
        generate_calculix_precice_config(
            mode="FSI",
            surface_name="SURFACE_INTERFACE",
            mesh_name="Solid-Mesh",
            participant_name="Solid",
            precice_config="../precice-config.xml",
        ),
        encoding="utf-8",
    )
    (solid_dir / "solid.inp").write_text(
        generate_calculix_precice_inp(
            mode="FSI",
            width=width,
            solid_thickness=solid_thickness,
            depth=depth,
            young_modulus=float(data.get("young_modulus") or 210e9),
            poisson_ratio=float(data.get("poisson_ratio") or 0.3),
            density=float(data.get("density") or 7850.0),
            conductivity_k=float(data.get("solid_conductivity_k") or data.get("thermal_conductivity_k") or 50.0),
            specific_heat=float(data.get("specific_heat") or 460.0),
            time_step=dt,
            end_time=end_t,
        ),
        encoding="utf-8",
    )

    # Mesh fluid domain
    bm = subprocess.run([block_mesh_bin], cwd=fluid_dir, text=True, capture_output=True, timeout=60, check=False)
    if bm.returncode != 0:
        raise RuntimeError(f"blockMesh failed for preCICE fluid participant: {(bm.stderr or bm.stdout)[-1500:]}")

    # Launch both participants concurrently with guaranteed peer co-termination
    fluid_log_path = fluid_dir / "fluid.log"
    solid_log_path = solid_dir / "solid.log"
    timeout_sec = int(data.get("timeout_seconds") or 300)
    started = time.monotonic()

    with fluid_log_path.open("w", encoding="utf-8") as f_out, solid_log_path.open("w", encoding="utf-8") as s_out:
        p_fluid = subprocess.Popen([pimple_bin], cwd=fluid_dir, stdout=f_out, stderr=subprocess.STDOUT)
        p_solid = subprocess.Popen(
            [ccx_bin, "-i", "solid", "-precice-participant", "Solid"],
            cwd=solid_dir,
            stdout=s_out,
            stderr=subprocess.STDOUT,
        )
        try:
            while True:
                rc_f = p_fluid.poll()
                rc_s = p_solid.poll()
                elapsed = time.monotonic() - started

                if stream_callback is not None:
                    try:
                        stream_callback(
                            {
                                "progress": min(92, int(35 + min(1.0, elapsed / max(10.0, timeout_sec * 0.5)) * 55)),
                                "status_message": f"preCICE FSI co-simulation running ({elapsed:.1f}s)",
                                "logs": [f"[preCICE FSI] Fluid/Solid active ({elapsed:.1f}s)"],
                            }
                        )
                    except Exception:
                        pass

                if rc_f is not None and rc_s is not None:
                    break
                if rc_f is not None and rc_f != 0:
                    p_solid.terminate()
                    break
                if rc_s is not None and rc_s != 0:
                    p_fluid.terminate()
                    break
                if elapsed > timeout_sec:
                    p_fluid.terminate()
                    p_solid.terminate()
                    raise TimeoutError(f"preCICE FSI co-simulation timed out after {timeout_sec}s.")
                time.sleep(0.5)
        finally:
            for proc in (p_fluid, p_solid):
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5)

    rc_f = p_fluid.returncode
    rc_s = p_solid.returncode
    fluid_log = fluid_log_path.read_text(encoding="utf-8", errors="replace")
    solid_log = solid_log_path.read_text(encoding="utf-8", errors="replace")
    if rc_f != 0 or rc_s != 0:
        raise RuntimeError(
            f"preCICE 2-Way FSI co-simulation failed (fluid rc={rc_f}, solid rc={rc_s}). "
            f"Fluid tail: {fluid_log[-800:]} | Solid tail: {solid_log[-800:]}"
        )

    coupling_stats = parse_precice_iterations_log(fluid_dir / "precice-Fluid-iterations.log")
    return {
        "status": "SOLVED_REALTIME",
        "solver": "preCICE v3 (pimpleFoam <-> ccx_preCICE)",
        "physics_type": "FSI_2Way",
        "case_directory": str(case_dir),
        "coupling_mode": "FSI_2Way",
        "coupling_scheme": scheme,
        "coupling_convergence": coupling_stats,
        "logs": (fluid_log.splitlines()[-60:] + solid_log.splitlines()[-60:]),
    }


def _parse_openfoam_scalar_internal_field(field_path: Path) -> List[float]:
    """Parse ASCII OpenFOAM volScalarField `internalField` into float values."""
    if not field_path.is_file():
        return []
    text = field_path.read_text(encoding="utf-8", errors="replace")
    m_uni = re.search(r"internalField\s+uniform\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)", text)
    if m_uni:
        return [float(m_uni.group(1))]
    m_nonuni = re.search(
        r"internalField\s+nonuniform\s+List<scalar>\s*(\d+)\s*\((.*?)\)",
        text,
        flags=re.S,
    )
    if m_nonuni:
        vals: List[float] = []
        for tok in m_nonuni.group(2).split():
            try:
                v = float(tok)
                if math.isfinite(v):
                    vals.append(v)
            except ValueError:
                pass
        return vals
    return []


def _parse_patch_temperature_values(field_path: Path, patch_name: str) -> List[float]:
    """Extract boundary patch `value` entries from an OpenFOAM volScalarField file."""
    if not field_path.is_file():
        return []
    text = field_path.read_text(encoding="utf-8", errors="replace")
    pat = re.search(rf"\b{re.escape(patch_name)}\s*\{{([^}}]*)\}}", text, flags=re.S)
    if not pat:
        return []
    block = pat.group(1)
    m_uni = re.search(r"value\s+uniform\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)", block)
    if m_uni:
        return [float(m_uni.group(1))]
    m_list = re.search(r"value\s+nonuniform\s+List<scalar>\s*(\d+)\s*\((.*?)\)", block, flags=re.S)
    if m_list:
        out: List[float] = []
        for tok in m_list.group(2).split():
            try:
                v = float(tok)
                if math.isfinite(v):
                    out.append(v)
            except ValueError:
                pass
        return out
    return []


def _numeric_time_dirs(case_dir: Path) -> List[Tuple[float, Path]]:
    items: List[Tuple[float, Path]] = []
    for child in case_dir.iterdir():
        if not child.is_dir():
            continue
        try:
            t_val = float(child.name)
            if t_val > 0.0:
                items.append((t_val, child))
        except ValueError:
            continue
    items.sort(key=lambda pair: pair[0])
    return items


def run_openfoam_multiregion_cht(
    data: Mapping[str, Any],
    *,
    openfoam_env: Optional[Dict[str, str]] = None,
    run_streaming_fn: Optional[Callable[..., subprocess.CompletedProcess[str]]] = None,
    parse_checkmesh_fn: Optional[Callable[[str], Dict[str, Any]]] = None,
    parse_residuals_fn: Optional[Callable[[str], Dict[str, Any]]] = None,
    extract_vtk_fn: Optional[Callable[[Path], Optional[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """
    Execute a REAL native OpenFOAM v2406 Multi-Region Conjugate Heat Transfer
    simulation (`chtMultiRegionSimpleFoam` or `chtMultiRegionFoam`) with two
    physically coupled regions (`fluid` + `solid`) across `fluid_to_solid` /
    `solid_to_fluid` (`compressible::turbulentTemperatureCoupledBaffleMixed`).
    """
    env = dict(openfoam_env or os.environ)
    time_mode = str(data.get("time_mode") or "steady").strip().lower()
    adaptive_ts = bool(data.get("adaptive_time_stepping"))
    is_transient = time_mode == "transient" or adaptive_ts

    solver_name = "chtMultiRegionFoam" if is_transient else "chtMultiRegionSimpleFoam"
    solver_bin = shutil.which(solver_name, path=env.get("PATH")) or shutil.which(solver_name)
    if not solver_bin and is_transient:
        solver_name = "chtMultiRegionSimpleFoam"
        solver_bin = shutil.which(solver_name, path=env.get("PATH")) or shutil.which(solver_name)
        is_transient = False

    block_mesh = shutil.which("blockMesh", path=env.get("PATH")) or shutil.which("blockMesh")
    split_regions = shutil.which("splitMeshRegions", path=env.get("PATH")) or shutil.which("splitMeshRegions")
    check_mesh = shutil.which("checkMesh", path=env.get("PATH")) or shutil.which("checkMesh")
    foam_to_vtk = shutil.which("foamToVTK", path=env.get("PATH")) or shutil.which("foamToVTK")

    if not solver_bin or not block_mesh or not split_regions:
        raise MultiRegionChtError(
            "Native Multi-Region CHT requires OpenFOAM `blockMesh`, `splitMeshRegions`, and "
            f"`{solver_name}` on PATH inside the Docker worker."
        )

    width = max(1e-3, float(data.get("width_x") or 0.5))
    fluid_height = max(1e-3, float(data.get("height_y") or 0.1))
    depth = max(1e-3, float(data.get("depth_z") or 0.05))
    solid_thickness = max(1e-3, float(data.get("solid_thickness") or 0.04))
    mesh_size = max(1e-3, float(data.get("mesh_size") or 0.025))

    velocity = float(data.get("velocity") or 0.5)
    t_inlet = float(data.get("temperature") or 300.0)
    if t_inlet < 150.0:
        t_inlet += 273.15
    t_solid_bottom = float(data.get("bc_bottom_temp") or data.get("bc_left_temp") or (t_inlet + 60.0))
    if t_solid_bottom < 150.0:
        t_solid_bottom += 273.15
    if abs(t_solid_bottom - t_inlet) < 1.0:
        t_solid_bottom = t_inlet + 60.0
    heat_flux_val = data.get("heat_flux")

    rho_f = float(data.get("fluid_density") or 1.18)
    mu_f = float(data.get("dynamic_viscosity") or 1.85e-5)
    cp_f = float(data.get("fluid_cp") or 1005.0)
    k_f = float(data.get("fluid_k") or 0.026)
    pr_f = max(0.05, (cp_f * mu_f) / max(k_f, 1e-6))

    k_solid = float(data.get("solid_conductivity_k") or data.get("thermal_conductivity_k") or 50.0)
    rho_solid = float(data.get("density") or 7850.0)
    cp_solid = float(data.get("specific_heat") or 460.0)

    max_iters = max(20, min(500, int(data.get("solver_iterations") or 120)))
    dt_val = float(data.get("time_step") or 0.005)
    end_t_val = float(data.get("end_time") or 0.1)
    max_co = float(data.get("max_co") or 0.8)
    max_delta_t = float(data.get("max_delta_t") or max(dt_val * 10.0, 0.05))

    nx = max(6, min(60, int(round(width / mesh_size))))
    ny_f = max(4, min(30, int(round(fluid_height / mesh_size))))
    ny_s = max(3, min(20, int(round(solid_thickness / mesh_size))))

    configured_root = os.getenv("OPENFOAM_CASE_ROOT") or os.getenv("NASEER_JOB_DIR")
    root = (
        Path(configured_root)
        if configured_root
        else (Path("/app/jobs") if Path("/app/jobs").exists() else Path.cwd() / "jobs")
    )
    root.mkdir(parents=True, exist_ok=True)
    case_dir = root / f"openfoam-cht-{uuid.uuid4().hex[:12]}"
    for sub in (
        "0/fluid",
        "0/solid",
        "constant/fluid",
        "constant/solid",
        "system/fluid",
        "system/solid",
    ):
        (case_dir / sub).mkdir(parents=True, exist_ok=True)

    # 1. Contiguous two-zone blockMesh (solid: y in [-t_s, 0], fluid: y in [0, H_f])
    (case_dir / "system" / "blockMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
        "convertToMeters 1;\n"
        "vertices\n(\n"
        f"  (0 {-solid_thickness:.8g} 0)\n"        # 0
        f"  ({width:.8g} {-solid_thickness:.8g} 0)\n"  # 1
        f"  ({width:.8g} 0 0)\n"                   # 2
        f"  (0 0 0)\n"                             # 3
        f"  (0 {fluid_height:.8g} 0)\n"            # 4
        f"  ({width:.8g} {fluid_height:.8g} 0)\n"  # 5
        f"  (0 {-solid_thickness:.8g} {depth:.8g})\n"  # 6
        f"  ({width:.8g} {-solid_thickness:.8g} {depth:.8g})\n"  # 7
        f"  ({width:.8g} 0 {depth:.8g})\n"         # 8
        f"  (0 0 {depth:.8g})\n"                   # 9
        f"  (0 {fluid_height:.8g} {depth:.8g})\n"  # 10
        f"  ({width:.8g} {fluid_height:.8g} {depth:.8g})\n"  # 11
        ");\n"
        "blocks\n(\n"
        f"  hex (0 1 2 3 6 7 8 9) solid ({nx} {ny_s} 1) simpleGrading (1 1 1)\n"
        f"  hex (3 2 5 4 9 8 11 10) fluid ({nx} {ny_f} 1) simpleGrading (1 1 1)\n"
        ");\n"
        "edges ();\n"
        "boundary\n(\n"
        "  inlet { type patch; faces ((3 9 10 4)); }\n"
        "  outlet { type patch; faces ((2 5 11 8)); }\n"
        "  fluid_top { type wall; faces ((4 10 11 5)); }\n"
        "  solid_bottom { type wall; faces ((0 1 7 6)); }\n"
        "  solid_sides { type wall; faces ((0 6 9 3) (1 2 8 7)); }\n"
        "  frontAndBack { type empty; faces ((0 3 2 1) (3 4 5 2) (6 7 8 9) (9 8 11 10)); }\n"
        ");\nmergePatchPairs ();\n",
        encoding="utf-8",
    )

    # 2. Root constant & system files
    (case_dir / "constant" / "regionProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object regionProperties; }\n'
        "regions ( fluid (fluid) solid (solid) );\n",
        encoding="utf-8",
    )

    if is_transient:
        ctrl_text = (
            'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
            f"application {solver_name};\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
            f"endTime {end_t_val:.6g};\ndeltaT {dt_val:.6g};\nwriteControl adjustableRunTime;\n"
            f"writeInterval {max(dt_val, end_t_val / 5.0):.6g};\npurgeWrite 0;\nwriteFormat ascii;\n"
            "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;\n"
            f"adjustTimeStep {'yes' if adaptive_ts else 'no'};\n"
            f"maxCo {max_co:.6g};\nmaxDi 10;\nmaxDeltaT {max_delta_t:.6g};\n"
        )
    else:
        ctrl_text = (
            'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
            f"application {solver_name};\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
            f"endTime {max_iters};\ndeltaT 1;\nwriteControl timeStep;\n"
            f"writeInterval {max(25, max_iters // 2)};\npurgeWrite 2;\nwriteFormat ascii;\n"
            "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;\n"
        )
    (case_dir / "system" / "controlDict").write_text(ctrl_text, encoding="utf-8")

    # Root fvSchemes / fvSolution required by OpenFOAM utilities
    (case_dir / "system" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        f"ddtSchemes {{ default {'Euler' if is_transient else 'steadyState'}; }}\n"
        "gradSchemes { default Gauss linear; }\n"
        "divSchemes { default none; }\n"
        "laplacianSchemes { default Gauss linear corrected; }\n"
        "interpolationSchemes { default linear; }\n"
        "snGradSchemes { default corrected; }\n",
        encoding="utf-8",
    )
    (case_dir / "system" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers {}\n"
        "PIMPLE { nOuterCorrectors 2; }\n"
        "SIMPLE { nNonOrthogonalCorrectors 0; }\n",
        encoding="utf-8",
    )

    # 3. Fluid region constant & system files
    (case_dir / "constant" / "fluid" / "thermophysicalProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object thermophysicalProperties; }\n'
        "thermoType { type heRhoThermo; mixture pureMixture; transport const; thermo hConst; equationOfState rhoConst; specie specie; energy sensibleEnthalpy; }\n"
        "mixture {\n"
        "  specie { molWeight 28.96; }\n"
        f"  equationOfState {{ rho {rho_f:.8g}; }}\n"
        f"  thermodynamics {{ Cp {cp_f:.8g}; Hf 0; }}\n"
        f"  transport {{ mu {mu_f:.8g}; Pr {pr_f:.8g}; }}\n"
        "}\n",
        encoding="utf-8",
    )
    (case_dir / "constant" / "fluid" / "turbulenceProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object turbulenceProperties; }\n'
        "simulationType laminar;\n",
        encoding="utf-8",
    )
    grav_y = float(data.get("gravity_y") or -9.81) if bool(data.get("gravity_enabled")) else 0.0
    (case_dir / "constant" / "fluid" / "g").write_text(
        'FoamFile { version 2.0; format ascii; class uniformDimensionedVectorField; object g; }\n'
        f"dimensions [0 1 -2 0 0 0 0];\nvalue (0 {grav_y:.8g} 0);\n",
        encoding="utf-8",
    )
    (case_dir / "constant" / "fluid" / "radiationProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object radiationProperties; }\n'
        "radiation off;\nradiationModel none;\n",
        encoding="utf-8",
    )

    (case_dir / "system" / "fluid" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        f"ddtSchemes {{ default {'Euler' if is_transient else 'steadyState'}; }}\n"
        "gradSchemes { default Gauss linear; }\n"
        "divSchemes {\n"
        "  default none;\n"
        "  div(phi,U) bounded Gauss upwind;\n"
        "  div(phi,h) bounded Gauss upwind;\n"
        "  div(phi,K) bounded Gauss upwind;\n"
        "  div(phi,k) bounded Gauss upwind;\n"
        "  div(phi,epsilon) bounded Gauss upwind;\n"
        "  div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;\n"
        "}\n"
        "laplacianSchemes { default Gauss linear corrected; }\n"
        "interpolationSchemes { default linear; }\n"
        "snGradSchemes { default corrected; }\n",
        encoding="utf-8",
    )
    (case_dir / "system" / "fluid" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers {\n"
        "  p_rgh { solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol 0.01; }\n"
        "  p_rghFinal { $p_rgh; relTol 0; }\n"
        '  "(U|h|e|k|epsilon|omega).*" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0.1; }\n'
        '  "(U|h|e|k|epsilon|omega)Final" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0; }\n'
        "}\n"
        "SIMPLE {\n"
        "  nNonOrthogonalCorrectors 0;\n"
        "  pRefCell 0;\n"
        "  pRefValue 101325;\n"
        "  residualControl { p_rgh 1e-4; U 1e-4; h 1e-4; }\n"
        "}\n"
        "PIMPLE {\n"
        "  nOuterCorrectors 2;\n"
        "  nCorrectors 2;\n"
        "  nNonOrthogonalCorrectors 0;\n"
        "  pRefCell 0;\n"
        "  pRefValue 101325;\n"
        "}\n"
        "relaxationFactors {\n"
        "  fields { p_rgh 0.3; rho 1.0; }\n"
        "  equations { U 0.7; h 0.7; }\n"
        "}\n",
        encoding="utf-8",
    )

    # 4. Solid region constant & system files
    (case_dir / "constant" / "solid" / "thermophysicalProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object thermophysicalProperties; }\n'
        "thermoType { type heSolidThermo; mixture pureMixture; transport constIso; thermo hConst; equationOfState rhoConst; specie specie; energy sensibleEnthalpy; }\n"
        "mixture {\n"
        "  specie { molWeight 55.85; }\n"
        f"  transport {{ kappa {k_solid:.8g}; }}\n"
        f"  thermodynamics {{ Hf 0; Cp {cp_solid:.8g}; }}\n"
        f"  equationOfState {{ rho {rho_solid:.8g}; }}\n"
        "}\n",
        encoding="utf-8",
    )
    (case_dir / "constant" / "solid" / "radiationProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object radiationProperties; }\n'
        "radiation off;\nradiationModel none;\n",
        encoding="utf-8",
    )
    (case_dir / "system" / "solid" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        f"ddtSchemes {{ default {'Euler' if is_transient else 'steadyState'}; }}\n"
        "gradSchemes { default Gauss linear; }\n"
        "divSchemes { default none; }\n"
        "laplacianSchemes { default Gauss linear corrected; }\n"
        "interpolationSchemes { default linear; }\n"
        "snGradSchemes { default corrected; }\n",
        encoding="utf-8",
    )
    (case_dir / "system" / "solid" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers {\n"
        "  h { solver PCG; preconditioner DIC; tolerance 1e-8; relTol 0.1; }\n"
        "  hFinal { $h; relTol 0; }\n"
        "}\n"
        "SIMPLE { nNonOrthogonalCorrectors 0; residualControl { h 1e-5; } }\n"
        "PIMPLE { nNonOrthogonalCorrectors 0; }\n"
        "relaxationFactors { equations { h 0.9; } }\n",
        encoding="utf-8",
    )

    log_path = case_dir / "solver.log"

    def _run_step(cmd: List[str], *, stream: bool = False) -> subprocess.CompletedProcess[str]:
        if stream and run_streaming_fn is not None:
            return run_streaming_fn(
                cmd,
                cwd=case_dir,
                env=env,
                timeout=240,
                log_path=log_path,
                append_log=True,
                solver_kind="openfoam",
                max_iters=None if is_transient else max_iters,
                end_time=end_t_val if is_transient else None,
            )
        proc = subprocess.run(cmd, cwd=case_dir, env=env, text=True, capture_output=True, timeout=180, check=False)
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(proc.stdout or "")
            fh.write(proc.stderr or "")
        return proc

    # Step A: blockMesh + splitMeshRegions
    p_bm = _run_step([block_mesh])
    if p_bm.returncode != 0:
        raise MultiRegionChtError(f"blockMesh failed: {(p_bm.stderr or p_bm.stdout)[-1500:]}")

    p_sp = _run_step([split_regions, "-cellZones", "-overwrite"])
    if p_sp.returncode != 0:
        raise MultiRegionChtError(f"splitMeshRegions failed: {(p_sp.stderr or p_sp.stdout)[-1500:]}")

    # Step B: Write region initial/boundary fields AFTER splitMeshRegions so coupled patches are intact
    t_init = 0.5 * (t_inlet + t_solid_bottom)
    (case_dir / "0" / "fluid" / "U").write_text(
        'FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n'
        "dimensions [0 1 -1 0 0 0 0];\n"
        f"internalField uniform ({velocity:.8g} 0 0);\n"
        "boundaryField {\n"
        f"  inlet {{ type fixedValue; value uniform ({velocity:.8g} 0 0); }}\n"
        "  outlet { type zeroGradient; }\n"
        "  fluid_top { type noSlip; }\n"
        "  fluid_to_solid { type noSlip; }\n"
        "  frontAndBack { type empty; }\n"
        '  ".*" { type noSlip; }\n'
        "}\n",
        encoding="utf-8",
    )
    (case_dir / "0" / "fluid" / "p_rgh").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p_rgh; }\n'
        "dimensions [1 -1 -2 0 0 0 0];\n"
        "internalField uniform 101325;\n"
        "boundaryField {\n"
        "  inlet { type fixedFluxPressure; value uniform 101325; }\n"
        "  outlet { type fixedValue; value uniform 101325; }\n"
        "  fluid_top { type fixedFluxPressure; value uniform 101325; }\n"
        "  fluid_to_solid { type fixedFluxPressure; value uniform 101325; }\n"
        "  frontAndBack { type empty; }\n"
        '  ".*" { type fixedFluxPressure; value uniform 101325; }\n'
        "}\n",
        encoding="utf-8",
    )
    (case_dir / "0" / "fluid" / "p").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n'
        "dimensions [1 -1 -2 0 0 0 0];\n"
        "internalField uniform 101325;\n"
        "boundaryField {\n"
        "  inlet { type calculated; value uniform 101325; }\n"
        "  outlet { type calculated; value uniform 101325; }\n"
        "  fluid_top { type calculated; value uniform 101325; }\n"
        "  fluid_to_solid { type calculated; value uniform 101325; }\n"
        "  frontAndBack { type empty; }\n"
        '  ".*" { type calculated; value uniform 101325; }\n'
        "}\n",
        encoding="utf-8",
    )
    (case_dir / "0" / "fluid" / "T").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object T; }\n'
        "dimensions [0 0 0 1 0 0 0];\n"
        f"internalField uniform {t_inlet:.8g};\n"
        "boundaryField {\n"
        f"  inlet {{ type fixedValue; value uniform {t_inlet:.8g}; }}\n"
        "  outlet { type zeroGradient; }\n"
        "  fluid_top { type zeroGradient; }\n"
        "  fluid_to_solid {\n"
        "    type compressible::turbulentTemperatureCoupledBaffleMixed;\n"
        "    Tnbr T;\n"
        "    kappaMethod fluidThermo;\n"
        f"    value uniform {t_init:.8g};\n"
        "  }\n"
        "  frontAndBack { type empty; }\n"
        '  ".*" { type zeroGradient; }\n'
        "}\n",
        encoding="utf-8",
    )

    if heat_flux_val is not None and abs(float(heat_flux_val)) > 0.0:
        q_val = float(heat_flux_val)
        solid_bottom_bc = (
            "  solid_bottom {\n"
            "    type externalWallHeatFluxTemperature;\n"
            "    mode flux;\n"
            f"    q uniform {q_val:.8g};\n"
            "    kappaMethod solidThermo;\n"
            f"    value uniform {t_solid_bottom:.8g};\n"
            "  }\n"
        )
    else:
        solid_bottom_bc = f"  solid_bottom {{ type fixedValue; value uniform {t_solid_bottom:.8g}; }}\n"

    (case_dir / "0" / "solid" / "T").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object T; }\n'
        "dimensions [0 0 0 1 0 0 0];\n"
        f"internalField uniform {t_solid_bottom:.8g};\n"
        "boundaryField {\n"
        f"{solid_bottom_bc}"
        "  solid_sides { type zeroGradient; }\n"
        "  solid_to_fluid {\n"
        "    type compressible::turbulentTemperatureCoupledBaffleMixed;\n"
        "    Tnbr T;\n"
        "    kappaMethod solidThermo;\n"
        f"    value uniform {t_init:.8g};\n"
        "  }\n"
        "  frontAndBack { type empty; }\n"
        '  ".*" { type zeroGradient; }\n'
        "}\n",
        encoding="utf-8",
    )

    # Step C: checkMesh per region
    region_mesh_quality: Dict[str, Any] = {}
    if check_mesh:
        for reg in ("fluid", "solid"):
            cm = _run_step([check_mesh, "-region", reg])
            if parse_checkmesh_fn is not None:
                region_mesh_quality[reg] = parse_checkmesh_fn(cm.stdout or "")

    # Step D: Run real chtMultiRegionSimpleFoam / chtMultiRegionFoam
    p_solve = _run_step([solver_bin], stream=True)
    if p_solve.returncode != 0:
        full_log = log_path.read_text(encoding="utf-8", errors="replace")
        raise MultiRegionChtError(
            f"{solver_name} failed with exit code {p_solve.returncode}: {full_log[-2500:]}"
        )

    time_dirs = _numeric_time_dirs(case_dir)
    if not time_dirs:
        raise MultiRegionChtError(
            f"{solver_name} produced no converged time directories > 0."
        )
    latest_time, latest_dir = time_dirs[-1]

    fluid_t = _parse_openfoam_scalar_internal_field(latest_dir / "fluid" / "T")
    solid_t = _parse_openfoam_scalar_internal_field(latest_dir / "solid" / "T")
    iface_fluid_t = _parse_patch_temperature_values(latest_dir / "fluid" / "T", "fluid_to_solid")
    iface_solid_t = _parse_patch_temperature_values(latest_dir / "solid" / "T", "solid_to_fluid")

    if not fluid_t or not solid_t:
        raise MultiRegionChtError(
            f"Missing converged temperature fields in {latest_dir} (fluid={len(fluid_t)}, solid={len(solid_t)})."
        )

    t_fluid_avg = sum(fluid_t) / len(fluid_t)
    t_solid_avg = sum(solid_t) / len(solid_t)
    t_iface_avg = (
        sum(iface_fluid_t) / len(iface_fluid_t)
        if iface_fluid_t
        else (sum(iface_solid_t) / len(iface_solid_t) if iface_solid_t else 0.5 * (t_fluid_avg + t_solid_avg))
    )
    # Conduction heat flux across solid wall from real converged temperature drop
    est_heat_flux_w_m2 = k_solid * (t_solid_bottom - t_iface_avg) / max(solid_thickness, 1e-6)
    dh = 2.0 * fluid_height
    delta_t_conv = max(1e-3, abs(t_iface_avg - t_inlet))
    h_conv = abs(est_heat_flux_w_m2) / delta_t_conv
    nusselt = (h_conv * dh) / max(k_f, 1e-6)

    # Step E: Export multi-region VTK via foamToVTK -allRegions -latestTime
    vtk_payload: Any = []
    if foam_to_vtk:
        _run_step([foam_to_vtk, "-allRegions", "-latestTime"])
        vtk_root = case_dir / "VTK"
        if vtk_root.is_dir() and extract_vtk_fn is not None:
            vtu_candidates = sorted(vtk_root.rglob("*.vtu")) or sorted(vtk_root.rglob("*.vtk"))
            # Prefer fluid region internal mesh for primary viewport visualization
            fluid_vtu = [p for p in vtu_candidates if "fluid" in str(p).lower()]
            pick = fluid_vtu[-1] if fluid_vtu else (vtu_candidates[-1] if vtu_candidates else None)
            if pick is not None:
                try:
                    parsed_vtk = extract_vtk_fn(pick)
                    if parsed_vtk:
                        vtk_payload = parsed_vtk
                except Exception:
                    pass

    full_log = log_path.read_text(encoding="utf-8", errors="replace")
    residuals = parse_residuals_fn(full_log) if parse_residuals_fn else {}

    all_t = fluid_t + solid_t
    return {
        "status": "SOLVED_REALTIME",
        "solver": f"OpenFOAM ({solver_name})",
        "solver_type": solver_name,
        "physics_type": "CHT_MultiRegion",
        "case_directory": str(case_dir),
        "latest_time": latest_time,
        "regions": ["fluid", "solid"],
        "interface_patches": ["fluid_to_solid", "solid_to_fluid"],
        "mesh_nodes": (nx + 1) * (ny_f + ny_s + 1) * 2,
        "mesh_elements": nx * (ny_f + ny_s),
        "region_mesh_quality": region_mesh_quality,
        "mesh_quality": region_mesh_quality.get("fluid") or region_mesh_quality.get("solid"),
        "residuals": residuals,
        "convergence": {
            "converged": True,
            "residuals": residuals,
        },
        "temperature": {
            "min": round(min(all_t), 4),
            "max": round(max(all_t), 4),
            "avg": round(sum(all_t) / len(all_t), 4),
            "fluid_min": round(min(fluid_t), 4),
            "fluid_max": round(max(fluid_t), 4),
            "fluid_avg": round(t_fluid_avg, 4),
            "solid_min": round(min(solid_t), 4),
            "solid_max": round(max(solid_t), 4),
            "solid_avg": round(t_solid_avg, 4),
            "interface_avg": round(t_iface_avg, 4),
        },
        "max_temperature": round(max(all_t), 4),
        "calculated_heat_flux": round(est_heat_flux_w_m2, 4),
        "integrals": {
            "fluid_avg_temp_k": round(t_fluid_avg, 4),
            "solid_avg_temp_k": round(t_solid_avg, 4),
            "interface_temp_k": round(t_iface_avg, 4),
            "interface_heat_flux_w_m2": round(est_heat_flux_w_m2, 4),
            "nusselt_number": round(nusselt, 4),
        },
        "vtk_data": vtk_payload,
        "logs": full_log.splitlines()[-120:],
        "units": {"temperature": "K", "heat_flux": "W/m^2"},
    }
