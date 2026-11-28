"""
Automated Unit & Integration Tests for Directive 07:
1. preCICE v3 XML (`precice-config.xml`), OpenFOAM `preciceDict` + `dynamicMeshDict`,
   CalculiX `config.yml` + `.inp` generation, and preCICE iteration log parsing.
2. Strict Zero-Mock FSI_2Way runtime gate: raises `PreciceRuntimeUnavailableError` (and returns
   structured `PRECICE_RUNTIME_UNAVAILABLE` error via `execute_simulation`) when preCICE /
   `ccx_preCICE` / `libpreciceAdapterFunctionObject.so` are absent — never fabricates FSI data.
3. Real Native OpenFOAM Multi-Region CHT (`CHT_MultiRegion`) execution using
   `chtMultiRegionSimpleFoam` & `splitMeshRegions` when OpenFOAM v2406 binaries are available.
4. Adaptive Courant Time-Stepping (`adjustTimeStep yes;`, `maxCo`, `maxDeltaT`, `pimpleFoam`
   selection over `icoFoam`) and real OpenFOAM Courant / deltaT log parser.
5. Checkpoint / Restart (`latestTime`): `POST /api/jobs/{task_id}/resume` RBAC enforcement,
   strict case directory path confinement, `HTTP 422 NO_CHECKPOINT_AVAILABLE`, child job
   queuing (`HTTP 202`), and `resume_openfoam_case` non-mutating case cloning & `controlDict`
   continuation verification.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import MagicMock, patch

import universal_dispatcher
from backend import precice_coupling
from test_async_heartbeat_sse import (
    _FakeRequest,
    _InMemoryJobRepository,
    _import_main_module,
)


class TestDirective07PreciceConfigAndZeroMockGate(unittest.TestCase):
    """Suite 1 & 2: preCICE v3 configuration schema validation and strict Zero-Mock FSI gate."""

    def test_generate_precice_v3_xml_fsi_and_cht_strict_schema(self) -> None:
        fsi_xml = precice_coupling.generate_precice_config_xml(
            mode="FSI",
            coupling_scheme="parallel-implicit",
            time_window_size=0.005,
            max_time=0.25,
            max_iterations=25,
            rel_tol=1e-3,
            acceleration="IQN-ILS",
            mapping="rbf-pum-direct",
        )
        root = precice_coupling.validate_precice_xml(fsi_xml)
        self.assertEqual(root.tag, "precice-configuration")
        self.assertIn('<data:vector name="Force"', fsi_xml)
        self.assertIn('<data:vector name="Displacement"', fsi_xml)
        self.assertIn("parallel-implicit", fsi_xml)
        self.assertIn("acceleration:IQN-ILS", fsi_xml)
        self.assertIn("rbf-pum-direct", fsi_xml)

        cht_xml = precice_coupling.generate_precice_config_xml(
            mode="CHT",
            coupling_scheme="serial-implicit",
            time_window_size=0.01,
            max_time=1.0,
            max_iterations=40,
            rel_tol=1e-4,
            acceleration="aitken",
            mapping="nearest-neighbor",
        )
        root_cht = precice_coupling.validate_precice_xml(cht_xml)
        self.assertEqual(root_cht.tag, "precice-configuration")
        self.assertIn('<data:scalar name="Temperature"', cht_xml)
        self.assertIn('<data:scalar name="Heat-Flux"', cht_xml)
        self.assertIn("serial-implicit", cht_xml)
        self.assertIn("acceleration:aitken", cht_xml)

    def test_generate_openfoam_and_calculix_precice_decks(self) -> None:
        precice_dict, dyn_mesh_dict = precice_coupling.generate_openfoam_precice_dict(
            mode="FSI",
            patch_name="flapInterface",
            rho_ref=1000.0,
        )
        self.assertIn("modules (FSI);", precice_dict)
        self.assertIn("patches           (flapInterface);", precice_dict)
        self.assertIn("Displacement", precice_dict)
        self.assertIn("Force", precice_dict)
        self.assertIn("dynamicMotionSolverFvMesh", dyn_mesh_dict)
        self.assertIn("displacementLaplacian", dyn_mesh_dict)

        ccx_cfg = precice_coupling.generate_calculix_precice_config(
            mode="FSI",
            mesh_name="Solid-Mesh",
            surface_name="SURFACE_INTERFACE",
        )
        self.assertIn("Solid-Mesh", ccx_cfg)
        self.assertIn("SURFACE_INTERFACE", ccx_cfg)
        self.assertIn("Displacement", ccx_cfg)
        self.assertIn("Force", ccx_cfg)

        ccx_inp = precice_coupling.generate_calculix_precice_inp(
            mode="FSI",
            width=0.2,
            solid_thickness=0.02,
            depth=0.05,
            young_modulus=1.4e6,
            poisson_ratio=0.4,
            density=1000.0,
            time_step=0.005,
            end_time=0.1,
        )
        self.assertIn("*NSET, NSET=NINTERFACE", ccx_inp)
        self.assertIn("*ELASTIC", ccx_inp)
        self.assertIn("*DYNAMIC", ccx_inp)

    def test_parse_precice_iterations_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "precice-Fluid-iterations.log"
            log_path.write_text(
                "TimeWindow  TotalIterations  Iterations  Convergence  Norm\n"
                "1  5  5  1  8.1e-4\n"
                "2  9  4  1  6.2e-4\n"
                "3  12  3  1  4.0e-4\n",
                encoding="utf-8",
            )
            parsed = precice_coupling.parse_precice_iterations_log(log_path)
            self.assertTrue(parsed["available"])
            self.assertEqual(parsed["time_windows"], 3)
            self.assertEqual(parsed["total_iterations"], 12)
            self.assertAlmostEqual(parsed["avg_iterations_per_window"], 4.0, places=3)

    def test_fsi_2way_zero_mock_gate_raises_when_precice_missing(self) -> None:
        fake_caps = {
            "precice_lib": {"available": False, "version": None, "path": None},
            "calculix_precice": {"available": False, "version": None, "path": None},
            "openfoam_precice_adapter": {"available": False, "path": None},
            "openfoam_cht_multiregion": {"available": False, "steady_solver": None, "transient_solver": None, "split_mesh_regions": None},
            "fsi_2way_ready": False,
            "cht_multiregion_ready": False,
        }
        with patch.object(precice_coupling, "probe_coupling_capabilities", return_value=fake_caps):
            with self.assertRaises(precice_coupling.PreciceRuntimeUnavailableError) as ctx:
                precice_coupling.run_precice_coupled_simulation(
                    {
                        "simulation_type": "FSI_2Way",
                        "velocity": 1.0,
                        "young_modulus": 1.4e6,
                        "poisson_ratio": 0.4,
                        "density": 1000.0,
                    }
                )
            msg = str(ctx.exception)
            self.assertIn("ccx_preCICE", msg)
            self.assertIn("libprecice", msg)

            # Also verify universal_dispatcher.execute_simulation classifies FSI_2Way and returns structured error
            self.assertEqual(universal_dispatcher.classify_physics({"simulation_type": "FSI_2Way"}), "FSI_2Way")
            res = universal_dispatcher.execute_simulation({"simulation_type": "FSI_2Way", "velocity": 1.0})
            self.assertEqual(res["status"], "error")
            self.assertTrue(
                any(err.get("code") == "PRECICE_RUNTIME_UNAVAILABLE" for err in (res.get("errors") or [])),
                f"Expected PRECICE_RUNTIME_UNAVAILABLE in errors, got: {res.get('errors')}",
            )

    def test_probe_worker_capabilities_exposes_coupling_keys(self) -> None:
        caps = universal_dispatcher.probe_worker_capabilities()
        for key in (
            "precice_lib",
            "calculix_precice",
            "openfoam_precice_adapter",
            "openfoam_cht_multiregion",
            "fsi_2way_ready",
            "cht_multiregion_ready",
        ):
            self.assertIn(key, caps)


class TestDirective07NativeMultiRegionCht(unittest.TestCase):
    """Suite 3: Real OpenFOAM native Multi-Region CHT execution when installed in worker."""

    def test_classify_cht_multiregion_and_recommended_engine(self) -> None:
        self.assertEqual(
            universal_dispatcher.classify_physics({"simulation_type": "CHT_MultiRegion"}),
            "CHT_MultiRegion",
        )
        self.assertIn("chtMultiRegionSimpleFoam", universal_dispatcher._recommended_engine("CHT_MultiRegion"))

    @unittest.skipUnless(
        bool(shutil.which("chtMultiRegionSimpleFoam") and shutil.which("splitMeshRegions") and shutil.which("blockMesh")),
        "OpenFOAM chtMultiRegionSimpleFoam/splitMeshRegions not installed on bare host",
    )
    def test_real_openfoam_multiregion_cht_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": tmp}):
                result = precice_coupling.run_openfoam_multiregion_cht(
                    {
                        "simulation_type": "CHT_MultiRegion",
                        "width_x": 0.4,
                        "height_y": 0.1,
                        "depth_z": 0.05,
                        "solid_thickness": 0.04,
                        "velocity": 0.5,
                        "temperature": 300.0,
                        "bc_bottom_temp": 360.0,
                        "solid_conductivity_k": 200.0,
                        "solver_iterations": 40,
                        "mesh_size": 0.04,
                    }
                )
                self.assertEqual(result["status"], "SOLVED_REALTIME")
                self.assertEqual(result["solver_variant"], "chtMultiRegionSimpleFoam")
                self.assertIn("fluid", result.get("regions", []))
                self.assertIn("solid", result.get("regions", []))
                case_dir = Path(result["case_directory"])
                self.assertTrue((case_dir / "constant" / "fluid" / "polyMesh").is_dir())
                self.assertTrue((case_dir / "constant" / "solid" / "polyMesh").is_dir())
                self.assertIsNotNone(result.get("interface_temperature_k"))


class TestDirective07AdaptiveCourant(unittest.TestCase):
    """Suite 4: Adaptive Courant time-stepping controlDict generation & log parsing."""

    def test_parse_openfoam_courant_history_real_log_and_zero_mock_empty(self) -> None:
        empty = universal_dispatcher.parse_openfoam_courant_history("SIMPLE solution converged\n")
        self.assertFalse(empty["available"])
        self.assertIsNone(empty["max_co_peak"])

        sample_log = (
            "Time = 0.005\n"
            "Courant Number mean: 0.12 max: 0.45\n"
            "deltaT = 0.0082\n"
            "Time = 0.0132\n"
            "Courant Number mean: 0.24 max: 0.79\n"
            "deltaT = 0.0079\n"
            "Time = 0.0211\n"
            "Courant Number mean: 0.22 max: 0.76\n"
            "deltaT = 0.0081\n"
        )
        parsed = universal_dispatcher.parse_openfoam_courant_history(sample_log)
        self.assertTrue(parsed["available"])
        self.assertEqual(parsed["sample_count"], 3)
        self.assertAlmostEqual(parsed["max_co_peak"], 0.79, places=4)
        self.assertAlmostEqual(parsed["max_co_final"], 0.76, places=4)
        self.assertAlmostEqual(parsed["min_delta_t"], 0.0079, places=6)
        self.assertAlmostEqual(parsed["max_delta_t"], 0.0082, places=6)
        self.assertAlmostEqual(parsed["final_delta_t"], 0.0081, places=6)

    def test_adaptive_time_stepping_generates_pimplefoam_and_maxco_controldict(self) -> None:
        captured_ctrl: Dict[str, str] = {}
        captured_cmd: Dict[str, list] = {}

        def _fake_which(name: str, path=None):
            if name in {"blockMesh", "pimpleFoam", "icoFoam", "simpleFoam"}:
                return f"/usr/bin/{name}"
            return None

        def _fake_run_cmd(cmd, *, cwd, **kwargs):
            captured_cmd["cmd"] = list(cmd)
            ctrl_file = Path(cwd) / "system" / "controlDict"
            if ctrl_file.is_file():
                captured_ctrl["text"] = ctrl_file.read_text(encoding="utf-8")
            raise RuntimeError("STOP_AFTER_CONTROLDICT_CHECK")

        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": tmp}), \
                 patch.object(universal_dispatcher.shutil, "which", side_effect=_fake_which), \
                 patch.object(universal_dispatcher.subprocess, "run", return_value=MagicMock(returncode=0, stdout="", stderr="")), \
                 patch.object(universal_dispatcher, "_run_openfoam_check_mesh", return_value={"verdict": "PASS", "cells": 100, "points": 200}), \
                 patch.object(universal_dispatcher, "_run_streaming_command", side_effect=_fake_run_cmd):
                with self.assertRaises(RuntimeError) as ctx:
                    universal_dispatcher.call_openfoam_solver(
                        {
                            "simulation_type": "CFD_Incompressible",
                            "time_mode": "transient",
                            "adaptive_time_stepping": True,
                            "time_step": 0.002,
                            "end_time": 0.5,
                            "max_co": 0.65,
                            "max_delta_t": 0.02,
                            "velocity": 1.0,
                            "pressure": 0.0,
                            "temperature": 300.0,
                            "width_x": 1.0,
                            "height_y": 0.2,
                            "depth_z": 0.1,
                            "mesh_size": 0.05,
                        }
                    )
                self.assertIn("STOP_AFTER_CONTROLDICT_CHECK", str(ctx.exception))

        ctrl_text = captured_ctrl.get("text", "")
        self.assertIn("application pimpleFoam;", ctrl_text)
        self.assertIn("adjustTimeStep yes;", ctrl_text)
        self.assertIn("maxCo 0.65;", ctrl_text)
        self.assertIn("maxDeltaT 0.02;", ctrl_text)
        self.assertIn("writeControl adjustableRunTime;", ctrl_text)
        self.assertTrue(captured_cmd["cmd"][0].endswith("pimpleFoam"))


class TestDirective07CheckpointRestart(unittest.TestCase):
    """Suite 5: Checkpoint / Restart (`latestTime`) engine & FastAPI route tests."""

    def _create_mock_openfoam_case(self, root: Path, *, with_checkpoint: bool = True) -> Path:
        case_dir = root / "openfoam-parent1234"
        (case_dir / "system").mkdir(parents=True)
        (case_dir / "constant" / "polyMesh").mkdir(parents=True)
        (case_dir / "0").mkdir(parents=True)
        (case_dir / "system" / "controlDict").write_text(
            "FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }\n"
            "application simpleFoam;\n"
            "startFrom startTime;\n"
            "startTime 0;\n"
            "stopAt endTime;\n"
            "endTime 100;\n"
            "deltaT 1;\n"
            "writeControl timeStep;\n"
            "writeInterval 50;\n",
            encoding="utf-8",
        )
        (case_dir / "0" / "U").write_text("internalField uniform (1 0 0);\n", encoding="utf-8")
        if with_checkpoint:
            (case_dir / "50").mkdir()
            (case_dir / "100").mkdir()
            (case_dir / "100" / "U").write_text("internalField uniform (1.1 0 0);\n", encoding="utf-8")
            (case_dir / "100" / "p").write_text("internalField uniform 0;\n", encoding="utf-8")
        return case_dir

    def test_resume_openfoam_case_clones_and_updates_controldict_without_mutating_parent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            parent = self._create_mock_openfoam_case(root, with_checkpoint=True)
            parent_ctrl_before = (parent / "system" / "controlDict").read_text(encoding="utf-8")

            observed_cwd: Dict[str, Path] = {}

            def _fake_stream(cmd, *, cwd, **kwargs):
                observed_cwd["dir"] = Path(cwd)
                # Simulate solver producing checkpoint 150
                (Path(cwd) / "150").mkdir(exist_ok=True)
                (Path(cwd) / "150" / "U").write_text("internalField uniform (1.2 0 0);\n", encoding="utf-8")
                (Path(cwd) / "150" / "p").write_text("internalField uniform 0;\n", encoding="utf-8")
                log_out = (
                    "Time = 150\n"
                    "Courant Number mean: 0.10 max: 0.42\n"
                    "deltaT = 0.005\n"
                    "Solving for Ux, Initial residual = 1.2e-5, Final residual = 1e-6\n"
                )
                (Path(cwd) / "solver.log").write_text(log_out, encoding="utf-8")
                return MagicMock(returncode=0, stdout=log_out, stderr="")

            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": str(root)}), \
                 patch.object(universal_dispatcher.shutil, "which", side_effect=lambda name, path=None: f"/usr/bin/{name}" if name == "simpleFoam" else None), \
                 patch.object(universal_dispatcher, "_run_streaming_command", side_effect=_fake_stream), \
                 patch.object(universal_dispatcher, "verify_openfoam_convergence", return_value=None), \
                 patch.object(universal_dispatcher, "compute_openfoam_metrics", return_value={}):
                res = universal_dispatcher.resume_openfoam_case(
                    str(parent),
                    {"extra_iterations": 50, "adaptive_time_stepping": True, "max_co": 0.75},
                )

            cloned_dir = observed_cwd["dir"]
            self.assertNotEqual(cloned_dir.resolve(), parent.resolve())
            self.assertTrue(cloned_dir.is_dir())
            # Parent controlDict remains untouched
            self.assertEqual((parent / "system" / "controlDict").read_text(encoding="utf-8"), parent_ctrl_before)
            # Cloned controlDict has latestTime + endTime 150 + adaptive maxCo
            cloned_ctrl = (cloned_dir / "system" / "controlDict").read_text(encoding="utf-8")
            self.assertIn("startFrom latestTime;", cloned_ctrl)
            self.assertIn("endTime 150;", cloned_ctrl)
            self.assertIn("adjustTimeStep yes;", cloned_ctrl)
            self.assertIn("maxCo 0.75;", cloned_ctrl)
            self.assertEqual(res["resumed_from_time"], 100.0)
            self.assertEqual(res["final_time"], 150.0)
            self.assertTrue(res["courant_history"]["available"])

    def test_resume_openfoam_case_rejects_outside_storage_and_missing_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as allowed_tmp, tempfile.TemporaryDirectory() as outside_tmp:
            outside_case = self._create_mock_openfoam_case(Path(outside_tmp), with_checkpoint=True)
            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": allowed_tmp, "NASEER_JOB_DIR": allowed_tmp, "CAE_WORK_DIR": allowed_tmp}):
                with self.assertRaises(PermissionError):
                    universal_dispatcher.resume_openfoam_case(str(outside_case), {})

            no_ckpt_case = self._create_mock_openfoam_case(Path(allowed_tmp), with_checkpoint=False)
            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": allowed_tmp}):
                with self.assertRaises(ValueError) as ctx:
                    universal_dispatcher.resume_openfoam_case(str(no_ckpt_case), {})
                self.assertIn("NO_CHECKPOINT_AVAILABLE", str(ctx.exception))

    def test_api_resume_job_enforces_rbac_checkpoint_gate_and_queues_child_job(self) -> None:
        main_mod, _ = _import_main_module()
        repo = _InMemoryJobRepository()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            case_ok = self._create_mock_openfoam_case(root, with_checkpoint=True)
            case_empty = self._create_mock_openfoam_case(root / "empty", with_checkpoint=False)

            repo.create("job-ok", {"simulation_type": "CFD_Incompressible", "project_id": "proj-1"})
            repo.update("job-ok", status="COMPLETED", result={"case_directory": str(case_ok)})
            repo.create("job-empty", {"simulation_type": "CFD_Incompressible", "project_id": "proj-1"})
            repo.update("job-empty", status="COMPLETED", result={"case_directory": str(case_empty)})

            fake_celery = MagicMock()
            fake_celery.send_task = MagicMock()
            fake_sec = MagicMock()
            fake_sec.resolve_actor = MagicMock(
                return_value={"email": "eng@naseer.local", "role": "engineer", "workspace_id": "ws-1"}
            )
            fake_sec.record_audit = MagicMock()

            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": str(root)}), \
                 patch.object(main_mod, "job_repository", repo), \
                 patch.object(main_mod, "celery_app", fake_celery), \
                 patch.object(main_mod, "security_service", fake_sec):
                # 1. Missing numeric checkpoint returns HTTP 422 NO_CHECKPOINT_AVAILABLE
                with self.assertRaises(main_mod.HTTPException) as exc_422:
                    asyncio.run(main_mod.resume_job("job-empty", _FakeRequest()))
                self.assertEqual(exc_422.exception.status_code, 422)
                self.assertEqual(exc_422.exception.detail["code"], "NO_CHECKPOINT_AVAILABLE")

                # 2. Valid checkpoint dispatches Celery child task and audits action
                resp = asyncio.run(
                    main_mod.resume_job(
                        "job-ok",
                        _FakeRequest(),
                        main_mod.JobResumeRequest(extra_iterations=75, adaptive_time_stepping=True, max_co=0.8),
                    )
                )
                self.assertTrue(resp["success"])
                self.assertEqual(resp["parent_task_id"], "job-ok")
                self.assertEqual(resp["resumed_from_time"], 100.0)
                self.assertEqual(resp["status"], "QUEUED")
                child_id = resp["task_id"]
                self.assertIsNotNone(repo.get(child_id))
                fake_celery.send_task.assert_called_once()
                call_args = fake_celery.send_task.call_args
                self.assertEqual(call_args.args[0], "universal_dispatcher.resume_simulation")
                self.assertEqual(call_args.kwargs["task_id"], child_id)
                fake_sec.record_audit.assert_called_once()
                self.assertEqual(fake_sec.record_audit.call_args.kwargs["action"], "simulation.resume")


if __name__ == "__main__":
    unittest.main()
