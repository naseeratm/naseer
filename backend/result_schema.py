"""Canonical result envelope shared by every solver integration."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


SCHEMA_VERSION = "1.0"


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except (AttributeError, ValueError):
            pass
    return value


def input_provenance(input_data: Mapping[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(_jsonable(input_data), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return {
        "source": "api_input",
        "input_sha256": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "schema_version": SCHEMA_VERSION,
    }


def canonicalize_result(
    payload: Mapping[str, Any],
    *,
    physics_type: str,
    input_data: Mapping[str, Any],
    solver: str | None = None,
) -> dict[str, Any]:
    """Attach the canonical envelope without discarding solver-specific data."""
    result = dict(payload)
    raw_status = str(result.get("status", "")).lower()
    is_error = raw_status == "error" or bool(result.get("error"))
    status = "error" if is_error else "success"

    errors = result.get("errors")
    if not isinstance(errors, list):
        errors = []
    if is_error and not errors:
        errors = [{"code": "SOLVER_ERROR", "message": str(result.get("error", "Solver failed"))}]

    raw_solver = result.get("solver") or solver
    convergence = result.get("convergence")
    if not isinstance(convergence, Mapping):
        convergence = {"converged": None, "status": "not_reported", "residuals": {}}

    raw_artifacts = result.get("artifacts", {})
    if isinstance(raw_artifacts, Mapping):
        artifacts = dict(raw_artifacts)
    elif isinstance(raw_artifacts, list):
        artifacts = {str(item.get("name", index)): item for index, item in enumerate(raw_artifacts) if isinstance(item, Mapping)}
    else:
        artifacts = {}

    provenance = input_provenance(input_data)
    if isinstance(result.get("provenance"), Mapping):
        provenance.update(dict(result["provenance"]))
    provenance["solver"] = raw_solver

    result.update({
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "physics_type": physics_type,
        "solver": raw_solver,
        "units": result.get("units", {}),
        "provenance": provenance,
        "artifacts": artifacts,
        "convergence": dict(convergence),
        "errors": errors,
    })
    return result
