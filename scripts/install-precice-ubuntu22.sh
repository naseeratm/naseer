#!/usr/bin/env bash
# NASEER Universal CAE Studio — Optional preCICE v3 + CalculiX-preCICE + OpenFOAM-adapter Installer
# Target: Ubuntu 22.04 (jammy) + OpenFOAM v2406
# Usage:
#   docker compose build --build-arg INSTALL_PRECICE=1 worker
set -euo pipefail

PRECICE_VERSION="${PRECICE_VERSION:-3.1.2}"
PRECICE_DEB_URL="${PRECICE_DEB_URL:-https://github.com/precice/precice/releases/download/v${PRECICE_VERSION}/libprecice3_${PRECICE_VERSION}_jammy.deb}"
CALCULIX_PRECICE_DEB_URL="${CALCULIX_PRECICE_DEB_URL:-}"
OPENFOAM_ADAPTER_REPO="${OPENFOAM_ADAPTER_REPO:-https://github.com/precice/openfoam-adapter.git}"
OPENFOAM_ADAPTER_REF="${OPENFOAM_ADAPTER_REF:-v1.3.1}"
FOAM_BASHRC="${FOAM_BASHRC:-/usr/lib/openfoam/openfoam2406/etc/bashrc}"

echo "[NASEER preCICE] Installing build dependencies on Ubuntu 22.04 (jammy)..."
apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  cmake \
  curl \
  g++ \
  gfortran \
  git \
  pkg-config \
  libarpack2-dev \
  libspooles-dev \
  libyaml-cpp-dev \
  libboost-all-dev \
  libeigen3-dev \
  libxml2-dev

TMP_DIR="$(mktemp -d /tmp/naseer-precice.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

# 1. Install official libprecice3 Debian package (idempotent)
if ! pkg-config --exists libprecice 2>/dev/null; then
  echo "[NASEER preCICE] Downloading libprecice3 from ${PRECICE_DEB_URL}..."
  curl -fsSL -o "${TMP_DIR}/libprecice3.deb" "${PRECICE_DEB_URL}"
  apt-get install -y --no-install-recommends "${TMP_DIR}/libprecice3.deb"
  ldconfig
else
  echo "[NASEER preCICE] libprecice already installed: $(pkg-config --modversion libprecice)"
fi

# 2. Install ccx_preCICE (if URL provided or build from official calculix-adapter)
if ! command -v ccx_preCICE >/dev/null 2>&1; then
  if [ -n "${CALCULIX_PRECICE_DEB_URL}" ]; then
    echo "[NASEER preCICE] Downloading calculix-precice package from ${CALCULIX_PRECICE_DEB_URL}..."
    curl -fsSL -o "${TMP_DIR}/calculix-precice.deb" "${CALCULIX_PRECICE_DEB_URL}"
    apt-get install -y --no-install-recommends "${TMP_DIR}/calculix-precice.deb"
  else
    echo "[NASEER preCICE] Building ccx_preCICE from precice/calculix-adapter..."
    git clone --depth 1 https://github.com/precice/calculix-adapter.git "${TMP_DIR}/calculix-adapter"
    curl -fsSL -o "${TMP_DIR}/ccx_2.20.src.tar.bz2" "http://www.dhondt.de/ccx_2.20.src.tar.bz2"
    tar -xjf "${TMP_DIR}/ccx_2.20.src.tar.bz2" -C "${TMP_DIR}"
    make -C "${TMP_DIR}/calculix-adapter" -j"$(nproc)" CCX="${TMP_DIR}/CalculiX/ccx_2.20/src"
    install -m 0755 "${TMP_DIR}/calculix-adapter/bin/ccx_preCICE" /usr/local/bin/ccx_preCICE
  fi
else
  echo "[NASEER preCICE] ccx_preCICE already installed at $(command -v ccx_preCICE)"
fi

# 3. Build OpenFOAM preCICE adapter against OpenFOAM v2406
if [ -f "${FOAM_BASHRC}" ]; then
  echo "[NASEER preCICE] Compiling precice/openfoam-adapter (${OPENFOAM_ADAPTER_REF})..."
  set +u
  # shellcheck disable=SC1090
  source "${FOAM_BASHRC}"
  set -u
  if [ ! -f "${FOAM_USER_LIBBIN:-/usr/local/lib}/libpreciceAdapterFunctionObject.so" ] && [ ! -f "/usr/local/lib/libpreciceAdapterFunctionObject.so" ]; then
    git clone --depth 1 --branch "${OPENFOAM_ADAPTER_REF}" "${OPENFOAM_ADAPTER_REPO}" "${TMP_DIR}/openfoam-adapter"
    (
      cd "${TMP_DIR}/openfoam-adapter"
      ./Allwmake
    )
    if [ -n "${FOAM_USER_LIBBIN:-}" ] && [ -f "${FOAM_USER_LIBBIN}/libpreciceAdapterFunctionObject.so" ]; then
      cp -f "${FOAM_USER_LIBBIN}/libpreciceAdapterFunctionObject.so" /usr/local/lib/libpreciceAdapterFunctionObject.so
      ldconfig
    fi
  fi
fi

rm -rf /var/lib/apt/lists/*
echo "[NASEER preCICE] Verification:"
pkg-config --modversion libprecice || true
command -v ccx_preCICE || true
ls -la /usr/local/lib/libpreciceAdapterFunctionObject.so 2>/dev/null || true
