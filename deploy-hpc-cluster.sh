#!/usr/bin/env bash
# ==============================================================================
# NASEER Universal CAE Studio — Automated Ubuntu Cloud HPC Cluster Provisioner
# ==============================================================================
# Supports:
#   - Ubuntu 22.04 / 24.04 LTS Cloud VMs (Hetzner, AWS EC2 c7i/c6i, GCP C2, Azure)
#   - Multi-core Linux Workstations & Local Docker Hosts
#
# Usage:
#   chmod +x deploy-hpc-cluster.sh
#   ./deploy-hpc-cluster.sh [WORKER_COUNT] [MPI_CORES_PER_WORKER]
#
# Examples:
#   ./deploy-hpc-cluster.sh           # Auto-detects CPU cores and calculates optimal split
#   ./deploy-hpc-cluster.sh 4 4       # Launches 4 parallel workers x 4 MPI cores (16 cores total)
#   ./deploy-hpc-cluster.sh 8 8       # Launches 8 parallel workers x 8 MPI cores (64-core cloud server)
# ==============================================================================

set -euo pipefail

echo "=============================================================================="
echo " NASEER Universal CAE Studio — Cloud HPC Cluster Provisioner"
echo " Solvers: OpenFOAM v2406 (MPI) | CalculiX v2.21 (OpenMP) | Gmsh | ElmerFEM"
echo "=============================================================================="

# 1. Detect Physical Hardware Resources
TOTAL_CORES="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
TOTAL_RAM_GB="$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo 8)"

echo "[1/5] Detected Host Hardware: ${TOTAL_CORES} CPU Cores | ~${TOTAL_RAM_GB} GB RAM"

# 2. Compute Optimal Worker Count & MPI Cores per Worker
REQUESTED_WORKERS="${1:-}"
REQUESTED_CORES_PER_WORKER="${2:-}"

if [[ -z "${REQUESTED_WORKERS}" ]]; then
  if (( TOTAL_CORES >= 32 )); then
    REQUESTED_WORKERS=4
    REQUESTED_CORES_PER_WORKER=$(( TOTAL_CORES / 4 ))
  elif (( TOTAL_CORES >= 16 )); then
    REQUESTED_WORKERS=4
    REQUESTED_CORES_PER_WORKER=4
  elif (( TOTAL_CORES >= 8 )); then
    REQUESTED_WORKERS=2
    REQUESTED_CORES_PER_WORKER=4
  elif (( TOTAL_CORES >= 4 )); then
    REQUESTED_WORKERS=2
    REQUESTED_CORES_PER_WORKER=2
  else
    REQUESTED_WORKERS=1
    REQUESTED_CORES_PER_WORKER="${TOTAL_CORES}"
  fi
fi

if [[ -z "${REQUESTED_CORES_PER_WORKER}" ]]; then
  REQUESTED_CORES_PER_WORKER=$(( TOTAL_CORES / REQUESTED_WORKERS ))
  if (( REQUESTED_CORES_PER_WORKER < 1 )); then
    REQUESTED_CORES_PER_WORKER=1
  fi
fi

echo "[2/5] Cluster Topology Plan: ${REQUESTED_WORKERS} Parallel Celery Workers x ${REQUESTED_CORES_PER_WORKER} MPI/OpenMP Cores per Worker"

# 3. Install Docker Engine & Compose Plugin if missing on Ubuntu/Debian
if ! command -v docker >/dev/null 2>&1; then
  echo "[3/5] Docker not found. Installing Docker Engine & Compose plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "${USER:-root}" || true
  else
    echo "ERROR: Please install Docker Desktop or Docker Engine for your OS first."
    exit 1
  fi
else
  echo "[3/5] Docker Engine verified: $(docker --version)"
fi

# 4. Prepare Shared CAE Workspace Directory
mkdir -p ./cae-workspace
chmod 775 ./cae-workspace || true

# 5. Launch Multi-Worker HPC Cluster via Docker Compose
echo "[4/5] Building & scaling NASEER HPC Cluster (${REQUESTED_WORKERS} workers)..."
export NASEER_WORKER_REPLICAS="${REQUESTED_WORKERS}"
export NASEER_MPI_CORES_PER_WORKER="${REQUESTED_CORES_PER_WORKER}"

docker compose -f docker-compose.cluster.yml up -d --build --scale worker="${REQUESTED_WORKERS}"

echo "[5/5] Waiting for FastAPI Gateway (:8000) and Celery Workers to register..."
for attempt in {1..20}; do
  if curl -fsS "http://127.0.0.1:8000/api/cluster/status" >/tmp/naseer_cluster_status.json 2>/dev/null; then
    echo "------------------------------------------------------------------------------"
    echo " Cluster Online! Live Telemetry from http://127.0.0.1:8000/api/cluster/status:"
    python3 -m json.tool /tmp/naseer_cluster_status.json || cat /tmp/naseer_cluster_status.json
    echo "------------------------------------------------------------------------------"
    exit 0
  fi
  sleep 2
done

echo "WARNING: Cluster containers started, but /api/cluster/status is still initializing."
echo "Run: docker compose -f docker-compose.cluster.yml ps"
