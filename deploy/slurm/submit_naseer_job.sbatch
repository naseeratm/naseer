#!/usr/bin/env bash
# ==============================================================================
# NASEER Universal CAE Studio — Slurm HPC Supercomputer Submission Script
# Supports: OpenFOAM (MPI), CalculiX ccx (OpenMP), and ElmerFEM (MPI)
#
# Usage:
#   sbatch --export=ALL,SOLVER=openfoam,CASE_DIR=/scratch/$USER/job_01,OPENFOAM_BIN=pimpleFoam \
#          deploy/slurm/submit_naseer_job.sbatch
# ==============================================================================
#SBATCH --job-name=naseer-cae
#SBATCH --output=naseer_cae_%j.out
#SBATCH --error=naseer_cae_%j.err
#SBATCH --nodes=1
#SBATCH --ntasks=16
#SBATCH --cpus-per-task=1
#SBATCH --mem=32G
#SBATCH --time=04:00:00

set -euo pipefail

SOLVER="${SOLVER:-openfoam}"
CASE_DIR="${CASE_DIR:?ERROR: Pass CASE_DIR=/path/to/exported/case via --export}"
OPENFOAM_BIN="${OPENFOAM_BIN:-simpleFoam}"
CCX_JOB="${CCX_JOB:-job}"
APPTAINER_IMAGE="${APPTAINER_IMAGE:-}"

if [[ ! -d "${CASE_DIR}" ]]; then
  echo "[NASEER-SLURM] Case directory does not exist: ${CASE_DIR}" >&2
  exit 1
fi

echo "[NASEER-SLURM] Job ID=${SLURM_JOB_ID:-local} | Nodes=${SLURM_JOB_NUM_NODES:-1} | Tasks=${SLURM_NTASKS:-1} | Solver=${SOLVER}"
cd "${CASE_DIR}"

run_cmd() {
  if [[ -n "${APPTAINER_IMAGE}" ]]; then
    apptainer exec --bind "${CASE_DIR}:${CASE_DIR}" "${APPTAINER_IMAGE}" "$@"
  else
    "$@"
  fi
}

case "${SOLVER}" in
  openfoam)
    if [[ -f /usr/lib/openfoam/openfoam2406/etc/bashrc ]]; then
      # shellcheck disable=SC1091
      source /usr/lib/openfoam/openfoam2406/etc/bashrc || true
    fi
    if [[ -f system/decomposeParDict && "${SLURM_NTASKS:-1}" -gt 1 ]]; then
      run_cmd decomposePar -force
      srun --mpi=pmix -n "${SLURM_NTASKS}" "${OPENFOAM_BIN}" -parallel
      run_cmd reconstructPar -latestTime
    else
      run_cmd "${OPENFOAM_BIN}"
    fi
    ;;

  calculix)
    export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK:-${SLURM_NTASKS:-4}}"
    run_cmd ccx -i "${CCX_JOB}"
    ;;

  elmer)
    if [[ "${SLURM_NTASKS:-1}" -gt 1 ]]; then
      srun --mpi=pmix -n "${SLURM_NTASKS}" ElmerSolver_mpi case.sif
    else
      run_cmd ElmerSolver case.sif
    fi
    ;;

  *)
    echo "[NASEER-SLURM] Unsupported SOLVER='${SOLVER}'. Use openfoam | calculix | elmer." >&2
    exit 2
    ;;
esac

echo "[NASEER-SLURM] Completed successfully at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
