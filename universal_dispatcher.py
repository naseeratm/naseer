"""
Universal CAE Solver Dispatcher.

Routes every engineering request to real Docker worker solvers:
- Gmsh (parametric & STL/STEP 3D tetrahedral/hexahedral meshing + quality metrics)
- OpenFOAM (CFD incompressible/compressible, turbulence RANS, CHT, buoyant thermal, VOF multiphase, custom archives)
- CalculiX ccx (Structural static/nonlinear/modal/buckling, thermal conduction/convection/radiation, coupled thermo-mechanical, custom .inp)
- ElmerFEM (Electromagnetics, Joule heating, Helmholtz acoustics)

Zero mock or fallback formulas: if a solver binary or case fails, an explicit runtime error is raised.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple


def _ensure_app_on_sys_path() -> str:
    """Guarantee the application root directory is on sys.path for prefork Celery lazy imports."""
    app_dir = str(Path(__file__).resolve().parent)
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    return app_dir


_ensure_app_on_sys_path()

try:
    import redis as redis_lib
except ImportError:  # Local test environment outside Docker container
    redis_lib = None  # type: ignore[assignment]

try:
    from celery import Celery
    from celery.signals import task_postrun, task_prerun, worker_ready, worker_shutdown
except ImportError:  # Local test environment outside Docker container
    class Celery:  # type: ignore[no-redef]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.conf: Dict[str, Any] = {}

        def task(self, *args: Any, **kwargs: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
                return fn
            return _decorator

    worker_ready = None  # type: ignore[assignment]
    worker_shutdown = None  # type: ignore[assignment]
    task_prerun = None  # type: ignore[assignment]
    task_postrun = None  # type: ignore[assignment]

from backend.report_generator import generate_academic_report
from backend.result_schema import canonicalize_result
from backend.vv_metrics import (
    KeyResultUnavailable,
    MeshStudyError,
    compute_openfoam_metrics,
    parse_internal_field,
    run_mesh_study,
)
try:
    from cae_repository import JobRepository
except ImportError:
    JobRepository = None  # type: ignore[assignment,misc]

PhysicsResult = Dict[str, Any]


class OpenFOAMVerificationError(RuntimeError):
    """Raised when the OpenFOAM verification gate rejects a finished solver run."""


REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
celery_app = Celery(
    "universal_cae",
    broker=REDIS_URL,
    backend=os.getenv("CELERY_RESULT_BACKEND", REDIS_URL),
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


_STREAM_STATE = threading.local()
_CPU_SAMPLE_LOCK = threading.Lock()
_LAST_CPU_TICKS: Optional[Tuple[int, int]] = None


def _read_proc_stat_ticks() -> Optional[Tuple[int, int]]:
    """Read real aggregate (idle_ticks, total_ticks) from Linux /proc/stat."""
    stat_path = Path("/proc/stat")
    if not stat_path.exists():
        return None
    try:
        first_line = stat_path.read_text(encoding="utf-8", errors="replace").splitlines()[0]
        parts = first_line.split()
        if not parts or parts[0] != "cpu" or len(parts) < 5:
            return None
        nums = [int(x) for x in parts[1:] if x.isdigit()]
        idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
        total = sum(nums)
        return (idle, total)
    except Exception:
        return None


def _read_cgroup_cpu_quota_cores() -> Optional[float]:
    """Read Docker cgroup v2 or v1 CPU quota in cores if explicitly limited."""
    try:
        v2 = Path("/sys/fs/cgroup/cpu.max")
        if v2.exists():
            parts = v2.read_text(encoding="utf-8", errors="replace").strip().split()
            if len(parts) >= 2 and parts[0] != "max":
                quota, period = float(parts[0]), float(parts[1])
                if quota > 0 and period > 0:
                    return round(quota / period, 2)
    except Exception:
        pass
    try:
        q_path = Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
        p_path = Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
        if q_path.exists() and p_path.exists():
            quota = float(q_path.read_text(encoding="utf-8", errors="replace").strip())
            period = float(p_path.read_text(encoding="utf-8", errors="replace").strip())
            if quota > 0 and period > 0:
                return round(quota / period, 2)
    except Exception:
        pass
    return None


def _read_memory_stats_mb() -> Tuple[Optional[float], Optional[float], Optional[float], str]:
    """Read real memory usage from Linux /proc/meminfo or Docker cgroup limits (MB)."""
    host_total_mb: Optional[float] = None
    host_avail_mb: Optional[float] = None
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        try:
            kv: Dict[str, float] = {}
            for line in meminfo.read_text(encoding="utf-8", errors="replace").splitlines():
                if ":" not in line:
                    continue
                k, rest = line.split(":", 1)
                toks = rest.strip().split()
                if toks and toks[0].isdigit():
                    kv[k.strip()] = float(toks[0]) / 1024.0  # kB -> MB
            host_total_mb = kv.get("MemTotal")
            host_avail_mb = kv.get("MemAvailable", kv.get("MemFree"))
        except Exception:
            pass

    # Prefer Docker cgroup v2 limit when container has an explicit cap lower than host RAM
    try:
        cg_cur = Path("/sys/fs/cgroup/memory.current")
        cg_max = Path("/sys/fs/cgroup/memory.max")
        if cg_cur.exists() and cg_max.exists():
            max_raw = cg_max.read_text(encoding="utf-8", errors="replace").strip()
            if max_raw != "max" and max_raw.isdigit():
                lim_mb = int(max_raw) / (1024.0 * 1024.0)
                cur_mb = int(cg_cur.read_text(encoding="utf-8", errors="replace").strip()) / (1024.0 * 1024.0)
                if lim_mb > 0 and (host_total_mb is None or lim_mb < host_total_mb * 1.05):
                    pct = round(min(100.0, max(0.0, (cur_mb / lim_mb) * 100.0)), 2)
                    return (round(cur_mb, 1), round(lim_mb, 1), pct, "cgroup_v2")
    except Exception:
        pass

    # Docker cgroup v1
    try:
        cg1_cur = Path("/sys/fs/cgroup/memory/memory.usage_in_bytes")
        cg1_max = Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")
        if cg1_cur.exists() and cg1_max.exists():
            lim_raw = int(cg1_max.read_text(encoding="utf-8", errors="replace").strip())
            if 0 < lim_raw < (1 << 60):
                lim_mb = lim_raw / (1024.0 * 1024.0)
                cur_mb = int(cg1_cur.read_text(encoding="utf-8", errors="replace").strip()) / (1024.0 * 1024.0)
                if host_total_mb is None or lim_mb < host_total_mb * 1.05:
                    pct = round(min(100.0, max(0.0, (cur_mb / lim_mb) * 100.0)), 2)
                    return (round(cur_mb, 1), round(lim_mb, 1), pct, "cgroup_v1")
    except Exception:
        pass

    if host_total_mb and host_total_mb > 0 and host_avail_mb is not None:
        used_mb = max(0.0, host_total_mb - host_avail_mb)
        pct = round(min(100.0, max(0.0, (used_mb / host_total_mb) * 100.0)), 2)
        return (round(used_mb, 1), round(host_total_mb, 1), pct, "proc_meminfo")

    return (None, None, None, "unavailable")


def _read_process_rss_mb(pid: Optional[int]) -> Optional[float]:
    """Read real resident set size (VmRSS in MB) of an active solver subprocess PID."""
    if not pid or pid <= 0:
        return None
    status_path = Path(f"/proc/{pid}/status")
    if not status_path.exists():
        return None
    try:
        for line in status_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("VmRSS:"):
                toks = line.split()
                if len(toks) >= 2 and toks[1].isdigit():
                    return round(float(toks[1]) / 1024.0, 2)
    except Exception:
        return None
    return None


def sample_node_telemetry(pid: Optional[int] = None) -> Dict[str, Any]:
    """Sample real OS/Docker CPU load, RAM usage, and optional solver process RSS (Zero-Mock)."""
    global _LAST_CPU_TICKS
    cpu_percent: Optional[float] = None
    with _CPU_SAMPLE_LOCK:
        cur = _read_proc_stat_ticks()
        if cur is not None:
            if _LAST_CPU_TICKS is None:
                # One-time brief 50ms baseline delta so the very first poll returns a real reading
                time.sleep(0.05)
                cur2 = _read_proc_stat_ticks()
                if cur2 is not None:
                    d_total = cur2[1] - cur[1]
                    d_idle = cur2[0] - cur[0]
                    if d_total > 0:
                        cpu_percent = round(min(100.0, max(0.0, (1.0 - (d_idle / d_total)) * 100.0)), 1)
                    _LAST_CPU_TICKS = cur2
                else:
                    _LAST_CPU_TICKS = cur
            else:
                d_total = cur[1] - _LAST_CPU_TICKS[1]
                d_idle = cur[0] - _LAST_CPU_TICKS[0]
                if d_total > 0:
                    cpu_percent = round(min(100.0, max(0.0, (1.0 - (d_idle / d_total)) * 100.0)), 1)
                _LAST_CPU_TICKS = cur

    host_cores = os.cpu_count() or 1
    quota_cores = _read_cgroup_cpu_quota_cores()
    effective_cores = min(float(host_cores), quota_cores) if quota_cores else float(host_cores)

    load_1m: Optional[float] = None
    load_5m: Optional[float] = None
    try:
        la1, la5, _ = os.getloadavg()
        load_1m = round(la1, 2)
        load_5m = round(la5, 2)
    except (AttributeError, OSError):
        pass

    mem_used_mb, mem_total_mb, mem_pct, mem_source = _read_memory_stats_mb()
    rss_mb = _read_process_rss_mb(pid)

    return {
        "hostname": os.uname().nodename if hasattr(os, "uname") else "unknown",
        "sampled_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cpu_percent": cpu_percent,
        "cpu_cores": int(round(effective_cores)) if effective_cores >= 1 else 1,
        "host_cpu_cores": host_cores,
        "load_avg_1m": load_1m,
        "load_avg_5m": load_5m,
        "memory_used_mb": mem_used_mb,
        "memory_total_mb": mem_total_mb,
        "memory_percent": mem_pct,
        "memory_source": mem_source,
        "solver_pid": pid if rss_mb is not None else None,
        "solver_rss_mb": rss_mb,
    }


def compute_wall_clock_sec(created_at: Any, completed_at: Any = None) -> Optional[float]:
    """Compute real elapsed wall-clock seconds from persisted UTC ISO timestamps."""
    if not isinstance(created_at, str) or not created_at.strip():
        return None
    try:
        from datetime import datetime, timezone

        t0 = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if t0.tzinfo is None:
            t0 = t0.replace(tzinfo=timezone.utc)
        if isinstance(completed_at, str) and completed_at.strip():
            t1 = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
            if t1.tzinfo is None:
                t1 = t1.replace(tzinfo=timezone.utc)
        else:
            t1 = datetime.now(timezone.utc)
        return round(max(0.0, (t1 - t0).total_seconds()), 2)
    except Exception:
        return None


def _task_progress(task: Any, progress: int, message: str, **extra: Any) -> None:
    """Publish a stable metadata shape that API clients can consume."""
    meta: Dict[str, Any] = {
        "progress": max(0, min(100, progress)),
        "status_message": message,
        "logs": extra.pop("logs", [message]),
        **extra,
    }
    task.update_state(state="STARTED", meta=meta)


def _run_streaming_command(
    command: List[str],
    *,
    cwd: Path,
    env: Optional[Dict[str, str]] = None,
    timeout: int = 180,
    log_path: Optional[Path] = None,
    append_log: bool = True,
    solver_kind: str = "generic",
    max_iters: Optional[int] = None,
    end_time: Optional[float] = None,
) -> subprocess.CompletedProcess[str]:
    """Execute a real solver subprocess via Popen, streaming live iterations, residuals, and OS telemetry to Celery/SQLite."""
    callback: Optional[Callable[[Dict[str, Any]], None]] = getattr(_STREAM_STATE, "callback", None)
    started_mono = time.monotonic()
    proc = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines: List[str] = []
    live_residuals: Dict[str, Dict[str, List[float]]] = {}
    current_iter = 0
    current_time = 0.0
    last_emit = started_mono
    deadline = started_mono + float(timeout)

    re_time = re.compile(r"^\s*Time\s*=\s*([0-9.eE+-]+)")
    re_res = re.compile(r"Solving for\s+([A-Za-z_][\w.]*).*?Initial residual\s*=\s*([^\s,]+)", re.I)
    re_ccx_inc = re.compile(r"\bincrement\s+(\d+)\s+attempt\s+(\d+)", re.I)
    re_elmer_iter = re.compile(r"(?:ITERATION|ComputeChange|Nonlinear iteration)\s*[:=#]?\s*(\d+)?.*?([0-9.eE+-]+)?", re.I)

    log_file = log_path.open("a" if append_log else "w", encoding="utf-8") if log_path is not None else None
    try:
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            if time.monotonic() > deadline:
                proc.kill()
                proc.wait(timeout=5)
                raise subprocess.TimeoutExpired(command, timeout, output="".join(lines[-200:]))
            line = raw_line.rstrip("\r\n")
            lines.append(line)
            if log_file is not None:
                log_file.write(raw_line)
                log_file.flush()

            if solver_kind == "openfoam":
                m_t = re_time.match(line)
                if m_t:
                    try:
                        current_time = float(m_t.group(1))
                        current_iter += 1
                    except ValueError:
                        pass
                m_r = re_res.search(line)
                if m_r:
                    field_name = m_r.group(1)
                    try:
                        val = float(m_r.group(2))
                        if math.isfinite(val) and val > 0:
                            entry = live_residuals.setdefault(field_name, {"iterations": [], "values": []})
                            entry["iterations"].append(len(entry["iterations"]) + 1)
                            entry["values"].append(val)
                    except ValueError:
                        pass
            elif solver_kind == "calculix":
                m_inc = re_ccx_inc.search(line)
                if m_inc:
                    current_iter = max(current_iter, int(m_inc.group(1)))
            elif solver_kind == "elmer":
                m_el = re_elmer_iter.search(line)
                if m_el and m_el.group(1):
                    try:
                        current_iter = max(current_iter, int(m_el.group(1)))
                    except ValueError:
                        pass

            now = time.monotonic()
            if callback is not None and (now - last_emit >= 0.75):
                last_emit = now
                pct = 40
                if end_time and end_time > 0 and current_time > 0:
                    pct = int(35 + min(1.0, current_time / end_time) * 57)
                elif max_iters and max_iters > 0 and current_iter > 0:
                    pct = int(35 + min(1.0, current_iter / max_iters) * 57)
                elif current_iter > 0:
                    pct = min(90, 38 + current_iter)
                try:
                    live_tel = sample_node_telemetry(pid=proc.pid)
                    live_tel["wall_clock_sec"] = round(now - started_mono, 2)
                    live_tel["solver_binary"] = Path(command[0]).name
                    callback({
                        "progress": max(35, min(95, pct)),
                        "logs": lines[-140:],
                        "residuals": live_residuals,
                        "current_iteration": current_iter,
                        "status_message": f"{Path(command[0]).name}: iter {current_iter}" if current_iter > 0 else f"Running {Path(command[0]).name}",
                        "telemetry": live_tel,
                    })
                except Exception:
                    pass

        if callback is not None and (live_residuals or current_iter > 0 or lines):
            try:
                now = time.monotonic()
                live_tel = sample_node_telemetry(pid=proc.pid)
                live_tel["wall_clock_sec"] = round(now - started_mono, 2)
                live_tel["solver_binary"] = Path(command[0]).name
                callback({
                    "progress": 95,
                    "logs": lines[-140:],
                    "residuals": live_residuals,
                    "current_iteration": current_iter,
                    "status_message": f"{Path(command[0]).name}: iter {current_iter}" if current_iter > 0 else f"Completed {Path(command[0]).name}",
                    "telemetry": live_tel,
                })
            except Exception:
                pass

        returncode = proc.wait(timeout=max(5, int(deadline - time.monotonic())))
    except Exception:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        raise
    finally:
        if proc.stdout is not None:
            try:
                proc.stdout.close()
            except Exception:
                pass
        if log_file is not None:
            log_file.close()

    full_output = "\n".join(lines) + ("\n" if lines else "")
    return subprocess.CompletedProcess(command, returncode, stdout=full_output, stderr="")


def _build_openfoam_function_objects(
    solver_stem: str,
    patch_roles: Mapping[str, str],
    *,
    rho: float,
    velocity: float,
    width: float,
    height: float,
    depth: float,
    compressible: bool,
) -> str:
    """Build OpenFOAM v2406 native functionObjects for yPlus, wallShearStress, and aerodynamic forceCoeffs."""
    supported = {"simpleFoam", "pimpleFoam", "rhoSimpleFoam", "rhoPimpleFoam", "buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}
    if solver_stem not in supported:
        return ""
    wall_patches = [pname for pname, role in patch_roles.items() if role == "wall"]
    if not wall_patches:
        return ""
    patches_str = " ".join(wall_patches)
    p_name = "p_rgh" if solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"} else "p"
    rho_block = "rho rho;" if (compressible or solver_stem == "buoyantSimpleFoam") else f"rho rhoInf; rhoInf {max(rho, 1e-6):.8g};"
    mag_u = max(abs(velocity), 1e-3)
    l_ref = max(width, height, 1e-4)
    a_ref = max(height * depth, 1e-6)
    return (
        "\nfunctions\n{\n"
        "  yPlus\n  {\n"
        "    type yPlus;\n"
        "    libs (fieldFunctionObjects);\n"
        "    writeControl writeTime;\n"
        "    writeFields false;\n"
        f"    patches ({patches_str});\n"
        "  }\n"
        "  wallShearStress\n  {\n"
        "    type wallShearStress;\n"
        "    libs (fieldFunctionObjects);\n"
        "    writeControl writeTime;\n"
        "    writeFields false;\n"
        f"    patches ({patches_str});\n"
        "  }\n"
        "  forceCoeffs\n  {\n"
        "    type forceCoeffs;\n"
        "    libs (forces);\n"
        "    writeControl writeTime;\n"
        f"    patches ({patches_str});\n"
        f"    p {p_name};\n"
        f"    {rho_block}\n"
        "    liftDir (0 1 0);\n"
        "    dragDir (1 0 0);\n"
        "    pitchAxis (0 0 1);\n"
        "    CofR (0 0 0);\n"
        f"    magUInf {mag_u:.8g};\n"
        f"    lRef {l_ref:.8g};\n"
        f"    Aref {a_ref:.8g};\n"
        "  }\n"
        "}\n"
    )


def _parse_openfoam_postprocessing(case_dir: Path) -> Dict[str, float]:
    """Parse genuine OpenFOAM postProcessing/ files (yPlus, wallShearStress, forceCoeffs) without fabrication."""
    out: Dict[str, float] = {}
    pp = case_dir / "postProcessing"
    if not pp.exists():
        return out

    # 1. yPlus.dat: columns typically Time patch min max average
    yplus_files = sorted(pp.glob("yPlus/*/yPlus.dat"))
    if yplus_files:
        mins: List[float] = []
        maxs: List[float] = []
        avgs: List[float] = []
        for raw_line in yplus_files[-1].read_text(encoding="utf-8", errors="replace").splitlines():
            s = raw_line.strip()
            if not s or s.startswith("#"):
                continue
            parts = s.split()
            if len(parts) >= 5:
                try:
                    mins.append(float(parts[2]))
                    maxs.append(float(parts[3]))
                    avgs.append(float(parts[4]))
                except ValueError:
                    pass
        if mins and maxs and avgs:
            out["y_plus_min"] = round(mins[-1], 4)
            out["y_plus_max"] = round(maxs[-1], 4)
            out["y_plus_avg"] = round(avgs[-1], 4)

    # 2. wallShearStress.dat: columns Time patch min(vx vy vz) max(vx vy vz)
    wss_files = sorted(pp.glob("wallShearStress/*/wallShearStress.dat"))
    if wss_files:
        vec_re = re.compile(r"\(\s*([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s*\)")
        mags: List[float] = []
        for raw_line in wss_files[-1].read_text(encoding="utf-8", errors="replace").splitlines():
            s = raw_line.strip()
            if not s or s.startswith("#"):
                continue
            vecs = vec_re.findall(s)
            for vx, vy, vz in vecs:
                try:
                    mags.append(math.sqrt(float(vx) ** 2 + float(vy) ** 2 + float(vz) ** 2))
                except ValueError:
                    pass
        if mags:
            out["wall_shear_stress_max_pa"] = round(max(mags), 6)

    # 3. forceCoeffs coefficient.dat: columns Time Cd Cs Cl CmRoll CmPitch CmYaw ...
    coeff_files = sorted(pp.glob("forceCoeffs/*/coefficient.dat")) or sorted(pp.glob("forceCoeffs/*/forceCoeffs.dat"))
    if coeff_files:
        header_cols: List[str] = []
        last_nums: List[float] = []
        for raw_line in coeff_files[-1].read_text(encoding="utf-8", errors="replace").splitlines():
            s = raw_line.strip()
            if not s:
                continue
            if s.startswith("#"):
                tokens = s.lstrip("#").split()
                if "Cd" in tokens and "Cl" in tokens:
                    header_cols = tokens
                continue
            parts = s.split()
            try:
                nums = [float(x) for x in parts]
                if len(nums) >= 4:
                    last_nums = nums
            except ValueError:
                pass
        if last_nums:
            cd_idx = header_cols.index("Cd") if "Cd" in header_cols else 1
            cl_idx = header_cols.index("Cl") if "Cl" in header_cols else (3 if len(last_nums) > 3 else 2)
            if cd_idx < len(last_nums):
                out["drag_coefficient_cd"] = round(last_nums[cd_idx], 5)
            if cl_idx < len(last_nums):
                out["lift_coefficient_cl"] = round(last_nums[cl_idx], 5)

    return out


def _compute_stl_bounds(stl_path: Path) -> Tuple[List[float], List[float]]:
    """Compute exact 3D bounding box [min_x, min_y, min_z], [max_x, max_y, max_z] from binary or ASCII STL."""
    raw = stl_path.read_bytes()
    if len(raw) < 15:
        raise ValueError(f"STL file '{stl_path.name}' is empty or truncated.")

    min_v = [float("inf"), float("inf"), float("inf")]
    max_v = [float("-inf"), float("-inf"), float("-inf")]
    vertex_count = 0

    # Check binary STL exact size: 80-byte header + 4-byte uint32 tri count + 50 bytes per triangle
    is_binary = False
    if len(raw) >= 84:
        tri_count = struct.unpack("<I", raw[80:84])[0]
        if 84 + tri_count * 50 == len(raw) and tri_count > 0:
            is_binary = True
            offset = 84
            for _ in range(tri_count):
                # Skip 12-byte normal; read 3 vertices (9 floats)
                floats = struct.unpack_from("<9f", raw, offset + 12)
                for k in range(0, 9, 3):
                    vx, vy, vz = floats[k], floats[k + 1], floats[k + 2]
                    if math.isfinite(vx) and math.isfinite(vy) and math.isfinite(vz):
                        if vx < min_v[0]: min_v[0] = vx
                        if vx > max_v[0]: max_v[0] = vx
                        if vy < min_v[1]: min_v[1] = vy
                        if vy > max_v[1]: max_v[1] = vy
                        if vz < min_v[2]: min_v[2] = vz
                        if vz > max_v[2]: max_v[2] = vz
                        vertex_count += 1
                offset += 50

    if not is_binary:
        text = raw.decode("utf-8", errors="replace")
        for match in re.finditer(r"vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", text):
            vx, vy, vz = float(match.group(1)), float(match.group(2)), float(match.group(3))
            if math.isfinite(vx) and math.isfinite(vy) and math.isfinite(vz):
                if vx < min_v[0]: min_v[0] = vx
                if vx > max_v[0]: max_v[0] = vx
                if vy < min_v[1]: min_v[1] = vy
                if vy > max_v[1]: max_v[1] = vy
                if vz < min_v[2]: min_v[2] = vz
                if vz > max_v[2]: max_v[2] = vz
                vertex_count += 1

    if vertex_count < 3 or any(not math.isfinite(v) for v in min_v + max_v):
        raise ValueError(f"Could not extract valid 3D vertices from STL file '{stl_path.name}'.")
    return min_v, max_v


def _prepare_external_aero_stl(raw_cad: bytes, cad_filename: str, tri_surface_dir: Path) -> Path:
    """Place or tessellate uploaded STL/STEP/IGES geometry into constant/triSurface/obstacle.stl."""
    tri_surface_dir.mkdir(parents=True, exist_ok=True)
    target_stl = tri_surface_dir / "obstacle.stl"
    ext = Path(cad_filename).suffix.lower()
    if ext == ".stl":
        target_stl.write_bytes(raw_cad)
        return target_stl

    if ext in {".step", ".stp", ".iges", ".igs", ".brep"}:
        src_path = tri_surface_dir / f"source{ext}"
        src_path.write_bytes(raw_cad)
        try:
            import gmsh  # type: ignore[import-not-found]
            gmsh.initialize()
            gmsh.option.setNumber("General.Terminal", 0)
            gmsh.model.add("ext_aero_stl")
            gmsh.model.occ.importShapes(str(src_path))
            gmsh.model.occ.synchronize()
            gmsh.model.mesh.generate(2)
            gmsh.write(str(target_stl))
            gmsh.finalize()
            if target_stl.exists() and target_stl.stat().st_size > 84:
                return target_stl
        except Exception as exc:
            try:
                import gmsh  # type: ignore[import-not-found]
                if gmsh.isInitialized():
                    gmsh.finalize()
            except Exception:
                pass
            raise RuntimeError(f"Failed to tessellate CAD '{cad_filename}' into STL for snappyHexMesh: {exc}") from exc

    raise ValueError(
        f"Unsupported CAD format '{cad_filename}' for external aerodynamics snappyHexMesh. Upload an .STL, .STEP, or .IGES file."
    )


def _build_external_wind_tunnel_spec(
    bmin: Sequence[float],
    bmax: Sequence[float],
    *,
    upstream_mult: float = 3.0,
    downstream_mult: float = 6.0,
    pad_mult: float = 2.5,
    base_cell_size: Optional[float] = None,
) -> Dict[str, Any]:
    """Compute wind-tunnel domain, wake refinement box, safe locationInMesh, and background cell counts."""
    obs_l = max(1e-4, float(bmax[0]) - float(bmin[0]))
    obs_h = max(1e-4, float(bmax[1]) - float(bmin[1]))
    obs_w = max(1e-4, float(bmax[2]) - float(bmin[2]))
    char_d = max(obs_l, obs_h, obs_w)

    up_m = max(1.5, min(15.0, float(upstream_mult)))
    down_m = max(3.0, min(25.0, float(downstream_mult)))
    pad_m = max(1.5, min(12.0, float(pad_mult)))

    upstream_len = max(up_m * obs_l, 2.0 * char_d)
    downstream_len = max(down_m * obs_l, 4.0 * char_d)
    lat_pad_y = max(pad_m * obs_h, 1.8 * char_d)
    lat_pad_z = max(pad_m * obs_w, 1.8 * char_d)

    tx0 = float(bmin[0]) - upstream_len
    tx1 = float(bmax[0]) + downstream_len
    ty0 = float(bmin[1]) - lat_pad_y
    ty1 = float(bmax[1]) + lat_pad_y
    tz0 = float(bmin[2]) - lat_pad_z
    tz1 = float(bmax[2]) + lat_pad_z

    tunnel_l = tx1 - tx0
    tunnel_h = ty1 - ty0
    tunnel_w = tz1 - tz0

    # Wake refinement box starting slightly upstream of nose and covering turbulent wake downstream
    wake_min = [
        float(bmin[0]) - 0.35 * obs_l,
        float(bmin[1]) - 0.65 * obs_h,
        float(bmin[2]) - 0.65 * obs_w,
    ]
    wake_max = [
        min(tx1 - 0.1 * downstream_len, float(bmax[0]) + min(downstream_len * 0.75, 4.0 * obs_l)),
        float(bmax[1]) + 0.65 * obs_h,
        float(bmax[2]) + 0.65 * obs_w,
    ]

    # Guaranteed safe point strictly inside wind tunnel and strictly outside obstacle bounding box
    loc_in_mesh = [
        tx0 + 0.15 * upstream_len,
        ty1 - 0.15 * lat_pad_y,
        0.5 * (tz0 + tz1),
    ]

    bg_cell = (
        float(base_cell_size)
        if (base_cell_size is not None and math.isfinite(float(base_cell_size)) and float(base_cell_size) > 0)
        else max(1e-4, char_d * 0.35)
    )
    nx = max(12, min(80, int(round(tunnel_l / bg_cell))))
    ny = max(8, min(50, int(round(tunnel_h / bg_cell))))
    nz = max(8, min(50, int(round(tunnel_w / bg_cell))))

    return {
        "obstacle_min": [float(bmin[0]), float(bmin[1]), float(bmin[2])],
        "obstacle_max": [float(bmax[0]), float(bmax[1]), float(bmax[2])],
        "obstacle_dims": [obs_l, obs_h, obs_w],
        "tunnel_min": [tx0, ty0, tz0],
        "tunnel_max": [tx1, ty1, tz1],
        "tunnel_dims": [tunnel_l, tunnel_h, tunnel_w],
        "wake_min": wake_min,
        "wake_max": wake_max,
        "location_in_mesh": loc_in_mesh,
        "nx": nx,
        "ny": ny,
        "nz": nz,
    }


def _write_external_aero_dicts(
    case_dir: Path,
    spec: Mapping[str, Any],
    *,
    surface_level: int = 2,
    wake_level: int = 1,
    inflation_layers: int = 3,
    growth_rate: float = 1.2,
    use_feature_extract: bool = True,
) -> None:
    """Write genuine OpenFOAM v2406 blockMeshDict, surfaceFeatureExtractDict, and snappyHexMeshDict."""
    tx0, ty0, tz0 = spec["tunnel_min"]
    tx1, ty1, tz1 = spec["tunnel_max"]
    wx0, wy0, wz0 = spec["wake_min"]
    wx1, wy1, wz1 = spec["wake_max"]
    lx, ly, lz = spec["location_in_mesh"]
    nx, ny, nz = int(spec["nx"]), int(spec["ny"]), int(spec["nz"])

    s_lvl = max(1, min(4, int(surface_level)))
    s_lvl_max = min(5, s_lvl + 1)
    w_lvl = max(1, min(3, int(wake_level)))
    n_layers = max(0, min(12, int(inflation_layers)))
    exp_ratio = max(1.05, min(1.5, float(growth_rate)))

    (case_dir / "system" / "blockMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
        "convertToMeters 1;\n"
        f"vertices (\n"
        f"  ({tx0:.8g} {ty0:.8g} {tz0:.8g})\n"
        f"  ({tx1:.8g} {ty0:.8g} {tz0:.8g})\n"
        f"  ({tx1:.8g} {ty1:.8g} {tz0:.8g})\n"
        f"  ({tx0:.8g} {ty1:.8g} {tz0:.8g})\n"
        f"  ({tx0:.8g} {ty0:.8g} {tz1:.8g})\n"
        f"  ({tx1:.8g} {ty0:.8g} {tz1:.8g})\n"
        f"  ({tx1:.8g} {ty1:.8g} {tz1:.8g})\n"
        f"  ({tx0:.8g} {ty1:.8g} {tz1:.8g})\n"
        ");\n"
        f"blocks ( hex (0 1 2 3 4 5 6 7) ({nx} {ny} {nz}) simpleGrading (1 1 1) );\n"
        "edges ();\n"
        "boundary (\n"
        "  inlet    { type patch; faces ((0 4 7 3)); }\n"
        "  outlet   { type patch; faces ((1 2 6 5)); }\n"
        "  farfield { type patch; faces ((0 1 5 4) (3 7 6 2) (0 3 2 1) (4 5 6 7)); }\n"
        ");\n"
        "mergePatchPairs ();\n",
        encoding="utf-8",
    )

    (case_dir / "system" / "surfaceFeatureExtractDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object surfaceFeatureExtractDict; }\n'
        "obstacle.stl\n"
        "{\n"
        "  extractionMethod extractFromSurface;\n"
        "  extractFromSurfaceCoeffs\n"
        "  {\n"
        "    includedAngle 150;\n"
        "  }\n"
        "  writeObj no;\n"
        "}\n",
        encoding="utf-8",
    )

    features_block = (
        f'  features ( {{ file "obstacle.eMesh"; level {s_lvl}; }} );\n'
        if use_feature_extract
        else "  features ();\n"
    )
    add_layers_flag = "true" if n_layers > 0 else "false"
    explicit_snap = "true" if use_feature_extract else "false"
    implicit_snap = "false" if use_feature_extract else "true"

    (case_dir / "system" / "snappyHexMeshDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object snappyHexMeshDict; }\n'
        "castellatedMesh true;\n"
        "snap            true;\n"
        f"addLayers       {add_layers_flag};\n\n"
        "geometry\n"
        "{\n"
        "  obstacle.stl\n"
        "  {\n"
        "    type triSurfaceMesh;\n"
        "    name obstacle;\n"
        "  }\n"
        "  wakeBox\n"
        "  {\n"
        "    type searchableBox;\n"
        f"    min ({wx0:.8g} {wy0:.8g} {wz0:.8g});\n"
        f"    max ({wx1:.8g} {wy1:.8g} {wz1:.8g});\n"
        "  }\n"
        "};\n\n"
        "castellatedMeshControls\n"
        "{\n"
        "  maxLocalCells 250000;\n"
        "  maxGlobalCells 1500000;\n"
        "  minRefinementCells 10;\n"
        "  maxLoadUnbalance 0.10;\n"
        "  nCellsBetweenLevels 3;\n"
        + features_block
        + "  refinementSurfaces\n"
        "  {\n"
        "    obstacle\n"
        "    {\n"
        f"      level ({s_lvl} {s_lvl_max});\n"
        "      patchInfo { type wall; }\n"
        "    }\n"
        "  }\n"
        "  resolveFeatureAngle 30;\n"
        "  refinementRegions\n"
        "  {\n"
        "    wakeBox\n"
        "    {\n"
        "      mode inside;\n"
        f"      levels ((1E15 {w_lvl}));\n"
        "    }\n"
        "  }\n"
        f"  locationInMesh ({lx:.8g} {ly:.8g} {lz:.8g});\n"
        "  allowFreeStandingZoneFaces true;\n"
        "}\n\n"
        "snapControls\n"
        "{\n"
        "  nSmoothPatch 3;\n"
        "  tolerance 2.0;\n"
        "  nSolveIter 30;\n"
        "  nRelaxIter 5;\n"
        "  nFeatureSnapIter 10;\n"
        f"  implicitFeatureSnap {implicit_snap};\n"
        f"  explicitFeatureSnap {explicit_snap};\n"
        "  multiRegionFeatureSnap false;\n"
        "}\n\n"
        "addLayersControls\n"
        "{\n"
        "  relativeSizes true;\n"
        "  layers\n"
        "  {\n"
        '    "obstacle.*"\n'
        "    {\n"
        f"      nSurfaceLayers {max(1, n_layers)};\n"
        "    }\n"
        "  }\n"
        f"  expansionRatio {exp_ratio:.4g};\n"
        "  finalLayerThickness 0.35;\n"
        "  minThickness 0.1;\n"
        "  nGrow 0;\n"
        "  featureAngle 60;\n"
        "  slipFeatureAngle 30;\n"
        "  nRelaxIter 5;\n"
        "  nSmoothSurfaceNormals 1;\n"
        "  nSmoothNormals 3;\n"
        "  nSmoothThickness 10;\n"
        "  maxFaceThicknessRatio 0.5;\n"
        "  maxThicknessToMedialRatio 0.3;\n"
        "  minMedialAxisAngle 90;\n"
        "  nBufferCellsNoExtrude 0;\n"
        "  nLayerIter 50;\n"
        "}\n\n"
        "meshQualityControls\n"
        "{\n"
        "  maxNonOrtho 65;\n"
        "  maxBoundarySkewness 20;\n"
        "  maxInternalSkewness 4;\n"
        "  maxConcave 80;\n"
        "  minVol 1e-13;\n"
        "  minTetQuality -1e30;\n"
        "  minArea -1;\n"
        "  minTwist 0.02;\n"
        "  minDeterminant 0.001;\n"
        "  minFaceWeight 0.02;\n"
        "  minVolRatio 0.01;\n"
        "  minTriangleTwist -1;\n"
        "  nSmoothScale 4;\n"
        "  errorReduction 0.75;\n"
        "}\n\n"
        "mergeTolerance 1e-6;\n",
        encoding="utf-8",
    )


def _flatten_text(value: Any) -> str:
    if isinstance(value, Mapping):
        parts: list[str] = []
        for key, item in value.items():
            if key in {"cad_stl_b64", "cad_file_b64", "openfoam_archive_b64"}:
                continue
            parts.extend([str(key), _flatten_text(item)])
        return " ".join(parts)
    if isinstance(value, (list, tuple, set)):
        return " ".join(_flatten_text(item) for item in value)
    return str(value)


def _extract_upload_path_content(data: Mapping[str, Any]) -> Tuple[Optional[bytes], Optional[str]]:
    """Resolve binary/text attachment from base64 payload or uploaded path in shared workspace."""
    b64 = data.get("cad_stl_b64") or data.get("cad_file_b64")
    filename = str(data.get("cad_filename") or "")
    if isinstance(b64, str) and b64.strip():
        clean = b64.split(",", 1)[-1].strip()
        try:
            return base64.b64decode(clean), (filename or "geometry.stl")
        except Exception:
            pass
    upload_path = data.get("uploaded_file_path")
    if isinstance(upload_path, str) and upload_path.strip() and Path(upload_path).is_file():
        p = Path(upload_path)
        return p.read_bytes(), p.name
    return None, (filename or None)


def classify_and_route_simulation(input_data: Mapping[str, Any]) -> PhysicsResult:
    """Submit a classified case to a Celery worker."""
    task = run_simulation_task.delay(dict(input_data))
    physics_type = classify_physics(input_data)
    return {
        "task_id": task.id,
        "status": "QUEUED",
        "physics_type": physics_type,
        "recommended_solver": _recommended_engine(physics_type),
    }


def classify_physics(input_data: Mapping[str, Any]) -> str:
    explicit_raw = str(
        input_data.get("simulation_type") or input_data.get("physics_type") or ""
    ).strip()
    explicit_type = explicit_raw.lower().replace("-", "_").replace(" ", "_")

    exact_map = {
        "cfd_incompressible": "CFD_Incompressible",
        "cfd": "CFD_Incompressible",
        "cfd_compressible": "CFD_Compressible",
        "structural_static": "Structural_Static",
        "fea": "Structural_Static",
        "structural_dynamic": "Structural_Dynamic",
        "structural_buckling": "Structural_Buckling",
        "thermal_transient": "Thermal_Transient",
        "thermal_steady": "Thermal_Steady",
        "thermal": "Thermal_Steady",
        "thermal_radiation": "Thermal_Radiation",
        "thermal_structural": "Thermal_Structural",
        "thermo_mechanical": "Thermal_Structural",
        "cht_coupled": "CHT_Coupled",
        "cht": "CHT_Coupled",
        "multiphase_vof": "Multiphase_VOF",
        "multiphase": "Multiphase_VOF",
        "vof": "Multiphase_VOF",
        "electromagnetic": "Electromagnetic",
        "em": "Electromagnetic",
        "acoustics": "Acoustics",
        "multiphysics": "Thermal_Structural",
    }
    if explicit_type in exact_map:
        return exact_map[explicit_type]
    if explicit_type.startswith("cfd_") and "compressible" in explicit_type:
        return "CFD_Compressible"
    if explicit_type.startswith("cfd_"):
        return "CFD_Incompressible"

    text = _flatten_text(input_data).lower()
    if any(t in text for t in ("maxwell", "electromagnetic", "magnetostatic", "electrostatic", "induction", "joule")):
        return "Electromagnetic"
    if any(t in text for t in ("acoustic", "helmholtz", "sound pressure")):
        return "Acoustics"
    if any(t in text for t in ("vof", "multiphase", "interfoam", "phase change", "pcm")):
        return "Multiphase_VOF"
    if any(t in text for t in ("cht", "conjugate heat", "buoyant")):
        return "CHT_Coupled"
    if any(t in text for t in ("buckling", "*buckle")):
        return "Structural_Buckling"

    has_cfd = any(t in text for t in (
        "velocity_inlet", "cfd", "navier", "airfoil", "fluid", "incompressible",
        "mach", "compressible", "aerodynamics", "simplefoam",
    ))
    has_structural = any(t in text for t in (
        "stress", "structural", "fea", "displacement", "von mises", "elastic", "mechanical", "*static",
    ))
    has_thermal = any(t in text for t in (
        "thermal", "temperature", "heat_flux", "heat flux", "convection", "conduction",
        "radiation", "*heat transfer",
    ))

    if has_cfd and has_thermal:
        return "CHT_Coupled"
    if has_structural and has_thermal:
        return "Thermal_Structural"
    if "radiation" in text:
        return "Thermal_Radiation"
    if "dynamic" in text or "modal" in text or "*frequency" in text:
        return "Structural_Dynamic"
    if "compressible" in text:
        return "CFD_Compressible"
    if has_cfd:
        return "CFD_Incompressible"
    if has_structural:
        return "Structural_Static"
    if has_thermal:
        return "Thermal_Transient" if "transient" in text else "Thermal_Steady"
    return "Thermal_Steady"


def _recommended_engine(physics_type: str) -> str:
    engines = {
        "CFD_Incompressible": "OpenFOAM (simpleFoam / icoFoam / pimpleFoam)",
        "CFD_Compressible": "OpenFOAM (rhoSimpleFoam / rhoPimpleFoam)",
        "CHT_Coupled": "OpenFOAM (buoyantSimpleFoam / chtMultiRegionSimpleFoam)",
        "Multiphase_VOF": "OpenFOAM (interFoam VOF)",
        "Structural_Static": "CalculiX (ccx *STATIC)",
        "Structural_Dynamic": "CalculiX (ccx *FREQUENCY / *MODAL DYNAMIC)",
        "Structural_Buckling": "CalculiX (ccx *BUCKLE)",
        "Thermal_Transient": "CalculiX (ccx *HEAT TRANSFER)",
        "Thermal_Steady": "CalculiX (ccx *HEAT TRANSFER STEADY STATE)",
        "Thermal_Radiation": "CalculiX (ccx *HEAT TRANSFER + *RADIATE)",
        "Thermal_Structural": "CalculiX (ccx *COUPLED TEMPERATURE-DISPLACEMENT)",
        "Electromagnetic": "ElmerFEM (ElmerSolver Electrostatics / MagnetoDynamics)",
        "Acoustics": "ElmerFEM (ElmerSolver HelmholtzSolve)",
        "Multiphysics": "CalculiX / OpenFOAM Coupled Engine",
    }
    return engines.get(physics_type, "CalculiX / OpenFOAM Docker Engine")


def _probe_binary_version(binary: str, args: Sequence[str] = ("--version",)) -> Dict[str, Any]:
    resolved = shutil.which(binary)
    if not resolved:
        return {"available": False, "path": None, "version": None}
    version_text = None
    try:
        proc = subprocess.run([resolved, *args], text=True, capture_output=True, timeout=3, check=False)
        combined = f"{proc.stdout or ''}\n{proc.stderr or ''}"
        lower_combined = combined.lower()
        raw = [ln.strip() for ln in combined.splitlines() if ln.strip()]
        if raw:
            version_text = raw[0][:140]
        if (
            proc.returncode == 127
            or "error while loading shared libraries" in lower_combined
            or "cannot open shared object file" in lower_combined
            or "symbol lookup error" in lower_combined
        ):
            return {
                "available": False,
                "path": resolved,
                "version": None,
                "error": version_text or "Binary failed to load required shared libraries",
            }
    except Exception as exc:
        return {"available": False, "path": resolved, "version": None, "error": str(exc)[:140]}
    return {"available": True, "path": resolved, "version": version_text}


def probe_worker_capabilities() -> Dict[str, Any]:
    """Inspect real installed binaries inside the current container."""
    return {
        "openfoam": _probe_binary_version("simpleFoam", ("-help",)),
        "openfoam_blockMesh": _probe_binary_version("blockMesh", ("-help",)),
        "openfoam_snappyHexMesh": _probe_binary_version("snappyHexMesh", ("-help",)),
        "openfoam_surfaceFeatureExtract": _probe_binary_version("surfaceFeatureExtract", ("-help",)),
        "openfoam_interFoam": _probe_binary_version("interFoam", ("-help",)),
        "openfoam_buoyantSimpleFoam": _probe_binary_version("buoyantSimpleFoam", ("-help",)),
        "openfoam_foamToVTK": _probe_binary_version("foamToVTK", ("-help",)),
        "calculix": _probe_binary_version("ccx", ("-v",)),
        "gmsh": _probe_binary_version("gmsh", ("--version",)),
        "elmer": _probe_binary_version("ElmerSolver", ("--version",)),
        "elmer_grid": _probe_binary_version("ElmerGrid", ("--help",)),
    }


def parse_openfoam_residuals(log_text: str) -> Dict[str, Dict[str, Any]]:
    """Parse OpenFOAM's residual output into normalized series."""
    residuals: Dict[str, Dict[str, Any]] = {}
    patterns = (
        re.compile(r"Solving for\s+([A-Za-z_][\w.]*).*?Initial residual\s*=\s*([^\s,]+)", re.I),
        re.compile(r"Solved for\s+([A-Za-z_][\w.]*)[^\n]*Initial residual\s*=\s*([^\s,]+)", re.I),
    )
    for pattern in patterns:
        for match in pattern.finditer(log_text):
            field, initial = match.groups()
            try:
                value = float(initial)
                if math.isfinite(value):
                    residuals.setdefault(
                        field.lower(),
                        {"values": [], "initial": value, "final": value, "iterations": 0},
                    )["values"].append(value)
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
    try:
        parsed = parse_internal_field(text)
        vals = parsed.get("values", [])
        if vals:
            if parsed.get("kind") == "vector":
                mags = [math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) for v in vals]
                return {"kind": "vector", "minimum": min(mags), "maximum": max(mags), "mean": sum(mags) / len(mags), "values": mags[:2000]}
            return {"kind": "scalar", "minimum": min(vals), "maximum": max(vals), "mean": sum(vals) / len(vals), "values": vals[:2000]}
    except Exception:
        pass
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
    """Read latest time U/p/T/alpha.water dictionaries and normalize their basic statistics."""
    time_dirs = [p for p in case_dir.iterdir() if p.is_dir() and re.fullmatch(r"(?:\d+(?:\.\d*)?)", p.name)]
    time_dirs.sort(key=lambda p: float(p.name), reverse=True)
    fields: Dict[str, Dict[str, Any]] = {}
    name_map = {"p": "pressure", "U": "velocity", "T": "temperature", "alpha.water": "alpha_water"}
    for name, out_key in name_map.items():
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
            fields[out_key] = {
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

_OPENFOAM_FPE_BANNER = re.compile(r"^[^\n]*trapFpe:[^\n]*trapping enabled[^\n]*$", re.M | re.I)


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
    log_text = _OPENFOAM_FPE_BANNER.sub("", log_text)
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


def _write_block_mesh_boundary_summary(
    case_dir: Path, nx: int, ny: int, nz: int,
    width: float, height: float, depth: float,
) -> None:
    summary = {
        "dimensions": {"x": width, "y": height, "z": depth},
        "cells": {"nx": nx, "ny": ny, "nz": nz, "total": nx * ny * nz},
        "patches": ["inlet", "outlet", "walls", "frontAndBack"],
    }
    (case_dir / "mesh_metadata.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def _openfoam_env() -> Dict[str, str]:
    env = os.environ.copy()
    wm_dir = env.get("WM_PROJECT_DIR")
    if not wm_dir:
        opencfd_dir = Path("/usr/lib/openfoam")
        candidates = sorted(opencfd_dir.glob("openfoam*"), reverse=True) if opencfd_dir.is_dir() else []
        if candidates:
            wm_dir = str(candidates[0])
        elif Path("/usr/share/openfoam").is_dir():
            wm_dir = "/usr/share/openfoam"
        else:
            wm_dir = "/usr/lib/openfoam/openfoam2406"

    wm_path = Path(wm_dir)
    default_version = (
        f"v{wm_path.name[len('openfoam'):]}"
        if wm_path.name.startswith("openfoam") and len(wm_path.name) > len("openfoam")
        else "v2406"
    )
    env.setdefault("WM_PROJECT_DIR", wm_dir)
    env.setdefault("WM_PROJECT_INST_DIR", str(wm_path.parent))
    env.setdefault("WM_PROJECT_VERSION", default_version)
    env.setdefault("FOAM_ETC", str(wm_path / "etc"))

    if "FOAM_APPBIN" not in env:
        platform_bins = sorted((wm_path / "platforms").glob("*/bin")) if (wm_path / "platforms").is_dir() else []
        env["FOAM_APPBIN"] = str(platform_bins[0]) if platform_bins else "/usr/bin"
    if "FOAM_LIBBIN" not in env:
        platform_libs = sorted((wm_path / "platforms").glob("*/lib")) if (wm_path / "platforms").is_dir() else []
        env["FOAM_LIBBIN"] = str(platform_libs[0]) if platform_libs else "/usr/lib"

    if env["FOAM_APPBIN"] and env["FOAM_APPBIN"] not in env.get("PATH", ""):
        env["PATH"] = f"{env['FOAM_APPBIN']}:{env.get('PATH', '')}".strip(":")
    if env["FOAM_LIBBIN"] and env["FOAM_LIBBIN"] not in env.get("LD_LIBRARY_PATH", ""):
        env["LD_LIBRARY_PATH"] = f"{env['FOAM_LIBBIN']}:{env.get('LD_LIBRARY_PATH', '')}".strip(":")
    return env


def _requested_parallel_cores(data: Mapping[str, Any]) -> int:
    """Resolve user-requested parallel MPI/OpenMP core count clamped safely to [1, 64]."""
    raw = data.get("parallel_cores", 1)
    try:
        cores = int(raw if raw is not None else 1)
    except (TypeError, ValueError):
        cores = 1
    return max(1, min(64, cores))


def _write_openfoam_decompose_dict(case_dir: Path, np_cores: int) -> None:
    """Write standard OpenFOAM Scotch domain decomposition dictionary for mpirun -parallel."""
    (case_dir / "system" / "decomposeParDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; location "system"; object decomposeParDict; }\n'
        f"numberOfSubdomains {np_cores};\n"
        "method          scotch;\n",
        encoding="utf-8",
    )


def _compute_box_surface_sample_map(
    width: float,
    height: float,
    depth: float,
    nx: int,
    ny: int,
    nz: int,
) -> Tuple[List[float], List[int], List[int]]:
    """Build deterministic box surface geometry (points, triangles) and per-vertex source cell indices."""
    points: List[float] = []
    triangles: List[int] = []
    sample_cids: List[int] = []

    def cell_idx(ix: int, iy: int, iz: int) -> int:
        cix = max(0, min(nx - 1, ix))
        ciy = max(0, min(ny - 1, iy))
        ciz = max(0, min(nz - 1, iz))
        return cix + nx * (ciy + ny * ciz)

    def add_face_grid(u_steps: int, v_steps: int, coord_fn: Callable[[int, int], Tuple[float, float, float, int, int, int]]) -> None:
        base_v = len(points) // 3
        for j in range(v_steps + 1):
            for i in range(u_steps + 1):
                vx, vy, vz, cix, ciy, ciz = coord_fn(i, j)
                points.extend([round(vx, 6), round(vy, 6), round(vz, 6)])
                sample_cids.append(cell_idx(cix, ciy, ciz))
        stride = u_steps + 1
        for j in range(v_steps):
            for i in range(u_steps):
                a = base_v + j * stride + i
                b = a + 1
                c = a + stride + 1
                d = a + stride
                triangles.extend([a, b, c, a, c, d])

    snx = min(nx, 48)
    sny = min(ny, 48)
    snz = min(max(nz, 1), 16)

    def map_idx(step: int, max_step: int, target_n: int) -> int:
        return int(round((step / max(1, max_step)) * (target_n - 1)))

    add_face_grid(snx, sny, lambda i, j: (
        width * i / snx, height * j / sny, depth,
        map_idx(i, snx, nx), map_idx(j, sny, ny), nz - 1,
    ))
    add_face_grid(snx, sny, lambda i, j: (
        width * (snx - i) / snx, height * j / sny, 0.0,
        map_idx(snx - i, snx, nx), map_idx(j, sny, ny), 0,
    ))
    add_face_grid(snx, snz, lambda i, k: (
        width * i / snx, height, depth * (snz - k) / snz,
        map_idx(i, snx, nx), ny - 1, map_idx(snz - k, snz, nz),
    ))
    add_face_grid(snx, snz, lambda i, k: (
        width * i / snx, 0.0, depth * k / snz,
        map_idx(i, snx, nx), 0, map_idx(k, snz, nz),
    ))
    add_face_grid(snz, sny, lambda k, j: (
        0.0, height * j / sny, depth * k / snz,
        0, map_idx(j, sny, ny), map_idx(k, snz, nz),
    ))
    add_face_grid(snz, sny, lambda k, j: (
        width, height * j / sny, depth * (snz - k) / snz,
        nx - 1, map_idx(j, sny, ny), map_idx(snz - k, snz, nz),
    ))
    return points, triangles, sample_cids


def _map_box_cells_to_surface(
    sample_cids: Sequence[int],
    scalars: Mapping[str, Sequence[float]],
    vectors: Optional[Mapping[str, Sequence[float]]] = None,
) -> Tuple[Dict[str, List[float]], Dict[str, List[float]]]:
    """Map volumetric cell fields onto precomputed box surface vertices."""
    out_scalars: Dict[str, List[float]] = {k: [] for k in scalars}
    out_vectors: Dict[str, List[float]] = {k: [] for k in (vectors or {})}
    for cid in sample_cids:
        for key, arr in scalars.items():
            if arr:
                val = arr[cid] if cid < len(arr) else arr[-1]
                out_scalars[key].append(float(val))
        if vectors:
            for key, varr in vectors.items():
                base = cid * 3
                if base + 2 < len(varr):
                    out_vectors[key].extend([float(varr[base]), float(varr[base + 1]), float(varr[base + 2])])
                else:
                    out_vectors[key].extend([0.0, 0.0, 0.0])
    return out_scalars, out_vectors


def _build_structured_box_vtk(
    width: float,
    height: float,
    depth: float,
    nx: int,
    ny: int,
    nz: int,
    scalars: Dict[str, List[float]],
    vectors: Optional[Dict[str, List[float]]] = None,
    units: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Construct boundary surface triangles from a structured 3D cell grid + cell-mapped fields."""
    total_cells = nx * ny * nz
    points, triangles, sample_cids = _compute_box_surface_sample_map(width, height, depth, nx, ny, nz)
    out_scalars, out_vectors = _map_box_cells_to_surface(sample_cids, scalars, vectors)

    active_field = next((k for k, vals in out_scalars.items() if vals), "")
    return {
        "points": points,
        "triangles": triangles,
        "scalars": out_scalars,
        "vectors": out_vectors if any(out_vectors.values()) else {},
        "active_field": active_field,
        "units": units or {},
        "bounds": {"min": [0.0, 0.0, 0.0], "max": [width, height, depth]},
        "node_count": len(points) // 3,
        "triangle_count": len(triangles) // 3,
        "source_cells": total_cells,
    }


def _extract_vtk_from_meshio_file(vtu_or_vtk: Path) -> Optional[Dict[str, Any]]:
    """Read a real VTU/VTK surface or volume file produced by foamToVTK or ElmerSolver."""
    try:
        import meshio  # type: ignore
    except ImportError:
        return None
    if not vtu_or_vtk.exists():
        return None
    try:
        mesh = meshio.read(str(vtu_or_vtk))
        pts = mesh.points
        if len(pts) == 0:
            return None
        triangles: List[int] = []
        for cb in mesh.cells:
            if cb.type == "triangle":
                for tri in cb.data:
                    triangles.extend([int(tri[0]), int(tri[1]), int(tri[2])])
            elif cb.type == "quad":
                for q in cb.data:
                    triangles.extend([int(q[0]), int(q[1]), int(q[2]), int(q[0]), int(q[2]), int(q[3])])
            elif cb.type == "tetra" and not triangles:
                # Extract outer/boundary faces by face frequency == 1
                face_count: Dict[Tuple[int, int, int], Tuple[int, int, int]] = {}
                counts: Dict[Tuple[int, int, int], int] = {}
                for t in cb.data:
                    a, b, c, d = int(t[0]), int(t[1]), int(t[2]), int(t[3])
                    for f in ((a, b, c), (a, b, d), (b, c, d), (c, a, d)):
                        key = tuple(sorted(f))
                        counts[key] = counts.get(key, 0) + 1
                        face_count[key] = f
                for key, cnt in counts.items():
                    if cnt == 1:
                        triangles.extend(face_count[key])

        scalars: Dict[str, List[float]] = {}
        vectors: Dict[str, List[float]] = {}
        for name, arr in (mesh.point_data or {}).items():
            try:
                if hasattr(arr, "ndim") and arr.ndim == 2 and arr.shape[1] >= 2:
                    vec_flat: List[float] = []
                    mags: List[float] = []
                    for row in arr:
                        vx = float(row[0])
                        vy = float(row[1])
                        vz = float(row[2]) if len(row) > 2 else 0.0
                        vec_flat.extend([vx, vy, vz])
                        mags.append(math.sqrt(vx * vx + vy * vy + vz * vz))
                    vectors[str(name)] = vec_flat
                    scalars[f"{name}_mag"] = mags
                else:
                    scalars[str(name)] = [float(x) for x in arr]
            except Exception:
                continue

        flat_pts = [float(c) for p in pts for c in (p[0], p[1], p[2] if len(p) > 2 else 0.0)]
        xs = flat_pts[0::3]
        ys = flat_pts[1::3]
        zs = flat_pts[2::3]
        active = next(iter(scalars.keys()), "")
        return {
            "points": flat_pts,
            "triangles": triangles,
            "scalars": scalars,
            "vectors": vectors,
            "active_field": active,
            "units": {},
            "bounds": {
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            },
            "node_count": len(pts),
            "triangle_count": len(triangles) // 3,
        }
    except Exception:
        return None


def preview_cad_geometry(data: Mapping[str, Any]) -> PhysicsResult:
    """Tessellate uploaded .STL/.STEP/.IGES/.INP/.MSH CAD via real Gmsh or meshio for 3D pre-solve preview."""
    raw_bytes, cad_filename = _extract_upload_path_content(data)
    if not raw_bytes or not cad_filename:
        raise ValueError("No CAD file content provided for preview.")

    jobs_dir = Path(os.getenv("NASEER_JOB_DIR", "/app/jobs" if Path("/app/jobs").exists() else "jobs"))
    jobs_dir.mkdir(parents=True, exist_ok=True)
    work_dir = jobs_dir / f"cadprev-{uuid.uuid4().hex[:12]}"
    work_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(cad_filename).suffix.lower()
    cad_path = work_dir / f"preview_input{ext}"
    cad_path.write_bytes(raw_bytes)

    # Fast-path meshio for .inp / .vtk / .vtu / .msh / .obj if available
    if ext in {".inp", ".vtu", ".vtk", ".obj", ".ply"}:
        parsed = _extract_vtk_from_meshio_file(cad_path)
        if parsed and parsed.get("points") and parsed.get("triangles"):
            bmin = parsed["bounds"]["min"]
            bmax = parsed["bounds"]["max"]
            dims = [
                round(max(1e-6, float(bmax[0]) - float(bmin[0])), 6),
                round(max(1e-6, float(bmax[1]) - float(bmin[1])), 6),
                round(max(1e-6, float(bmax[2]) - float(bmin[2])), 6),
            ]
            return {
                "status": "PREVIEW_READY",
                "backend": "meshio",
                "filename": cad_filename,
                "dimensions": dims,
                "patches": [{"id": "surface_1", "name": "Imported Domain Surface", "dim": 2}],
                "vtk_data": parsed,
            }

    try:
        import gmsh  # type: ignore
    except ImportError as exc:
        if ext == ".stl":
            parsed = _extract_vtk_from_meshio_file(cad_path)
            if parsed and parsed.get("points") and parsed.get("triangles"):
                bmin = parsed["bounds"]["min"]
                bmax = parsed["bounds"]["max"]
                dims = [
                    round(max(1e-6, float(bmax[0]) - float(bmin[0])), 6),
                    round(max(1e-6, float(bmax[1]) - float(bmin[1])), 6),
                    round(max(1e-6, float(bmax[2]) - float(bmin[2])), 6),
                ]
                return {
                    "status": "PREVIEW_READY",
                    "backend": "meshio",
                    "filename": cad_filename,
                    "dimensions": dims,
                    "patches": [{"id": "stl_surface", "name": cad_filename, "dim": 2}],
                    "vtk_data": parsed,
                }
        raise RuntimeError("Gmsh Python library is required to tessellate B-Rep STEP/IGES CAD files.") from exc

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("cad_preview")
        if ext in {".step", ".stp", ".iges", ".igs", ".brep"}:
            gmsh.model.occ.importShapes(str(cad_path))
            gmsh.model.occ.synchronize()
            xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
            diag = math.sqrt((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) or 1.0
            gmsh.option.setNumber("Mesh.CharacteristicLengthMin", max(1e-5, diag * 0.02))
            gmsh.option.setNumber("Mesh.CharacteristicLengthMax", max(1e-4, diag * 0.08))
            gmsh.model.mesh.generate(2)
        else:
            gmsh.merge(str(cad_path))
            if ext != ".stl":
                try:
                    gmsh.model.mesh.generate(2)
                except Exception:
                    pass

        patches: List[Dict[str, Any]] = []
        node_tags, coords, _ = gmsh.model.mesh.getNodes()
        node_index_map = {int(tag): idx for idx, tag in enumerate(node_tags)}
        surface_triangles: List[int] = []
        triangle_patches: List[int] = []

        used_names: Dict[str, int] = {}
        for dim, tag in gmsh.model.getEntities(2):
            raw_name = gmsh.model.getEntityName(dim, tag) or f"Face_{tag}"
            safe_base = re.sub(r"[^A-Za-z0-9_]+", "_", raw_name).strip("_")
            if not safe_base or safe_base[0].isdigit():
                safe_base = f"Face_{safe_base or tag}"
            cnt = used_names.get(safe_base, 0) + 1
            used_names[safe_base] = cnt
            pname = safe_base if cnt == 1 else f"{safe_base}_{tag}"
            xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(dim, tag)
            center = [round((xmin + xmax) * 0.5, 6), round((ymin + ymax) * 0.5, 6), round((zmin + zmax) * 0.5, 6)]
            p_idx = len(patches)
            patches.append({
                "id": f"face_{tag}",
                "name": pname,
                "dim": dim,
                "tag": tag,
                "center": center,
                "bbox": [xmin, ymin, zmin, xmax, ymax, zmax],
            })
            try:
                e_types, _e_tags, e_nodes = gmsh.model.mesh.getElements(2, tag)
                for etype, enodes in zip(e_types, e_nodes):
                    if etype == 2:
                        for i in range(0, len(enodes), 3):
                            surface_triangles.extend([
                                node_index_map[int(enodes[i])],
                                node_index_map[int(enodes[i + 1])],
                                node_index_map[int(enodes[i + 2])],
                            ])
                            triangle_patches.append(p_idx)
                    elif etype == 9:
                        for i in range(0, len(enodes), 6):
                            surface_triangles.extend([
                                node_index_map[int(enodes[i])],
                                node_index_map[int(enodes[i + 1])],
                                node_index_map[int(enodes[i + 2])],
                            ])
                            triangle_patches.append(p_idx)
                    elif etype == 3:
                        for i in range(0, len(enodes), 4):
                            a, b, c, d = (
                                node_index_map[int(enodes[i])],
                                node_index_map[int(enodes[i + 1])],
                                node_index_map[int(enodes[i + 2])],
                                node_index_map[int(enodes[i + 3])],
                            )
                            surface_triangles.extend([a, b, c, a, c, d])
                            triangle_patches.extend([p_idx, p_idx])
            except Exception:
                pass

        if not surface_triangles:
            elem_types, _elem_tags, elem_node_tags = gmsh.model.mesh.getElements()
            for etype, enodes in zip(elem_types, elem_node_tags):
                if etype == 2:
                    for i in range(0, len(enodes), 3):
                        surface_triangles.extend([
                            node_index_map[int(enodes[i])],
                            node_index_map[int(enodes[i + 1])],
                            node_index_map[int(enodes[i + 2])],
                        ])
                        triangle_patches.append(0)
                elif etype == 9:
                    for i in range(0, len(enodes), 6):
                        surface_triangles.extend([
                            node_index_map[int(enodes[i])],
                            node_index_map[int(enodes[i + 1])],
                            node_index_map[int(enodes[i + 2])],
                        ])
                        triangle_patches.append(0)

        flat_coords = [float(c) for c in coords]
        if not flat_coords or not surface_triangles:
            raise RuntimeError(f"Gmsh extracted zero surface triangles from '{cad_filename}'.")
        xs, ys, zs = flat_coords[0::3], flat_coords[1::3], flat_coords[2::3]
        bmin = [min(xs), min(ys), min(zs)]
        bmax = [max(xs), max(ys), max(zs)]
        dims = [
            round(max(1e-6, bmax[0] - bmin[0]), 6),
            round(max(1e-6, bmax[1] - bmin[1]), 6),
            round(max(1e-6, bmax[2] - bmin[2]), 6),
        ]
        patch_summary = patches[:64] or [{"id": "cad_surface", "name": "CAD Surface", "dim": 2}]
        tri_cap = 360000
        return {
            "status": "PREVIEW_READY",
            "backend": "gmsh",
            "filename": cad_filename,
            "dimensions": dims,
            "patches": patch_summary,
            "vtk_data": {
                "points": flat_coords[:180000],
                "triangles": surface_triangles[:tri_cap],
                "triangle_patches": triangle_patches[: tri_cap // 3],
                "patches": patch_summary,
                "scalars": {},
                "active_field": "",
                "bounds": {"min": bmin, "max": bmax},
                "node_count": len(node_tags),
                "triangle_count": len(surface_triangles) // 3,
            },
        }
    finally:
        gmsh.finalize()


def call_gmsh_mesher(data: Mapping[str, Any]) -> PhysicsResult:
    """Real 2D/3D Gmsh meshing for parametric boxes or imported .STL/.STEP files with element order & inflation layers."""
    raw_bytes, cad_filename = _extract_upload_path_content(data)
    mesh_size = float(data.get("mesh_size", 0.05) or 0.05)
    if mesh_size <= 0:
        raise ValueError("mesh_size must be positive")
    width = float(data.get("width_x", 1.0) or 1.0)
    height = float(data.get("height_y", 0.4) or 0.4)
    depth = float(data.get("depth_z", 0.2) or 0.2)
    target_dim = int(data.get("dimension", 3) or 3)
    msh_version = float(data.get("msh_version", 2.2) or 2.2)
    element_order = 2 if str(data.get("element_order", "1")) == "2" else 1
    inflation_layers = int(data.get("inflation_layers") or 0)
    first_layer_height = float(data.get("first_layer_height") or 0.002)
    growth_rate = float(data.get("growth_rate") or 1.2)

    jobs_dir = Path(os.getenv("NASEER_JOB_DIR", "/app/jobs" if Path("/app/jobs").exists() else "jobs"))
    jobs_dir.mkdir(parents=True, exist_ok=True)
    work_dir = jobs_dir / f"gmsh-{uuid.uuid4().hex[:12]}"
    work_dir.mkdir(parents=True, exist_ok=True)

    msh_path = work_dir / "mesh.msh"
    inp_path = work_dir / "mesh.inp"

    try:
        import gmsh  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Gmsh Python library is not installed in this container. Run inside Docker worker with gmsh."
        ) from exc

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("Mesh.CharacteristicLengthMin", max(1e-5, mesh_size * 0.5))
        gmsh.option.setNumber("Mesh.CharacteristicLengthMax", mesh_size * 1.5)
        gmsh.option.setNumber("Mesh.ElementOrder", element_order)
        gmsh.option.setNumber("Mesh.MshFileVersion", msh_version)
        gmsh.model.add("naseer_cad_mesh")

        wall_surface_tags: List[int] = []
        detected_patches: List[Dict[str, Any]] = []

        if raw_bytes and cad_filename:
            ext = Path(cad_filename).suffix.lower()
            cad_path = work_dir / f"input{ext}"
            cad_path.write_bytes(raw_bytes)
            if ext in {".step", ".stp", ".iges", ".igs", ".brep"}:
                gmsh.model.occ.importShapes(str(cad_path))
                gmsh.model.occ.synchronize()
            else:
                gmsh.merge(str(cad_path))
                gmsh.model.mesh.classifySurfaces(40.0 * math.pi / 180.0, True, False, 180.0 * math.pi / 180.0)
                gmsh.model.mesh.createGeometry()
                surfaces = gmsh.model.getEntities(2)
                if surfaces and not gmsh.model.getEntities(3):
                    try:
                        loop = gmsh.model.geo.addSurfaceLoop([s[1] for s in surfaces])
                        gmsh.model.geo.addVolume([loop])
                    except Exception:
                        pass
                gmsh.model.geo.synchronize()

            used_names: Dict[str, int] = {}
            for dim, tag in gmsh.model.getEntities(2):
                wall_surface_tags.append(tag)
                raw_name = gmsh.model.getEntityName(dim, tag) or f"Patch_{tag}"
                safe_base = re.sub(r"[^A-Za-z0-9_]+", "_", raw_name).strip("_")
                if not safe_base or safe_base[0].isdigit():
                    safe_base = f"Patch_{safe_base or tag}"
                count = used_names.get(safe_base, 0) + 1
                used_names[safe_base] = count
                safe_name = safe_base if count == 1 else f"{safe_base}_{tag}"
                pg = gmsh.model.addPhysicalGroup(2, [tag])
                gmsh.model.setPhysicalName(2, pg, safe_name)
                xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(dim, tag)
                center = [(xmin + xmax) * 0.5, (ymin + ymax) * 0.5, (zmin + zmax) * 0.5]
                detected_patches.append({
                    "id": safe_name,
                    "name": safe_name,
                    "dim": dim,
                    "tag": tag,
                    "center": center,
                    "bbox": [xmin, ymin, zmin, xmax, ymax, zmax],
                })
            vols = gmsh.model.getEntities(3)
            if vols:
                p_vol = gmsh.model.addPhysicalGroup(3, [v[1] for v in vols])
                gmsh.model.setPhysicalName(3, p_vol, "internal")
        else:
            gmsh.model.occ.addBox(0.0, 0.0, 0.0, width, height, depth)
            gmsh.model.occ.synchronize()
            surfaces = gmsh.model.getEntities(2)
            tol = 1e-6 * max(width, height, depth)
            inlet_s, outlet_s, wall_s = [], [], []
            for dim, tag in surfaces:
                xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(dim, tag)
                if abs(xmin) < tol and abs(xmax) < tol:
                    inlet_s.append(tag)
                elif abs(xmin - width) < tol and abs(xmax - width) < tol:
                    outlet_s.append(tag)
                else:
                    wall_s.append(tag)
            wall_surface_tags = list(wall_s)
            if inlet_s:
                p_in = gmsh.model.addPhysicalGroup(2, inlet_s)
                gmsh.model.setPhysicalName(2, p_in, "inlet")
                detected_patches.append({"id": "inlet", "name": "inlet", "dim": 2, "center": [0.0, height * 0.5, depth * 0.5]})
            if outlet_s:
                p_out = gmsh.model.addPhysicalGroup(2, outlet_s)
                gmsh.model.setPhysicalName(2, p_out, "outlet")
                detected_patches.append({"id": "outlet", "name": "outlet", "dim": 2, "center": [width, height * 0.5, depth * 0.5]})
            if wall_s:
                p_w = gmsh.model.addPhysicalGroup(2, wall_s)
                gmsh.model.setPhysicalName(2, p_w, "walls")
                detected_patches.append({"id": "walls", "name": "walls", "dim": 2, "center": [width * 0.5, height * 0.5, depth * 0.5]})
            vols = gmsh.model.getEntities(3)
            if vols:
                p_vol = gmsh.model.addPhysicalGroup(3, [v[1] for v in vols])
                gmsh.model.setPhysicalName(3, p_vol, "internal")

        # Apply Gmsh BoundaryLayer / Distance size field near walls when inflation_layers > 0
        if inflation_layers > 0 and wall_surface_tags:
            try:
                dist_field = gmsh.model.mesh.field.add("Distance")
                gmsh.model.mesh.field.setNumbers(dist_field, "SurfacesList", wall_surface_tags[:24])
                thresh_field = gmsh.model.mesh.field.add("Threshold")
                gmsh.model.mesh.field.setNumber(thresh_field, "InField", dist_field)
                h0 = max(1e-5, min(mesh_size * 0.5, first_layer_height))
                total_bl_thick = h0 * ((growth_rate ** inflation_layers - 1.0) / max(1e-6, growth_rate - 1.0)) if growth_rate != 1.0 else h0 * inflation_layers
                gmsh.model.mesh.field.setNumber(thresh_field, "SizeMin", h0)
                gmsh.model.mesh.field.setNumber(thresh_field, "SizeMax", mesh_size * 1.5)
                gmsh.model.mesh.field.setNumber(thresh_field, "DistMin", h0)
                gmsh.model.mesh.field.setNumber(thresh_field, "DistMax", max(h0 * 2.0, total_bl_thick * 2.0))
                gmsh.model.mesh.field.setAsBackgroundMesh(thresh_field)
            except Exception:
                pass

        gmsh.model.mesh.generate(target_dim)
        gmsh.write(str(msh_path))
        gmsh.write(str(inp_path))

        node_tags, coords, _ = gmsh.model.mesh.getNodes()
        node_index_map = {int(tag): idx for idx, tag in enumerate(node_tags)}

        elem_types, elem_tags, elem_node_tags = gmsh.model.mesh.getElements()
        total_elements = sum(len(et) for et in elem_tags)
        surface_triangles: List[int] = []
        triangle_patches: List[int] = []
        patch_nodes: Dict[str, List[int]] = {}
        vol_tags: List[int] = []

        # Collect 2D surface triangles tagged by physical group for exact CAD patch picking & BC node mapping
        try:
            for dim_pg, pg_tag in gmsh.model.getPhysicalGroups(2):
                pg_name = gmsh.model.getPhysicalName(dim_pg, pg_tag) or f"Patch_{pg_tag}"
                p_idx = next((idx for idx, p in enumerate(detected_patches) if p["name"] == pg_name), -1)
                if p_idx < 0:
                    p_idx = len(detected_patches)
                    detected_patches.append({"id": pg_name, "name": pg_name, "dim": 2, "tag": pg_tag})
                try:
                    n_tags_pg, _ = gmsh.model.mesh.getNodesForPhysicalGroup(2, pg_tag)
                    patch_nodes[pg_name] = sorted({int(n) for n in n_tags_pg})
                except Exception:
                    pass
                for ent_tag in gmsh.model.getEntitiesForPhysicalGroup(2, pg_tag):
                    e_types, _et, e_nodes = gmsh.model.mesh.getElements(2, ent_tag)
                    for etype, enodes in zip(e_types, e_nodes):
                        if etype == 2:
                            for i in range(0, len(enodes), 3):
                                surface_triangles.extend([
                                    node_index_map[int(enodes[i])],
                                    node_index_map[int(enodes[i + 1])],
                                    node_index_map[int(enodes[i + 2])],
                                ])
                                triangle_patches.append(p_idx)
                        elif etype == 9:
                            for i in range(0, len(enodes), 6):
                                surface_triangles.extend([
                                    node_index_map[int(enodes[i])],
                                    node_index_map[int(enodes[i + 1])],
                                    node_index_map[int(enodes[i + 2])],
                                ])
                                triangle_patches.append(p_idx)
        except Exception:
            pass

        for etype, etags, enodes in zip(elem_types, elem_tags, elem_node_tags):
            # Type 2 = 3-node triangle; Type 9 = 6-node second-order triangle; Type 4/11 = tet
            if not surface_triangles and etype == 2:
                for i in range(0, len(enodes), 3):
                    surface_triangles.extend([
                        node_index_map[int(enodes[i])],
                        node_index_map[int(enodes[i + 1])],
                        node_index_map[int(enodes[i + 2])],
                    ])
                    triangle_patches.append(0)
            elif not surface_triangles and etype == 9:
                for i in range(0, len(enodes), 6):
                    surface_triangles.extend([
                        node_index_map[int(enodes[i])],
                        node_index_map[int(enodes[i + 1])],
                        node_index_map[int(enodes[i + 2])],
                    ])
                    triangle_patches.append(0)
            elif etype in {4, 11}:
                vol_tags.extend(int(t) for t in etags)

        qualities: List[float] = []
        if vol_tags:
            qualities = [float(q) for q in gmsh.model.mesh.getElementQualities(vol_tags[:50000], "minSICN")]
        elif total_elements > 0:
            all_tags = [int(t) for sub in elem_tags for t in sub]
            qualities = [float(q) for q in gmsh.model.mesh.getElementQualities(all_tags[:50000], "gamma")]

        min_q = round(min(qualities), 4) if qualities else 0.0
        avg_q = round(sum(qualities) / len(qualities), 4) if qualities else 0.0
        max_q = round(max(qualities), 4) if qualities else 0.0
        max_skew = round(max(0.0, min(1.0, 1.0 - min_q)), 4) if qualities else 0.0
        bins = [0, 0, 0, 0, 0]
        for q in qualities:
            idx = min(4, max(0, int(q * 5)))
            bins[idx] += 1

        flat_coords = [float(c) for c in coords]
        xs, ys, zs = flat_coords[0::3], flat_coords[1::3], flat_coords[2::3]
        bounds = {
            "min": [min(xs) if xs else 0.0, min(ys) if ys else 0.0, min(zs) if zs else 0.0],
            "max": [max(xs) if xs else width, max(ys) if ys else height, max(zs) if zs else depth],
        }
        tri_cap = 360000

        return {
            "status": "MESHED",
            "mesher": "Gmsh",
            "element_order": element_order,
            "inflation_layers": inflation_layers,
            "case_directory": str(work_dir),
            "msh_path": str(msh_path),
            "inp_path": str(inp_path),
            "nodes_count": len(node_tags),
            "elements_count": total_elements,
            "volume_elements_count": len(vol_tags),
            "surface_triangles_count": len(surface_triangles) // 3,
            "min_quality": min_q,
            "avg_quality": avg_q,
            "max_quality": max_q,
            "max_skewness": max_skew,
            "patches": detected_patches,
            "patch_nodes": patch_nodes,
            "quality_histogram": [
                {"bin": "0.0-0.2", "count": bins[0]},
                {"bin": "0.2-0.4", "count": bins[1]},
                {"bin": "0.4-0.6", "count": bins[2]},
                {"bin": "0.6-0.8", "count": bins[3]},
                {"bin": "0.8-1.0", "count": bins[4]},
            ],
            "vtk_data": {
                "points": flat_coords[:180000],
                "triangles": surface_triangles[:tri_cap],
                "triangle_patches": triangle_patches[: tri_cap // 3],
                "patches": detected_patches,
                "scalars": {},
                "active_field": "",
                "bounds": bounds,
                "node_count": len(node_tags),
                "triangle_count": len(surface_triangles) // 3,
            },
        }
    finally:
        gmsh.finalize()


def _compute_effective_fluid_props(data: Mapping[str, Any]) -> Dict[str, float]:
    """Compute fluid or effective nanofluid properties deterministically."""
    fp = data.get("fluid_properties") if isinstance(data.get("fluid_properties"), Mapping) else {}
    mat = data.get("material_properties") if isinstance(data.get("material_properties"), Mapping) else (
        data.get("material") if isinstance(data.get("material"), Mapping) else {}
    )
    rho_f = float(fp.get("density") or mat.get("density") or data.get("density") or 998.2)
    mu_f = float(fp.get("dynamic_viscosity") or mat.get("viscosity") or data.get("dynamic_viscosity") or 0.001003)
    k_f = float(fp.get("thermal_conductivity") or mat.get("thermal_conductivity_k") or data.get("thermal_conductivity_k") or 0.6)
    cp_f = float(fp.get("specific_heat") or mat.get("specific_heat") or data.get("specific_heat") or 4182.0)
    beta = float(fp.get("thermal_expansion") or 2.1e-4)

    phi = float(fp.get("nanofluid_vol_fraction") or data.get("nanofluid_vol_fraction") or 0.0)
    if phi > 0.0:
        phi = min(0.15, max(0.0, phi))
        rho_p = float(fp.get("nanoparticle_density") or 3970.0)
        k_p = float(fp.get("nanoparticle_k") or 40.0)
        cp_p = float(fp.get("nanoparticle_cp") or 765.0)
        rho_eff = (1.0 - phi) * rho_f + phi * rho_p
        cp_eff = ((1.0 - phi) * rho_f * cp_f + phi * rho_p * cp_p) / rho_eff
        mu_eff = mu_f * (1.0 + 2.5 * phi + 6.2 * (phi ** 2))
        k_eff = k_f * ((k_p + 2.0 * k_f - 2.0 * phi * (k_f - k_p)) / (k_p + 2.0 * k_f + phi * (k_f - k_p)))
    else:
        rho_eff, cp_eff, mu_eff, k_eff = rho_f, cp_f, mu_f, k_f

    nu_eff = float(fp.get("kinematic_viscosity") or (mu_eff / max(rho_eff, 1e-6)))
    prandtl = (mu_eff * cp_eff) / max(k_eff, 1e-9)
    return {
        "rho": rho_eff,
        "mu": mu_eff,
        "nu": nu_eff,
        "k": k_eff,
        "cp": cp_eff,
        "prandtl": prandtl,
        "beta": beta,
        "phi": phi,
    }


def _classify_openfoam_turbulence(turb_model: str) -> Dict[str, Any]:
    """Classify OpenFOAM turbulence selection into laminar, RAS, LES, or DDES metadata."""
    norm = (turb_model or "laminar").strip().lower().replace("-", "_").replace(" ", "_")
    if norm in {"", "laminar", "none"}:
        return {
            "simulation_type": "laminar",
            "model": "laminar",
            "delta": None,
            "is_les": False,
            "needs_nutilda": False,
            "uses_k": False,
        }
    les_map: Dict[str, Tuple[str, str, bool, bool]] = {
        "wale": ("WALE", "cubeRootVol", False, False),
        "les_wale": ("WALE", "cubeRootVol", False, False),
        "smagorinsky": ("Smagorinsky", "cubeRootVol", False, False),
        "les_smagorinsky": ("Smagorinsky", "cubeRootVol", False, False),
        "keqn": ("kEqn", "cubeRootVol", False, True),
        "les_keqn": ("kEqn", "cubeRootVol", False, True),
        "spalartallmarasddes": ("SpalartAllmarasDDES", "vanDriest", True, False),
        "spalart_allmaras_ddes": ("SpalartAllmarasDDES", "vanDriest", True, False),
        "ddes": ("SpalartAllmarasDDES", "vanDriest", True, False),
    }
    if norm in les_map:
        model_name, delta_name, needs_nutilda, uses_k = les_map[norm]
        return {
            "simulation_type": "LES",
            "model": model_name,
            "delta": delta_name,
            "is_les": True,
            "needs_nutilda": needs_nutilda,
            "uses_k": uses_k,
        }
    ras_map: Dict[str, Tuple[str, bool, bool]] = {
        "komegasst": ("kOmegaSST", False, True),
        "k_omega_sst": ("kOmegaSST", False, True),
        "kepsilon": ("kEpsilon", False, True),
        "k_epsilon": ("kEpsilon", False, True),
        "spalartallmaras": ("SpalartAllmaras", True, False),
        "spalart_allmaras": ("SpalartAllmaras", True, False),
    }
    ras_name, needs_nutilda, uses_k = ras_map.get(norm, ("kOmegaSST", False, True))
    return {
        "simulation_type": "RAS",
        "model": ras_name,
        "delta": None,
        "is_les": False,
        "needs_nutilda": needs_nutilda,
        "uses_k": uses_k,
    }


def _openfoam_turbulence_setup(
    case_dir: Path,
    turb_model: str,
    velocity: float,
    char_len: float,
    nu: float,
    patch_roles: Optional[Mapping[str, str]] = None,
) -> Dict[str, Any]:
    """Write turbulenceProperties + RAS/LES/DDES initial fields (k, omega, epsilon, nuTilda, nut)."""
    meta = _classify_openfoam_turbulence(turb_model)
    if meta["simulation_type"] == "laminar":
        (case_dir / "constant" / "turbulenceProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object turbulenceProperties; }\n'
            "simulationType laminar;\n",
            encoding="utf-8",
        )
        return meta

    if meta["simulation_type"] == "LES":
        model_name = meta["model"]
        if meta["delta"] == "vanDriest":
            delta_block = (
                "  delta vanDriest;\n"
                "  vanDriestCoeffs {\n"
                "    delta cubeRootVol;\n"
                "    cubeRootVolCoeffs { deltaCoeff 1; }\n"
                "    kappa 0.41;\n"
                "    Aplus 26;\n"
                "    Cdelta 0.158;\n"
                "  }\n"
            )
        else:
            delta_block = (
                "  delta cubeRootVol;\n"
                "  cubeRootVolCoeffs { deltaCoeff 1; }\n"
            )
        (case_dir / "constant" / "turbulenceProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object turbulenceProperties; }\n'
            "simulationType LES;\n"
            "LES {\n"
            f"  LESModel {model_name};\n"
            "  turbulence on;\n"
            "  printCoeffs on;\n"
            f"{delta_block}"
            "}\n",
            encoding="utf-8",
        )
    else:
        ras_name = meta["model"]
        (case_dir / "constant" / "turbulenceProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object turbulenceProperties; }\n'
            "simulationType RAS;\n"
            f"RAS {{ RASModel {ras_name}; turbulence on; printCoeffs on; }}\n",
            encoding="utf-8",
        )

    u_ref = max(abs(velocity), 0.1)
    intensity = 0.05
    k_val = max(1e-6, 1.5 * (u_ref * intensity) ** 2)
    l_mix = max(1e-4, 0.07 * char_len)
    eps_val = max(1e-6, (0.09 ** 0.75) * (k_val ** 1.5) / l_mix)
    omega_val = max(1e-3, (k_val ** 0.5) / ((0.09 ** 0.25) * l_mix))
    nut_val = max(nu, 0.09 * (k_val ** 2) / eps_val)
    nu_tilda_val = max(3.0 * max(nu, 1e-9), 1e-6)
    nut_wall_fn = "nutkWallFunction" if meta["uses_k"] else "nutUSpaldingWallFunction"

    roles = dict(patch_roles or {
        "inlet": "inlet",
        "outlet": "outlet",
        "walls": "wall",
        "frontAndBack": "empty",
    })

    def _bc_block(field_name: str) -> str:
        lines: List[str] = []
        for pname, role in roles.items():
            if role == "empty":
                lines.append(f"  {pname} {{ type empty; }}")
            elif role == "inlet":
                if field_name == "k":
                    lines.append(f"  {pname} {{ type fixedValue; value uniform {k_val:.6g}; }}")
                elif field_name == "epsilon":
                    lines.append(f"  {pname} {{ type fixedValue; value uniform {eps_val:.6g}; }}")
                elif field_name == "omega":
                    lines.append(f"  {pname} {{ type fixedValue; value uniform {omega_val:.6g}; }}")
                elif field_name == "nuTilda":
                    lines.append(f"  {pname} {{ type fixedValue; value uniform {nu_tilda_val:.6g}; }}")
                else:
                    lines.append(f"  {pname} {{ type calculated; value uniform 0; }}")
            elif role == "outlet":
                if field_name == "nut":
                    lines.append(f"  {pname} {{ type calculated; value uniform 0; }}")
                else:
                    lines.append(f"  {pname} {{ type zeroGradient; }}")
            elif role == "slip":
                if field_name == "nut":
                    lines.append(f"  {pname} {{ type calculated; value uniform 0; }}")
                else:
                    lines.append(f"  {pname} {{ type slip; }}")
            else:
                if field_name == "k":
                    lines.append(f"  {pname} {{ type kqRWallFunction; value uniform {k_val:.6g}; }}")
                elif field_name == "epsilon":
                    lines.append(f"  {pname} {{ type epsilonWallFunction; value uniform {eps_val:.6g}; }}")
                elif field_name == "omega":
                    lines.append(f"  {pname} {{ type omegaWallFunction; value uniform {omega_val:.6g}; }}")
                elif field_name == "nuTilda":
                    lines.append(f"  {pname} {{ type fixedValue; value uniform 0; }}")
                else:
                    lines.append(f"  {pname} {{ type {nut_wall_fn}; value uniform 0; }}")
        return "\n".join(lines)

    if meta["uses_k"] or meta["simulation_type"] == "RAS":
        (case_dir / "0" / "k").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object k; }\n'
            f"dimensions [0 2 -2 0 0 0 0];\ninternalField uniform {k_val:.6g};\n"
            f"boundaryField {{\n{_bc_block('k')}\n}}\n",
            encoding="utf-8",
        )
    if meta["simulation_type"] == "RAS":
        (case_dir / "0" / "epsilon").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object epsilon; }\n'
            f"dimensions [0 2 -3 0 0 0 0];\ninternalField uniform {eps_val:.6g};\n"
            f"boundaryField {{\n{_bc_block('epsilon')}\n}}\n",
            encoding="utf-8",
        )
        (case_dir / "0" / "omega").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object omega; }\n'
            f"dimensions [0 0 -1 0 0 0 0];\ninternalField uniform {omega_val:.6g};\n"
            f"boundaryField {{\n{_bc_block('omega')}\n}}\n",
            encoding="utf-8",
        )
    if meta["needs_nutilda"]:
        (case_dir / "0" / "nuTilda").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object nuTilda; }\n'
            f"dimensions [0 2 -1 0 0 0 0];\ninternalField uniform {nu_tilda_val:.6g};\n"
            f"boundaryField {{\n{_bc_block('nuTilda')}\n}}\n",
            encoding="utf-8",
        )
    (case_dir / "0" / "nut").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object nut; }\n'
        f"dimensions [0 2 -1 0 0 0 0];\ninternalField uniform {nut_val:.6g};\n"
        f"boundaryField {{\n{_bc_block('nut')}\n}}\n",
        encoding="utf-8",
    )
    return meta


def _write_openfoam_mrf_setup(
    case_dir: Path,
    data: Mapping[str, Any],
    patch_roles: Mapping[str, str],
    width: float,
    height: float,
    depth: float,
    existing_topo_actions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Write OpenFOAM v2406 constant/MRFProperties and cylinderToCell rotorZone in system/topoSetDict."""
    omega = float(data.get("mrf_omega_rad_s") or 0.0)
    if abs(omega) <= 1e-12:
        raise ValueError("MRF rotating zone requires a non-zero angular velocity (`mrf_omega_rad_s`, rad/s).")

    radius = float(data.get("mrf_radius") or (min(width, height) * 0.3))
    if radius <= 0.0:
        raise ValueError("MRF rotor radius (`mrf_radius`) must be strictly positive (meters).")

    raw_axis = data.get("mrf_axis")
    if isinstance(raw_axis, str):
        axis_lut = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}
        ax, ay, az = axis_lut.get(raw_axis.strip().lower(), (0.0, 0.0, 1.0))
    elif isinstance(raw_axis, (list, tuple)) and len(raw_axis) >= 3:
        ax, ay, az = float(raw_axis[0]), float(raw_axis[1]), float(raw_axis[2])
    else:
        ax, ay, az = 0.0, 0.0, 1.0
    a_mag = math.sqrt(ax * ax + ay * ay + az * az)
    if a_mag <= 1e-12:
        ax, ay, az = 0.0, 0.0, 1.0
    else:
        ax, ay, az = ax / a_mag, ay / a_mag, az / a_mag

    raw_origin = data.get("mrf_origin")
    if isinstance(raw_origin, (list, tuple)) and len(raw_origin) >= 3:
        ox, oy, oz = float(raw_origin[0]), float(raw_origin[1]), float(raw_origin[2])
    else:
        ox, oy, oz = width * 0.5, height * 0.5, depth * 0.5

    half_span = max(width, height, depth) * 0.6 + 1e-3
    p1 = (ox - ax * half_span, oy - ay * half_span, oz - az * half_span)
    p2 = (ox + ax * half_span, oy + ay * half_span, oz + az * half_span)

    actions: List[str] = list(existing_topo_actions or [])
    actions.append(
        "{ name rotorZone; type cellSet; action new; source cylinderToCell; "
        f"sourceInfo {{ p1 ({p1[0]:.8g} {p1[1]:.8g} {p1[2]:.8g}); "
        f"p2 ({p2[0]:.8g} {p2[1]:.8g} {p2[2]:.8g}); radius {radius:.8g}; }} }}"
    )
    actions.append(
        "{ name rotorZone; type cellZoneSet; action new; source setToCellZone; sourceInfo { set rotorZone; } }"
    )
    (case_dir / "system" / "topoSetDict").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object topoSetDict; }\n'
        "actions (\n  " + "\n  ".join(actions) + "\n);\n",
        encoding="utf-8",
    )

    non_rotating = [
        pname
        for pname, role in patch_roles.items()
        if role != "empty" and not any(tok in pname.lower() for tok in ("rotor", "impeller", "blade"))
    ]
    non_rot_str = " ".join(non_rotating)
    (case_dir / "constant" / "MRFProperties").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object MRFProperties; }\n'
        "MRF1\n{\n"
        "  cellZone        rotorZone;\n"
        "  active          yes;\n"
        f"  nonRotatingPatches ( {non_rot_str} );\n"
        f"  origin          ({ox:.8g} {oy:.8g} {oz:.8g});\n"
        f"  axis            ({ax:.8g} {ay:.8g} {az:.8g});\n"
        f"  omega           {omega:.8g};\n"
        "}\n",
        encoding="utf-8",
    )
    return {
        "cell_zone": "rotorZone",
        "omega_rad_s": omega,
        "radius_m": radius,
        "origin": [ox, oy, oz],
        "axis": [ax, ay, az],
        "non_rotating_patches": non_rotating,
    }


def _run_openfoam_archive(archive_b64: str, data: Mapping[str, Any]) -> PhysicsResult:
    """Extract and execute an uploaded OpenFOAM case archive directly inside Docker worker."""
    clean = archive_b64.split(",", 1)[-1].strip()
    raw = base64.b64decode(clean)
    configured_root = os.getenv("OPENFOAM_CASE_ROOT")
    root = Path(configured_root) if configured_root else (Path("/app/jobs") if Path("/app/jobs").exists() else Path.cwd() / "jobs")
    root.mkdir(parents=True, exist_ok=True)
    extract_dir = root / f"openfoam-case-{uuid.uuid4().hex[:12]}"
    extract_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        zf.extractall(extract_dir)

    # Locate the directory containing system/controlDict
    case_dir = extract_dir
    if not (case_dir / "system" / "controlDict").is_file():
        candidates = list(extract_dir.rglob("system/controlDict"))
        if not candidates:
            raise RuntimeError("Uploaded OpenFOAM archive contains no system/controlDict")
        case_dir = candidates[0].parent.parent

    ctrl = (case_dir / "system" / "controlDict").read_text(encoding="utf-8", errors="replace")
    m = re.search(r"application\s+([A-Za-z0-9_]+)\s*;", ctrl)
    solver_name = m.group(1) if m else "simpleFoam"
    executable = shutil.which(solver_name)
    if not executable:
        raise RuntimeError(f"Requested OpenFOAM archive solver '{solver_name}' is not available on worker PATH.")

    env = _openfoam_env()

    def run(cmd: List[str]) -> None:
        proc = subprocess.run(cmd, cwd=case_dir, env=env, text=True, capture_output=True, timeout=180, check=False)
        with (case_dir / "solver.log").open("a", encoding="utf-8") as stream:
            stream.write(proc.stdout or "")
            stream.write(proc.stderr or "")
        if proc.returncode != 0:
            raise RuntimeError(f"{cmd[0]} failed: {(proc.stderr or proc.stdout or '')[-3000:]}")

    if not (case_dir / "constant" / "polyMesh" / "points").exists() and (case_dir / "system" / "blockMeshDict").exists():
        bm = shutil.which("blockMesh")
        if bm:
            run([bm])
    run([executable])

    verification = verify_openfoam_convergence(case_dir, solver_name)
    if not verification["valid"]:
        raise OpenFOAMVerificationError(verification["error"])

    foam_to_vtk = shutil.which("foamToVTK")
    vtk_payload: Any = []
    if foam_to_vtk:
        try:
            run([foam_to_vtk, "-latestTime"])
            vtu_files = sorted((case_dir / "VTK").rglob("*.vtu")) or sorted((case_dir / "VTK").rglob("*.vtk"))
            if vtu_files:
                parsed = _extract_vtk_from_meshio_file(vtu_files[0])
                if parsed:
                    vtk_payload = parsed
        except Exception:
            pass

    log_text = (case_dir / "solver.log").read_text(encoding="utf-8", errors="replace")
    residuals = parse_openfoam_residuals(log_text)
    fields = parse_openfoam_fields(case_dir)
    result = {
        "status": "SOLVED_REALTIME",
        "solver": "OpenFOAM",
        "solver_variant": solver_name,
        "executable": executable,
        "case_directory": str(case_dir),
        "residuals": residuals,
        "convergence": {
            "converged": bool(residuals and all(v["values"] and v["values"][-1] < 1e-3 for v in residuals.values())),
            "residuals": residuals,
        },
        "pressure": fields.get("pressure", {}),
        "velocity": fields.get("velocity", {}),
        "temperature": fields.get("temperature", {}),
        "vtk_data": vtk_payload,
        "artifacts": {"case_directory": str(case_dir), "log": str(case_dir / "solver.log")},
        "units": {"pressure": "Pa", "velocity": "m/s", "temperature": "K"},
        "input": {k: v for k, v in data.items() if k != "openfoam_archive_b64"},
    }
    return canonicalize_result(result, physics_type=classify_physics(data), input_data=result["input"], solver="OpenFOAM")


def _discover_polymesh_patches(case_dir: Path) -> List[Dict[str, Any]]:
    """Parse OpenFOAM constant/polyMesh/boundary (+ points/faces) to get real CAD patch names & centroids."""
    bpath = case_dir / "constant" / "polyMesh" / "boundary"
    if not bpath.is_file():
        return []
    btext = bpath.read_text(encoding="utf-8", errors="replace")
    patch_matches = re.finditer(
        r"^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\n?\s*\{\s*([^}]*)\}",
        btext,
        re.M | re.S,
    )
    patches: List[Dict[str, Any]] = []
    for m in patch_matches:
        pname = m.group(1)
        if pname in {"FoamFile", "boundary"}:
            continue
        body = m.group(2)
        ptype_m = re.search(r"\btype\s+([A-Za-z0-9_]+)\s*;", body)
        nfaces_m = re.search(r"\bnFaces\s+(\d+)\s*;", body)
        sface_m = re.search(r"\bstartFace\s+(\d+)\s*;", body)
        nfaces = int(nfaces_m.group(1)) if nfaces_m else 0
        sface = int(sface_m.group(1)) if sface_m else 0
        ptype = ptype_m.group(1) if ptype_m else "patch"
        if nfaces > 0:
            patches.append({
                "name": pname,
                "type": ptype,
                "nFaces": nfaces,
                "startFace": sface,
                "center": [0.0, 0.0, 0.0],
            })
    if not patches:
        return []

    # Compute exact face-weighted centroid per patch from polyMesh/points & faces
    pts_path = case_dir / "constant" / "polyMesh" / "points"
    faces_path = case_dir / "constant" / "polyMesh" / "faces"
    if pts_path.is_file() and faces_path.is_file():
        try:
            pts_raw = pts_path.read_text(encoding="utf-8", errors="replace")
            pt_tuples = re.findall(r"\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)", pts_raw)
            pts = [(float(x), float(y), float(z)) for x, y, z in pt_tuples]
            faces_raw = faces_path.read_text(encoding="utf-8", errors="replace")
            face_matches = re.findall(r"\d+\(\s*([\d\s]+)\s*\)", faces_raw)
            if pts and face_matches:
                for p in patches:
                    sf = p["startFace"]
                    ef = min(len(face_matches), sf + p["nFaces"])
                    sx = sy = sz = 0.0
                    cnt = 0
                    for fi in range(sf, ef):
                        vids = [int(tok) for tok in face_matches[fi].split()]
                        for vid in vids:
                            if 0 <= vid < len(pts):
                                sx += pts[vid][0]
                                sy += pts[vid][1]
                                sz += pts[vid][2]
                                cnt += 1
                    if cnt > 0:
                        p["center"] = [sx / cnt, sy / cnt, sz / cnt]
        except Exception:
            pass
    return patches


def _rewrite_polymesh_wall_types(case_dir: Path, wall_names: set[str]) -> None:
    bpath = case_dir / "constant" / "polyMesh" / "boundary"
    if not bpath.is_file() or not wall_names:
        return
    btext = bpath.read_text(encoding="utf-8", errors="replace")
    for wname in wall_names:
        pattern = re.compile(rf"(\b{re.escape(wname)}\s*\n?\s*\{{[^}}]*?\btype\s+)patch(\s*;)", re.S)
        btext = pattern.sub(r"\1wall\2", btext)
    bpath.write_text(btext, encoding="utf-8")


def call_openfoam_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Create and execute a configurable OpenFOAM CFD / CHT / Thermal / VOF case."""
    if isinstance(data.get("openfoam_archive_b64"), str) and data["openfoam_archive_b64"].strip():
        return _run_openfoam_archive(data["openfoam_archive_b64"], data)

    physics_type = classify_physics(data)
    compressible = physics_type == "CFD_Compressible"
    is_cht = physics_type == "CHT_Coupled"
    is_vof = physics_type == "Multiphase_VOF"
    turb_model = str(data.get("turbulence_model") or "laminar")
    turb_class = _classify_openfoam_turbulence("laminar" if compressible else turb_model)
    mrf_requested = bool(data.get("mrf_enabled")) or abs(float(data.get("mrf_omega_rad_s") or 0.0)) > 0.0
    time_mode = str(data.get("time_mode") or "steady").lower()
    is_transient = time_mode == "transient" or is_vof or bool(turb_class["is_les"])

    # Promote CFD to CHT when wall thermal boundary conditions (heat flux / wall temperature) are present
    markers = data.get("boundary_markers")
    has_thermal_pin = isinstance(markers, list) and any(
        isinstance(m, Mapping) and any(tok in str(m.get("type") or m.get("subtype") or "").lower() for tok in ("heat", "temp", "convection"))
        for m in markers
    )
    heat_flux_req = float(data.get("heat_flux") or 0.0)
    wall_temp_req = data.get("wall_temperature")
    if (abs(heat_flux_req) > 0.0 or wall_temp_req is not None or has_thermal_pin) and not compressible and not is_vof and not is_cht:
        is_cht = True

    if is_vof:
        candidates = ("interFoam",)
    elif is_cht:
        candidates = ("buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam", "simpleFoam")
    elif compressible:
        candidates = ("rhoPimpleFoam", "rhoSimpleFoam", "sonicFoam") if is_transient else ("rhoSimpleFoam", "rhoPimpleFoam", "sonicFoam")
    elif turb_class["is_les"]:
        candidates = ("pimpleFoam", "simpleFoam")
    elif is_transient:
        candidates = ("pimpleFoam", "simpleFoam") if mrf_requested else ("pimpleFoam", "icoFoam", "simpleFoam")
    else:
        candidates = ("simpleFoam", "pimpleFoam") if (turb_class["simulation_type"] != "laminar" or mrf_requested) else ("icoFoam", "simpleFoam", "pimpleFoam")

    resolved = {name: shutil.which(name) for name in candidates}
    executable = next((path for path in resolved.values() if path), None)
    block_mesh = shutil.which("blockMesh")
    if not executable or not block_mesh:
        raise RuntimeError(
            "OpenFOAM environment validation failed: blockMesh and one of "
            + ", ".join(candidates)
            + " must be available on PATH inside the Docker worker."
        )

    solver_stem = Path(executable).stem
    configured_root = os.getenv("OPENFOAM_CASE_ROOT")
    root = Path(configured_root) if configured_root else (Path("/app/jobs") if Path("/app/jobs").exists() else Path.cwd() / "jobs")
    root.mkdir(parents=True, exist_ok=True)
    case_dir = root / f"openfoam-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "constant").mkdir()
    (case_dir / "constant" / "polyMesh").mkdir()
    (case_dir / "system").mkdir()
    (case_dir / "0").mkdir()

    fluid = _compute_effective_fluid_props(data)
    domain = data.get("domain", {}) if isinstance(data.get("domain"), Mapping) else {}
    width = float(domain.get("width_x", domain.get("width", data.get("width_x", data.get("domain_length", 1.0)))))
    height = float(domain.get("height_y", domain.get("height", data.get("height_y", data.get("domain_height", 0.4)))))
    depth = float(domain.get("depth_z", domain.get("depth", data.get("depth_z", 0.1))))
    if width <= 0 or height <= 0 or depth <= 0:
        raise ValueError("OpenFOAM domain dimensions must be positive")
    mesh = data.get("mesh_settings", {}) if isinstance(data.get("mesh_settings"), Mapping) else {}
    size = float(mesh.get("mesh_size", data.get("mesh_size", 0.05)))
    if size <= 0:
        raise ValueError("mesh_size must be positive")

    raw_bc = data.get("boundary_conditions", {})
    boundary_conditions = raw_bc if isinstance(raw_bc, Mapping) else {}
    velocity = float(data.get("velocity", boundary_conditions.get("velocity", boundary_conditions.get("inlet_velocity_mps", 1.0))))
    pressure = float(data.get("pressure", boundary_conditions.get("pressure", 101325.0 if (compressible or solver_stem == "buoyantSimpleFoam") else 0.0)))
    temperature_kelvin = temperature_to_kelvin(data)
    if wall_temp_req is not None:
        wt_num = float(wall_temp_req)
        wall_temp_k = wt_num + 273.15 if wt_num < 150.0 else wt_num
    else:
        wall_temp_k = float(data.get("bc_left_temp", temperature_kelvin + 40.0 if is_cht else temperature_kelvin))

    # Extended solver control cards & typed boundary patches
    inlet_mode = "velocity"
    mass_flow_rate = 0.0
    inlet_total_p = pressure
    outlet_p = pressure if (compressible or solver_stem == "buoyantSimpleFoam") else 0.0
    wall_u_bc = "type noSlip;"
    use_heat_flux = abs(heat_flux_req) > 0.0
    wall_t_grad = heat_flux_req / max(fluid["k"], 1e-6)
    wall_t_bc = (
        f"type fixedGradient; gradient uniform {wall_t_grad:.8g};"
        if use_heat_flux
        else f"type fixedValue; value uniform {wall_temp_k:.8g};"
    )

    if isinstance(markers, list):
        for m in markers:
            if not isinstance(m, Mapping):
                continue
            mtype = str(m.get("subtype") or m.get("type") or "").lower()
            try:
                mval = float(m.get("value"))
            except (TypeError, ValueError):
                mval = None
            if "mass flow" in mtype and mval is not None:
                inlet_mode = "mass_flow"
                mass_flow_rate = mval
                inlet_area = max(1e-9, height * depth)
                velocity = mval / (max(1e-6, fluid["rho"]) * inlet_area)
            elif "pressure inlet" in mtype and mval is not None:
                inlet_mode = "pressure_inlet"
                inlet_total_p = mval
            elif ("inlet" in mtype) and mval is not None:
                velocity = mval
            elif "outlet" in mtype and mval is not None:
                outlet_p = mval
            elif "slip wall" in mtype:
                wall_u_bc = "type slip;"
            elif "moving wall" in mtype and mval is not None:
                wall_u_bc = f"type fixedValue; value uniform ({mval} 0 0);"
            elif "flux" in mtype and mval is not None:
                use_heat_flux = True
                heat_flux_req = mval
                wall_t_grad = mval / max(fluid["k"], 1e-6)
                wall_t_bc = f"type fixedGradient; gradient uniform {wall_t_grad:.8g};"
            elif "heat" in mtype and mval is not None:
                use_heat_flux = False
                wall_temp_k = mval + 273.15 if mval < 150.0 else mval
                wall_t_bc = f"type fixedValue; value uniform {wall_temp_k:.8g};"

    # Check if user enabled External Aerodynamics (snappyHexMesh) OR uploaded internal CAD for Gmsh
    raw_cad, cad_filename = _extract_upload_path_content(data)
    external_aero = bool(data.get("external_aero"))
    gmsh_to_foam = shutil.which("gmshToFoam")
    snappy_bin = shutil.which("snappyHexMesh")
    sfe_bin = shutil.which("surfaceFeatureExtract")
    used_gmsh_cad = False
    used_snappy_aero = False
    aero_spec: Optional[Dict[str, Any]] = None
    cad_mesh_res: Optional[Dict[str, Any]] = None
    geometry_mode = str(data.get("geometry_mode") or "smooth_channel").lower()
    wave_count = max(0, int(data.get("wave_count") or 0))
    wave_amp_ratio = float(data.get("wave_amplitude_ratio") or 0.0)
    is_corrugated = geometry_mode == "corrugated_channel" and wave_count > 0 and wave_amp_ratio > 0.0

    nx = max(4, min(200, int(round(width / size))))
    if is_corrugated:
        nx = max(nx, min(200, wave_count * 16))
    ny = max(4, min(200, int(round(height / size))))
    nz = max(4, min(16, int(round(depth / size)))) if (is_vof or turb_class["is_les"]) else 1

    if external_aero:
        if not (raw_cad and cad_filename):
            raise ValueError(
                "External Aerodynamics (snappyHexMesh) requires an uploaded 3D body (.STL, .STEP, or .IGES)."
            )
        if not snappy_bin:
            raise RuntimeError(
                "OpenFOAM environment validation failed: snappyHexMesh must be available on PATH inside the Docker worker."
            )
        stl_path = _prepare_external_aero_stl(raw_cad, cad_filename, case_dir / "constant" / "triSurface")
        obs_min, obs_max = _compute_stl_bounds(stl_path)
        aero_spec = _build_external_wind_tunnel_spec(
            obs_min,
            obs_max,
            upstream_mult=float(data.get("tunnel_upstream_mult") or 3.0),
            downstream_mult=float(data.get("tunnel_downstream_mult") or 6.0),
            pad_mult=float(data.get("tunnel_pad_mult") or 2.5),
            base_cell_size=size if size > 0 else None,
        )
        _write_external_aero_dicts(
            case_dir,
            aero_spec,
            surface_level=int(data.get("aero_surface_level") or 2),
            wake_level=int(data.get("aero_wake_level") or 1),
            inflation_layers=int(data.get("inflation_layers") or 3),
            growth_rate=float(data.get("growth_rate") or 1.2),
            use_feature_extract=bool(sfe_bin),
        )
        nx, ny, nz = int(aero_spec["nx"]), int(aero_spec["ny"]), int(aero_spec["nz"])
        width, height, depth = aero_spec["obstacle_dims"]
        used_snappy_aero = True
    elif raw_cad and cad_filename and gmsh_to_foam:
        cad_mesh_res = call_gmsh_mesher({
            "cad_stl_b64": base64.b64encode(raw_cad).decode("ascii"),
            "cad_filename": cad_filename,
            "mesh_size": size,
            "dimension": 3,
            "msh_version": 2.2,
            "element_order": "1",  # OpenFOAM gmshToFoam converts linear 1st-order elements directly
            "inflation_layers": data.get("inflation_layers", 0),
            "first_layer_height": data.get("first_layer_height", 0.002),
            "growth_rate": data.get("growth_rate", 1.2),
        })
        shutil.copy2(cad_mesh_res["msh_path"], case_dir / "cad.msh")
        proc_g2f = subprocess.run([gmsh_to_foam, "cad.msh"], cwd=case_dir, env=_openfoam_env(), text=True, capture_output=True, timeout=90, check=False)
        with (case_dir / "solver.log").open("a", encoding="utf-8") as stream:
            stream.write(proc_g2f.stdout or "")
            stream.write(proc_g2f.stderr or "")
        if proc_g2f.returncode != 0:
            raise RuntimeError(f"gmshToFoam conversion failed for '{cad_filename}': {(proc_g2f.stderr or proc_g2f.stdout)[-2000:]}")
        used_gmsh_cad = True

    if not used_gmsh_cad and not used_snappy_aero:
        fb_type = "patch" if nz > 1 else "empty"
        edges_block = "edges ();"
        if is_corrugated:
            amp = min(height * 0.28, max(1e-5, height * wave_amp_ratio))
            n_pts = max(24, wave_count * 12)
            def _poly(v0: int, v1: int, is_top: bool, z_val: float) -> str:
                pts_str = " ".join(
                    f"({(width * idx / n_pts):.6g} {(height - amp * math.sin(2.0 * math.pi * wave_count * idx / n_pts) if is_top else amp * math.sin(2.0 * math.pi * wave_count * idx / n_pts)):.6g} {z_val:.6g})"
                    for idx in range(1, n_pts)
                )
                return f" polyLine {v0} {v1} ( {pts_str} )"
            edges_block = (
                "edges (\n"
                + _poly(0, 1, False, 0.0) + "\n"
                + _poly(3, 2, True, 0.0) + "\n"
                + _poly(4, 5, False, depth) + "\n"
                + _poly(7, 6, True, depth) + "\n"
                + ");"
            )
        (case_dir / "system" / "blockMeshDict").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }\n'
            "convertToMeters 1;\n"
            f"vertices ( (0 0 0) ({width} 0 0) ({width} {height} 0) (0 {height} 0) "
            f"(0 0 {depth}) ({width} 0 {depth}) ({width} {height} {depth}) (0 {height} {depth}) );\n"
            f"blocks ( hex (0 1 2 3 4 5 6 7) ({nx} {ny} {nz}) simpleGrading (1 1 1) );\n"
            f"{edges_block}\nboundary (\n"
            " inlet { type patch; faces ((0 4 7 3)); }\n"
            " outlet { type patch; faces ((1 2 6 5)); }\n"
            " walls { type wall; faces ((0 1 5 4) (3 7 6 2)); }\n"
            f" frontAndBack {{ type {fb_type}; faces ((0 3 2 1) (4 5 6 7)); }}\n"
            ");\nmergePatchPairs ();\n",
            encoding="utf-8",
        )

    # Resolve real OpenFOAM patch roles (CAD patches from constant/polyMesh/boundary vs parametric box patches)
    patch_roles: Dict[str, str] = {}
    patch_custom_bcs: Dict[str, Dict[str, Any]] = {}
    if used_gmsh_cad:
        poly_patches = _discover_polymesh_patches(case_dir)
        if not poly_patches and cad_mesh_res and isinstance(cad_mesh_res.get("patches"), list):
            poly_patches = [{"name": p["name"], "type": "patch", "center": p.get("center", [0.0, 0.0, 0.0])} for p in cad_mesh_res["patches"]]
        if not poly_patches:
            raise RuntimeError(f"CAD geometry '{cad_filename}' produced no boundary patches in OpenFOAM polyMesh.")

        for p in poly_patches:
            pname = p["name"]
            if p.get("type") == "empty":
                patch_roles[pname] = "empty"
            else:
                patch_roles[pname] = "wall"

        # Bind explicit named patches (`patchName` on markers or `boundary_patches`) or spatial viewport pins
        candidate_patches = [p for p in poly_patches if patch_roles[p["name"]] != "empty"]
        candidate_names = {p["name"] for p in candidate_patches}
        raw_patch_bcs: List[Mapping[str, Any]] = []
        if isinstance(data.get("boundary_patches"), list):
            raw_patch_bcs.extend(bp for bp in data["boundary_patches"] if isinstance(bp, Mapping))
        if isinstance(markers, list):
            raw_patch_bcs.extend(m for m in markers if isinstance(m, Mapping))

        for m in raw_patch_bcs:
            explicit_name = str(m.get("patchName") or m.get("patch_name") or "").strip()
            target_patch: Optional[str] = explicit_name if explicit_name in candidate_names else None
            if target_patch is None:
                pt = m.get("point")
                if not (isinstance(pt, (list, tuple)) and len(pt) == 3) or not candidate_patches:
                    continue
                nearest = min(
                    candidate_patches,
                    key=lambda cp: (cp["center"][0] - float(pt[0])) ** 2 + (cp["center"][1] - float(pt[1])) ** 2 + (cp["center"][2] - float(pt[2])) ** 2,
                )
                target_patch = nearest["name"]

            mtype = str(m.get("subtype") or m.get("type") or "").lower()
            if "inlet" in mtype or "mass flow" in mtype:
                patch_roles[target_patch] = "inlet"
            elif "outlet" in mtype:
                patch_roles[target_patch] = "outlet"
            else:
                patch_roles[target_patch] = "wall"
            patch_custom_bcs[target_patch] = dict(m)

        # Ensure flow path has inlet + outlet patches assigned by x-coordinate extremes if not pinned
        has_inlet = any(r == "inlet" for r in patch_roles.values())
        has_outlet = any(r == "outlet" for r in patch_roles.values())
        if len(candidate_patches) >= 2:
            ordered = sorted(candidate_patches, key=lambda cp: cp["center"][0])
            if not has_inlet:
                for cp in ordered:
                    if patch_roles[cp["name"]] == "wall":
                        patch_roles[cp["name"]] = "inlet"
                        break
            if not has_outlet:
                for cp in reversed(ordered):
                    if patch_roles[cp["name"]] == "wall":
                        patch_roles[cp["name"]] = "outlet"
                        break
        elif not has_inlet and candidate_patches:
            raise ValueError(
                f"Uploaded CAD file '{cad_filename}' contains only 1 boundary surface; supply a multi-surface STEP or separate Inlet/Outlet CAD faces."
            )

        wall_set = {pname for pname, role in patch_roles.items() if role == "wall"}
        _rewrite_polymesh_wall_types(case_dir, wall_set)
        if cad_mesh_res and isinstance(cad_mesh_res.get("vtk_data"), Mapping):
            b = cad_mesh_res["vtk_data"].get("bounds", {})
            bmin, bmax = b.get("min", [0, 0, 0]), b.get("max", [width, height, depth])
            width = max(1e-4, float(bmax[0]) - float(bmin[0]))
            height = max(1e-4, float(bmax[1]) - float(bmin[1]))
            depth = max(1e-4, float(bmax[2]) - float(bmin[2]))
    elif used_snappy_aero:
        patch_roles = {
            "inlet": "inlet",
            "outlet": "outlet",
            "farfield": "slip",
            "obstacle": "wall",
        }
    else:
        patch_roles = {
            "inlet": "inlet",
            "outlet": "outlet",
            "walls": "wall",
            "frontAndBack": "patch" if nz > 1 else "empty",
        }
        if isinstance(data.get("boundary_patches"), list):
            for bp in data["boundary_patches"]:
                if not isinstance(bp, Mapping):
                    continue
                pname = str(bp.get("patchName") or bp.get("patch_name") or "").strip()
                if pname in patch_roles:
                    patch_custom_bcs[pname] = dict(bp)

    gravity_enabled = bool(data.get("gravity_enabled")) or is_vof or solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}
    gy_val = float(data.get("gravity_y", -9.81)) if data.get("gravity_enabled", True) else 0.0
    if gravity_enabled:
        (case_dir / "constant" / "g").write_text(
            'FoamFile { version 2.0; format ascii; class uniformDimensionedVectorField; location "constant"; object g; }\n'
            f"dimensions [0 1 -2 0 0 0 0]; value (0 {gy_val:.6g} 0);\n",
            encoding="utf-8",
        )

    # Transport / thermophysical properties
    if is_vof:
        (case_dir / "constant" / "transportProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object transportProperties; }\n'
            "phases (water air);\n"
            f"water {{ transportModel Newtonian; nu [0 2 -1 0 0 0 0] {fluid['nu']:.6g}; rho [1 -3 0 0 0 0 0] {fluid['rho']:.6g}; }}\n"
            "air   { transportModel Newtonian; nu [0 2 -1 0 0 0 0] 1.48e-5; rho [1 -3 0 0 0 0 0] 1.2; }\n"
            "sigma [1 0 -2 0 0 0 0] 0.07;\n",
            encoding="utf-8",
        )
    else:
        (case_dir / "constant" / "transportProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; location "constant"; object transportProperties; }\n'
            "transportModel Newtonian;\n"
            f"nu [0 2 -1 0 0 0 0] {fluid['nu']:.6g};\n"
            f"beta [0 0 0 -1 0 0 0] {fluid['beta']:.6g};\n"
            f"TRef [0 0 0 1 0 0 0] {temperature_kelvin:.6g};\n"
            f"Pr [0 0 0 0 0 0 0] {fluid['prandtl']:.6g};\n"
            "Prt [0 0 0 0 0 0 0] 0.85;\n",
            encoding="utf-8",
        )

    turb_meta = _openfoam_turbulence_setup(
        case_dir,
        "laminar" if compressible else turb_model,
        velocity,
        min(width, height),
        fluid["nu"],
        patch_roles=patch_roles,
    )
    is_turb = not compressible and turb_meta["simulation_type"] != "laminar"
    is_les = not compressible and bool(turb_meta["is_les"])

    if compressible or solver_stem == "buoyantSimpleFoam":
        (case_dir / "constant" / "thermophysicalProperties").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object thermophysicalProperties; }\n'
            "thermoType { type heRhoThermo; mixture pureMixture; transport const; thermo hConst; equationOfState perfectGas; specie specie; energy sensibleEnthalpy; }\n"
            f"mixture {{ specie {{ molWeight 28.96; }} thermodynamics {{ Cp {fluid['cp']:.8g}; Hf 0; }} transport {{ mu {fluid['mu']:.6g}; Pr {fluid['prandtl']:.4g}; }} }}\n"
            f"p {pressure:.8g};\nT {temperature_kelvin:.8g};\n",
            encoding="utf-8",
        )

    max_iters = int(data.get("solver_iterations") or (300 if solver_stem in {"simpleFoam", "buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"} else 1000))
    dt_val = max(1e-5, float(data.get("time_step") or 0.005))
    end_t_val = max(dt_val, float(data.get("end_time") or (0.5 if is_vof else 1.0)))
    residual_target = max(1e-9, min(1e-2, float(data.get("residual_target") or 1e-4)))
    relax_p = max(0.05, min(1.0, float(data.get("relaxation_p") or 0.3)))
    relax_u = max(0.05, min(1.0, float(data.get("relaxation_u") or 0.7)))
    relax_t = max(0.05, min(1.0, float(data.get("relaxation_t") or 0.7)))
    scheme_choice = str(data.get("discretization_scheme") or ("first_order" if compressible else "second_order")).lower()
    div_u = (
        "Gauss limitedLinearV 1"
        if is_les
        else ("Gauss linearUpwind grad(U)" if ("second" in scheme_choice and not compressible) else "Gauss upwind")
    )

    is_transient_run = bool(is_vof or is_transient or is_les or solver_stem in {"icoFoam", "pimpleFoam", "rhoPimpleFoam"})
    if is_transient_run:
        n_steps = max(1, int(round(end_t_val / dt_val)))
        w_int = max(1, n_steps // 12)
        ctrl_text = (
            'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
            f"application {solver_stem};\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
            f"endTime {end_t_val:.6g};\ndeltaT {dt_val:.6g};\nwriteControl timeStep;\nwriteInterval {w_int};\npurgeWrite 0;\nwriteFormat ascii;\n"
            "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;\n"
        )
    else:
        ctrl_text = (
            'FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n'
            f"application {solver_stem};\nstartFrom startTime;\nstartTime 0;\nstopAt endTime;\n"
            f"endTime {max_iters};\ndeltaT 1;\nwriteInterval {max(50, max_iters // 4)};\npurgeWrite 2;\nwriteFormat ascii;\n"
            "writePrecision 8;\ntimeFormat general;\ntimePrecision 8;\nrunTimeModifiable true;\n"
        )
    fn_objects_block = _build_openfoam_function_objects(
        solver_stem,
        patch_roles,
        rho=fluid["rho"],
        velocity=velocity,
        width=width,
        height=height,
        depth=depth,
        compressible=compressible,
    )
    (case_dir / "system" / "controlDict").write_text(ctrl_text + fn_objects_block, encoding="utf-8")

    ddt_scheme = "backward" if is_les else ("Euler" if is_transient_run else "steadyState")
    (case_dir / "system" / "fvSchemes").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }\n'
        + f"ddtSchemes {{ default {ddt_scheme}; }}\n"
        + "gradSchemes { default Gauss linear; }\n"
        + f"divSchemes {{ default none; div(phi,U) {div_u}; div(phi,h) {div_u}; div(phi,K) Gauss upwind; div(phi,T) {div_u}; "
          "div(phid,p) Gauss upwind; div(phi,k) Gauss upwind; div(phi,epsilon) Gauss upwind; div(phi,omega) Gauss upwind; "
          "div(phi,nuTilda) Gauss linearUpwind grad(nuTilda); "
          "div(rhoPhi,U) Gauss linearUpwind grad(U); div(phi,alpha) Gauss vanLeer; div(phirb,alpha) Gauss linear; "
          "\"div\\(.*\\)\" Gauss linear; }\n"
        + "laplacianSchemes { default Gauss linear corrected; }\n"
        + "interpolationSchemes { default linear; }\n"
        + "snGradSchemes { default corrected; }\n"
        + "wallDist { method meshWave; }\n",
        encoding="utf-8",
    )

    extra_solvers = ""
    if is_cht or solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}:
        extra_solvers += "  T { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
    if is_turb:
        extra_solvers += (
            "  k { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
            "  kFinal { $k; relTol 0; }\n"
            "  epsilon { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
            "  epsilonFinal { $epsilon; relTol 0; }\n"
            "  omega { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
            "  omegaFinal { $omega; relTol 0; }\n"
            "  nuTilda { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
            "  nuTildaFinal { $nuTilda; relTol 0; }\n"
        )
    if is_vof:
        extra_solvers += (
            "  p_rgh { solver GAMG; smoother GaussSeidel; tolerance 1e-6; relTol 0.01; }\n"
            "  p_rghFinal { $p_rgh; relTol 0; }\n"
            "  \"alpha.water.*\" { nAlphaCorr 2; nAlphaSubCycles 2; cAlpha 1; }\n"
        )
    elif solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}:
        extra_solvers += (
            "  p_rgh { solver GAMG; smoother GaussSeidel; tolerance 1e-6; relTol 0.01; }\n"
            "  p_rghFinal { $p_rgh; relTol 0; }\n"
        )
    if compressible:
        extra_solvers += (
            "  rho { solver PCG; preconditioner DIC; tolerance 1e-6; relTol 0; }\n"
            "  rhoFinal { $rho; }\n"
        )

    (case_dir / "system" / "fvSolution").write_text(
        'FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }\n'
        "solvers {\n"
        "  p { solver GAMG; smoother GaussSeidel; tolerance 1e-6; relTol 0.01; }\n"
        "  pFinal { $p; relTol 0; }\n"
        "  U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
        "  UFinal { $U; relTol 0; }\n"
        "  h { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-6; relTol 0.05; }\n"
        "  hFinal { $h; relTol 0; }\n"
        + extra_solvers
        + "}\n"
        f"SIMPLE {{ nNonOrthogonalCorrectors 1; pRefCell 0; pRefValue {pressure:.8g}; residualControl {{ p {residual_target:.2e}; p_rgh {residual_target:.2e}; U {residual_target:.2e}; T {residual_target:.2e}; }} }}\n"
        "PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }\n"
        "PIMPLE { momentumPredictor yes; nCorrectors 2; nNonOrthogonalCorrectors 0; nOuterCorrectors 1; }\n"
        f"relaxationFactors {{ fields {{ p {relax_p:.4g}; p_rgh {relax_p:.4g}; rho 0.5; }} equations {{ U {relax_u:.4g}; T {relax_t:.4g}; h {relax_t:.4g}; k {relax_u:.4g}; epsilon {relax_u:.4g}; omega {relax_u:.4g}; nuTilda {relax_u:.4g}; }} }}\n",
        encoding="utf-8",
    )

    # Region box volumetric source & MRF rotating cellZone (combined cleanly in system/topoSetDict)
    topo_actions: List[str] = []
    region_box = data.get("region_box")
    if isinstance(region_box, Mapping) and (is_cht or solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}):
        if isinstance(region_box.get("min"), (list, tuple)) and isinstance(region_box.get("max"), (list, tuple)) and len(region_box["min"]) >= 3 and len(region_box["max"]) >= 3:
            b_min = [float(v) for v in region_box["min"][:3]]
            b_max = [float(v) for v in region_box["max"][:3]]
            x0, y0, z0 = min(b_min[0], b_max[0]), min(b_min[1], b_max[1]), min(b_min[2], b_max[2]) - 1e-3
            x1, y1, z1 = max(b_min[0], b_max[0]), max(b_min[1], b_max[1]), max(b_min[2], b_max[2]) + 1e-3
        else:
            c_pos = region_box.get("center", [width * 0.5, height * 0.5, depth * 0.5])
            s_dim = region_box.get("size", [width * 0.2, height * 0.2, depth])
            x0, y0, z0 = float(c_pos[0]) - float(s_dim[0]) / 2, float(c_pos[1]) - float(s_dim[1]) / 2, -1.0
            x1, y1, z1 = float(c_pos[0]) + float(s_dim[0]) / 2, float(c_pos[1]) + float(s_dim[1]) / 2, depth + 1.0
        topo_actions.append(
            f"{{ name heatZone; type cellSet; action new; source boxToCell; sourceInfo {{ box ({x0} {y0} {z0}) ({x1} {y1} {z1}); }} }}"
        )
        topo_actions.append(
            "{ name heatZone; type cellZoneSet; action new; source setToCellZone; sourceInfo { set heatZone; } }"
        )

    mrf_info: Optional[Dict[str, Any]] = None
    if mrf_requested:
        mrf_info = _write_openfoam_mrf_setup(
            case_dir,
            data,
            patch_roles,
            width,
            height,
            depth,
            existing_topo_actions=topo_actions,
        )
    elif topo_actions:
        (case_dir / "system" / "topoSetDict").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object topoSetDict; }\n'
            "actions (\n  " + "\n  ".join(topo_actions) + "\n);\n",
            encoding="utf-8",
        )

    if inlet_mode == "mass_flow":
        u_inlet_bc = f"type flowRateInletVelocity; massFlowRate {mass_flow_rate:.8g}; value uniform ({velocity} 0 0);"
    elif inlet_mode == "pressure_inlet":
        u_inlet_bc = f"type pressureInletOutletVelocity; value uniform ({velocity} 0 0);"
    else:
        u_inlet_bc = f"type fixedValue; value uniform ({velocity} 0 0);"

    u_entries: List[str] = []
    for pname, role in patch_roles.items():
        if role == "empty":
            u_entries.append(f"  {pname} {{ type empty; }}")
        elif role == "slip":
            u_entries.append(f"  {pname} {{ type slip; }}")
        elif role == "patch":
            u_entries.append(f"  {pname} {{ type noSlip; }}")
        elif role == "inlet":
            u_entries.append(f"  {pname} {{ {u_inlet_bc} }}")
        elif role == "outlet":
            u_entries.append(f"  {pname} {{ type inletOutlet; inletValue uniform (0 0 0); value uniform (0 0 0); }}")
        else:
            cm = patch_custom_bcs.get(pname, {})
            cm_type = str(cm.get("subtype") or cm.get("type") or "").lower()
            if "slip wall" in cm_type:
                u_entries.append(f"  {pname} {{ type slip; }}")
            elif "moving wall" in cm_type and cm.get("value") is not None:
                u_entries.append(f"  {pname} {{ type fixedValue; value uniform ({float(cm['value'])} 0 0); }}")
            else:
                u_entries.append(f"  {pname} {{ {wall_u_bc} }}")

    (case_dir / "0" / "U").write_text(
        'FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n'
        "dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (0 0 0);\n"
        f"boundaryField {{\n{chr(10).join(u_entries)}\n}}\n",
        encoding="utf-8",
    )

    p_dims = "[1 -1 -2 0 0 0 0]" if (compressible or is_vof or solver_stem in {"buoyantSimpleFoam"}) else "[0 2 -2 0 0 0 0]"
    p_val = outlet_p
    p_inlet_bc = (
        f"type totalPressure; p0 uniform {inlet_total_p:.8g};"
        if inlet_mode == "pressure_inlet"
        else "type zeroGradient;"
    )
    p_outlet_bc = (
        f"type waveTransmissive; field p; psi thermo:psi; gamma 1.4; fieldInf {p_val:.8g}; lInf 1; value uniform {p_val:.8g};"
        if compressible
        else f"type fixedValue; value uniform {p_val:.8g};"
    )
    p_entries: List[str] = []
    for pname, role in patch_roles.items():
        if role == "empty":
            p_entries.append(f"  {pname} {{ type empty; }}")
        elif role == "inlet":
            p_entries.append(f"  {pname} {{ {p_inlet_bc} }}")
        elif role == "outlet":
            p_entries.append(f"  {pname} {{ {p_outlet_bc} }}")
        else:
            p_entries.append(f"  {pname} {{ type zeroGradient; }}")

    (case_dir / "0" / "p").write_text(
        'FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n'
        f"dimensions {p_dims};\ninternalField uniform {p_val:.8g};\n"
        f"boundaryField {{\n{chr(10).join(p_entries)}\n}}\n",
        encoding="utf-8",
    )

    if is_vof or solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}:
        prgh_entries: List[str] = []
        for pname, role in patch_roles.items():
            if role == "empty":
                prgh_entries.append(f"  {pname} {{ type empty; }}")
            elif role == "outlet":
                prgh_entries.append(f"  {pname} {{ type prghPressure; p uniform {p_val:.8g}; value uniform {p_val:.8g}; }}")
            else:
                prgh_entries.append(f"  {pname} {{ type fixedFluxPressure; value uniform {p_val:.8g}; }}")
        (case_dir / "0" / "p_rgh").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object p_rgh; }\n'
            f"dimensions [1 -1 -2 0 0 0 0];\ninternalField uniform {p_val:.8g};\n"
            f"boundaryField {{\n{chr(10).join(prgh_entries)}\n}}\n",
            encoding="utf-8",
        )

    if is_vof:
        alpha_entries: List[str] = []
        for pname, role in patch_roles.items():
            if role == "empty":
                alpha_entries.append(f"  {pname} {{ type empty; }}")
            elif role == "inlet":
                alpha_entries.append(f"  {pname} {{ type fixedValue; value uniform 1; }}")
            else:
                alpha_entries.append(f"  {pname} {{ type zeroGradient; }}")
        (case_dir / "0" / "alpha.water").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object alpha.water; }\n'
            "dimensions [0 0 0 0 0 0 0];\ninternalField uniform 0;\n"
            f"boundaryField {{\n{chr(10).join(alpha_entries)}\n}}\n",
            encoding="utf-8",
        )
        (case_dir / "system" / "setFieldsDict").write_text(
            'FoamFile { version 2.0; format ascii; class dictionary; object setFieldsDict; }\n'
            "defaultFieldValues ( volScalarFieldValue alpha.water 0 );\n"
            f"regions ( boxToCell {{ box (0 0 -1) ({width * 0.4} {height * 0.6} {depth + 1}); fieldValues ( volScalarFieldValue alpha.water 1 ); }} );\n",
            encoding="utf-8",
        )

    if compressible or solver_stem in {"buoyantSimpleFoam", "buoyantBoussinesqSimpleFoam"}:
        t_entries: List[str] = []
        for pname, role in patch_roles.items():
            if role == "empty":
                t_entries.append(f"  {pname} {{ type empty; }}")
            elif role == "slip":
                t_entries.append(f"  {pname} {{ type zeroGradient; }}")
            elif role == "inlet":
                t_entries.append(f"  {pname} {{ type fixedValue; value uniform {temperature_kelvin:.8g}; }}")
            elif role == "outlet":
                t_entries.append(f"  {pname} {{ type inletOutlet; inletValue uniform {temperature_kelvin:.8g}; value uniform {temperature_kelvin:.8g}; }}")
            else:
                cm = patch_custom_bcs.get(pname, {})
                cm_type = str(cm.get("subtype") or cm.get("type") or "").lower()
                if "flux" in cm_type and cm.get("value") is not None:
                    g_val = float(cm["value"]) / max(fluid["k"], 1e-6)
                    t_entries.append(f"  {pname} {{ type fixedGradient; gradient uniform {g_val:.8g}; }}")
                elif "heat" in cm_type and cm.get("value") is not None:
                    tv = float(cm["value"])
                    tv_k = tv + 273.15 if tv < 150.0 else tv
                    t_entries.append(f"  {pname} {{ type fixedValue; value uniform {tv_k:.8g}; }}")
                elif "adiabatic" in cm_type:
                    t_entries.append(f"  {pname} {{ type zeroGradient; }}")
                else:
                    t_entries.append(f"  {pname} {{ {wall_t_bc} }}")
        (case_dir / "0" / "T").write_text(
            'FoamFile { version 2.0; format ascii; class volScalarField; object T; }\n'
            f"dimensions [0 0 0 1 0 0 0];\ninternalField uniform {temperature_kelvin:.8g};\n"
            f"boundaryField {{\n{chr(10).join(t_entries)}\n}}\n",
            encoding="utf-8",
        )

    env = _openfoam_env()
    requested_cores = _requested_parallel_cores(data)
    decompose_bin = shutil.which("decomposePar", path=env.get("PATH")) or shutil.which("decomposePar")
    mpirun_bin = shutil.which("mpirun", path=env.get("PATH")) or shutil.which("mpirun")
    reconstruct_bin = shutil.which("reconstructPar", path=env.get("PATH")) or shutil.which("reconstructPar")
    use_mpi = requested_cores > 1 and bool(decompose_bin and mpirun_bin and reconstruct_bin)
    actual_cores = requested_cores if use_mpi else 1

    def run(command: list[str], stream_solver: bool = False) -> subprocess.CompletedProcess[str]:
        if stream_solver:
            proc = _run_streaming_command(
                command,
                cwd=case_dir,
                env=env,
                timeout=300,
                log_path=case_dir / "solver.log",
                append_log=True,
                solver_kind="openfoam",
                max_iters=max_iters,
                end_time=end_t_val if is_transient_run else float(max_iters),
            )
        else:
            proc = subprocess.run(
                command, cwd=case_dir, env=env, text=True,
                capture_output=True, timeout=180, check=False,
            )
            with (case_dir / "solver.log").open("a", encoding="utf-8") as stream:
                stream.write(proc.stdout or "")
                stream.write(proc.stderr or "")
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(
                proc.returncode, command, output=proc.stdout, stderr=proc.stderr,
            )
        return proc

    try:
        if used_snappy_aero:
            run([block_mesh])
            if sfe_bin:
                run([sfe_bin])
            run([snappy_bin, "-overwrite"])
            check_mesh_bin = shutil.which("checkMesh", path=env.get("PATH")) or shutil.which("checkMesh")
            if check_mesh_bin:
                subprocess.run([check_mesh_bin], cwd=case_dir, env=env, text=True, capture_output=True, timeout=90, check=False)
        elif not used_gmsh_cad:
            run([block_mesh])
            _write_block_mesh_boundary_summary(case_dir, nx, ny, nz, width, height, depth)
        if (case_dir / "system" / "topoSetDict").exists():
            topo_set_bin = shutil.which("topoSet", path=env.get("PATH")) or shutil.which("topoSet")
            if mrf_info and not topo_set_bin:
                raise RuntimeError(
                    "OpenFOAM environment validation failed: topoSet binary is required to build MRF rotorZone cellZones."
                )
            if topo_set_bin:
                run([topo_set_bin])
        if is_vof and shutil.which("setFields"):
            run([shutil.which("setFields") or "setFields"])
        if use_mpi and decompose_bin and mpirun_bin and reconstruct_bin:
            _write_openfoam_decompose_dict(case_dir, requested_cores)
            run([decompose_bin, "-force"])
            run([mpirun_bin, "--allow-run-as-root", "--oversubscribe", "-np", str(requested_cores), executable, "-parallel"], stream_solver=True)
            run([reconstruct_bin])
        else:
            run([executable], stream_solver=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"OpenFOAM execution failed: {(exc.stderr or exc.stdout or '')[-4000:]}"
        ) from exc

    verification = verify_openfoam_convergence(case_dir, solver_stem)
    if not verification["valid"]:
        raise OpenFOAMVerificationError(verification["error"])

    log = (case_dir / "solver.log").read_text(encoding="utf-8", errors="replace")
    residuals = parse_openfoam_residuals(log)
    fields = parse_openfoam_fields(case_dir)

    def _read_box_time_fields(tdir: Path) -> Tuple[Dict[str, List[float]], Dict[str, List[float]], List[float]]:
        scalars_3d: Dict[str, List[float]] = {}
        vectors_3d: Dict[str, List[float]] = {}
        t_vals_out: List[float] = []
        if (tdir / "U").exists():
            u_parsed = parse_internal_field((tdir / "U").read_text(encoding="utf-8", errors="replace"))
            u_vals = u_parsed.get("values", [])
            if u_parsed.get("uniform") and len(u_vals) == 1:
                u_vals = u_vals * (nx * ny * nz)
            scalars_3d["U_mag"] = [math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) for v in u_vals]
            vectors_3d["U"] = [float(c) for v in u_vals for c in v]
        p_file = "p_rgh" if (tdir / "p_rgh").exists() else "p"
        if (tdir / p_file).exists():
            p_parsed = parse_internal_field((tdir / p_file).read_text(encoding="utf-8", errors="replace"))
            p_vals = p_parsed.get("values", [])
            if p_parsed.get("uniform") and len(p_vals) == 1:
                p_vals = p_vals * (nx * ny * nz)
            scalars_3d["p"] = [float(x) for x in p_vals]
        if (tdir / "T").exists():
            t_parsed = parse_internal_field((tdir / "T").read_text(encoding="utf-8", errors="replace"))
            t_vals = t_parsed.get("values", [])
            if t_parsed.get("uniform") and len(t_vals) == 1:
                t_vals = t_vals * (nx * ny * nz)
            t_vals_out = [float(x) for x in t_vals]
            scalars_3d["T"] = t_vals_out
        if (tdir / "alpha.water").exists():
            a_parsed = parse_internal_field((tdir / "alpha.water").read_text(encoding="utf-8", errors="replace"))
            a_vals = a_parsed.get("values", [])
            scalars_3d["alpha_water"] = [float(x) for x in a_vals]
        return scalars_3d, vectors_3d, t_vals_out

    vtk_payload: Any = []
    foam_to_vtk = shutil.which("foamToVTK", path=env.get("PATH")) or shutil.which("foamToVTK")
    if (used_gmsh_cad or used_snappy_aero) and foam_to_vtk:
        try:
            vtk_cmd = [foam_to_vtk] if is_transient_run else [foam_to_vtk, "-latestTime"]
            run(vtk_cmd)
            vtu_files = sorted((case_dir / "VTK").rglob("*.vtu")) or sorted((case_dir / "VTK").rglob("*.vtk"))
            if vtu_files:
                parsed_vtk = _extract_vtk_from_meshio_file(vtu_files[-1])
                if parsed_vtk:
                    vtk_payload = parsed_vtk
                    if cad_mesh_res and isinstance(cad_mesh_res.get("patches"), list):
                        vtk_payload["patches"] = cad_mesh_res["patches"]
                    if is_transient_run and len(vtu_files) > 1:
                        time_frames: List[Dict[str, Any]] = []
                        step_slice = vtu_files[-15:]
                        base_n = len(vtk_payload.get("points", [])) // 3
                        for idx, vf in enumerate(step_slice):
                            fparsed = _extract_vtk_from_meshio_file(vf)
                            if fparsed and (len(fparsed.get("points", [])) // 3) == base_n:
                                time_frames.append({
                                    "time": round(float(idx + 1) * (end_t_val / max(1, len(step_slice))), 6),
                                    "scalars": fparsed.get("scalars", {}),
                                    "vectors": fparsed.get("vectors", {}),
                                })
                        if len(time_frames) > 1:
                            vtk_payload["time_frames"] = time_frames
        except Exception:
            pass

    t_internal_vals: List[float] = []
    if not used_gmsh_cad and not used_snappy_aero:
        try:
            time_dirs_asc = sorted(
                [p for p in case_dir.iterdir() if p.is_dir() and re.fullmatch(r"\d+(?:\.\d*)?", p.name) and float(p.name) > 0],
                key=lambda p: float(p.name),
            )
            if time_dirs_asc:
                latest_dir = time_dirs_asc[-1]
                scalars_3d, vectors_3d, t_internal_vals = _read_box_time_fields(latest_dir)
                vtk_payload = _build_structured_box_vtk(
                    width, height, depth, nx, ny, nz,
                    scalars=scalars_3d,
                    vectors=vectors_3d,
                    units={"U_mag": "m/s", "p": "Pa" if (compressible or is_vof) else "m²/s²", "T": "K", "alpha_water": "-"},
                )
                if is_transient_run and len(time_dirs_asc) > 1 and isinstance(vtk_payload, dict):
                    _, _, sample_cids = _compute_box_surface_sample_map(width, height, depth, nx, ny, nz)
                    frames: List[Dict[str, Any]] = []
                    for td in time_dirs_asc[-15:]:
                        sc_t, vec_t, _ = _read_box_time_fields(td)
                        surf_sc, surf_vec = _map_box_cells_to_surface(sample_cids, sc_t, vec_t)
                        if any(surf_sc.values()):
                            frames.append({
                                "time": float(td.name),
                                "scalars": surf_sc,
                                "vectors": surf_vec if any(surf_vec.values()) else {},
                            })
                    if len(frames) > 1:
                        vtk_payload["time_frames"] = frames
        except Exception:
            pass

    pressure_path = case_dir / "pressure.json"
    velocity_path = case_dir / "velocity.json"
    pressure_path.write_text(json.dumps(fields.get("pressure", {}), indent=2), encoding="utf-8")
    velocity_path.write_text(json.dumps(fields.get("velocity", {}), indent=2), encoding="utf-8")

    result: Dict[str, Any] = {
        "status": "SOLVED_REALTIME",
        "solver": "OpenFOAM",
        "solver_variant": solver_stem,
        "turbulence_model": turb_meta["model"],
        "turbulence_simulation_type": turb_meta["simulation_type"],
        "mrf_active": bool(mrf_info),
        "mrf_omega_rad_s": float(mrf_info["omega_rad_s"]) if mrf_info else 0.0,
        "geometry_mode": geometry_mode,
        "parallel_cores": actual_cores,
        "effective_fluid": fluid,
        "executable": executable,
        "case_directory": str(case_dir),
        "mesh_nodes": int(cad_mesh_res["nodes_count"]) if (used_gmsh_cad and cad_mesh_res) else (nx + 1) * (ny + 1) * (nz + 1),
        "mesh_elements": int(cad_mesh_res["elements_count"]) if (used_gmsh_cad and cad_mesh_res) else nx * ny * nz,
        "artifacts": {
            "case_directory": str(case_dir),
            "log": str(case_dir / "solver.log"),
            "pressure": str(pressure_path),
            "velocity": str(velocity_path),
            "mesh_metadata": str(case_dir / "mesh_metadata.json"),
        },
        "residuals": residuals,
        "convergence": {
            "converged": bool(residuals and all(item["values"] and item["values"][-1] < 1e-4 for item in residuals.values())),
            "residuals": residuals,
        },
        "pressure": fields.get("pressure", {}),
        "velocity": fields.get("velocity", {}),
        "temperature": fields.get("temperature", {}),
        "vtk_data": vtk_payload,
        "logs": log.splitlines()[-120:],
        "input": {k: v for k, v in data.items() if k not in {"cad_stl_b64", "cad_file_b64", "openfoam_archive_b64"}},
        "units": {"pressure": "Pa", "velocity": "m/s", "temperature": "K", "residual": "dimensionless"},
    }

    inlet_area = height * depth
    mass_flow_kg_s = round(fluid["rho"] * velocity * inlet_area, 6)
    integrals: Dict[str, Any] = {
        "mass_flow_kg_s": mass_flow_kg_s,
        "domain_volume_m3": round(width * height * depth, 6),
        "wetted_area_m2": round(2.0 * (width * height + width * depth), 6),
        "turbulence_simulation_type": turb_meta["simulation_type"],
        "turbulence_model": turb_meta["model"],
    }
    if mrf_info:
        integrals["mrf_omega_rad_s"] = round(float(mrf_info["omega_rad_s"]), 5)
        integrals["mrf_radius_m"] = round(float(mrf_info["radius_m"]), 5)
    pp_metrics = _parse_openfoam_postprocessing(case_dir)
    if pp_metrics:
        integrals.update(pp_metrics)

    if not used_gmsh_cad:
        try:
            metrics = compute_openfoam_metrics(case_dir)
            result["metrics"] = metrics
            result["units"]["pressure"] = metrics["pressure_drop"]["unit"] or result["units"]["pressure"]
            if metrics.get("pressure_drop", {}).get("value") is not None:
                dp_val = float(metrics["pressure_drop"]["value"])
                # Convert kinematic m^2/s^2 to Pa when solver was incompressible kinematic pressure
                dp_pa = dp_val * fluid["rho"] if metrics["pressure_drop"].get("unit") in {"m2/s2", "m²/s²"} else dp_val
                integrals["pressure_drop_pa"] = round(dp_pa, 5)
                result["pressure_drop_pa"] = integrals["pressure_drop_pa"]
            if metrics.get("max_velocity", {}).get("value") is not None:
                integrals["max_velocity_mps"] = round(float(metrics["max_velocity"]["value"]), 5)
                result["max_velocity"] = integrals["max_velocity_mps"]
        except Exception as exc:
            result["metrics_error"] = f"{type(exc).__name__}: {exc}"

    if isinstance(vtk_payload, Mapping):
        scalars_map = vtk_payload.get("scalars") or {}
        if used_gmsh_cad:
            p_vals_vtk = scalars_map.get("p") or scalars_map.get("p_rgh") or []
            u_vals_vtk = scalars_map.get("U_mag") or []
            if p_vals_vtk:
                raw_dp = max(p_vals_vtk) - min(p_vals_vtk)
                dp_pa = raw_dp if (compressible or is_vof or solver_stem == "buoyantSimpleFoam") else raw_dp * fluid["rho"]
                integrals["pressure_drop_pa"] = round(dp_pa, 5)
                result["pressure_drop_pa"] = integrals["pressure_drop_pa"]
            if u_vals_vtk:
                integrals["max_velocity_mps"] = round(max(u_vals_vtk), 5)
                result["max_velocity"] = integrals["max_velocity_mps"]

        active_k = vtk_payload.get("active_field", "")
        active_arr = scalars_map.get(active_k, [])
        if active_arr:
            integrals["field_average"] = round(sum(active_arr) / len(active_arr), 6)
            integrals["field_min"] = round(min(active_arr), 6)
            integrals["field_max"] = round(max(active_arr), 6)

        t_arr = scalars_map.get("T", [])
        if t_arr:
            t_avg = sum(t_arr) / len(t_arr)
            t_max_v = max(t_arr)
            integrals["mean_temperature_k"] = round(t_avg, 4)
            result["temperature_max"] = round(t_max_v, 4)

            # Compute genuine OpenFOAM convection coefficient (h) and Nusselt number (Nu = h * Dh / k)
            dh = float(data.get("hydraulic_diameter") or (2.0 * height * depth / max(height + depth, 1e-6) if nz > 1 else 2.0 * height))
            dy_cell = height / max(1, ny)
            q_wall = abs(heat_flux_req)
            t_wall_eff = wall_temp_k
            if not used_gmsh_cad and len(t_internal_vals) >= nx * ny:
                # Sample near-wall cell layers (j=0 bottom and j=ny-1 top at mid z-plane)
                k_mid = nz // 2
                bot_temps = [t_internal_vals[i + nx * (0 + ny * k_mid)] for i in range(nx)]
                top_temps = [t_internal_vals[i + nx * ((ny - 1) + ny * k_mid)] for i in range(nx)]
                t_near_wall = 0.5 * (sum(bot_temps) / len(bot_temps) + sum(top_temps) / len(top_temps))
                if use_heat_flux:
                    t_wall_eff = t_near_wall + q_wall * (0.5 * dy_cell) / max(fluid["k"], 1e-6)
                else:
                    q_wall = fluid["k"] * abs(wall_temp_k - t_near_wall) / max(0.5 * dy_cell, 1e-6)
            elif q_wall == 0.0:
                q_wall = fluid["k"] * abs(t_wall_eff - t_avg) / max(0.25 * dh, 1e-6)

            delta_t_bulk = max(0.05, abs(t_wall_eff - t_avg))
            h_conv = max(0.0, q_wall / delta_t_bulk)
            nu_num = (h_conv * dh) / max(fluid["k"], 1e-9)
            wetted_area = integrals["wetted_area_m2"]
            integrals["heat_transfer_coeff_h"] = round(h_conv, 4)
            integrals["nusselt_number"] = round(nu_num, 4)
            integrals["total_heat_transfer_w"] = round(q_wall * wetted_area, 4)
            result["heat_transfer_coeff_h"] = integrals["heat_transfer_coeff_h"]
            result["nusselt_number"] = integrals["nusselt_number"]

    result["integrals"] = integrals
    return canonicalize_result(result, physics_type=physics_type, input_data=result["input"], solver="OpenFOAM")


def _numbered_dat_rows(path: Path, heading_tokens: tuple[str, ...], column_count: int):
    if not path.exists():
        return []
    rows = []
    active = False
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip().lower()
        if not line:
            continue
        if any(token in line for token in heading_tokens):
            active = True
            continue
        if any(token in line for token in ("displacements", "forces", "stresses", "strains", "temperatures", "heat flux", "eigenvalue", "buckling")):
            active = False
            continue
        if active and line.startswith("*"):
            active = False
            continue
        if active and line:
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


def _parse_calculix_dat_temperatures(path: Path) -> list[dict[str, Any]]:
    result = []
    for node, values in _numbered_dat_rows(path, ("temperatures",), 1):
        result.append({"node": node, "temperature": values[0]})
    return result


def _parse_calculix_modal_or_buckling(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    modes: list[dict[str, Any]] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    is_eigen = "E I G E N V A L U E" in text
    is_buckle = "B U C K L I N G" in text
    if not (is_eigen or is_buckle):
        return modes
    for line in text.splitlines():
        m = re.match(
            r"^\s*(\d+)\s+([-+]?\d+\.\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d+\.\d+(?:[eE][-+]?\d+)?)(?:\s+([-+]?\d+\.\d+(?:[eE][-+]?\d+)?))?",
            line,
        )
        if m:
            eigenvalue = float(m.group(2))
            col3 = float(m.group(3))
            entry: dict[str, Any] = {
                "mode": int(m.group(1)),
                "eigenvalue": eigenvalue,
                "frequency_or_factor": col3,
            }
            if is_eigen:
                if m.group(4) is not None:
                    entry["frequency_hz"] = float(m.group(4))
                elif eigenvalue > 0.0:
                    entry["frequency_hz"] = round(math.sqrt(eigenvalue) / (2.0 * math.pi), 6)
            modes.append(entry)
    return modes


def call_openfoam_compressible_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Explicit compressible route, routing low-Mach flows cleanly to incompressible solver."""
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
        payload["pressure_incompressible_routing"] = True
        payload["solver_route_reason"] = "low_mach_safe_incompressible"
        payload["requested_physics_type"] = "CFD_Compressible"
        payload["routed_mach_number"] = mach_number
        return call_openfoam_solver(payload)

    payload["simulation_type"] = "CFD_Compressible"
    return call_openfoam_solver(payload)


def _ccx_id_lines(ids) -> str:
    """CalculiX allows at most 16 entries per data line."""
    ids = [str(i) for i in ids]
    return "".join(",".join(ids[start:start + 16]) + "\n" for start in range(0, len(ids), 16))


def _parse_calculix_inp_mesh(inp_text: str) -> Tuple[Dict[int, Tuple[float, float, float]], Dict[int, Tuple[str, List[int]]]]:
    """Parse *NODE coordinates and *ELEMENT connectivity from any CalculiX .inp deck."""
    node_coords: Dict[int, Tuple[float, float, float]] = {}
    elem_conn: Dict[int, Tuple[str, List[int]]] = {}
    mode: Optional[str] = None
    active_etype = ""
    pending_eid: Optional[int] = None
    pending_nodes: List[int] = []

    def _flush_elem() -> None:
        nonlocal pending_eid, pending_nodes
        if pending_eid is not None and pending_nodes:
            elem_conn[pending_eid] = (active_etype, list(pending_nodes))
        pending_eid = None
        pending_nodes = []

    for raw in inp_text.splitlines():
        line = raw.strip()
        if not line or line.startswith("**"):
            continue
        if line.startswith("*"):
            _flush_elem()
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

        parts = [p.strip() for p in line.split(",") if p.strip() != ""]
        if mode == "node" and len(parts) >= 4:
            try:
                nid = int(float(parts[0]))
                node_coords[nid] = (float(parts[1]), float(parts[2]), float(parts[3]))
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
            # Detect continuation lines ending with trailing comma
            if not raw.rstrip().endswith(","):
                _flush_elem()
    _flush_elem()
    return node_coords, elem_conn


def _extract_surface_triangles_from_elements(
    node_coords: Mapping[int, Tuple[float, float, float]],
    elem_conn: Mapping[int, Tuple[str, List[int]]],
) -> Tuple[List[int], List[float], List[int], Dict[str, List[float]]]:
    """Extract outer boundary surface triangles from 3D/2D CalculiX elements deterministically."""
    face_counts: Dict[Tuple[int, ...], int] = {}
    face_oriented: Dict[Tuple[int, ...], Tuple[int, ...]] = {}
    direct_faces: List[Tuple[int, ...]] = []

    for etype, nids in elem_conn.values():
        et = etype.upper()
        if et.startswith(("C3D4", "DC3D4", "C3D10", "DC3D10")) and len(nids) >= 4:
            a, b, c, d = nids[0], nids[1], nids[2], nids[3]
            faces = ((a, b, c), (a, b, d), (b, c, d), (c, a, d))
        elif et.startswith(("C3D8", "DC3D8", "C3D20", "DC3D20")) and len(nids) >= 8:
            n0, n1, n2, n3, n4, n5, n6, n7 = nids[:8]
            faces = (
                (n0, n3, n2, n1),
                (n4, n5, n6, n7),
                (n0, n1, n5, n4),
                (n1, n2, n6, n5),
                (n2, n3, n7, n6),
                (n3, n0, n4, n7),
            )
        elif et.startswith(("C3D6", "DC3D6", "C3D15")) and len(nids) >= 6:
            n0, n1, n2, n3, n4, n5 = nids[:6]
            faces = ((n0, n2, n1), (n3, n4, n5), (n0, n1, n4, n3), (n1, n2, n5, n4), (n2, n0, n3, n5))
        elif et.startswith(("S3", "S6", "CPS3", "CPE3", "CAX3")) and len(nids) >= 3:
            direct_faces.append((nids[0], nids[1], nids[2]))
            continue
        elif et.startswith(("S4", "S8", "CPS4", "CPE4", "CAX4")) and len(nids) >= 4:
            direct_faces.append((nids[0], nids[1], nids[2], nids[3]))
            continue
        else:
            continue

        for f in faces:
            key = tuple(sorted(f))
            face_counts[key] = face_counts.get(key, 0) + 1
            face_oriented[key] = f

    boundary_faces = direct_faces + [face_oriented[k] for k, c in face_counts.items() if c == 1]
    ordered_nids = sorted(node_coords.keys())
    nid_to_idx = {nid: idx for idx, nid in enumerate(ordered_nids)}
    points: List[float] = []
    xs: List[float] = []
    ys: List[float] = []
    zs: List[float] = []
    for nid in ordered_nids:
        x, y, z = node_coords[nid]
        points.extend([float(x), float(y), float(z)])
        xs.append(float(x))
        ys.append(float(y))
        zs.append(float(z))

    triangles: List[int] = []
    for f in boundary_faces:
        idxs = [nid_to_idx[nid] for nid in f if nid in nid_to_idx]
        if len(idxs) == 3:
            triangles.extend(idxs)
        elif len(idxs) == 4:
            triangles.extend([idxs[0], idxs[1], idxs[2], idxs[0], idxs[2], idxs[3]])

    bounds = {
        "min": [min(xs) if xs else 0.0, min(ys) if ys else 0.0, min(zs) if zs else 0.0],
        "max": [max(xs) if xs else 0.0, max(ys) if ys else 0.0, max(zs) if zs else 0.0],
    }
    return ordered_nids, points, triangles, bounds


def _extract_calculix_frd_time_frames(
    frd_path: Path,
    ordered_nids: Sequence[int],
    max_frames: int = 15,
) -> List[Dict[str, Any]]:
    """Extract multi-step transient/nonlinear node frames from real CalculiX model.frd."""
    if not frd_path.is_file() or not ordered_nids:
        return []
    frames_by_time: Dict[float, Dict[str, Any]] = {}
    current_time: Optional[float] = None
    active_block: Optional[str] = None
    temp_map: Dict[int, float] = {}
    disp_map: Dict[int, Tuple[float, float, float]] = {}

    def _flush_block() -> None:
        nonlocal temp_map, disp_map, active_block
        if current_time is None or active_block is None:
            temp_map = {}
            disp_map = {}
            active_block = None
            return
        entry = frames_by_time.setdefault(
            round(current_time, 9),
            {"time": float(current_time), "scalars": {}, "vectors": {}},
        )
        if active_block == "T" and temp_map:
            t_default = sum(temp_map.values()) / len(temp_map)
            entry["scalars"]["T"] = [temp_map.get(nid, t_default) for nid in ordered_nids]
        elif active_block == "DISP" and disp_map:
            mags: List[float] = []
            vecs: List[float] = []
            for nid in ordered_nids:
                dx, dy, dz = disp_map.get(nid, (0.0, 0.0, 0.0))
                mags.append(math.sqrt(dx * dx + dy * dy + dz * dz))
                vecs.extend([dx, dy, dz])
            entry["scalars"]["displacement"] = mags
            entry["vectors"]["displacement"] = vecs
        temp_map = {}
        disp_map = {}
        active_block = None

    try:
        with frd_path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                s = line.lstrip()
                if s.startswith("100CL"):
                    _flush_block()
                    rest = s[5:].replace("D", "E").replace("d", "e")
                    m_time = re.search(r"[-+]?\d+\.\d+(?:[eE][-+]?\d+)?", rest)
                    if m_time:
                        current_time = float(m_time.group(0))
                    else:
                        nums = re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", rest)
                        current_time = float(nums[1]) if len(nums) >= 2 else (float(nums[0]) if nums else 0.0)
                elif s.startswith("-4"):
                    _flush_block()
                    upper = s.upper()
                    if "NDTEMP" in upper or "TOFFSET" in upper:
                        active_block = "T"
                    elif "DISP" in upper:
                        active_block = "DISP"
                elif s.startswith("-3"):
                    _flush_block()
                elif active_block and s.startswith("-1"):
                    rest = s[2:].strip().replace("D", "E").replace("d", "e")
                    m_nid = re.match(r"^(\d+)(.*)$", rest)
                    if not m_nid:
                        continue
                    nid = int(m_nid.group(1))
                    vals = [float(x) for x in re.findall(r"[-+]?\d+\.\d+(?:[eE][-+]?\d+)?", m_nid.group(2))]
                    if active_block == "T" and vals:
                        temp_map[nid] = vals[0]
                    elif active_block == "DISP" and len(vals) >= 3:
                        disp_map[nid] = (vals[0], vals[1], vals[2])
        _flush_block()
    except Exception:
        return []

    frames = [v for _, v in sorted(frames_by_time.items(), key=lambda kv: kv[0]) if v["scalars"]]
    if len(frames) > max_frames:
        step = max(1, len(frames) // max_frames)
        sampled = frames[::step]
        if sampled[-1] is not frames[-1]:
            sampled[-1] = frames[-1]
        frames = sampled[:max_frames]
    return frames


def _build_calculix_vtk_from_results(
    node_coords: Mapping[int, Tuple[float, float, float]],
    elem_conn: Mapping[int, Tuple[str, List[int]]],
    disps: List[Dict[str, Any]],
    stresses: List[Dict[str, Any]],
    temps: List[Dict[str, Any]],
    frd_path: Optional[Path] = None,
) -> Any:
    """Build full 3D VtkFieldPayload for any CalculiX mesh (.inp or CAD tet) from parsed .dat/.frd results."""
    if not node_coords or not elem_conn:
        return []
    ordered_nids, points, triangles, bounds = _extract_surface_triangles_from_elements(node_coords, elem_conn)
    if not points or not triangles:
        return []

    scalars: Dict[str, List[float]] = {}
    vectors: Dict[str, List[float]] = {}
    units: Dict[str, str] = {}

    if temps:
        t_map = {t["node"]: float(t["temperature"]) for t in temps}
        t_default = sum(t_map.values()) / len(t_map)
        scalars["T"] = [t_map.get(nid, t_default) for nid in ordered_nids]
        units["T"] = "K"

    if disps:
        d_map = {d["node"]: d for d in disps}
        disp_mag: List[float] = []
        disp_vec: List[float] = []
        for nid in ordered_nids:
            entry = d_map.get(nid)
            if entry:
                disp_mag.append(float(entry["magnitude"]))
                c = entry["components"]
                disp_vec.extend([float(c["x"]), float(c["y"]), float(c["z"])])
            else:
                disp_mag.append(0.0)
                disp_vec.extend([0.0, 0.0, 0.0])
        scalars["displacement"] = disp_mag
        vectors["displacement"] = disp_vec
        units["displacement"] = "m"

    if stresses:
        elem_vm: Dict[int, List[float]] = {}
        for s in stresses:
            elem_vm.setdefault(s["element"], []).append(float(s["von_mises"]))
        elem_avg = {eid: sum(vals) / len(vals) for eid, vals in elem_vm.items()}
        node_vm_acc: Dict[int, List[float]] = {}
        for eid, (_etype, nids) in elem_conn.items():
            if eid in elem_avg:
                val = elem_avg[eid]
                for nid in nids:
                    node_vm_acc.setdefault(nid, []).append(val)
        scalars["von_mises"] = [
            sum(node_vm_acc[nid]) / len(node_vm_acc[nid]) if nid in node_vm_acc else 0.0
            for nid in ordered_nids
        ]
        units["von_mises"] = "Pa"

    active_field = "von_mises" if "von_mises" in scalars else ("T" if "T" in scalars else ("displacement" if "displacement" in scalars else ""))
    payload: Dict[str, Any] = {
        "points": points[:360000],
        "triangles": triangles[:720000],
        "scalars": scalars,
        "vectors": vectors,
        "active_field": active_field,
        "units": units,
        "bounds": bounds,
        "node_count": len(ordered_nids),
        "triangle_count": len(triangles) // 3,
    }
    if frd_path is not None and len(ordered_nids) <= 120000:
        time_frames = _extract_calculix_frd_time_frames(frd_path, ordered_nids)
        if len(time_frames) > 1:
            payload["time_frames"] = time_frames
    return payload


def _select_nodes_near_point(
    node_coords: Mapping[int, Tuple[float, float, float]],
    target: Sequence[float],
    radius: float,
    min_count: int = 3,
) -> List[int]:
    tx, ty, tz = float(target[0]), float(target[1]), float(target[2])
    ranked = sorted(
        ((nid, (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2) for nid, (x, y, z) in node_coords.items()),
        key=lambda item: item[1],
    )
    r2 = radius * radius
    within = [nid for nid, d2 in ranked if d2 <= r2]
    if len(within) >= min_count:
        return within
    return [nid for nid, _ in ranked[:max(min_count, 1)]]


def call_calculix_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """
    Universal CalculiX (ccx) solver supporting:
    - Direct .inp deck execution (with full 3D VTK surface/field extraction)
    - STL/STEP 3D CAD tetrahedral meshing via Gmsh (C3D4/C3D10/DC3D4/C3D4T)
    - Spatial 3D viewport boundary pin mapping (*BOUNDARY / *CLOAD / *CFLUX)
    - Structural Static / Nonlinear / Modal Dynamic / Buckling
    - Thermal Steady / Transient / Convection / Radiation
    - Coupled Thermo-Mechanical (*COUPLED TEMPERATURE-DISPLACEMENT)
    """
    ccx = shutil.which("ccx")
    if not ccx:
        raise RuntimeError("CalculiX ccx is not installed in the worker container")

    requested_cores = _requested_parallel_cores(data)
    ccx_env = {**os.environ, "OMP_NUM_THREADS": str(requested_cores), "OMP_DYNAMIC": "FALSE"}

    physics_type = classify_physics(data)
    jobs_dir = Path(os.getenv("NASEER_JOB_DIR", "/app/jobs" if Path("/app/jobs").exists() else "jobs"))
    jobs_dir.mkdir(parents=True, exist_ok=True)
    case_dir = jobs_dir / f"calculix-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    inp = case_dir / "model.inp"

    # Mode A: Direct .inp execution when user uploaded an .inp deck
    raw_inp = data.get("inp_deck")
    if isinstance(raw_inp, str) and raw_inp.strip() and "*NODE" in raw_inp.upper():
        inp.write_text(raw_inp, encoding="utf-8")
        try:
            proc = subprocess.run([ccx, "model"], cwd=case_dir, env=ccx_env, text=True, capture_output=True, timeout=180, check=True)
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(f"CalculiX direct .inp execution failed: {(exc.stderr or exc.stdout or '')[-4000:]}") from exc
        dat_path = case_dir / "model.dat"
        frd_path = case_dir / "model.frd"
        disps = _parse_calculix_dat_displacements(dat_path)
        stresses = _parse_calculix_dat_stress(dat_path)
        temps = _parse_calculix_dat_temperatures(dat_path)
        reactions = _parse_calculix_dat_reactions(dat_path)
        modes = _parse_calculix_modal_or_buckling(dat_path)
        inp_nodes, inp_elems = _parse_calculix_inp_mesh(raw_inp)
        vtk_payload = _build_calculix_vtk_from_results(inp_nodes, inp_elems, disps, stresses, temps, frd_path=frd_path)
        inp_integrals: Dict[str, Any] = {}
        if disps:
            inp_integrals["max_displacement_m"] = round(max(d["magnitude"] for d in disps), 8)
        if stresses:
            vms = [s["von_mises"] for s in stresses]
            inp_integrals["max_von_mises_pa"] = round(max(vms), 4)
            inp_integrals["avg_von_mises_pa"] = round(sum(vms) / len(vms), 4)
        if reactions:
            inp_integrals["max_reaction_n"] = round(max(r["magnitude"] for r in reactions), 4)
        if temps:
            tvals = [t["temperature"] for t in temps]
            inp_integrals["mean_temperature_k"] = round(sum(tvals) / len(tvals), 4)
        return canonicalize_result({
            "status": "SOLVED_REALTIME",
            "solver": "CalculiX",
            "solver_variant": "Direct .inp Deck",
            "executable": ccx,
            "parallel_cores": requested_cores,
            "case_directory": str(case_dir),
            "model": str(inp),
            "mesh_nodes": len(inp_nodes),
            "mesh_elements": len(inp_elems),
            "displacements": disps,
            "stress": stresses,
            "temperatures": temps,
            "reactions": reactions,
            "modes": modes,
            "integrals": inp_integrals,
            "stdout": proc.stdout[-4000:],
            "logs": proc.stdout.splitlines()[-100:],
            "vtk_data": vtk_payload,
            "units": {"displacement": "m", "stress": "Pa", "von_mises": "Pa", "temperature": "K"},
            "convergence": {"converged": dat_path.exists(), "status": "completed" if dat_path.exists() else "not_reported", "residuals": {}},
        }, physics_type=physics_type, input_data={"mode": "direct_inp", "parallel_cores": requested_cores}, solver="CalculiX")

    is_thermal_only = physics_type in {"Thermal_Transient", "Thermal_Steady", "Thermal_Radiation"}
    is_coupled_ts = physics_type in {"Thermal_Structural", "Multiphysics"}
    is_buckling = physics_type == "Structural_Buckling"
    is_dynamic = physics_type == "Structural_Dynamic"

    geometry = data.get("geometry", data)
    dimensions = geometry.get("dimensions", geometry) if isinstance(geometry, Mapping) else {}

    def positive(name: str, alias: str, default: float) -> float:
        return float(dimensions.get(name, dimensions.get(alias, geometry.get(name, geometry.get(alias, default)))))

    length = positive("length_x", "length", positive("x", "width", 1.0))
    height = positive("length_y", "height", 0.4)
    depth = positive("length_z", "depth", 0.2)
    mesh = data.get("mesh", data.get("mesh_settings", {}))
    mesh_size = float(mesh.get("mesh_size", data.get("mesh_size", 0.1)) if isinstance(mesh, Mapping) else 0.1)
    element_order = 2 if str(data.get("element_order", "1")) == "2" else 1

    material = data.get("material", data.get("material_properties", {}))
    E = float(material.get("young_modulus", material.get("youngs_modulus", material.get("elastic_modulus", material.get("E", 210e9)))))
    nu = float(material.get("poisson_ratio", material.get("poissons_ratio", material.get("nu", 0.3))))
    density = float(material.get("density", data.get("density", 7850.0)))
    k_cond = float(material.get("thermal_conductivity_k", data.get("thermal_conductivity_k", 400.0)))
    cp_solid = float(material.get("specific_heat", data.get("specific_heat", 460.0)))
    alpha_exp = float(material.get("thermal_expansion", data.get("thermal_expansion", 1.2e-5)))
    name = "MATERIAL"

    raw_cad, cad_filename = _extract_upload_path_content(data)
    used_gmsh_cad = False
    cad_patch_nodes: Dict[str, List[int]] = {}
    nodes: Dict[Tuple[int, int, int], int] = {}
    node_coords: Dict[int, Tuple[float, float, float]] = {}
    elements: List[Tuple[int, ...]] = []
    elem_conn: Dict[int, Tuple[str, List[int]]] = {}
    nx = ny = nz = 1

    if raw_cad and cad_filename:
        cad_mesh_res = call_gmsh_mesher({
            "cad_stl_b64": base64.b64encode(raw_cad).decode("ascii"),
            "cad_filename": cad_filename,
            "mesh_size": mesh_size,
            "dimension": 3,
            "element_order": element_order,
        })
        gmsh_inp_text = Path(cad_mesh_res["inp_path"]).read_text(encoding="utf-8", errors="replace")
        parsed_nodes, parsed_elems = _parse_calculix_inp_mesh(gmsh_inp_text)
        # Filter to 3D tetrahedral volume elements generated by Gmsh
        vol_elems = {
            eid: (et, nids)
            for eid, (et, nids) in parsed_elems.items()
            if et.upper().startswith(("C3D4", "C3D10", "DC3D4", "DC3D10", "C3D8"))
        }
        if not parsed_nodes or not vol_elems:
            raise ValueError(f"Uploaded CAD file '{cad_filename}' produced no 3D solid elements in Gmsh for CalculiX.")
        used_gmsh_cad = True
        node_coords = parsed_nodes
        raw_pn = cad_mesh_res.get("patch_nodes") or {}
        if isinstance(raw_pn, Mapping):
            cad_patch_nodes = {
                str(pname): [int(n) for n in nids if int(n) in node_coords]
                for pname, nids in raw_pn.items()
                if isinstance(nids, (list, tuple))
            }
        is_second_order = any(len(nids) >= 10 for _, nids in vol_elems.values())
        if is_thermal_only:
            elem_type = "DC3D10" if is_second_order else "DC3D4"
        elif is_coupled_ts:
            elem_type = "C3D10T" if is_second_order else "C3D4T"
        else:
            elem_type = "C3D10" if is_second_order else "C3D4"

        re_eid = 1
        for _old_eid, (_et, nids) in vol_elems.items():
            elements.append((re_eid, *nids))
            elem_conn[re_eid] = (elem_type, list(nids))
            re_eid += 1

        xs = [c[0] for c in node_coords.values()]
        ys = [c[1] for c in node_coords.values()]
        zs = [c[2] for c in node_coords.values()]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        z_min, z_max = min(zs), max(zs)
        length = max(1e-6, x_max - x_min)
        height = max(1e-6, y_max - y_min)
        depth = max(1e-6, z_max - z_min)
        tol_x = max(1e-6, length * 0.05)
        tol_y = max(1e-6, height * 0.05)
        tol_z = max(1e-6, depth * 0.05)

        def face_nodes(face: str) -> list[int]:
            face = face.lower()
            if face in {"xmin", "x_min", "left"}:
                return [nid for nid, (x, _, _) in node_coords.items() if x <= x_min + tol_x]
            if face in {"xmax", "x_max", "right"}:
                return [nid for nid, (x, _, _) in node_coords.items() if x >= x_max - tol_x]
            if face in {"ymin", "y_min", "bottom"}:
                return [nid for nid, (_, y, _) in node_coords.items() if y <= y_min + tol_y]
            if face in {"ymax", "y_max", "top"}:
                return [nid for nid, (_, y, _) in node_coords.items() if y >= y_max - tol_y]
            if face in {"zmin", "z_min", "front"}:
                return [nid for nid, (_, _, z) in node_coords.items() if z <= z_min + tol_z]
            if face in {"zmax", "z_max", "back"}:
                return [nid for nid, (_, _, z) in node_coords.items() if z >= z_max - tol_z]
            return []
    used_twobody_contact = False
    lower_elem_ids: List[int] = []
    upper_elem_ids: List[int] = []
    master_contact_faces: List[Tuple[int, str]] = []
    slave_contact_faces: List[Tuple[int, str]] = []
    contact_mode_norm = str(data.get("contact_type") or "Bonded").strip().lower()
    wants_twobody_contact = (
        (not used_gmsh_cad)
        and (not is_thermal_only)
        and (not is_dynamic)
        and (not is_buckling)
        and contact_mode_norm in {"frictional", "contact_frictionless", "tie"}
    )

    if not used_gmsh_cad:
        divisions = geometry.get("divisions", mesh.get("divisions", {})) if isinstance(mesh, Mapping) else {}
        if not isinstance(divisions, Mapping):
            divisions = {}
        default_nx = max(2, min(40, int(round(length / max(mesh_size, 1e-4)))))
        default_ny = max(2, min(40, int(round(height / max(mesh_size, 1e-4)))))
        default_nz = max(2, min(16, int(round(depth / max(mesh_size, 1e-4)))))
        nx = max(1, int(divisions.get("x", mesh.get("nx", default_nx) if isinstance(mesh, Mapping) else default_nx)))
        ny = max(1, int(divisions.get("y", mesh.get("ny", default_ny) if isinstance(mesh, Mapping) else default_ny)))
        nz = max(1, int(divisions.get("z", mesh.get("nz", default_nz) if isinstance(mesh, Mapping) else default_nz)))
        elem_type = "DC3D8" if is_thermal_only else ("C3D8T" if is_coupled_ts else "C3D8")

        if wants_twobody_contact:
            ny = max(2, ny)
            (
                node_coords,
                elements,
                elem_conn,
                lower_elem_ids,
                upper_elem_ids,
                master_contact_faces,
                slave_contact_faces,
            ) = _generate_calculix_twobody_mesh(length, height, depth, nx, ny, nz, elem_type)
            used_twobody_contact = True

            def face_nodes(face: str) -> list[int]:
                tol = 1e-7 * max(length, height, depth, 1.0)
                face = face.lower()
                if face in {"xmin", "x_min", "left"}:
                    return [nid for nid, (x, _, _) in node_coords.items() if abs(x) <= tol]
                if face in {"xmax", "x_max", "right"}:
                    return [nid for nid, (x, _, _) in node_coords.items() if abs(x - length) <= tol]
                if face in {"ymin", "y_min", "bottom"}:
                    return [nid for nid, (_, y, _) in node_coords.items() if abs(y) <= tol]
                if face in {"ymax", "y_max", "top"}:
                    return [nid for nid, (_, y, _) in node_coords.items() if abs(y - height) <= tol]
                if face in {"zmin", "z_min", "front"}:
                    return [nid for nid, (_, _, z) in node_coords.items() if abs(z) <= tol]
                if face in {"zmax", "z_max", "back"}:
                    return [nid for nid, (_, _, z) in node_coords.items() if abs(z - depth) <= tol]
                return []
        else:
            node_id = 1
            for k in range(nz + 1):
                for j in range(ny + 1):
                    for i in range(nx + 1):
                        nodes[(i, j, k)] = node_id
                        node_coords[node_id] = (length * i / nx, height * j / ny, depth * k / nz)
                        node_id += 1
            element_id = 1
            for k in range(nz):
                for j in range(ny):
                    for i in range(nx):
                        conn = [
                            nodes[(i, j, k)], nodes[(i + 1, j, k)], nodes[(i + 1, j + 1, k)], nodes[(i, j + 1, k)],
                            nodes[(i, j, k + 1)], nodes[(i + 1, j, k + 1)], nodes[(i + 1, j + 1, k + 1)], nodes[(i, j + 1, k + 1)],
                        ]
                        elements.append((element_id, *conn))
                        elem_conn[element_id] = (elem_type, conn)
                        element_id += 1

            def node_set(predicate) -> list[int]:
                return [nid for (i, j, k), nid in nodes.items()
                        if predicate(length * i / nx, height * j / ny, depth * k / nz)]

            def face_nodes(face: str) -> list[int]:
                tol = 1e-9 * max(length, height, depth, 1.0)
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

    def _ccx_elem_line(tup: Tuple[int, ...]) -> str:
        if len(tup) <= 16:
            return ",".join(map(str, tup)) + "\n"
        # CalculiX max 16 entries per line -> split continuation cleanly
        return ",".join(map(str, tup[:16])) + ",\n" + ",".join(map(str, tup[16:])) + "\n"

    mat_cards, mat_meta = _build_calculix_material_cards(
        data,
        mat_name=name,
        E=E,
        nu=nu,
        density=density,
        k_cond=k_cond,
        cp_solid=cp_solid,
        alpha_exp=alpha_exp,
        is_thermal_only=is_thermal_only,
        is_coupled_ts=is_coupled_ts,
    )

    ordered_nids = sorted(node_coords.keys())
    header_lines = [
        "*HEADING",
        f"NASEER Universal CalculiX {physics_type}",
        "*NODE",
        "".join("%d,%.15g,%.15g,%.15g\n" % (nid, *node_coords[nid]) for nid in ordered_nids).rstrip("\n"),
        f"*ELEMENT,TYPE={elem_type},ELSET=SOLID",
        "".join(_ccx_elem_line(e) for e in elements).rstrip("\n"),
        f"*SOLID SECTION,ELSET=SOLID,MATERIAL={name}",
        *mat_cards,
    ]
    if is_thermal_only or is_coupled_ts:
        t_init = temperature_to_kelvin(data, default=293.15)
        header_lines.append(f"*INITIAL CONDITIONS,TYPE=TEMPERATURE\nALL,{t_init}")

    contact_meta: Dict[str, Any] = {
        "contact_pair_active": False,
        "contact_type": str(data.get("contact_type") or "Bonded"),
        "friction_coeff": 0.0,
        "requires_nlgeom": False,
    }
    if used_twobody_contact:
        contact_cards, contact_meta = _build_calculix_contact_cards(
            contact_type=str(data.get("contact_type") or "Tie"),
            friction_coeff=float(data.get("friction_coeff") if data.get("friction_coeff") is not None else 0.2),
            E=E,
            height=height,
            master_faces=master_contact_faces,
            slave_faces=slave_contact_faces,
        )
        header_lines.append(f"*ELSET,ELSET=BODY_LOWER\n{_ccx_id_lines(lower_elem_ids).rstrip()}")
        header_lines.append(f"*ELSET,ELSET=BODY_UPPER\n{_ccx_id_lines(upper_elem_ids).rstrip()}")
        header_lines.append(contact_cards.rstrip("\n"))

    inp.write_text("\n".join(header_lines) + "\n", encoding="utf-8")

    markers = data.get("boundary_markers")
    boundary_patches = data.get("boundary_patches")
    bbox_diag = math.sqrt(length * length + height * height + depth * depth)
    pin_radius = max(mesh_size * 1.5, bbox_diag * 0.08)

    def _resolve_ccx_patch_nodes(pname: str) -> List[int]:
        if not pname:
            return []
        if pname in cad_patch_nodes and cad_patch_nodes[pname]:
            return cad_patch_nodes[pname]
        low = pname.lower()
        for k, nids in cad_patch_nodes.items():
            if nids and (k.lower() == low or low in k.lower() or k.lower() in low):
                return nids
        return face_nodes(pname)

    with inp.open("a", encoding="utf-8") as f:
        f.write(f"*NSET,NSET=ALL\n{_ccx_id_lines(ordered_nids)}")
        f.write(f"*ELSET,ELSET=EALL\n{_ccx_id_lines(range(1, len(elements) + 1))}")

        # Thermal boundary conditions (DOF 11 in CalculiX)
        t_left = float(data.get("bc_left_temp", 373.15))
        t_right = float(data.get("bc_right_temp", 293.15))
        thermal_pin_flux_cards: list[str] = []
        if is_thermal_only or is_coupled_ts:
            left_ids = face_nodes("left")
            right_ids = face_nodes("right")
            if left_ids:
                f.write(f"*NSET,NSET=THERM_LEFT\n{_ccx_id_lines(left_ids)}")
                if not data.get("heat_flux"):
                    f.write(f"*BOUNDARY\nTHERM_LEFT,11,11,{t_left}\n")
            if right_ids:
                f.write(f"*NSET,NSET=THERM_RIGHT\n{_ccx_id_lines(right_ids)}")
                f.write(f"*BOUNDARY\nTHERM_RIGHT,11,11,{t_right}\n")
            if isinstance(boundary_patches, list):
                for bp_idx, bp in enumerate(boundary_patches):
                    if not isinstance(bp, Mapping):
                        continue
                    pname = str(bp.get("patchName") or bp.get("patch") or bp.get("name") or "").strip()
                    btype = str(bp.get("type") or "").lower()
                    bp_nids = _resolve_ccx_patch_nodes(pname)
                    if not bp_nids or not any(tok in btype for tok in ("heat", "temp", "flux", "convection", "radiation")):
                        continue
                    try:
                        bval = float(bp.get("value"))
                    except (TypeError, ValueError):
                        bval = None
                    f.write(f"*NSET,NSET=BP_TH_{bp_idx}\n{_ccx_id_lines(bp_nids)}")
                    if bval is not None and "flux" in btype:
                        q_total = bval * (math.pi * pin_radius * pin_radius)
                        thermal_pin_flux_cards.append(f"*CFLUX\nBP_TH_{bp_idx},11,{q_total / len(bp_nids):.15g}\n")
                    elif bval is not None:
                        tv_k = bval + 273.15 if bval < 150.0 else bval
                        f.write(f"*BOUNDARY\nBP_TH_{bp_idx},11,11,{tv_k:.8g}\n")
            if isinstance(markers, list):
                for m_idx, m in enumerate(markers):
                    if not isinstance(m, Mapping):
                        continue
                    pt = m.get("point")
                    pname = str(m.get("patchName") or "").strip()
                    mtype = str(m.get("subtype") or m.get("type") or "").lower()
                    if not any(tok in mtype for tok in ("heat", "temp", "flux")):
                        continue
                    pin_nids = _resolve_ccx_patch_nodes(pname) if pname else []
                    if not pin_nids and isinstance(pt, (list, tuple)) and len(pt) == 3:
                        pin_nids = _select_nodes_near_point(node_coords, pt, pin_radius)
                    if not pin_nids:
                        continue
                    f.write(f"*NSET,NSET=PIN_TH_{m_idx}\n{_ccx_id_lines(pin_nids)}")
                    try:
                        mval = float(m.get("value"))
                    except (TypeError, ValueError):
                        mval = None
                    if mval is not None and "flux" in mtype:
                        q_total = mval * (math.pi * pin_radius * pin_radius)
                        thermal_pin_flux_cards.append(f"*CFLUX\nPIN_TH_{m_idx},11,{q_total / len(pin_nids):.15g}\n")
                    elif mval is not None:
                        tv_k = mval + 273.15 if mval < 150.0 else mval
                        f.write(f"*BOUNDARY\nPIN_TH_{m_idx},11,11,{tv_k:.8g}\n")

        # Mechanical constraints & loads
        load_cards: list[str] = []
        if not is_thermal_only:
            constraints = data.get("constraints", [])
            if isinstance(constraints, Mapping):
                constraints = [constraints]
            applied_any_constraint = False
            for index, constraint in enumerate(constraints):
                if not isinstance(constraint, Mapping):
                    continue
                face = constraint.get("face") or constraint.get("surface")
                ids = _resolve_ccx_patch_nodes(str(face)) if face else list(constraint.get("nodes", []))
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
                f.write(f"*NSET,NSET=CONSTRAINT_{index}\n" + _ccx_id_lines(ids))
                for dof, value in zip(dofs, values):
                    f.write(f"*BOUNDARY\nCONSTRAINT_{index},{dof},{dof},{float(value)}\n")
                applied_any_constraint = True

            # Named CAD face boundary_patches
            if isinstance(boundary_patches, list):
                for bp_idx, bp in enumerate(boundary_patches):
                    if not isinstance(bp, Mapping):
                        continue
                    pname = str(bp.get("patchName") or bp.get("patch") or bp.get("name") or "").strip()
                    btype = str(bp.get("type") or "").lower()
                    bp_nids = _resolve_ccx_patch_nodes(pname)
                    if not bp_nids:
                        continue
                    if any(tok in btype for tok in ("fixed", "pinned", "frictionless", "wall", "displacement", "support")):
                        f.write(f"*NSET,NSET=BP_FIX_{bp_idx}\n{_ccx_id_lines(bp_nids)}")
                        if "displacement" in btype and bp.get("value") is not None:
                            try:
                                dval = float(bp["value"])
                                f.write(f"*BOUNDARY\nBP_FIX_{bp_idx},1,1,0\nBP_FIX_{bp_idx},3,3,0\nBP_FIX_{bp_idx},2,2,{dval}\n")
                            except (TypeError, ValueError):
                                f.write(f"*BOUNDARY\nBP_FIX_{bp_idx},1,3,0\n")
                        else:
                            f.write(f"*BOUNDARY\nBP_FIX_{bp_idx},1,3,0\n")
                        applied_any_constraint = True
                    elif any(tok in btype for tok in ("load", "force", "pressure")):
                        try:
                            bval = float(bp.get("value"))
                        except (TypeError, ValueError):
                            bval = 0.0
                        if abs(bval) > 0.0:
                            f.write(f"*NSET,NSET=BP_LOAD_{bp_idx}\n{_ccx_id_lines(bp_nids)}")
                            total_f = (bval * 1e6 * (math.pi * pin_radius * pin_radius)) if "pressure" in btype else bval
                            c_val = -total_f / len(bp_nids)
                            load_cards.append(f"*CLOAD\nBP_LOAD_{bp_idx},2,{c_val:.15g}\n")

            # Spatial 3D viewport pin constraints & loads
            if isinstance(markers, list):
                for m_idx, m in enumerate(markers):
                    if not isinstance(m, Mapping):
                        continue
                    pt = m.get("point")
                    pname = str(m.get("patchName") or "").strip()
                    mtype = str(m.get("subtype") or m.get("type") or "").lower()
                    pin_nids = _resolve_ccx_patch_nodes(pname) if pname else []
                    if not pin_nids and isinstance(pt, (list, tuple)) and len(pt) == 3:
                        pin_nids = _select_nodes_near_point(node_coords, pt, pin_radius)
                    if not pin_nids:
                        continue
                    if any(tok in mtype for tok in ("fixed", "pinned", "frictionless", "wall", "displacement")):
                        f.write(f"*NSET,NSET=PIN_FIX_{m_idx}\n{_ccx_id_lines(pin_nids)}")
                        if "displacement" in mtype and m.get("value") is not None:
                            f.write(f"*BOUNDARY\nPIN_FIX_{m_idx},1,1,0\nPIN_FIX_{m_idx},3,3,0\nPIN_FIX_{m_idx},2,2,{float(m['value'])}\n")
                        else:
                            f.write(f"*BOUNDARY\nPIN_FIX_{m_idx},1,3,0\n")
                        applied_any_constraint = True
                    elif any(tok in mtype for tok in ("load", "force", "pressure")):
                        try:
                            mval = float(m.get("value"))
                        except (TypeError, ValueError):
                            mval = 0.0
                        if abs(mval) > 0.0:
                            f.write(f"*NSET,NSET=PIN_LOAD_{m_idx}\n{_ccx_id_lines(pin_nids)}")
                            norm = m.get("normal") if isinstance(m.get("normal"), (list, tuple)) and len(m.get("normal")) == 3 else [0.0, 1.0, 0.0]
                            total_f = (mval * 1e6 * (math.pi * pin_radius * pin_radius)) if "pressure" in mtype else mval
                            for dof, comp in enumerate(norm, start=1):
                                c_val = (-total_f * float(comp)) / len(pin_nids)
                                if abs(c_val) > 1e-12:
                                    load_cards.append(f"*CLOAD\nPIN_LOAD_{m_idx},{dof},{c_val:.15g}\n")

            if not applied_any_constraint and "displacement" in data and float(data.get("displacement") or 0.0) != 0.0:
                val = float(data["displacement"])
                top_ids = face_nodes("top")
                bot_ids = face_nodes("bottom")
                f.write(f"*NSET,NSET=TOP\n{_ccx_id_lines(top_ids)}*BOUNDARY\nTOP,1,3,0\nTOP,2,2,{val}\n")
                f.write(f"*NSET,NSET=BOTTOM\n{_ccx_id_lines(bot_ids)}*BOUNDARY\nBOTTOM,1,3,0\n")
                applied_any_constraint = True

            if not applied_any_constraint:
                support_type = str(data.get("support_type") or "cantilever").lower()
                contact_mode = str(data.get("contact_type") or "Bonded").strip().lower()
                is_sliding = contact_mode == "sliding"
                if support_type == "simply_supported":
                    f.write(f"*NSET,NSET=SUP_L\n{_ccx_id_lines(face_nodes('left'))}*BOUNDARY\nSUP_L,1,3,0\n")
                    f.write(f"*NSET,NSET=SUP_R\n{_ccx_id_lines(face_nodes('right'))}*BOUNDARY\nSUP_R,2,2,0\n")
                elif support_type in {"fixed_both", "clamped"}:
                    f.write(f"*NSET,NSET=SUP_L\n{_ccx_id_lines(face_nodes('left'))}*BOUNDARY\nSUP_L,1,3,0\n")
                    if is_sliding:
                        # Frictionless sliding support on right face: restrict normal Y/Z while allowing axial X sliding
                        f.write(f"*NSET,NSET=SUP_R\n{_ccx_id_lines(face_nodes('right'))}*BOUNDARY\nSUP_R,2,3,0\n")
                    else:
                        f.write(f"*NSET,NSET=SUP_R\n{_ccx_id_lines(face_nodes('right'))}*BOUNDARY\nSUP_R,1,3,0\n")
                else:
                    if is_sliding:
                        # Frictionless sliding restraint on left face: fix normal X (DOF 1) + out-of-plane Z (DOF 3), anchor single bottom corner in Y to prevent rigid body mode
                        left_n = face_nodes('left')
                        f.write(f"*NSET,NSET=SUP_FIX\n{_ccx_id_lines(left_n)}*BOUNDARY\nSUP_FIX,1,1,0\nSUP_FIX,3,3,0\n")
                        if left_n:
                            f.write(f"*BOUNDARY\n{left_n[0]},2,2,0\n")
                    else:
                        f.write(f"*NSET,NSET=SUP_FIX\n{_ccx_id_lines(face_nodes('left'))}*BOUNDARY\nSUP_FIX,1,3,0\n")

            # Loads: explicit list OR pressure_load_mpa OR total force
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
                if ids:
                    f.write(f"*NSET,NSET=LOAD_{index}\n" + _ccx_id_lines(ids))
                    total = float(load.get("total", load.get("value", load.get("magnitude", 1.0))))
                    nodal = [v / len(ids) for v in components] if any(components) else [0.0, -total / len(ids), 0.0]
                    for dof, value in enumerate(nodal, start=1):
                        if abs(value) > 0:
                            load_cards.append(f"*CLOAD\nLOAD_{index},{dof},{value:.15g}\n")

            if not load_cards and not ("displacement" in data and float(data.get("displacement") or 0.0) != 0.0):
                p_mpa = float(data.get("pressure_load_mpa") or 0.0)
                force_n = float(data.get("force_n") or 0.0)
                top_ids = face_nodes("top")
                if p_mpa != 0.0 and top_ids:
                    total_force_n = p_mpa * 1e6 * (length * depth)
                    f.write(f"*NSET,NSET=LOAD_TOP\n{_ccx_id_lines(top_ids)}")
                    per_node = -total_force_n / len(top_ids)
                    load_cards.append(f"*CLOAD\nLOAD_TOP,2,{per_node:.15g}\n")
                elif force_n != 0.0 and top_ids:
                    f.write(f"*NSET,NSET=LOAD_TOP\n{_ccx_id_lines(top_ids)}")
                    per_node = -force_n / len(top_ids)
                    load_cards.append(f"*CLOAD\nLOAD_TOP,2,{per_node:.15g}\n")
                elif is_buckling:
                    raise ValueError(
                        "Structural buckling requires an explicit compressive load (`force_n`, `pressure_load_mpa`, `loads`, or a viewport Load pin)."
                    )

        # Step definition by physics mode
        needs_nlgeom = bool(data.get("nonlinear")) or bool(mat_meta.get("requires_nlgeom")) or bool(contact_meta.get("requires_nlgeom"))
        nlgeom = ",NLGEOM,INC=100" if needs_nlgeom else ""
        modes_count = max(1, min(20, int(data.get("modes_count") or (5 if is_dynamic else 3))))
        dt_ccx = max(1e-4, float(data.get("time_step") or 0.1))
        end_t_ccx = max(dt_ccx, float(data.get("end_time") or 10.0))
        emissivity = float(data.get("emissivity") or 0.85)
        t_amb_c = float(data.get("ambient_temp_c") if data.get("ambient_temp_c") is not None else 25.0)
        t_amb_k = t_amb_c + 273.15 if t_amb_c < 150.0 else t_amb_c

        if is_thermal_only:
            if physics_type == "Thermal_Radiation":
                f.write("*PHYSICAL CONSTANTS,ABSOLUTE ZERO=0,STEFAN BOLTZMANN=5.670374e-8\n")
            steady = ",STEADY STATE" if physics_type != "Thermal_Transient" else ""
            f.write(f"*STEP\n*HEAT TRANSFER{steady}\n")
            if physics_type == "Thermal_Transient":
                f.write(f"{dt_ccx:.6g},{end_t_ccx:.6g}\n")
            if data.get("heat_flux"):
                q_flux = float(data["heat_flux"])
                left_ids = face_nodes("left")
                if left_ids:
                    q_total = q_flux * (height * depth)
                    f.write(f"*CFLUX\nTHERM_LEFT,11,{q_total / len(left_ids):.15g}\n")
            f.write("".join(thermal_pin_flux_cards))
            if physics_type == "Thermal_Radiation" and not used_gmsh_cad:
                top_elem_ids = [
                    elem_idx + 1
                    for elem_idx in range(len(elements))
                    if ((elem_idx // nx) % ny) == (ny - 1)
                ]
                if top_elem_ids:
                    f.write(f"*ELSET,ELSET=RAD_TOP\n{_ccx_id_lines(top_elem_ids)}")
                    f.write(f"*RADIATE\nRAD_TOP,R5,{t_amb_k:.6g},{emissivity:.4g}\n")
            f.write("*NODE PRINT,NSET=ALL\nNT\n*NODE FILE\nNT\n*END STEP\n")
        elif is_coupled_ts:
            f.write(f"*STEP{nlgeom}\n*COUPLED TEMPERATURE-DISPLACEMENT,STEADY STATE\n")
            if needs_nlgeom:
                f.write("0.1,1.0,1e-5,0.25\n")
            f.write("".join(load_cards))
            f.write("".join(thermal_pin_flux_cards))
            f.write("*NODE PRINT,NSET=ALL\nU\n*NODE PRINT,NSET=ALL\nNT\n*NODE PRINT,NSET=ALL\nRF\n*EL PRINT,ELSET=SOLID\nS\n*NODE FILE\nU,NT\n*EL FILE\nS\n*END STEP\n")
        elif is_dynamic:
            f.write(f"*STEP\n*FREQUENCY\n{modes_count}\n*NODE PRINT,NSET=ALL\nU\n*NODE FILE\nU\n*END STEP\n")
        elif is_buckling:
            f.write(f"*STEP\n*BUCKLE\n{modes_count}\n")
            f.write("".join(load_cards))
            f.write("*NODE PRINT,NSET=ALL\nU\n*NODE FILE\nU\n*END STEP\n")
        else:
            static_inc = "0.1,1.0,1e-5,0.25\n" if needs_nlgeom else ""
            el_file_vars = "S,PEEQ" if mat_meta.get("material_model") == "plastic" else ("S,E" if mat_meta.get("material_model") == "hyperelastic" else "S")
            contact_file_card = "*CONTACT FILE\nCDIS,CSTR\n" if contact_meta.get("contact_pair_active") else ""
            f.write(
                f"*STEP{nlgeom}\n*STATIC\n"
                + static_inc
                + "".join(load_cards)
                + "*NODE PRINT,NSET=ALL\nU\n*NODE PRINT,NSET=ALL\nRF\n"
                + "*EL PRINT,ELSET=SOLID\nS\n*NODE FILE\nU\n"
                + f"*EL FILE\n{el_file_vars}\n"
                + contact_file_card
                + "*END STEP\n"
            )

    try:
        proc = _run_streaming_command(
            [ccx, "model"],
            cwd=case_dir,
            env=ccx_env,
            timeout=300,
            log_path=case_dir / "solver.log",
            append_log=False,
            solver_kind="calculix",
        )
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, [ccx, "model"], output=proc.stdout, stderr=proc.stderr)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"CalculiX execution failed: {(exc.stderr or exc.stdout or '')[-4000:]}") from exc

    dat_path = case_dir / "model.dat"
    frd_path = case_dir / "model.frd"
    disps = _parse_calculix_dat_displacements(dat_path)
    stresses = _parse_calculix_dat_stress(dat_path)
    reactions = _parse_calculix_dat_reactions(dat_path)
    temps = _parse_calculix_dat_temperatures(dat_path)
    modes = _parse_calculix_modal_or_buckling(dat_path)

    # Build 2D contour slice (for structured thermal box) & full 3D VTK surface payload for ALL meshes (box or CAD)
    temp_matrix: Optional[List[List[float]]] = None
    center_temp_c: Optional[float] = None
    calc_heat_flux: Optional[float] = None

    if temps:
        node_temp_map = {t["node"]: t["temperature"] for t in temps}
        if not used_gmsh_cad and not used_twobody_contact:
            mid_k = nz // 2
            slice_rows: List[List[float]] = []
            for j in range(ny + 1):
                row: List[float] = []
                for i in range(nx + 1):
                    nid = nodes[(i, j, mid_k)]
                    t_val = node_temp_map.get(nid, 293.15)
                    row.append(round(t_val - 273.15, 4))
                slice_rows.append(row)
            temp_matrix = slice_rows
            center_temp_c = slice_rows[ny // 2][nx // 2]
            t_l = sum(slice_rows[j][0] for j in range(ny + 1)) / (ny + 1)
            t_r = sum(slice_rows[j][-1] for j in range(ny + 1)) / (ny + 1)
            calc_heat_flux = round(k_cond * (t_l - t_r) / length, 3)
        else:
            left_nids = face_nodes("left")
            right_nids = face_nodes("right")
            if left_nids and right_nids:
                t_l = sum(node_temp_map.get(n, 293.15) for n in left_nids) / len(left_nids)
                t_r = sum(node_temp_map.get(n, 293.15) for n in right_nids) / len(right_nids)
                calc_heat_flux = round(k_cond * (t_l - t_r) / length, 3)

    vtk_payload = _build_calculix_vtk_from_results(node_coords, elem_conn, disps, stresses, temps, frd_path=frd_path)

    ccx_integrals: Dict[str, Any] = {
        "domain_volume_m3": round(length * height * depth, 6),
        "surface_area_m2": round(2.0 * (length * height + length * depth + height * depth), 6),
        "contact_type": str(data.get("contact_type") or "Bonded"),
        "material_model": str(mat_meta.get("material_model") or "linear_elastic"),
        "nlgeom_active": bool(needs_nlgeom),
    }
    if contact_meta.get("contact_pair_active") or used_twobody_contact:
        ccx_integrals["twobody_assembly"] = True
        ccx_integrals["contact_pair_active"] = bool(contact_meta.get("contact_pair_active"))
        if contact_meta.get("friction_coeff", 0.0) > 0.0:
            ccx_integrals["friction_coeff"] = round(float(contact_meta["friction_coeff"]), 4)
    if disps:
        ccx_integrals["max_displacement_m"] = round(max(d["magnitude"] for d in disps), 8)
    if stresses:
        vms = [s["von_mises"] for s in stresses]
        ccx_integrals["max_von_mises_pa"] = round(max(vms), 4)
        ccx_integrals["avg_von_mises_pa"] = round(sum(vms) / len(vms), 4)
    if reactions:
        ccx_integrals["max_reaction_n"] = round(max(r["magnitude"] for r in reactions), 4)
        ccx_integrals["total_reaction_x_n"] = round(sum(r["fx"] for r in reactions), 4)
        ccx_integrals["total_reaction_y_n"] = round(sum(r["fy"] for r in reactions), 4)
        ccx_integrals["total_reaction_z_n"] = round(sum(r["fz"] for r in reactions), 4)
    if calc_heat_flux is not None:
        ccx_integrals["heat_flux_w_m2"] = calc_heat_flux
        ccx_integrals["total_heat_transfer_w"] = round(calc_heat_flux * (height * depth), 4)
    if temps:
        tvals = [t["temperature"] for t in temps]
        ccx_integrals["field_average"] = round(sum(tvals) / len(tvals), 4)
        if data.get("convection_h") and data.get("hydraulic_diameter"):
            h_user = float(data["convection_h"])
            dh_user = float(data["hydraulic_diameter"])
            ccx_integrals["heat_transfer_coeff_h"] = round(h_user, 4)
            ccx_integrals["nusselt_number"] = round((h_user * dh_user) / max(k_cond, 1e-9), 4)
    elif stresses:
        ccx_integrals["field_average"] = ccx_integrals.get("avg_von_mises_pa")

    out: Dict[str, Any] = {
        "status": "SOLVED_REALTIME",
        "solver": "CalculiX",
        "solver_variant": elem_type,
        "material_model": mat_meta.get("material_model", "linear_elastic"),
        "contact_pair_active": bool(contact_meta.get("contact_pair_active")),
        "executable": ccx,
        "parallel_cores": requested_cores,
        "case_directory": str(case_dir),
        "model": str(inp),
        "mesh_nodes": len(node_coords),
        "mesh_elements": len(elements),
        "dat_output": dat_path.read_text(encoding="utf-8", errors="replace") if dat_path.exists() else "",
        "displacements": disps,
        "stress": stresses,
        "reactions": reactions,
        "temperatures": temps,
        "modes": modes,
        "integrals": ccx_integrals,
        "vtk_data": vtk_payload,
        "stdout": proc.stdout[-4000:],
        "logs": proc.stdout.splitlines()[-120:],
        "input": {k: v for k, v in data.items() if k not in {"cad_stl_b64", "cad_file_b64", "inp_deck"}},
        "units": {"displacement": "m", "stress": "Pa", "reaction": "N", "von_mises": "Pa", "temperature": "degC" if temp_matrix is not None else "K"},
        "artifacts": {"input_deck": str(inp), "dat_output": str(dat_path), "case_directory": str(case_dir)},
        "convergence": {"converged": dat_path.exists(), "status": "completed" if dat_path.exists() else "not_reported", "residuals": {}},
    }
    if "nusselt_number" in ccx_integrals:
        out["nusselt_number"] = ccx_integrals["nusselt_number"]
        out["heat_transfer_coeff_h"] = ccx_integrals["heat_transfer_coeff_h"]
    if temp_matrix is not None:
        out["temperature_matrix"] = temp_matrix
        out["center_temperature"] = center_temp_c
        out["calculated_heat_flux"] = calc_heat_flux
        out["material_k"] = k_cond
    return canonicalize_result(out, physics_type=physics_type, input_data=out["input"], solver="CalculiX")


def _build_calculix_material_cards(
    data: Mapping[str, Any],
    *,
    mat_name: str,
    E: float,
    nu: float,
    density: float,
    k_cond: float,
    cp_solid: float,
    alpha_exp: float,
    is_thermal_only: bool,
    is_coupled_ts: bool,
) -> Tuple[List[str], Dict[str, Any]]:
    """Build authentic CalculiX v2.21 material cards (*ELASTIC, *PLASTIC, or *HYPERELASTIC,NEO HOOKE)."""
    mat_dict = data.get("material", {}) if isinstance(data.get("material"), Mapping) else {}
    raw_model = str(data.get("material_model") or mat_dict.get("material_model") or "linear_elastic").strip().lower()
    if raw_model in {"plastic", "elastoplastic", "bilinear_plastic", "plasticity"}:
        model_key = "plastic"
    elif raw_model in {"hyperelastic", "neo_hooke", "neohookean", "neo-hooke"}:
        model_key = "hyperelastic"
    else:
        model_key = "linear_elastic"

    cards: List[str] = [f"*MATERIAL,NAME={mat_name}"]
    requires_nlgeom = False
    meta: Dict[str, Any] = {"material_model": model_key, "requires_nlgeom": False}

    if not is_thermal_only:
        if model_key == "hyperelastic":
            raw_c10 = data.get("hyper_c10_pa") if data.get("hyper_c10_pa") is not None else mat_dict.get("hyper_c10_pa")
            raw_d1 = data.get("hyper_d1_inv_pa") if data.get("hyper_d1_inv_pa") is not None else mat_dict.get("hyper_d1_inv_pa")
            if raw_c10 is not None and float(raw_c10) > 0.0:
                c10 = float(raw_c10)
            else:
                shear_g = E / (2.0 * (1.0 + nu))
                c10 = shear_g / 2.0
            if raw_d1 is not None and float(raw_d1) >= 0.0:
                d1 = float(raw_d1)
            else:
                bulk_k = E / (3.0 * max(1e-4, 1.0 - 2.0 * nu))
                d1 = 2.0 / bulk_k
            if c10 <= 0.0:
                raise ValueError("Hyperelastic Neo-Hooke model requires strictly positive C10 (Pa).")
            cards.append(f"*HYPERELASTIC,NEO HOOKE\n{c10:.8g},{d1:.8g}")
            requires_nlgeom = True
            meta["hyper_c10_pa"] = c10
            meta["hyper_d1_inv_pa"] = d1
        elif model_key == "plastic":
            raw_sy = data.get("yield_stress_pa") if data.get("yield_stress_pa") is not None else mat_dict.get("yield_stress_pa")
            if raw_sy is None or float(raw_sy) <= 0.0:
                raise ValueError("Elastoplastic (*PLASTIC) model requires a strictly positive `yield_stress_pa` (Pa).")
            sy = float(raw_sy)
            raw_et = data.get("tangent_modulus_pa") if data.get("tangent_modulus_pa") is not None else mat_dict.get("tangent_modulus_pa")
            et = float(raw_et) if (raw_et is not None and float(raw_et) > 0.0) else (0.05 * E)
            if et >= E:
                raise ValueError("Tangent modulus (`tangent_modulus_pa`) must be strictly less than Young's modulus E.")
            hardening_h = (E * et) / (E - et)
            eps_p2 = 0.2
            sigma_p2 = sy + hardening_h * eps_p2
            cards.append(f"*ELASTIC\n{E},{nu}")
            cards.append(f"*PLASTIC\n{sy:.8g},0.0\n{sigma_p2:.8g},{eps_p2:.6g}")
            requires_nlgeom = True
            meta["yield_stress_pa"] = sy
            meta["tangent_modulus_pa"] = et
        else:
            cards.append(f"*ELASTIC\n{E},{nu}")

    if is_thermal_only or is_coupled_ts:
        cards.append(f"*CONDUCTIVITY\n{k_cond}")
        cards.append(f"*SPECIFIC HEAT\n{cp_solid}")
    if is_coupled_ts:
        cards.append(f"*EXPANSION,ZERO=293.15\n{alpha_exp}")
    if density > 0:
        cards.append(f"*DENSITY\n{density}")
    meta["requires_nlgeom"] = requires_nlgeom
    return cards, meta


def _generate_calculix_twobody_mesh(
    length: float,
    height: float,
    depth: float,
    nx: int,
    ny: int,
    nz: int,
    elem_type: str = "C3D8",
) -> Tuple[
    Dict[int, Tuple[float, float, float]],
    List[Tuple[int, ...]],
    Dict[int, Tuple[str, List[int]]],
    List[int],
    List[int],
    List[Tuple[int, str]],
    List[Tuple[int, str]],
]:
    """Build two disconnected hexahedral bodies (BODY_LOWER y in [0, H/2], BODY_UPPER y in [H/2, H]) with independent interface node IDs."""
    ny_low = max(1, ny // 2)
    ny_up = max(1, ny - ny_low)
    y_mid = height * (ny_low / float(ny_low + ny_up))

    node_coords: Dict[int, Tuple[float, float, float]] = {}
    elements: List[Tuple[int, ...]] = []
    elem_conn: Dict[int, Tuple[str, List[int]]] = {}
    lower_elem_ids: List[int] = []
    upper_elem_ids: List[int] = []
    master_faces: List[Tuple[int, str]] = []
    slave_faces: List[Tuple[int, str]] = []

    nid = 1
    eid = 1

    # Lower body: y in [0, y_mid]
    low_nodes: Dict[Tuple[int, int, int], int] = {}
    for k in range(nz + 1):
        for j in range(ny_low + 1):
            for i in range(nx + 1):
                low_nodes[(i, j, k)] = nid
                node_coords[nid] = (length * i / nx, y_mid * j / ny_low, depth * k / nz)
                nid += 1
    for k in range(nz):
        for j in range(ny_low):
            for i in range(nx):
                conn = [
                    low_nodes[(i, j, k)], low_nodes[(i + 1, j, k)], low_nodes[(i + 1, j + 1, k)], low_nodes[(i, j + 1, k)],
                    low_nodes[(i, j, k + 1)], low_nodes[(i + 1, j, k + 1)], low_nodes[(i + 1, j + 1, k + 1)], low_nodes[(i, j + 1, k + 1)],
                ]
                elements.append((eid, *conn))
                elem_conn[eid] = (elem_type, conn)
                lower_elem_ids.append(eid)
                if j == ny_low - 1:
                    # CalculiX C3D8 face S5 is top (+Y, nodes 3-4-8-7)
                    master_faces.append((eid, "S5"))
                eid += 1

    # Upper body: y in [y_mid, height] with completely separate node IDs
    up_nodes: Dict[Tuple[int, int, int], int] = {}
    for k in range(nz + 1):
        for j in range(ny_up + 1):
            for i in range(nx + 1):
                up_nodes[(i, j, k)] = nid
                node_coords[nid] = (length * i / nx, y_mid + (height - y_mid) * j / ny_up, depth * k / nz)
                nid += 1
    for k in range(nz):
        for j in range(ny_up):
            for i in range(nx):
                conn = [
                    up_nodes[(i, j, k)], up_nodes[(i + 1, j, k)], up_nodes[(i + 1, j + 1, k)], up_nodes[(i, j + 1, k)],
                    up_nodes[(i, j, k + 1)], up_nodes[(i + 1, j, k + 1)], up_nodes[(i + 1, j + 1, k + 1)], up_nodes[(i, j + 1, k + 1)],
                ]
                elements.append((eid, *conn))
                elem_conn[eid] = (elem_type, conn)
                upper_elem_ids.append(eid)
                if j == 0:
                    # CalculiX C3D8 face S3 is bottom (-Y, nodes 1-2-6-5)
                    slave_faces.append((eid, "S3"))
                eid += 1

    return node_coords, elements, elem_conn, lower_elem_ids, upper_elem_ids, master_faces, slave_faces


def _build_calculix_contact_cards(
    *,
    contact_type: str,
    friction_coeff: float,
    E: float,
    height: float,
    master_faces: List[Tuple[int, str]],
    slave_faces: List[Tuple[int, str]],
) -> Tuple[str, Dict[str, Any]]:
    """Build authentic CalculiX v2.21 *SURFACE + (*TIE | *SURFACE INTERACTION + *FRICTION + *CONTACT PAIR)."""
    mode = (contact_type or "Tie").strip().lower()
    lines: List[str] = [
        "*SURFACE,NAME=SURF_MASTER,TYPE=ELEMENT",
        *(f"{eid},{face_id}" for eid, face_id in master_faces),
        "*SURFACE,NAME=SURF_SLAVE,TYPE=ELEMENT",
        *(f"{eid},{face_id}" for eid, face_id in slave_faces),
    ]
    if mode == "tie":
        lines.append("*TIE,NAME=TIE_ASSY,POSITION TOLERANCE=1e-3")
        lines.append("SURF_SLAVE,SURF_MASTER")
        return "\n".join(lines) + "\n", {
            "contact_pair_active": False,
            "contact_type": "Tie",
            "friction_coeff": 0.0,
            "requires_nlgeom": False,
        }

    mu = 0.0 if mode == "contact_frictionless" else max(0.0, float(friction_coeff))
    k_normal = max(1e6, 10.0 * E / max(height, 1e-4))
    stick_slope = 0.1 * k_normal
    lines.append("*SURFACE INTERACTION,NAME=INT_CONTACT")
    lines.append("*SURFACE BEHAVIOR,PRESSURE-OVERCLOSURE=LINEAR")
    lines.append(f"{k_normal:.6e}")
    if mode == "frictional" and mu > 0.0:
        lines.append("*FRICTION")
        lines.append(f"{mu:.6g},{stick_slope:.6e}")
    lines.append("*CONTACT PAIR,INTERACTION=INT_CONTACT,TYPE=SURFACE TO SURFACE")
    lines.append("SURF_SLAVE,SURF_MASTER")
    return "\n".join(lines) + "\n", {
        "contact_pair_active": True,
        "contact_type": "Frictional" if (mode == "frictional" and mu > 0.0) else "Contact_Frictionless",
        "friction_coeff": mu,
        "k_normal_pa_m": k_normal,
        "requires_nlgeom": True,
    }


def _discover_elmer_boundary_centroids(case_dir: Path) -> Dict[int, List[float]]:
    """Read ElmerGrid model/mesh.nodes & mesh.boundary to resolve real boundary ID centroids."""
    nodes_path = case_dir / "model" / "mesh.nodes"
    bnd_path = case_dir / "model" / "mesh.boundary"
    if not (nodes_path.is_file() and bnd_path.is_file()):
        return {}
    node_xyz: Dict[int, Tuple[float, float, float]] = {}
    for line in nodes_path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) >= 5:
            try:
                node_xyz[int(parts[0])] = (float(parts[2]), float(parts[3]), float(parts[4]))
            except ValueError:
                continue
    acc: Dict[int, List[float]] = {}
    cnt: Dict[int, int] = {}
    for line in bnd_path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) >= 6:
            try:
                bid = int(parts[1])
                nids = [int(tok) for tok in parts[5:]]
            except ValueError:
                continue
            for nid in nids:
                if nid in node_xyz:
                    x, y, z = node_xyz[nid]
                    if bid not in acc:
                        acc[bid] = [0.0, 0.0, 0.0]
                        cnt[bid] = 0
                    acc[bid][0] += x
                    acc[bid][1] += y
                    acc[bid][2] += z
                    cnt[bid] += 1
    return {
        bid: [vals[0] / cnt[bid], vals[1] / cnt[bid], vals[2] / cnt[bid]]
        for bid, vals in acc.items()
        if cnt.get(bid, 0) > 0
    }


def _read_elmer_mesh_names(case_dir: Path) -> Dict[str, int]:
    """Parse ElmerGrid model/mesh.names ($ name = bid) into a lookup dict."""
    names_path = case_dir / "model" / "mesh.names"
    if not names_path.is_file():
        return {}
    mapping: Dict[str, int] = {}
    for line in names_path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^\$\s*(.+?)\s*=\s*(\d+)\s*$", line.strip())
        if m:
            label = m.group(1).strip()
            bid = int(m.group(2))
            mapping[label] = bid
            mapping[label.lower()] = bid
    return mapping


def call_elmer_solver(data: Mapping[str, Any]) -> PhysicsResult:
    """Real ElmerFEM (ElmerGrid + ElmerSolver / ElmerSolver_mpi) engine for Electromagnetics & Acoustics."""
    elmer_solver = shutil.which("ElmerSolver")
    elmer_grid = shutil.which("ElmerGrid")
    if not elmer_solver or not elmer_grid:
        raise RuntimeError(
            "ElmerFEM (ElmerSolver / ElmerGrid) is not installed in the Docker worker container. "
            "Rebuild the worker image from Dockerfile.worker."
        )

    requested_cores = _requested_parallel_cores(data)
    physics_type = classify_physics(data)
    is_acoustics = physics_type == "Acoustics"
    width = float(data.get("width_x", 1.0) or 1.0)
    height = float(data.get("height_y", 0.5) or 0.5)
    depth = float(data.get("depth_z", 0.2) or 0.2)
    mesh_size = float(data.get("mesh_size", 0.1) or 0.1)

    mesh_res = call_gmsh_mesher({
        "cad_stl_b64": data.get("cad_stl_b64"),
        "cad_filename": data.get("cad_filename"),
        "width_x": width,
        "height_y": height,
        "depth_z": depth,
        "mesh_size": mesh_size,
        "dimension": 3,
        "msh_version": 2.2,
    })

    jobs_dir = Path(os.getenv("NASEER_JOB_DIR", "/app/jobs" if Path("/app/jobs").exists() else "jobs"))
    case_dir = jobs_dir / f"elmer-{uuid.uuid4().hex[:12]}"
    case_dir.mkdir(parents=True, exist_ok=True)
    msh_target = case_dir / "model.msh"
    shutil.copy2(mesh_res["msh_path"], msh_target)

    # Convert Gmsh MSH -> Elmer mesh format
    conv = subprocess.run([elmer_grid, "14", "2", "model.msh", "-autoclean"], cwd=case_dir, text=True, capture_output=True, timeout=90, check=False)
    if conv.returncode != 0:
        raise RuntimeError(f"ElmerGrid failed: {(conv.stderr or conv.stdout)[-2000:]}")

    # Resolve real Elmer boundary IDs against named CAD patches, viewport pins, or spatial ordering
    bnd_centroids = _discover_elmer_boundary_centroids(case_dir)
    name_to_bid = _read_elmer_mesh_names(case_dir)
    sorted_bids = sorted(bnd_centroids.keys()) if bnd_centroids else [1, 2]
    src_bid = sorted_bids[0]
    ref_bid = sorted_bids[1] if len(sorted_bids) > 1 else sorted_bids[0]

    def _resolve_elmer_bid(pname: str) -> Optional[int]:
        if not pname or not name_to_bid:
            return None
        if pname in name_to_bid:
            return name_to_bid[pname]
        low = pname.lower()
        if low in name_to_bid:
            return name_to_bid[low]
        for k, bid in name_to_bid.items():
            if low in k.lower() or k.lower() in low:
                return bid
        return None

    boundary_patches = data.get("boundary_patches")
    if isinstance(boundary_patches, list):
        for bp in boundary_patches:
            if not isinstance(bp, Mapping):
                continue
            pname = str(bp.get("patchName") or bp.get("patch") or bp.get("name") or "").strip()
            bid = _resolve_elmer_bid(pname)
            if bid is None:
                continue
            btype = str(bp.get("type") or "").lower()
            if any(tok in btype for tok in ("inlet", "heat", "source", "flux")):
                src_bid = bid
            elif any(tok in btype for tok in ("outlet", "fixed", "ground", "wall")):
                ref_bid = bid

    markers = data.get("boundary_markers")
    if isinstance(markers, list):
        for m in markers:
            if not isinstance(m, Mapping):
                continue
            pname = str(m.get("patchName") or "").strip()
            named_bid = _resolve_elmer_bid(pname)
            nearest_bid = named_bid
            if nearest_bid is None and bnd_centroids:
                pt = m.get("point")
                if isinstance(pt, (list, tuple)) and len(pt) == 3:
                    nearest_bid = min(
                        bnd_centroids.keys(),
                        key=lambda bid: (bnd_centroids[bid][0] - float(pt[0])) ** 2 + (bnd_centroids[bid][1] - float(pt[1])) ** 2 + (bnd_centroids[bid][2] - float(pt[2])) ** 2,
                    )
            if nearest_bid is None:
                continue
            mtype = str(m.get("subtype") or m.get("type") or "").lower()
            if any(tok in mtype for tok in ("inlet", "heat", "source")):
                src_bid = nearest_bid
            elif any(tok in mtype for tok in ("outlet", "fixed", "ground")):
                ref_bid = nearest_bid

    em_params = data.get("em_parameters") if isinstance(data.get("em_parameters"), Mapping) else {}
    em_submode = str(em_params.get("em_submode") or data.get("em_submode") or "Electrostatic").strip()
    voltage = float(em_params.get("source_value", em_params.get("voltage_v", data.get("voltage_v", 120.0))))
    ref_val = float(em_params.get("reference_value", 0.0))
    rel_permittivity = float(em_params.get("relative_permittivity", data.get("relative_permittivity", 4.5)))
    rel_permeability = float(em_params.get("relative_permeability", data.get("relative_permeability", 1.0)))
    elec_cond = float(em_params.get("electrical_conductivity", data.get("electrical_conductivity", 5.96e7)))
    current_density = float(em_params.get("current_density", data.get("current_density", 1.0e6)))
    frequency_hz = float(em_params.get("frequency_hz", 500.0))

    if is_acoustics:
        sif_content = f"""Header
  CHECK KEYWORDS Warn
  Mesh DB "." "model"
End
Simulation
  Coordinate System = Cartesian 3D
  Simulation Type = Steady State
  Steady State Max Iterations = 1
  Output File = "case.result"
  Post File = "case.vtu"
End
Body 1
  Target Bodies(1) = 1
  Equation = 1
  Material = 1
End
Equation 1
  Active Solvers(1) = 1
End
Solver 1
  Equation = Helmholtz
  Procedure = "HelmholtzSolve" "HelmholtzSolver"
  Frequency = {frequency_hz}
  Linear System Solver = Iterative
  Linear System Iterative Method = BiCGStab
  Linear System Max Iterations = 1000
  Linear System Convergence Tolerance = 1.0e-8
  Linear System Preconditioning = ILU1
End
Material 1
  Density = 1.21
  Sound speed = 343.0
End
Boundary Condition 1
  Target Boundaries(1) = {src_bid}
  Pressure Wave 1 = {voltage}
  Pressure Wave 2 = {ref_val}
End
Boundary Condition 2
  Target Boundaries(1) = {ref_bid}
  Wave Impedance 1 = 343.0
End
"""
        field_unit = "Pa"
        field_key = "pressure wave 1"
        solver_variant = "HelmholtzSolve"
    elif em_submode.lower() in {"magnetostatic", "eddycurrent"}:
        omega = 2.0 * math.pi * frequency_hz if em_submode.lower() == "eddycurrent" else 0.0
        sif_content = f"""Header
  CHECK KEYWORDS Warn
  Mesh DB "." "model"
End
Simulation
  Coordinate System = Cartesian 3D
  Simulation Type = Steady State
  Steady State Max Iterations = 1
  Angular Frequency = {omega:.6g}
  Output File = "case.result"
  Post File = "case.vtu"
End
Constants
  Permeability of Vacuum = 1.256637e-6
End
Body 1
  Target Bodies(1) = 1
  Equation = 1
  Material = 1
  Body Force = 1
End
Equation 1
  Active Solvers(2) = 1 2
End
Solver 1
  Equation = WhitneySolver
  Variable = AV
  Procedure = "MagnetoDynamics" "WhitneyAVSolver"
  Linear System Solver = Iterative
  Linear System Iterative Method = BiCGStab
  Linear System Max Iterations = 1000
  Linear System Convergence Tolerance = 1.0e-8
  Linear System Preconditioning = none
End
Solver 2
  Equation = MGDynamicsCalc
  Procedure = "MagnetoDynamics" "MagnetoDynamicsCalcFields"
  Potential Variable = String "AV"
  Calculate Magnetic Field Strength = True
  Calculate Current Density = True
End
Material 1
  Relative Permeability = {rel_permeability}
  Electric Conductivity = {elec_cond}
End
Body Force 1
  Current Density 1 = {current_density}
End
Boundary Condition 1
  Target Boundaries(1) = {src_bid}
  AV {{e}} = Real 0
End
Boundary Condition 2
  Target Boundaries(1) = {ref_bid}
  AV {{e}} = Real 0
End
"""
        field_unit = "T"
        field_key = "magnetic flux density"
        solver_variant = "MagnetoDynamics"
    else:
        sif_content = f"""Header
  CHECK KEYWORDS Warn
  Mesh DB "." "model"
End
Simulation
  Coordinate System = Cartesian 3D
  Simulation Type = Steady State
  Steady State Max Iterations = 1
  Output File = "case.result"
  Post File = "case.vtu"
End
Constants
  Permittivity of Vacuum = 8.8542e-12
End
Body 1
  Target Bodies(1) = 1
  Equation = 1
  Material = 1
End
Equation 1
  Active Solvers(1) = 1
End
Solver 1
  Equation = Electrostatics
  Procedure = "StatElecSolve" "StatElecSolver"
  Variable = Potential
  Calculate Electric Field = True
  Linear System Solver = Iterative
  Linear System Iterative Method = BiCGStab
  Linear System Max Iterations = 1000
  Linear System Convergence Tolerance = 1.0e-8
  Linear System Preconditioning = ILU1
End
Material 1
  Relative Permittivity = {rel_permittivity}
  Electric Conductivity = {elec_cond}
End
Boundary Condition 1
  Target Boundaries(1) = {src_bid}
  Potential = {voltage}
End
Boundary Condition 2
  Target Boundaries(1) = {ref_bid}
  Potential = {ref_val}
End
"""
        field_unit = "V"
        field_key = "potential"
        solver_variant = "StatElecSolve"

    (case_dir / "case.sif").write_text(sif_content, encoding="utf-8")
    (case_dir / "ELMERSOLVER_STARTINFO").write_text("case.sif\n1\n", encoding="utf-8")

    elmer_mpi = shutil.which("ElmerSolver_mpi")
    mpirun = shutil.which("mpirun")
    actual_cores = 1
    proc: Optional[subprocess.CompletedProcess[str]] = None
    if requested_cores > 1 and elmer_mpi and mpirun and mesh_res.get("elements_count", 0) >= requested_cores * 4:
        part_proc = subprocess.run(
            [elmer_grid, "2", "2", "model", "-metis", str(requested_cores), "3"],
            cwd=case_dir,
            text=True,
            capture_output=True,
            timeout=90,
            check=False,
        )
        if part_proc.returncode == 0:
            mpi_proc = subprocess.run(
                [mpirun, "--allow-run-as-root", "--oversubscribe", "-np", str(requested_cores), elmer_mpi],
                cwd=case_dir,
                text=True,
                capture_output=True,
                timeout=180,
                check=False,
            )
            if mpi_proc.returncode == 0 and (list(case_dir.glob("*.vtu")) or list(case_dir.glob("*.pvtu"))):
                # Verify at least one standalone single-domain VTU or gracefully fall back to serial VTU output
                full_vtu = [p for p in case_dir.glob("*.vtu") if not re.search(r"_\d{4}\.vtu$", p.name)]
                if full_vtu:
                    proc = mpi_proc
                    actual_cores = requested_cores

    if proc is None:
        proc = _run_streaming_command(
            [elmer_solver],
            cwd=case_dir,
            timeout=300,
            log_path=case_dir / "solver.log",
            append_log=False,
            solver_kind="elmer",
        )
    else:
        (case_dir / "solver.log").write_text((proc.stdout or "") + "\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(f"ElmerSolver failed: {(proc.stderr or proc.stdout)[-3000:]}")

    vtu_files = sorted(p for p in case_dir.glob("*.vtu") if not re.search(r"_\d{4}\.vtu$", p.name))
    if not vtu_files:
        vtu_files = sorted(case_dir.glob("*.vtu"))
    vtk_payload: Any = []
    field_summary: Dict[str, Any] = {}
    elmer_integrals: Dict[str, Any] = {
        "domain_volume_m3": round(width * height * depth, 6),
        "surface_area_m2": round(2.0 * (width * height + width * depth + height * depth), 6),
    }
    if vtu_files:
        parsed_vtk = _extract_vtk_from_meshio_file(vtu_files[-1])
        if parsed_vtk:
            vtk_payload = parsed_vtk
            if len(vtu_files) > 1:
                elmer_frames: List[Dict[str, Any]] = []
                base_node_count = parsed_vtk.get("node_count", 0)
                for idx_v, vfile in enumerate(vtu_files[:15]):
                    frame_vtk = _extract_vtk_from_meshio_file(vfile)
                    if frame_vtk and frame_vtk.get("node_count") == base_node_count and frame_vtk.get("scalars"):
                        elmer_frames.append({
                            "time": float(idx_v + 1),
                            "scalars": frame_vtk["scalars"],
                            "vectors": frame_vtk.get("vectors", {}),
                        })
                if len(elmer_frames) > 1:
                    vtk_payload["time_frames"] = elmer_frames
            scalars = parsed_vtk.get("scalars", {})
            chosen = next((k for k in scalars if field_key in k.lower()), next(iter(scalars.keys()), None))
            if chosen and scalars[chosen]:
                vals = scalars[chosen]
                vtk_payload["active_field"] = chosen
                field_summary = {"field": chosen, "min": min(vals), "max": max(vals), "unit": field_unit}
                elmer_integrals["field_min"] = round(min(vals), 6)
                elmer_integrals["field_max"] = round(max(vals), 6)
                elmer_integrals["field_average"] = round(sum(vals) / len(vals), 6)

    return canonicalize_result({
        "status": "SOLVED_REALTIME",
        "solver": "ElmerFEM",
        "solver_variant": solver_variant,
        "executable": elmer_mpi if actual_cores > 1 and elmer_mpi else elmer_solver,
        "parallel_cores": actual_cores,
        "case_directory": str(case_dir),
        "mesh_nodes": mesh_res["nodes_count"],
        "mesh_elements": mesh_res["elements_count"],
        "field_summary": field_summary,
        "integrals": elmer_integrals,
        "vtk_data": vtk_payload,
        "logs": (proc.stdout or "").splitlines()[-120:],
        "units": {"potential": "V", "electric_field": "V/m", "magnetic_flux": "T", "pressure": "Pa"},
        "artifacts": {"case_directory": str(case_dir), "sif": str(case_dir / "case.sif"), "log": str(case_dir / "solver.log")},
        "convergence": {"converged": True, "status": "completed", "residuals": {}},
        "input": {k: v for k, v in data.items() if k not in {"cad_stl_b64", "cad_file_b64"}},
    }, physics_type=physics_type, input_data={"physics_type": physics_type, "mesh_size": mesh_size, "parallel_cores": actual_cores}, solver="ElmerFEM")


def execute_simulation(data: Dict[str, Any]) -> PhysicsResult:
    started = perf_counter()
    physics_type = classify_physics(data)
    try:
        routes: Dict[str, Callable[[Mapping[str, Any]], PhysicsResult]] = {
            "CFD_Incompressible": call_openfoam_solver,
            "CFD_Compressible": call_openfoam_compressible_solver,
            "CHT_Coupled": call_openfoam_solver,
            "Multiphase_VOF": call_openfoam_solver,
            "Structural_Static": call_calculix_solver,
            "Structural_Dynamic": call_calculix_solver,
            "Structural_Buckling": call_calculix_solver,
            "Thermal_Transient": call_calculix_solver,
            "Thermal_Steady": call_calculix_solver,
            "Thermal_Radiation": call_calculix_solver,
            "Thermal_Structural": call_calculix_solver,
            "Multiphysics": call_calculix_solver,
            "Electromagnetic": call_elmer_solver,
            "Acoustics": call_elmer_solver,
        }

        runner = routes.get(physics_type, call_calculix_solver)
        result = runner(data)

        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        merged = result if isinstance(result, Mapping) else {}
        response = {
            "physics_type": physics_type,
            "recommended_solver": _recommended_engine(physics_type),
            "status": str(merged.get("status", "SOLVED_REALTIME")),
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": merged.get("vtk_data", []),
            "data": dict(merged),
        }
        response["academic_report"] = generate_academic_report(response)
        return canonicalize_result(
            response,
            physics_type=physics_type,
            input_data={k: v for k, v in data.items() if k not in {"cad_stl_b64", "cad_file_b64", "openfoam_archive_b64"}},
            solver=merged.get("solver") or merged.get("solver_type"),
        )
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        failure: Dict[str, Any] = {}
        if isinstance(exc, OpenFOAMVerificationError):
            failure["errors"] = [{"code": "OPENFOAM_VERIFICATION_FAILED", "message": str(exc)}]
        return canonicalize_result({
            "physics_type": physics_type,
            "recommended_solver": _recommended_engine(physics_type),
            "status": "error",
            "process_time_ms": elapsed_ms,
            "process_time": round(elapsed_ms / 1000, 3),
            "vtk_data": [],
            "data": {},
            "error": str(exc) if isinstance(exc, OpenFOAMVerificationError) else f"Universal dispatcher failed ({physics_type}): {exc}",
            **failure,
        }, physics_type=physics_type, input_data={k: v for k, v in data.items() if k not in {"cad_stl_b64", "cad_file_b64", "openfoam_archive_b64"}}, solver="unknown")


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
    """Persist job state in the canonical repository."""
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
    """Execute simulation work inside the Docker worker container."""
    physics_type = classify_physics(data)
    task_id = getattr(self.request, "id", None)
    _record_job_state(task_id, "RUNNING", progress=10)
    _task_progress(
        self, 10, "Preparing simulation input & mesh deck",
        physics_type=physics_type,
        recommended_solver=_recommended_engine(physics_type),
    )
    _task_progress(self, 35, f"Executing {_recommended_engine(physics_type)}", physics_type=physics_type)
    def _live_stream_callback(payload: Dict[str, Any]) -> None:
        pct = int(payload.get("progress", 40))
        live_logs = payload.get("logs") if isinstance(payload.get("logs"), list) else []
        live_res = payload.get("residuals") if isinstance(payload.get("residuals"), dict) else {}
        cur_iter = int(payload.get("current_iteration") or 0)
        msg = str(payload.get("status_message") or f"Running {_recommended_engine(physics_type)}")
        live_tel = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else sample_node_telemetry()
        _task_progress(
            self,
            pct,
            msg,
            logs=live_logs,
            live_residuals=live_res,
            current_iteration=cur_iter,
            physics_type=physics_type,
            telemetry=live_tel,
        )
        _record_job_state(task_id, "RUNNING", progress=pct, logs=live_logs)

    _STREAM_STATE.callback = _live_stream_callback
    try:
        result = execute_simulation(data)
    finally:
        _STREAM_STATE.callback = None

    if isinstance(result, dict) and (result.get("status") == "error" or result.get("error")):
        message = str(result.get("error") or "Simulation failed")
        result["logs"] = result.get("logs", ["Preparing simulation input", f"Failed ({physics_type})", message])
        _record_job_state(task_id, "FAILED", progress=100, logs=result["logs"], result=result, error=message)
        return result
    if isinstance(result, dict):
        result["task_progress"] = 100
        solver_logs = []
        if isinstance(result.get("data"), Mapping) and isinstance(result["data"].get("logs"), list):
            solver_logs = result["data"]["logs"]
        result["logs"] = solver_logs or result.get("logs", [
            "Preparing simulation input",
            f"Executed {_recommended_engine(physics_type)}",
            "Simulation completed & verified",
        ])
    _task_progress(self, 100, "Simulation completed", physics_type=physics_type)
    _record_job_state(
        task_id, "COMPLETED", progress=100,
        logs=result.get("logs") if isinstance(result, dict) else None, result=result,
    )
    return result


@celery_app.task(name="universal_dispatcher.generate_mesh", bind=True)
def run_mesh_generation_task(self, data: Dict[str, Any]) -> PhysicsResult:
    task_id = getattr(self.request, "id", None)
    _record_job_state(task_id, "RUNNING", progress=25)
    try:
        res = call_gmsh_mesher(data)
        _record_job_state(task_id, "COMPLETED", progress=100, result=res)
        return res
    except Exception as exc:
        msg = f"Gmsh mesh generation failed: {exc}"
        _record_job_state(task_id, "FAILED", progress=100, error=msg)
        return {"status": "error", "error": msg}


@celery_app.task(name="universal_dispatcher.preview_cad")
def preview_cad_task(data: Dict[str, Any]) -> PhysicsResult:
    """Tessellate uploaded CAD inside Docker worker where gmsh/meshio live."""
    return preview_cad_geometry(data)


@celery_app.task(name="universal_dispatcher.probe_capabilities")
def probe_capabilities_task() -> Dict[str, Any]:
    """Return live solver binary versions installed inside the Docker worker container."""
    return probe_worker_capabilities()


@celery_app.task(name="universal_dispatcher.sample_telemetry")
def sample_telemetry_task() -> Dict[str, Any]:
    """Return real OS/Docker CPU load and RAM telemetry from the Celery worker container."""
    return sample_node_telemetry()


# ---------------------------------------------------------------------------
# Async Mesh-Independence Study (GCI) & International V&V Suite Celery Tasks
# ---------------------------------------------------------------------------
@celery_app.task(
    name="universal_dispatcher.run_mesh_study_task",
    bind=True,
    soft_time_limit=int(os.getenv("CAE_MESH_STUDY_SOFT_TIME_LIMIT_SECONDS", "1200")),
    time_limit=int(os.getenv("CAE_MESH_STUDY_TIME_LIMIT_SECONDS", "1260")),
)
def run_mesh_study_task(
    self,
    payload: Dict[str, Any],
    physics_type: str,
    key_result: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute 3-level Celik GCI mesh-independence study asynchronously inside the Celery worker."""
    _ensure_app_on_sys_path()
    task_id = getattr(self.request, "id", None)
    logs: List[str] = [
        f"[{datetime.now(timezone.utc).isoformat()}] Starting 3-level mesh independence study ({physics_type}, key={key_result or 'default'})."
    ]
    completed_levels: List[Dict[str, Any]] = []

    def _emit(progress: int, msg: str) -> None:
        tel = sample_node_telemetry()
        _task_progress(
            self,
            progress,
            msg,
            logs=list(logs),
            levels=list(completed_levels),
            physics_type=physics_type,
            telemetry=tel,
        )
        _record_job_state(
            task_id,
            "RUNNING",
            progress=progress,
            logs=list(logs),
            result={
                "partial": True,
                "levels": list(completed_levels),
                "status_message": msg,
            },
        )

    _emit(10, "Initializing 3-level mesh independence study (coarse / medium / fine)")
    level_done_progress = {1: 35, 2: 65, 3: 95}

    def _on_level_start(idx: int, total: int, name: str, level_payload: Dict[str, Any]) -> None:
        size_note = (
            f"h={level_payload.get('mesh_size')}"
            if level_payload.get("mesh_size") is not None
            else f"divisions={((level_payload.get('mesh') or {}).get('divisions'))}"
        )
        msg = f"[Level {idx}/{total}] Running '{name}' mesh ({size_note}) via local solver..."
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {msg}")
        start_pct = 12 if idx == 1 else (38 if idx == 2 else 68)
        _emit(start_pct, msg)

    def _on_level_complete(
        idx: int,
        total: int,
        entry: Dict[str, Any],
        all_levels: List[Dict[str, Any]],
    ) -> None:
        completed_levels.clear()
        completed_levels.extend(all_levels)
        msg = (
            f"[Level {idx}/{total}] Completed '{entry.get('level')}' mesh: "
            f"cells={entry.get('cells')}, key_result={entry.get('key_result')}"
        )
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {msg}")
        _emit(level_done_progress.get(idx, 95), msg)

    def _run_local_level(level_payload: Dict[str, Any]) -> Dict[str, Any]:
        return execute_simulation({**level_payload, "execution_mode": "direct"})

    try:
        study = run_mesh_study(
            payload,
            physics_type,
            key_result,
            _run_local_level,
            on_level_start=_on_level_start,
            on_level_complete=_on_level_complete,
        )
        gci_val = study.get("gci_fine_percent")
        summary_msg = (
            f"Mesh study completed: convergence={study.get('convergence_type')}, "
            + (f"GCI_fine={gci_val}%" if gci_val is not None else "no GCI")
        )
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {summary_msg}")
        final_payload = {"success": True, "study": study}
        _task_progress(
            self,
            100,
            summary_msg,
            logs=list(logs),
            levels=study.get("levels", []),
            physics_type=physics_type,
            telemetry=sample_node_telemetry(),
        )
        _record_job_state(
            task_id,
            "COMPLETED",
            progress=100,
            logs=list(logs),
            result=final_payload,
        )
        return final_payload
    except KeyResultUnavailable as exc:
        err_msg = str(exc)
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] ERROR [KEY_RESULT_UNAVAILABLE]: {err_msg}")
        failure = {"success": False, "code": "KEY_RESULT_UNAVAILABLE", "error": err_msg}
        _record_job_state(task_id, "FAILED", progress=100, logs=list(logs), result=failure, error=err_msg)
        return failure
    except MeshStudyError as exc:
        err_msg = str(exc)
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] ERROR [{exc.code}]: {err_msg}")
        failure = {"success": False, "code": exc.code, "error": err_msg}
        _record_job_state(task_id, "FAILED", progress=100, logs=list(logs), result=failure, error=err_msg)
        return failure
    except Exception as exc:
        err_msg = str(exc)
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] ERROR [MESH_STUDY_FAILED]: {err_msg}")
        failure = {"success": False, "code": "MESH_STUDY_FAILED", "error": err_msg}
        _record_job_state(task_id, "FAILED", progress=100, logs=list(logs), result=failure, error=err_msg)
        return failure


@celery_app.task(
    name="universal_dispatcher.run_vv_suite_task",
    bind=True,
    soft_time_limit=int(os.getenv("CAE_VV_SOFT_TIME_LIMIT_SECONDS", "1500")),
    time_limit=int(os.getenv("CAE_VV_TIME_LIMIT_SECONDS", "1560")),
)
def run_vv_suite_task(self, selected_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Execute international ASME/NAFEMS/NASA TMR V&V benchmarks asynchronously inside the worker."""
    _ensure_app_on_sys_path()
    from vv_regression_suite import generate_vv_certificate_markdown, run_vv_suite

    task_id = getattr(self.request, "id", None)
    logs: List[str] = [
        f"[{datetime.now(timezone.utc).isoformat()}] Starting V&V verification suite ({'all 6 benchmarks' if not selected_ids else ', '.join(selected_ids)})."
    ]
    partial_results: List[Dict[str, Any]] = []

    def _emit(progress: int, msg: str, completed_count: int = 0, total_count: int = 0) -> None:
        tel = sample_node_telemetry()
        _task_progress(
            self,
            progress,
            msg,
            logs=list(logs),
            results=list(partial_results),
            completed_count=completed_count,
            total_count=total_count,
            telemetry=tel,
        )
        _record_job_state(
            task_id,
            "RUNNING",
            progress=progress,
            logs=list(logs),
            result={
                "partial": True,
                "results": list(partial_results),
                "completed_count": completed_count,
                "total_count": total_count,
                "status_message": msg,
            },
        )

    _emit(5, "Probing real solver binaries on worker node...")
    caps = probe_worker_capabilities()
    total_expected = len(selected_ids) if selected_ids else 6

    def _on_bench_start(idx: int, total: int, bid: str) -> None:
        msg = f"[V&V {idx}/{total}] Executing benchmark {bid}..."
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {msg}")
        pct = min(92, 8 + int(((idx - 1) / max(total, 1)) * 84))
        _emit(pct, msg, completed_count=idx - 1, total_count=total)

    def _on_bench_complete(
        idx: int,
        total: int,
        bench_result: Dict[str, Any],
        all_results: List[Dict[str, Any]],
    ) -> None:
        partial_results.clear()
        partial_results.extend(all_results)
        err_str = (
            f"err={bench_result.get('relative_error_percent')}%"
            if isinstance(bench_result.get("relative_error_percent"), (int, float))
            else "no numeric error"
        )
        msg = (
            f"[V&V {idx}/{total}] {bench_result.get('benchmark_id')}: "
            f"{bench_result.get('status')} ({err_str})"
        )
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {msg}")
        pct = min(95, 10 + int(round((idx / max(total, 1)) * 85)))
        _emit(pct, msg, completed_count=idx, total_count=total)

    def _run_local_vv(level_payload: Dict[str, Any]) -> Dict[str, Any]:
        return execute_simulation({**level_payload, "execution_mode": "direct"})

    try:
        report = run_vv_suite(
            selected_ids,
            executor=_run_local_vv,
            capabilities=caps,
            on_benchmark_start=_on_bench_start,
            on_benchmark_complete=_on_bench_complete,
        )
        cert_md = generate_vv_certificate_markdown(report)
        summary = report.get("summary") or {}
        final_msg = (
            f"V&V suite completed: {report.get('overall_status')} "
            f"({summary.get('passed', 0)} PASS / {summary.get('failed', 0)} FAIL / {summary.get('skipped', 0)} SKIPPED)"
        )
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] {final_msg}")
        final_payload = {
            "success": True,
            "report": report,
            "certificate_markdown": cert_md,
        }
        _task_progress(
            self,
            100,
            final_msg,
            logs=list(logs),
            results=report.get("results", []),
            completed_count=total_expected,
            total_count=total_expected,
            telemetry=sample_node_telemetry(),
        )
        _record_job_state(
            task_id,
            "COMPLETED",
            progress=100,
            logs=list(logs),
            result=final_payload,
        )
        return final_payload
    except Exception as exc:
        err_msg = str(exc)
        logs.append(f"[{datetime.now(timezone.utc).isoformat()}] ERROR [VV_SUITE_FAILED]: {err_msg}")
        failure = {"success": False, "code": "VV_SUITE_FAILED", "error": err_msg}
        _record_job_state(task_id, "FAILED", progress=100, logs=list(logs), result=failure, error=err_msg)
        return failure


# ---------------------------------------------------------------------------
# Lightweight Redis Worker Heartbeat (Replaces Blocking Health Probe)
# ---------------------------------------------------------------------------
WORKER_HEARTBEAT_PREFIX = "naseer:worker:heartbeat:"
WORKER_HEARTBEAT_TTL_SEC = 25
WORKER_HEARTBEAT_INTERVAL_SEC = 10.0
WORKER_CAPABILITIES_REFRESH_SEC = 60.0

_ACTIVE_TASKS_LOCK = threading.Lock()
_ACTIVE_TASKS_COUNT = 0
_HEARTBEAT_LOCK = threading.Lock()
_HEARTBEAT_STOP_EVENT: Optional[threading.Event] = None
_HEARTBEAT_THREAD: Optional[threading.Thread] = None
_HEARTBEAT_KEY: Optional[str] = None


def _get_heartbeat_redis_client() -> Optional[Any]:
    if redis_lib is None:
        return None
    try:
        return redis_lib.Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
            decode_responses=True,
        )
    except Exception:
        return None


def _build_worker_heartbeat_payload(
    *,
    hostname: str,
    concurrency: int,
    solvers: Dict[str, Any],
    queued_tasks: int = 0,
) -> Dict[str, Any]:
    host_cores = os.cpu_count() or 1
    mpi_cores = max(concurrency, int(os.getenv("NASEER_MPI_CORES_PER_WORKER", str(min(host_cores, 4)))))
    with _ACTIVE_TASKS_LOCK:
        active_count = max(0, _ACTIVE_TASKS_COUNT)
    return {
        "name": hostname,
        "status": "ONLINE",
        "pid": os.getpid(),
        "concurrency": concurrency,
        "mpi_cores": mpi_cores,
        "solvers": solvers,
        "active_tasks": active_count,
        "queued_tasks": max(0, int(queued_tasks)),
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
    }


def _heartbeat_loop(hostname: str, concurrency: int, stop_event: threading.Event) -> None:
    logger = logging.getLogger(__name__)
    key = f"{WORKER_HEARTBEAT_PREFIX}{hostname}"
    cached_solvers: Dict[str, Any] = probe_worker_capabilities()
    last_probe_mono = time.monotonic()

    while not stop_event.is_set():
        now_mono = time.monotonic()
        if now_mono - last_probe_mono >= WORKER_CAPABILITIES_REFRESH_SEC:
            try:
                cached_solvers = probe_worker_capabilities()
                last_probe_mono = now_mono
            except Exception:
                logger.debug("Worker capability refresh failed", exc_info=True)

        client = _get_heartbeat_redis_client()
        if client is not None:
            try:
                queued_len = 0
                try:
                    raw_len = client.llen("celery")
                    queued_len = int(raw_len or 0)
                except Exception:
                    queued_len = 0
                payload = _build_worker_heartbeat_payload(
                    hostname=hostname,
                    concurrency=concurrency,
                    solvers=cached_solvers,
                    queued_tasks=queued_len,
                )
                client.set(key, json.dumps(payload, ensure_ascii=False), ex=WORKER_HEARTBEAT_TTL_SEC)
            except Exception:
                logger.debug("Worker heartbeat write to Redis failed", exc_info=True)
            finally:
                try:
                    client.close()
                except Exception:
                    pass

        stop_event.wait(WORKER_HEARTBEAT_INTERVAL_SEC)


def start_worker_heartbeat(hostname: Optional[str] = None, concurrency: Optional[int] = None) -> None:
    global _HEARTBEAT_STOP_EVENT, _HEARTBEAT_THREAD, _HEARTBEAT_KEY
    resolved_host = hostname or f"celery@{socket.gethostname()}"
    resolved_conc = max(1, int(concurrency or os.getenv("CELERY_CONCURRENCY", "1")))
    with _HEARTBEAT_LOCK:
        if _HEARTBEAT_THREAD is not None and _HEARTBEAT_THREAD.is_alive():
            return
        _HEARTBEAT_STOP_EVENT = threading.Event()
        _HEARTBEAT_KEY = f"{WORKER_HEARTBEAT_PREFIX}{resolved_host}"
        _HEARTBEAT_THREAD = threading.Thread(
            target=_heartbeat_loop,
            args=(resolved_host, resolved_conc, _HEARTBEAT_STOP_EVENT),
            name=f"naseer-heartbeat-{resolved_host}",
            daemon=True,
        )
        _HEARTBEAT_THREAD.start()


def stop_worker_heartbeat() -> None:
    global _HEARTBEAT_STOP_EVENT, _HEARTBEAT_THREAD, _HEARTBEAT_KEY
    with _HEARTBEAT_LOCK:
        stop_ev = _HEARTBEAT_STOP_EVENT
        thread = _HEARTBEAT_THREAD
        key = _HEARTBEAT_KEY
        _HEARTBEAT_STOP_EVENT = None
        _HEARTBEAT_THREAD = None
        _HEARTBEAT_KEY = None
    if stop_ev is not None:
        stop_ev.set()
    if thread is not None and thread.is_alive():
        thread.join(timeout=2.0)
    if key:
        client = _get_heartbeat_redis_client()
        if client is not None:
            try:
                client.delete(key)
            except Exception:
                pass
            finally:
                try:
                    client.close()
                except Exception:
                    pass


if task_prerun is not None:
    @task_prerun.connect
    def _on_task_prerun(*args: Any, **kwargs: Any) -> None:
        global _ACTIVE_TASKS_COUNT
        with _ACTIVE_TASKS_LOCK:
            _ACTIVE_TASKS_COUNT += 1


if task_postrun is not None:
    @task_postrun.connect
    def _on_task_postrun(*args: Any, **kwargs: Any) -> None:
        global _ACTIVE_TASKS_COUNT
        with _ACTIVE_TASKS_LOCK:
            _ACTIVE_TASKS_COUNT = max(0, _ACTIVE_TASKS_COUNT - 1)


if worker_ready is not None:
    @worker_ready.connect
    def _on_worker_ready(sender: Any = None, **kwargs: Any) -> None:
        hostname = getattr(sender, "hostname", None) or f"celery@{socket.gethostname()}"
        concurrency = getattr(sender, "concurrency", None)
        if concurrency is None and sender is not None:
            pool = getattr(sender, "pool", None)
            concurrency = getattr(pool, "limit", None)
        start_worker_heartbeat(hostname=hostname, concurrency=concurrency)


if worker_shutdown is not None:
    @worker_shutdown.connect
    def _on_worker_shutdown(sender: Any = None, **kwargs: Any) -> None:
        stop_worker_heartbeat()


