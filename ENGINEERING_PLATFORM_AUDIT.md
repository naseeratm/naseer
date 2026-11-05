# NASEER Engineering Platform - Code and Architecture Audit

## Executive Assessment

The repository passes its static build checks, but the platform is **not yet ready as one verified production system**.

Verified:
- Docker Compose configuration is structurally valid.
- Frontend lint, TypeScript checking, and Vite build pass.
- The Python test suite passes 14 tests, with 1 skipped.
- Docker API, worker, Redis, and the shared job volume can operate together.
- Low-Mach incompressible OpenFOAM routing can complete through `icoFoam`.

Not verified:
- The React, Express, and Python layers do not share a single authoritative job workflow.
- FastAPI request validation and missing-job behavior are inconsistent.
- The CFD compressible case does not yet have a proven residual/time-directory convergence gate.
- Docker Compose does not run the Node or frontend services used by the UI.

## Evidence-Captured Findings

### Critical

| ID | Area | Finding | Evidence |
|---|---|---|---|
| A-01 | Architecture | Express and Python maintain separate job repositories while the UI creates an Express job and then executes a separate direct Python job. | [src/App.tsx](src/App.tsx#L88-L113), [server.ts](server.ts#L401-L410) |
| A-02 | API | A simulation request with `{}` is accepted and queued as `Thermal_Transient` instead of rejected as invalid input. | Runtime probe against `POST /api/run-simulation`; defaults are applied in `execute_simulation`/`classify_physics` |
| A-03 | API | An unknown task ID is returned with HTTP 200 and `PENDING/QUEUED` instead of HTTP 404. | Runtime probe against `GET /api/jobs/not-a-real-task` |
| A-04 | CFD validation | There is no mandatory convergence gate preventing a solver result from being treated as success after FPE, instability, missing residual history, or missing time directories. | [universal_dispatcher.py](universal_dispatcher.py#L906-L951), [universal_dispatcher.py](universal_dispatcher.py#L954-L990) |

### High

| ID | Area | Finding | Required correction |
|---|---|---|---|
| H-01 | FastAPI | `await request.json()` is used without a JSONDecodeError/content-type validation layer, so malformed JSON can escape as an unhandled 500 response. | Catch `JSONDecodeError`, return 400 `INVALID_JSON`; enforce an object-shaped request model. |
| H-02 | FastAPI | Any broker or routing exception is treated as broker availability failure and triggers a direct solver fallback. This can hide programming errors as successful fallback jobs. | Separate broker exceptions from validation/programming exceptions and only fallback for an allowlisted connectivity exception. |
| H-03 | API/status | Celery `AsyncResult` can report arbitrary unknown IDs as PENDING because no repository membership check is performed before constructing the response. | Check FastAPI `JobRepository.get(task_id)` first and return 404; distinguish unknown IDs from genuinely queued known IDs. |
| H-04 | Express proxy | Express proxies simulation requests only for `/api/run-simulation`, while several UI job routes are locally implemented in separate storage. | Make Express route proxy one canonical FastAPI job API, or add explicit synchronization between repositories. |
| H-05 | Frontend polling | The UI polls Node for only 20 attempts at 250 ms. It then starts a different direct Python simulation, so the second response is not tied to the first job. | Submit one canonical async job, retain `task_id`, and poll its exact status/log/result endpoints with backoff and timeout. |
| H-06 | Frontend runtime | Result normalization assumes nullable solver payloads and may interpret partial/failed payload shapes as valid. | Require `status === SOLVED/COMPLETED` and solver-specific convergence fields before rendering final success. |
| H-07 | Docker | Compose contains no Node/React service and no API healthcheck, despite the UI being a separate Express application. | Add and deploy Node/frontend services or document FastAPI as the only supported production API; add `healthcheck` to API and worker readiness checks to Redis. |
| H-08 | Physics | Numeric conversion helpers can silently replace invalid temperature values with defaults. | Reject invalid/non-finite/out-of-range values; defaults should be used only for documented server defaults, never for client typos. |
| H-09 | Physics | `velocity` and `pressure` are converted directly with `float(...)`, allowing NaN, infinity, or malformed boundary data to enter case generation. | Centralize finite-range validation before OpenFOAM/CalculiX dictionaries are written. |
| H-10 | CFD | Error handling canonicalizes an unknown exception to `Thermal_Transient` and status `error`, which can camouflage which required engine failed. | Preserve the requested physics type; provide stable machine-readable error codes, and do not wrap solver failures with a different engine identity. |

## Individual Remediation Plan

### A-01/A-03/H-03/H-04: Create One Canonical Job Authority

1. Treat FastAPI/Celery and the persistent FastAPI job repository as the canonical simulation-job authority.
2. Make Express proxy simulation creation, status, logs, cancellation, artifacts, and downloads rather than creating a second job.
3. Return:
   - `404 JOB_NOT_FOUND` when a task ID does not exist.
   - `409 JOB_NOT_READY` when result/log artifacts are requested before completion.
   - `202 QUEUED` when the canonical job is created.
   - `422 INVALID_SIMULATION_REQUEST` when input validation fails.
4. Remove or clearly isolate Express-only demo jobs from production solver job routes.

### A-02/H-01/H-08/H-09: Validate Requests Before Dispatch

Create a FastAPI Pydantic request body that:
- requires `simulation_type`;
- rejects unknown simulation types;
- rejects booleans, NaN, infinity, strings that cannot be parsed as finite numbers, and JSON `null` for required numeric fields;
- validates:
  - absolute temperature in finite Kelvin bounds, for example 150 K to 5000 K depending on solver;
  - Celsius input converts to Kelvin;
  - pressure for compressible cases within a solver-specific positive range;
  - velocity magnitude within a finite non-negative range.

The request parser should catch malformed JSON and return:

```json
{
  "success": false,
  "error": "Invalid JSON request body",
  "code": "INVALID_JSON"
}
```

with HTTP `400`.

Invalid simulation payloads should return HTTP `422`, not `200` and not an unhandled `500`.

### A-04/H-10: Implement a Solver Success Contract

No engine should return success unless the same programmatic contract is satisfied.

For OpenFOAM:
- solver process exits with zero;
- `solver.log` exists and contains an expected solver command completion;
- residuals are finite and non-increasing where the configured convergence policy requires it;
- configured residual thresholds are met;
- expected time directories exist;
- requested result fields exist in the final field directory;
- no FPE, segmentation fault, NaN, Infinity, or `Floating point exception` marker exists.

Until the above are proven, `CFD_Compressible` must remain `UNVERIFIED/BETA`; HTTP success, Docker execution, or process termination must never be reported as convergence.

For CalculiX:
- parse the `.dat`/`.sta` result instead of claiming success from process exit alone;
- require a completed step and finite displacement/stress values.

For thermal:
- require finite fields, covered time steps, and the configured residual/error tolerance.

### H-02: Separate Broker Failure from Solver Failure

Route handling should have explicit branches:

1. Validation errors: HTTP `422`.
2. Broker connection errors: HTTP `503`, with retry guidance, unless a documented direct-development fallback is explicitly selected.
3. Direct solver exceptions: return typed HTTP `500`/`502` plus machine-readable error code.
4. Broker is unavailable only when error type and connection target prove broker connectivity failure.

Do not execute local work inside the broker-outage catch-all.

### H-05/H-06: Fix Frontend Execution Flow

Replace the two-job sequence with:

```text
POST /api/run-simulation
  -> task_id
  -> GET /api/jobs/{task_id}
  -> GET /api/jobs/{task_id}/logs
  -> GET /api/jobs/{task_id}/artifacts
  -> normalize only terminal results
```

Use:
- exponential or fixed exponential polling;
- a total deadline;
- cancellation on component unmount/navigation;
- terminal status handling for `completed`, `failed`, `cancelled`, and `timeout`;
- no second solver POST after job completion.

### H-07: Complete the Compose Deployment

Add to the deployment contract whichever services are production-facing:
- `web`/React build service or prebuilt static artifact served by Express;
- `node`/Express service;
- `api` healthcheck;
- worker queue health/readiness indicator;
- Redis healthcheck dependency;
- network aliases and published ports;
- same `cae-jobs` volume mounted by API and worker;
- explicit environment values for `PYTHON_BACKEND_URL` and Celery URLs.

Example requirements:

```yaml
api:
  healthcheck:
    test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
    interval: 10s
    timeout: 5s
    retries: 5
```

### CFD Configuration Safety

Configuration advice from prior investigation should be treated as hypotheses only:
- `PCG`, `GAMG`, `PBiCGStab`, `DILU`, and `Diagonal` choices must match the actual OpenFOAM version and matrix type observed in the generated case.
- Absolute pressure, `p`, density initialization, enthalpy/temperature formulation, and boundary fields must agree.
- `waveTransmissive`, `totalPressure`, and `pressureInletOutletVelocity` require compatible field usage and a stable outlet setup.
- Low-Mach routing is acceptable only as a documented routing policy, not evidence that the compressible case converges.
- No suggested numerical tuning should be marked final until the required residual/time-field evidence is captured by automated tests.

## Backend/Endpoint Audit

| Endpoint family | Current result | Required result |
|---|---|---|
| `POST /api/run-simulation` | Queues broad/default payloads; supports direct execution | Strict request validation, canonical job ID and typed errors |
| `GET /api/tasks/{task_id}` | Mirrors Celery state | 404 unknown; persisted metadata checked |
| `GET /api/task-status/{task_id}` | Alias to task status | Same canonical contract |
| `GET /api/jobs/{task_id}` | Alias to task status | Same canonical contract plus 404 unknown |
| Logs/artifacts/download/cancel | Some aliases and persistence checks exist | Consistent ownership, readiness, and not-found states |
| `/api/health` | Operational probe returns `ONLINE` | Add dependency health or separate liveness/readiness endpoints |

## Docker/Volume Audit

`api`, `worker`, and `redis` are correctly isolated around Redis and a named `cae-jobs` volume. Required follow-up is:

- verify API actually depends on Redis health and worker readiness;
- publish a Node service if Express remains part of the deployment;
- mount the same absolute volume path in every service that reads/writes jobs;
- add container healthchecks for API and worker;
- avoid relying on a worker's ability to write when Redis is the sole readiness signal;
- apply resource/CPU limits and execution timeouts in production.

## Verification Gate

After remediation, run in this order:

1. `python -m unittest discover -s . -p "test_*.py"`
2. `npm run lint`
3. `npm run build`
4. `docker compose config`
5. API contract tests for malformed JSON, missing fields, invalid ranges, unknown task IDs, cancellation, and result readiness.
6. Docker OpenFOAM integration for incompressible, compressible, structural, and thermal cases.
7. For CFD compressible only: require residual convergence, finite values, final fields, and solver exit zero.

## Final Release Status

| Engine | Current status |
|---|---|
| CFD incompressible (`icoFoam`) | Operational evidence exists for the tested Low-Mach route; not every geometry/flow regime is proven |
| Structural static (`CalculiX`) | Operational installation exists; final result parsing/validation should be part of release gating |
| Thermal deterministic (`SciPy`) | Operational and build-tested; enforce finite result and coverage checks |
| CFD compressible (`rhoSimpleFoam`) | **Blocked for release; no convergence claim permitted** |
