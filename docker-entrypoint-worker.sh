#!/usr/bin/env bash
set -e

# Source official OpenCFD OpenFOAM v2406 (or system OpenFOAM fallback) for non-interactive Celery & diagnostic runs
for foam_bashrc in \
    /usr/lib/openfoam/openfoam2406/etc/bashrc \
    /usr/lib/openfoam/openfoam*/etc/bashrc \
    /usr/share/openfoam/etc/bashrc; do
    if [ -f "$foam_bashrc" ]; then
        set +u
        # shellcheck disable=SC1090
        source "$foam_bashrc" || true
        break
    fi
done

export PATH="/opt/venv/bin:${PATH}"
exec "$@"
