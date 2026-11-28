"""
Automated Unit Tests for Directive 01:
1. Redis worker heartbeat writing (`universal_dispatcher`) and non-blocking reading in
   `main._inspect_celery_cluster()` (zero `probe_capabilities` send_task, zero `inspector.ping`
   when heartbeats exist; fast `inspector.ping(timeout=1.0)` fallback ONLY when empty).
2. Non-blocking async `POST /api/mesh-study` and `POST /api/vv/run` returning HTTP 202 Accepted
   with `task_id` in Celery mode, persisting job state in `JobRepository`, and worker task
   progress/partial updates (`run_mesh_study_task`, `run_vv_suite_task`).
3. Real-time SSE `GET /api/jobs/{task_id}/stream` emitting valid `text/event-stream` frames
   (`event: progress` -> `event: done`) and terminating cleanly on `COMPLETED` and `FAILED`.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import universal_dispatcher
from enterprise_security import EnterpriseSecurityService


class _InMemoryJobRepository:
    """Exact JobRepository interface backed by an in-memory dict for deterministic tests."""

    def __init__(self) -> None:
        self.engine = None
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def create(self, task_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        rec = {
            "task_id": task_id,
            "status": "QUEUED",
            "progress": 0,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "completed_at": None,
            "payload": dict(data),
            "result": None,
            "logs": [],
            "artifacts": {},
            "error": None,
        }
        self._jobs[task_id] = rec
        return dict(rec)

    def update(
        self,
        task_id: str,
        *,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        logs: Optional[List[str]] = None,
        artifacts: Optional[Dict[str, Any]] = None,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        rec = self._jobs.get(task_id)
        if rec is None:
            return None
        now = datetime.now(timezone.utc).isoformat()
        if status is not None:
            rec["status"] = status
            if status == "RUNNING" and not rec["started_at"]:
                rec["started_at"] = now
            if status in {"COMPLETED", "FAILED", "CANCELLED"}:
                rec["completed_at"] = now
        if progress is not None:
            rec["progress"] = progress
        if logs is not None:
            rec["logs"] = list(logs)
        if artifacts is not None:
            rec["artifacts"] = dict(artifacts)
        if result is not None:
            rec["result"] = result
        if error is not None:
            rec["error"] = error
        rec["updated_at"] = now
        return dict(rec)

    def get(self, task_id: str) -> Optional[Dict[str, Any]]:
        rec = self._jobs.get(task_id)
        return dict(rec) if rec is not None else None

    def list(self) -> List[Dict[str, Any]]:
        return [dict(v) for v in self._jobs.values()]


class _FakeRedis:
    """Minimal Redis stub supporting ping, set(ex=...), scan_iter, mget, get, llen, delete, close."""

    def __init__(self, initial: Optional[Dict[str, str]] = None, queue_len: int = 0) -> None:
        self.store: Dict[str, str] = dict(initial or {})
        self.ttls: Dict[str, Optional[int]] = {}
        self.queue_len = queue_len
        self.ping_calls = 0

    def ping(self) -> bool:
        self.ping_calls += 1
        return True

    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        self.store[key] = value
        self.ttls[key] = ex
        return True

    def delete(self, key: str) -> int:
        return 1 if self.store.pop(key, None) is not None else 0

    def llen(self, _name: str) -> int:
        return self.queue_len

    def scan_iter(self, match: str = "*"):
        prefix = match[:-1] if match.endswith("*") else match
        for k in list(self.store.keys()):
            if k.startswith(prefix):
                yield k

    def mget(self, keys: List[str]) -> List[Optional[str]]:
        return [self.store.get(k) for k in keys]

    def get(self, key: str) -> Optional[str]:
        return self.store.get(key)

    def close(self) -> None:
        return None


def _import_main_module():
    """Import main.py natively if FastAPI/SQLAlchemy exist, or with minimal stdlib shims in bare Python."""
    if "main" in sys.modules:
        return sys.modules["main"], False

    try:
        import fastapi  # noqa: F401
        import pydantic  # noqa: F401
        import sqlalchemy  # noqa: F401
        return importlib.import_module("main"), False
    except ImportError:
        pass

    # Bare Python 3.11 environment (no pip deps installed): install minimal shims to execute real main.py logic
    injected: List[str] = []

    def _register(name: str, mod: types.ModuleType) -> None:
        if name not in sys.modules:
            sys.modules[name] = mod
            injected.append(name)

    # uvicorn shim
    uvicorn_mod = types.ModuleType("uvicorn")
    uvicorn_mod.run = lambda *a, **k: None  # type: ignore[attr-defined]
    _register("uvicorn", uvicorn_mod)

    # fastapi shims
    fastapi_mod = types.ModuleType("fastapi")

    class _HTTPException(Exception):
        def __init__(self, status_code: int, detail: Any = None) -> None:
            super().__init__(str(detail))
            self.status_code = status_code
            self.detail = detail

    class _FastAPI:
        def __init__(self, *a: Any, **k: Any) -> None:
            self.routes: List[Any] = []

        def add_middleware(self, *a: Any, **k: Any) -> None:
            pass

        def exception_handler(self, *_a: Any, **_k: Any):
            return lambda fn: fn

        def _route(self, *_a: Any, **_k: Any):
            return lambda fn: fn

        get = post = put = patch = delete = _route

    class _Status:
        HTTP_201_CREATED = 201
        HTTP_202_ACCEPTED = 202
        HTTP_400_BAD_REQUEST = 400
        HTTP_404_NOT_FOUND = 404
        HTTP_422_UNPROCESSABLE_ENTITY = 422
        HTTP_500_INTERNAL_SERVER_ERROR = 500
        HTTP_503_SERVICE_UNAVAILABLE = 503

    fastapi_mod.FastAPI = _FastAPI  # type: ignore[attr-defined]
    fastapi_mod.File = lambda *a, **k: None  # type: ignore[attr-defined]
    fastapi_mod.Form = lambda *a, **k: None  # type: ignore[attr-defined]
    fastapi_mod.HTTPException = _HTTPException  # type: ignore[attr-defined]
    fastapi_mod.Request = object  # type: ignore[attr-defined]
    fastapi_mod.UploadFile = object  # type: ignore[attr-defined]
    fastapi_mod.status = _Status  # type: ignore[attr-defined]
    _register("fastapi", fastapi_mod)

    fa_exc = types.ModuleType("fastapi.exceptions")
    fa_exc.RequestValidationError = type("RequestValidationError", (Exception,), {})  # type: ignore[attr-defined]
    _register("fastapi.exceptions", fa_exc)

    fa_cors = types.ModuleType("fastapi.middleware.cors")
    fa_cors.CORSMiddleware = object  # type: ignore[attr-defined]
    _register("fastapi.middleware", types.ModuleType("fastapi.middleware"))
    _register("fastapi.middleware.cors", fa_cors)

    fa_resp = types.ModuleType("fastapi.responses")

    class _Response:
        def __init__(self, content: Any = None, status_code: int = 200, media_type: Optional[str] = None, headers: Optional[Dict[str, str]] = None) -> None:
            self.body = content
            self.status_code = status_code
            self.media_type = media_type
            self.headers = dict(headers or {})

    class _JSONResponse(_Response):
        def __init__(self, content: Any = None, status_code: int = 200, headers: Optional[Dict[str, str]] = None) -> None:
            super().__init__(content=content, status_code=status_code, media_type="application/json", headers=headers)
            self.content = content

    class _StreamingResponse(_Response):
        def __init__(self, content: Any, status_code: int = 200, media_type: Optional[str] = None, headers: Optional[Dict[str, str]] = None) -> None:
            super().__init__(content=content, status_code=status_code, media_type=media_type, headers=headers)
            self.body_iterator = content

    fa_resp.JSONResponse = _JSONResponse  # type: ignore[attr-defined]
    fa_resp.Response = _Response  # type: ignore[attr-defined]
    fa_resp.StreamingResponse = _StreamingResponse  # type: ignore[attr-defined]
    _register("fastapi.responses", fa_resp)

    # pydantic shim
    pyd_mod = types.ModuleType("pydantic")

    class _FieldInfo:
        def __init__(self, default: Any = None) -> None:
            self.default = default

    def _Field(default: Any = None, **_k: Any) -> Any:
        return default if default is not ... else None

    class _BaseModel:
        def __init__(self, **kwargs: Any) -> None:
            self.model_fields_set = set(kwargs.keys())
            for cls in reversed(type(self).__mro__):
                for attr_name in getattr(cls, "__annotations__", {}):
                    if hasattr(cls, attr_name) and not callable(getattr(cls, attr_name)):
                        setattr(self, attr_name, getattr(cls, attr_name))
                    elif not hasattr(self, attr_name):
                        setattr(self, attr_name, None)
            for k, v in kwargs.items():
                setattr(self, k, v)

        def model_dump(self, mode: str = "json") -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            for k, v in self.__dict__.items():
                if k == "model_fields_set":
                    continue
                out[k] = v.value if hasattr(v, "value") else v
            return out

    pyd_mod.BaseModel = _BaseModel  # type: ignore[attr-defined]
    pyd_mod.ConfigDict = lambda **k: k  # type: ignore[attr-defined]
    pyd_mod.Field = _Field  # type: ignore[attr-defined]
    pyd_mod.ValidationInfo = object  # type: ignore[attr-defined]
    pyd_mod.field_validator = lambda *a, **k: (lambda fn: fn)  # type: ignore[attr-defined]
    pyd_mod.model_validator = lambda *a, **k: (lambda fn: fn)  # type: ignore[attr-defined]
    _register("pydantic", pyd_mod)

    # cae_repository shim when sqlalchemy is absent
    cae_repo_mod = types.ModuleType("cae_repository")
    cae_repo_mod.JobRepository = _InMemoryJobRepository  # type: ignore[attr-defined]
    _register("cae_repository", cae_repo_mod)

    main_mod = importlib.import_module("main")
    main_mod._TEST_INJECTED_MODULES = injected  # type: ignore[attr-defined]
    return main_mod, True


class _FakeRequest:
    def __init__(self, headers: Optional[Dict[str, str]] = None, disconnect_after: Optional[int] = None) -> None:
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.client = types.SimpleNamespace(host="127.0.0.1")
        self._checks = 0
        self._disconnect_after = disconnect_after

    async def is_disconnected(self) -> bool:
        self._checks += 1
        if self._disconnect_after is not None and self._checks > self._disconnect_after:
            return True
        return False


class _BoundTaskSelf:
    def __init__(self, task_id: str) -> None:
        self.request = types.SimpleNamespace(id=task_id)
        self.state_updates: List[Dict[str, Any]] = []

    def update_state(self, state: str, meta: Dict[str, Any]) -> None:
        self.state_updates.append({"state": state, "meta": dict(meta)})


def _invoke_bound_task(task_fn: Any, bound_self: Any, *args: Any, **kwargs: Any) -> Any:
    """Invoke a Celery bind=True task cleanly whether real Celery or the local stub is active."""
    run_method = getattr(task_fn, "run", None)
    unbound = getattr(run_method, "__func__", None)
    if callable(unbound):
        return unbound(bound_self, *args, **kwargs)
    wrapped = getattr(task_fn, "__wrapped__", None)
    if callable(wrapped):
        return wrapped(bound_self, *args, **kwargs)
    return task_fn(bound_self, *args, **kwargs)


class TestDirective01AsyncHeartbeatSSE(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.main_mod, cls.used_shims = _import_main_module()

    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.repo = _InMemoryJobRepository()
        self.sec = EnterpriseSecurityService(sqlite_path=str(Path(self.tmp_dir.name) / "sec.db"))

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    # ------------------------------------------------------------------
    # 1. Redis Worker Heartbeat & _inspect_celery_cluster
    # ------------------------------------------------------------------
    def test_main_has_no_temporary_naseer_cache_monkey_patch(self) -> None:
        src = Path("main.py").read_text(encoding="utf-8")
        self.assertNotIn("# NASEER_CACHE", src)
        self.assertNotIn("_orig_icc", src)

    def test_worker_heartbeat_writes_expected_redis_payload_and_ttl(self) -> None:
        fake_redis = _FakeRedis(queue_len=3)
        stop_ev = threading.Event()
        fake_caps = {
            "openfoam": {"available": True, "version": "v2406"},
            "calculix": {"available": True, "version": "2.21"},
            "gmsh": {"available": True, "version": "4.13.1"},
            "elmer": {"available": False, "version": None},
        }

        def _stop_after_first_wait(_timeout: float) -> bool:
            stop_ev.set()
            return True

        with (
            patch.object(universal_dispatcher, "probe_worker_capabilities", return_value=fake_caps) as mock_probe,
            patch.object(universal_dispatcher, "_get_heartbeat_redis_client", return_value=fake_redis),
            patch.object(stop_ev, "wait", side_effect=_stop_after_first_wait),
        ):
            universal_dispatcher._heartbeat_loop("celery@cae-node-1", 4, stop_ev)

        mock_probe.assert_called_once()
        expected_key = f"{universal_dispatcher.WORKER_HEARTBEAT_PREFIX}celery@cae-node-1"
        self.assertIn(expected_key, fake_redis.store)
        self.assertEqual(fake_redis.ttls[expected_key], 25)

        payload = json.loads(fake_redis.store[expected_key])
        for field in (
            "name",
            "status",
            "pid",
            "concurrency",
            "mpi_cores",
            "solvers",
            "active_tasks",
            "queued_tasks",
            "updated_at_utc",
        ):
            self.assertIn(field, payload)
        self.assertEqual(payload["name"], "celery@cae-node-1")
        self.assertEqual(payload["status"], "ONLINE")
        self.assertEqual(payload["concurrency"], 4)
        self.assertEqual(payload["queued_tasks"], 3)
        self.assertEqual(payload["solvers"]["openfoam"]["version"], "v2406")

    def test_inspect_celery_cluster_reads_redis_heartbeats_without_blocking_probes(self) -> None:
        hb1 = {
            "name": "celery@worker-1",
            "status": "ONLINE",
            "pid": 101,
            "concurrency": 2,
            "mpi_cores": 4,
            "solvers": {
                "openfoam": {"available": True, "version": "v2406"},
                "calculix": {"available": True, "version": "2.21"},
                "gmsh": {"available": True, "version": "4.13"},
                "elmer": {"available": True, "version": "9.0"},
            },
            "active_tasks": 1,
            "queued_tasks": 2,
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        hb2 = {
            "name": "celery@worker-2",
            "status": "ONLINE",
            "pid": 202,
            "concurrency": 2,
            "mpi_cores": 4,
            "solvers": {
                "openfoam": {"available": True, "version": "v2406"},
                "calculix": {"available": False, "version": None},
            },
            "active_tasks": 0,
            "queued_tasks": 1,
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        fake_redis = _FakeRedis(
            {
                "naseer:worker:heartbeat:celery@worker-1": json.dumps(hb1),
                "naseer:worker:heartbeat:celery@worker-2": json.dumps(hb2),
            }
        )
        mock_celery = MagicMock()
        mock_celery.send_task.side_effect = AssertionError("send_task(probe_capabilities) must NOT be called")
        mock_celery.control.inspect.side_effect = AssertionError("inspector.ping() must NOT be called when heartbeats exist")

        with (
            patch.object(self.main_mod, "_get_redis_client", return_value=fake_redis),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.object(self.main_mod, "probe_worker_capabilities", return_value={}),
        ):
            status_obj = self.main_mod._inspect_celery_cluster()

        self.assertEqual(status_obj["status"], "ONLINE")
        self.assertEqual(status_obj["service"], "NASEER_CAE_API")
        self.assertEqual(status_obj["port"], 8000)
        self.assertTrue(status_obj["redis"])
        self.assertEqual(status_obj["workers_online"], 2)
        self.assertEqual(status_obj["worker_names"], ["celery@worker-1", "celery@worker-2"])
        self.assertEqual(status_obj["total_cluster_cores"], 8)
        self.assertEqual(status_obj["active_tasks_count"], 1)
        self.assertEqual(status_obj["queued_tasks_count"], 3)
        self.assertTrue(status_obj["solvers"]["openfoam"]["available"])
        self.assertTrue(status_obj["solvers"]["calculix"]["available"])
        self.assertEqual(len(status_obj["workers"]), 2)

    def test_inspect_celery_cluster_falls_back_to_fast_inspector_when_no_heartbeats(self) -> None:
        empty_redis = _FakeRedis({})
        mock_inspector = MagicMock()
        mock_inspector.ping.return_value = {"celery@legacy-worker": {"ok": "pong"}}
        mock_inspector.stats.return_value = {"celery@legacy-worker": {"pid": 77, "pool": {"max-concurrency": 2}}}
        mock_inspector.active.return_value = {"celery@legacy-worker": [{"id": "t1"}]}
        mock_inspector.reserved.return_value = {"celery@legacy-worker": []}

        mock_celery = MagicMock()
        mock_celery.control.inspect.return_value = mock_inspector
        mock_celery.send_task.side_effect = AssertionError("send_task(probe_capabilities) must NOT be called")

        with (
            patch.object(self.main_mod, "_get_redis_client", return_value=empty_redis),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.object(self.main_mod, "probe_worker_capabilities", return_value={"openfoam": {"available": False}}),
        ):
            status_obj = self.main_mod._inspect_celery_cluster()

        mock_celery.control.inspect.assert_called_once_with(timeout=1.0)
        mock_inspector.ping.assert_called_once()
        self.assertEqual(status_obj["status"], "ONLINE")
        self.assertEqual(status_obj["workers_online"], 1)
        self.assertEqual(status_obj["worker_names"], ["celery@legacy-worker"])
        self.assertEqual(status_obj["active_tasks_count"], 1)

    # ------------------------------------------------------------------
    # 2. Async 202 /api/mesh-study & /api/vv/run + Celery Worker Tasks
    # ------------------------------------------------------------------
    def test_mesh_study_celery_mode_returns_202_and_persists_job(self) -> None:
        mock_celery = MagicMock()
        req = self.main_mod.MeshStudyRequest(
            simulation_type=self.main_mod.PhysicsType.THERMAL_TRANSIENT,
            execution_mode=self.main_mod.ExecutionMode.CELERY,
            mesh_size=0.1,
            width_x=1.0,
            height_y=1.0,
            depth_z=0.1,
            key_result="center_temperature",
        )
        http_req = _FakeRequest()

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            resp = self.main_mod.mesh_independence_study(req, http_req)

        self.assertEqual(resp.status_code, 202)
        body = json.loads(resp.body) if isinstance(resp.body, (bytes, str)) else resp.content
        self.assertTrue(body["success"])
        self.assertEqual(body["status"], "QUEUED")
        task_id = body["task_id"]
        self.assertTrue(task_id)

        stored = self.repo.get(task_id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored["status"], "QUEUED")
        self.assertEqual(stored["payload"]["action"], "mesh_study")

        mock_celery.send_task.assert_called_once()
        call_args = mock_celery.send_task.call_args
        self.assertEqual(call_args.args[0], "universal_dispatcher.run_mesh_study_task")
        self.assertEqual(call_args.kwargs["task_id"], task_id)

    def test_vv_run_celery_mode_returns_202_and_persists_job(self) -> None:
        mock_celery = MagicMock()
        req = self.main_mod.VVRunRequest(
            benchmark_id="all",
            execution_mode=self.main_mod.ExecutionMode.CELERY,
        )
        http_req = _FakeRequest()

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            resp = self.main_mod.run_vv_benchmarks_endpoint(req, http_req)

        self.assertEqual(resp.status_code, 202)
        body = json.loads(resp.body) if isinstance(resp.body, (bytes, str)) else resp.content
        self.assertTrue(body["success"])
        self.assertEqual(body["status"], "QUEUED")
        task_id = body["task_id"]
        self.assertTrue(task_id)

        stored = self.repo.get(task_id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored["status"], "QUEUED")
        self.assertEqual(stored["payload"]["action"], "vv_suite")

        mock_celery.send_task.assert_called_once()
        call_args = mock_celery.send_task.call_args
        self.assertEqual(call_args.args[0], "universal_dispatcher.run_vv_suite_task")
        self.assertEqual(call_args.kwargs["task_id"], task_id)

    def test_worker_mesh_study_task_streams_progress_and_persists_study(self) -> None:
        task_id = "mesh-study-worker-01"
        self.repo.create(task_id, {"action": "mesh_study"})
        bound_self = _BoundTaskSelf(task_id)

        def _fake_structural_exec(level_payload: Dict[str, Any]) -> Dict[str, Any]:
            n = level_payload["mesh"]["divisions"]["x"]
            displacements = [
                {"node": i, "components": {"x": 0.0, "y": 1e-3 * (i % 3) / 2, "z": 0.0}, "magnitude": 1e-3 * (i % 3) / 2}
                for i in range(1, (n + 1) ** 3 + 1)
            ]
            stress = [{"element": e, "von_mises": 200.0 - 40.0 / n} for e in range(1, n ** 3 + 1)]
            return {
                "status": "SOLVED_REALTIME",
                "solver": "CalculiX",
                "data": {"displacements": displacements, "stress": stress, "units": {"von_mises": "Pa", "displacement": "m"}},
            }

        with (
            patch.object(universal_dispatcher, "_job_repository", return_value=self.repo),
            patch.object(universal_dispatcher, "execute_simulation", side_effect=_fake_structural_exec),
        ):
            result = _invoke_bound_task(
                universal_dispatcher.run_mesh_study_task,
                bound_self,
                {"simulation_type": "Structural_Static", "mesh_size": 0.1, "mesh": {"divisions": {"x": 4, "y": 4, "z": 4}}},
                "Structural_Static",
                "max_von_mises",
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["study"]["schema_version"], 2)
        self.assertEqual([lvl["cells"] for lvl in result["study"]["levels"]], [8, 64, 512])

        # Verify progressive Celery task state updates: 10 -> 35 -> 65 -> 95 -> 100
        progresses = [u["meta"]["progress"] for u in bound_self.state_updates]
        for milestone in (10, 35, 65, 95, 100):
            self.assertIn(milestone, progresses)

        final_job = self.repo.get(task_id)
        self.assertEqual(final_job["status"], "COMPLETED")
        self.assertEqual(final_job["progress"], 100)
        self.assertTrue(final_job["result"]["success"])
        self.assertIn("study", final_job["result"])

    def test_worker_vv_suite_task_updates_per_benchmark_and_persists_certificate(self) -> None:
        task_id = "vv-suite-worker-01"
        self.repo.create(task_id, {"action": "vv_suite"})
        bound_self = _BoundTaskSelf(task_id)

        empty_caps = {
            "openfoam": {"available": False, "version": None},
            "calculix": {"available": False, "version": None},
            "elmer": {"available": False, "version": None},
        }

        with (
            patch.object(universal_dispatcher, "_job_repository", return_value=self.repo),
            patch.object(universal_dispatcher, "probe_worker_capabilities", return_value=empty_caps),
        ):
            result = _invoke_bound_task(universal_dispatcher.run_vv_suite_task, bound_self, None)

        self.assertTrue(result["success"])
        self.assertEqual(result["report"]["overall_status"], "SKIPPED_NO_SOLVERS")
        self.assertEqual(result["report"]["summary"]["skipped"], 6)
        self.assertIn("SKIPPED_NO_BINARY", result["certificate_markdown"])

        # Confirm per-benchmark progressive updates (1..6 completed counts emitted)
        completed_counts = [u["meta"].get("completed_count") for u in bound_self.state_updates if "completed_count" in u["meta"]]
        for i in range(1, 7):
            self.assertIn(i, completed_counts)

        final_job = self.repo.get(task_id)
        self.assertEqual(final_job["status"], "COMPLETED")
        self.assertEqual(final_job["progress"], 100)
        self.assertIn("report", final_job["result"])
        self.assertIn("certificate_markdown", final_job["result"])

    # ------------------------------------------------------------------
    # 3. Real-Time SSE Streaming Endpoint (/api/jobs/{task_id}/stream)
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

    def test_sse_stream_emits_progress_then_done_on_completed(self) -> None:
        task_id = "sse-job-complete-01"
        self.repo.create(task_id, {"action": "mesh_study"})
        self.repo.update(task_id, status="RUNNING", progress=35, logs=["[Level 1/3] Coarse done"])

        step = {"count": 0}
        original_get = self.repo.get

        def _advancing_get(tid: str) -> Optional[Dict[str, Any]]:
            step["count"] += 1
            if step["count"] >= 3:
                self.repo.update(
                    tid,
                    status="COMPLETED",
                    progress=100,
                    logs=["[Level 1/3] Coarse done", "[Level 3/3] Fine done"],
                    result={"success": True, "study": {"schema_version": 2}},
                )
            return original_get(tid)

        async def _fast_sleep(_sec: float) -> None:
            return None

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.repo, "get", side_effect=_advancing_get),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod.asyncio, "sleep", side_effect=_fast_sleep),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            resp = asyncio.run(self.main_mod.stream_job_status(task_id, _FakeRequest()))
            self.assertEqual(resp.media_type, "text/event-stream")
            self.assertEqual(resp.headers.get("Cache-Control"), "no-cache")
            self.assertEqual(resp.headers.get("X-Accel-Buffering"), "no")
            events = self._collect_sse_events(resp)

        self.assertGreaterEqual(len(events), 2)
        self.assertEqual(events[0]["event"], "progress")
        self.assertEqual(events[0]["data"]["status"], "RUNNING")
        self.assertEqual(events[0]["data"]["progress"], 35)
        self.assertEqual(events[-1]["event"], "done")
        self.assertEqual(events[-1]["data"]["status"], "COMPLETED")
        self.assertEqual(events[-1]["data"]["progress"], 100)

    def test_sse_stream_terminates_cleanly_on_failed_job(self) -> None:
        task_id = "sse-job-failed-01"
        self.repo.create(task_id, {"action": "vv_suite"})
        self.repo.update(task_id, status="FAILED", progress=100, error="Solver binary missing")

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            resp = asyncio.run(self.main_mod.stream_job_status(task_id, _FakeRequest()))
            events = self._collect_sse_events(resp)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event"], "done")
        self.assertEqual(events[0]["data"]["status"], "FAILED")
        self.assertEqual(events[0]["data"]["error"], "Solver binary missing")

    def test_sse_stream_enforces_rbac_in_enforced_mode(self) -> None:
        admin, admin_token = self.sec.bootstrap_admin(
            email="admin@naseer.io",
            full_name="Admin",
            password="StrongAdminPassword!1",
        )
        self.sec.create_user(
            email="viewer@naseer.io",
            full_name="Viewer",
            password="StrongViewerPassword!1",
            role="viewer",
            actor=admin,
        )
        _, viewer_token = self.sec.authenticate("viewer@naseer.io", "StrongViewerPassword!1")

        task_id = "sse-job-rbac-01"
        self.repo.create(task_id, {"action": "vv_suite"})
        self.repo.update(task_id, status="COMPLETED", progress=100, result={"success": True})

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "enforced"}),
        ):
            # Missing auth header must be rejected with 401
            with self.assertRaises(self.main_mod.SecurityError) as ctx:
                asyncio.run(self.main_mod.stream_job_status(task_id, _FakeRequest()))
            self.assertEqual(ctx.exception.status_code, 401)

            # Valid viewer Bearer token succeeds
            resp = asyncio.run(
                self.main_mod.stream_job_status(
                    task_id,
                    _FakeRequest(headers={"Authorization": f"Bearer {viewer_token}"}),
                )
            )
            events = self._collect_sse_events(resp)
            self.assertEqual(events[-1]["event"], "done")
            self.assertEqual(events[-1]["data"]["status"], "COMPLETED")

    def test_list_jobs_returns_filtered_real_summaries_and_enforces_rbac(self) -> None:
        self.repo.create("job-sim-1", {"project_id": "proj-alpha", "physics_type": "CFD_Incompressible"})
        self.repo.update(
            "job-sim-1",
            status="COMPLETED",
            progress=100,
            result={
                "solver": "OpenFOAM",
                "physics_type": "CFD_Incompressible",
                "data": {"integrals": {"max_velocity_mps": 1.45, "pressure_drop_pa": 18.2}},
                "case_directory": "/app/jobs/case-1",
            },
        )
        self.repo.create("job-gci-1", {"project_id": "proj-alpha", "action": "mesh_study", "physics_type": "Thermal_Steady"})
        self.repo.update(
            "job-gci-1",
            status="COMPLETED",
            progress=100,
            result={
                "success": True,
                "study": {
                    "solver": "CalculiX",
                    "key_result": {"id": "center_temperature", "label": "Center temperature", "unit": "°C"},
                    "gci_fine_percent": 1.42,
                    "observed_order": 1.98,
                    "convergence_type": "monotonic",
                    "grid_independent": True,
                    "levels": [{}, {}, {}],
                },
            },
        )
        self.repo.create("job-other", {"project_id": "proj-beta", "action": "vv_suite"})

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}),
        ):
            all_resp = asyncio.run(self.main_mod.list_jobs(_FakeRequest(), project_id=None, limit=50))
            self.assertTrue(all_resp["success"])
            self.assertEqual(all_resp["count"], 3)

            alpha_resp = asyncio.run(self.main_mod.list_jobs(_FakeRequest(), project_id="proj-alpha", limit=50))
            self.assertEqual(alpha_resp["count"], 2)
            by_id = {j["task_id"]: j for j in alpha_resp["jobs"]}
            self.assertAlmostEqual(by_id["job-sim-1"]["summary_metrics"]["max_velocity_mps"], 1.45)
            self.assertTrue(by_id["job-sim-1"]["has_case_archive"])
            self.assertAlmostEqual(by_id["job-gci-1"]["summary_metrics"]["gci_fine_percent"], 1.42)

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "enforced"}),
        ):
            with self.assertRaises(self.main_mod.SecurityError) as ctx:
                asyncio.run(self.main_mod.list_jobs(_FakeRequest(), project_id=None, limit=50))
            self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
