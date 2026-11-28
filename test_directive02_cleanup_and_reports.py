"""
Automated Unit Tests for Directive 02:
1. Dockerfile.api & Dockerfile.worker configure PYTHONPATH containing /app, and
   universal_dispatcher._ensure_app_on_sys_path() guarantees app dir resolution.
2. GET /api/jobs/{task_id} and GET /api/jobs/{task_id}/stream synchronize Celery
   FAILURE and REVOKED states into FAILED / CANCELLED with real error text and
   terminate SSE cleanly with `event: done`.
3. Bound Celery task test invocation works identically under real Celery Task
   wrappers and local stub fallback.
4. backend/report_generator.generate_academic_report produces distinct,
   domain-accurate multi-physics reports (CFD, CHT, Structural FEA, Thermal,
   Electromagnetic/Acoustics) with strict Zero-Mock "not available" placeholders.
5. Security & deduplication invariants: backend/main.py has no wildcard CORS,
   root file_parser.py re-exports backend.file_parser, server.ts gates local
   uvicorn spawning behind NASEER_AUTO_SPAWN_LOCAL_BACKEND, and
   AuditReportModal.tsx removes hardcoded solver versions.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import backend.file_parser as canonical_file_parser
import file_parser as root_file_parser
import universal_dispatcher
from backend.report_generator import generate_academic_report
from enterprise_security import EnterpriseSecurityService
from test_async_heartbeat_sse import (
    _BoundTaskSelf,
    _FakeRequest,
    _InMemoryJobRepository,
    _import_main_module,
    _invoke_bound_task,
)


class TestDirective02CleanupAndReports(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.main_mod, _ = _import_main_module()

    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.repo = _InMemoryJobRepository()
        self.sec = EnterpriseSecurityService(sqlite_path=str(Path(self.tmp_dir.name) / "sec.db"))

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    # ------------------------------------------------------------------
    # 1. Dockerfile PYTHONPATH & Worker sys.path Guard
    # ------------------------------------------------------------------
    def test_dockerfiles_configure_pythonpath_with_app(self) -> None:
        for dockerfile in ("Dockerfile.api", "Dockerfile.worker"):
            content = Path(dockerfile).read_text(encoding="utf-8")
            self.assertRegex(
                content,
                r'PYTHONPATH\s*=\s*"?[^"\n]*/app',
                f"{dockerfile} must configure PYTHONPATH containing /app",
            )

    def test_universal_dispatcher_ensures_app_root_on_sys_path(self) -> None:
        app_dir = str(Path(universal_dispatcher.__file__).resolve().parent)
        original = list(sys.path)
        try:
            sys.path[:] = [p for p in sys.path if p != app_dir]
            self.assertNotIn(app_dir, sys.path)
            resolved = universal_dispatcher._ensure_app_on_sys_path()
            self.assertEqual(resolved, app_dir)
            self.assertIn(app_dir, sys.path)
        finally:
            sys.path[:] = original

    def test_invoke_bound_task_handles_real_celery_task_and_stub(self) -> None:
        class _FakeCeleryTaskWrapper:
            """Mimics celery.Task where .run is a bound method on the task instance."""

            def run(self, payload_val: str) -> str:
                return f"{self.request.id}:{payload_val}"

        wrapped_task = _FakeCeleryTaskWrapper()
        bound_self = _BoundTaskSelf("celery-task-99")
        self.assertEqual(_invoke_bound_task(wrapped_task, bound_self, "ok"), "celery-task-99:ok")

        def _stub_fn(self_arg: Any, payload_val: str) -> str:
            return f"{self_arg.request.id}:{payload_val}"

        self.assertEqual(_invoke_bound_task(_stub_fn, bound_self, "ok"), "celery-task-99:ok")

    # ------------------------------------------------------------------
    # 2. Celery Early-Crash State Sync in GET /api/jobs/{id} & SSE Stream
    # ------------------------------------------------------------------
    def _collect_sse_events(self, response: Any) -> List[Dict[str, Any]]:
        async def _drain() -> str:
            chunks: List[str] = []
            async for chunk in response.body_iterator:
                chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk))
            return "".join(chunks)

        raw_stream = asyncio.run(_drain())
        events: List[Dict[str, Any]] = []
        for block in raw_stream.split("\n\n"):
            if not block.strip():
                continue
            ev_name = None
            data_str = None
            for line in block.splitlines():
                if line.startswith("event:"):
                    ev_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_str = line[5:].strip()
            if ev_name and data_str:
                events.append({"event": ev_name, "data": json.loads(data_str)})
        return events

    def test_get_job_and_sse_sync_celery_failure_to_failed(self) -> None:
        task_id = "crash-sync-failure-01"
        self.repo.create(task_id, {"action": "vv_suite"})

        fake_async = types.SimpleNamespace(
            state="FAILURE",
            info=ModuleNotFoundError("No module named 'vv_regression_suite'"),
        )
        mock_celery = MagicMock()
        mock_celery.AsyncResult.return_value = fake_async

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            job_resp = asyncio.run(self.main_mod.get_job_status(task_id, _FakeRequest()))
            self.assertEqual(job_resp["status"], "FAILED")
            self.assertIn("ModuleNotFoundError", job_resp["error"])
            self.assertIn("vv_regression_suite", job_resp["error"])

            # Repository must now be permanently updated to FAILED
            stored = self.repo.get(task_id)
            self.assertEqual(stored["status"], "FAILED")
            self.assertIn("vv_regression_suite", stored["error"])

        # Now test SSE stream syncing directly from QUEUED -> FAILED -> event: done
        task_id_sse = "crash-sync-sse-02"
        self.repo.create(task_id_sse, {"action": "mesh_study"})
        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            stream_resp = asyncio.run(self.main_mod.stream_job_status(task_id_sse, _FakeRequest()))
            events = self._collect_sse_events(stream_resp)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event"], "done")
        self.assertEqual(events[0]["data"]["status"], "FAILED")
        self.assertIn("vv_regression_suite", events[0]["data"]["error"])
        self.assertEqual(self.repo.get(task_id_sse)["status"], "FAILED")

    def test_get_job_and_sse_sync_celery_revoked_to_cancelled(self) -> None:
        task_id = "crash-sync-revoked-03"
        self.repo.create(task_id, {"action": "simulation"})
        self.repo.update(task_id, status="RUNNING", progress=25)

        fake_async = types.SimpleNamespace(state="REVOKED", info=None)
        mock_celery = MagicMock()
        mock_celery.AsyncResult.return_value = fake_async

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            stream_resp = asyncio.run(self.main_mod.stream_job_status(task_id, _FakeRequest()))
            events = self._collect_sse_events(stream_resp)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event"], "done")
        self.assertEqual(events[0]["data"]["status"], "CANCELLED")
        self.assertTrue(events[0]["data"]["error"])
        self.assertEqual(self.repo.get(task_id)["status"], "CANCELLED")

    # ------------------------------------------------------------------
    # 3. Dynamic Multi-Physics Academic Report Generator (Zero-Mock)
    # ------------------------------------------------------------------
    def test_report_generator_multi_physics_domains_and_zero_mock(self) -> None:
        cfd_report = generate_academic_report({
            "physics_type": "CFD_Incompressible",
            "recommended_solver": "OpenFOAM (simpleFoam)",
            "data": {
                "turbulence_model": "kOmegaSST",
                "boundary_conditions": {"inlet_velocity_mps": 12.5},
                "integrals": {
                    "pressure_drop_pa": 145.2,
                    "max_velocity_mps": 18.7,
                    "y_plus_mean": 1.15,
                    "wall_shear_stress_pa": 3.4,
                    "drag_coefficient_cd": 0.42,
                },
            },
        })
        self.assertEqual(cfd_report["domain"], "cfd")
        self.assertIn("Computational Fluid Dynamics", cfd_report["title"])
        self.assertIn("Navier-Stokes", cfd_report["markdown"])
        self.assertIn("kOmegaSST", cfd_report["markdown"])
        self.assertIn("145.2 Pa", cfd_report["markdown"])
        self.assertIn("not available", cfd_report["markdown"])
        self.assertNotIn("0.999000", cfd_report["markdown"])

        cht_report = generate_academic_report({
            "physics_type": "CHT_Coupled",
            "recommended_solver": "OpenFOAM (chtMultiRegionSimpleFoam)",
            "data": {
                "integrals": {
                    "nusselt_number": 42.8,
                    "heat_transfer_coefficient_w_m2k": 185.0,
                    "pressure_drop_pa": 32.1,
                },
            },
        })
        self.assertEqual(cht_report["domain"], "cht")
        self.assertIn("Conjugate Heat Transfer", cht_report["title"])
        self.assertIn("42.800", cht_report["markdown"])
        self.assertIn("not available", cht_report["markdown"])

        struct_report = generate_academic_report({
            "physics_type": "Structural_Static",
            "recommended_solver": "CalculiX (ccx)",
            "data": {
                "material": {"youngs_modulus": 210e9, "poisson_ratio": 0.3, "density": 7850.0},
                "integrals": {"max_von_mises_pa": 185.4e6, "max_displacement_m": 0.0024},
                "modal_frequencies_hz": [45.2, 118.6],
            },
        })
        self.assertEqual(struct_report["domain"], "structural")
        self.assertIn("Structural", struct_report["title"])
        self.assertIn("div(sigma) + b = 0", struct_report["markdown"])
        self.assertIn("45.2 Hz", struct_report["markdown"])
        self.assertIn("not available", struct_report["markdown"])

        thermal_report = generate_academic_report({
            "physics_type": "Thermal_Steady",
            "recommended_solver": "CalculiX (*HEAT TRANSFER)",
            "data": {},
        })
        self.assertEqual(thermal_report["domain"], "thermal")
        self.assertIn("Thermal", thermal_report["title"])
        self.assertIn("div(k grad T) = 0", thermal_report["markdown"])
        self.assertIn("not available", thermal_report["markdown"])
        self.assertNotIn("0.999000", thermal_report["markdown"])

        em_report = generate_academic_report({
            "physics_type": "Electromagnetic",
            "recommended_solver": "ElmerFEM (ElmerSolver)",
            "data": {
                "integrals": {"max_potential_v": 100.0},
            },
        })
        self.assertEqual(em_report["domain"], "electromagnetic")
        self.assertIn("Electromagnetic", em_report["title"])
        self.assertIn("Maxwell", em_report["markdown"])
        self.assertIn("100.0000", em_report["markdown"])
        self.assertIn("not available", em_report["markdown"])

        # All titles across domains must be distinct
        titles = {
            cfd_report["title"],
            cht_report["title"],
            struct_report["title"],
            thermal_report["title"],
            em_report["title"],
        }
        self.assertEqual(len(titles), 5)

        # Every section content must be a plain string (no tuple regression)
        for rep in (cfd_report, cht_report, struct_report, thermal_report, em_report):
            for sec in rep["sections"]:
                self.assertIsInstance(sec["content"], str)

    # ------------------------------------------------------------------
    # 4. Security, Deduplication & Dynamic UI Version Guards
    # ------------------------------------------------------------------
    def test_backend_main_has_no_wildcard_cors_and_is_marked_retired(self) -> None:
        src = Path("backend/main.py").read_text(encoding="utf-8")
        self.assertNotIn('allow_origins=["*"]', src)
        self.assertNotIn("allow_origins=['*']", src)
        self.assertIn("NASEER_ALLOWED_ORIGINS", src)
        self.assertIn("RETIRED LEGACY COMPATIBILITY", src)

    def test_root_file_parser_reexports_canonical_backend_parser(self) -> None:
        self.assertIs(root_file_parser.EngineeringFileParser, canonical_file_parser.EngineeringFileParser)
        self.assertIs(root_file_parser.parse_engineering_file, canonical_file_parser.parse_engineering_file)
        self.assertIs(root_file_parser.parser_instance, canonical_file_parser.parser_instance)
        root_lines = Path("file_parser.py").read_text(encoding="utf-8").splitlines()
        self.assertLess(len(root_lines), 40, "Root file_parser.py must be a thin re-export wrapper")

    def test_server_ts_gates_local_uvicorn_spawn_behind_env_var(self) -> None:
        src = Path("server.ts").read_text(encoding="utf-8")
        self.assertIn("NASEER_AUTO_SPAWN_LOCAL_BACKEND", src)
        fn_match = re.search(
            r"async function ensureLocalPythonBackend\(\): Promise<void> \{([\s\S]*?)spawn\(",
            src,
        )
        self.assertIsNotNone(fn_match)
        self.assertIn("process.env.NASEER_AUTO_SPAWN_LOCAL_BACKEND !== '1'", fn_match.group(1))

    def test_audit_report_modal_has_no_hardcoded_solver_versions(self) -> None:
        src = Path("src/components/AuditReportModal.tsx").read_text(encoding="utf-8")
        self.assertNotIn("OpenFOAM v2406", src)
        self.assertNotIn("CalculiX v2.21", src)
        self.assertIn("buildPlatformAuditReport", src)
        self.assertIn("Version probed live when Docker worker is online", src)


if __name__ == "__main__":
    unittest.main()
