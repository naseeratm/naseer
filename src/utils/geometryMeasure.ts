export interface PhysicalPoint3D {
  x: number;
  y: number;
  z: number;
  /** Optional scene-space coordinates for 3D rendering */
  scenePoint?: [number, number, number];
  /** Optional real solved VTK scalar interpolated via barycentric coordinates at this point */
  scalarValue?: number;
  scalarLabel?: string;
  scalarUnit?: string;
}

export interface MeasurementMetrics {
  p1: PhysicalPoint3D;
  p2: PhysicalPoint3D;
  dx: number;
  dy: number;
  dz: number;
  distanceM: number;
  distanceMm: number;
  midpoint: [number, number, number];
  /** Engineering reference cell sizes based strictly on measured feature length L */
  meshHintFineM: number;
  meshHintCoarseM: number;
  /** Populated ONLY when both endpoints carry real finite solved VTK scalar values */
  scalarDelta?: number;
  scalarSlope?: number;
  scalarLabel?: string;
  scalarUnit?: string;
  slopeUnit?: string;
}

export interface BoundingDimensions3D {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  diagonalM: number;
}

/**
 * Computes exact physical 3D distance, Cartesian components (Δx, Δy, Δz),
 * deterministic mesh-sizing reference (L/15..L/10), and real scalar delta/gradient
 * between two picked surface points. Zero-Mock: no synthetic values are invented.
 */
export function computeMeasurementMetrics(
  p1: PhysicalPoint3D,
  p2: PhysicalPoint3D,
): MeasurementMetrics | null {
  if (
    !Number.isFinite(p1.x) ||
    !Number.isFinite(p1.y) ||
    !Number.isFinite(p1.z) ||
    !Number.isFinite(p2.x) ||
    !Number.isFinite(p2.y) ||
    !Number.isFinite(p2.z)
  ) {
    return null;
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  const distanceM = Math.hypot(dx, dy, dz);
  const distanceMm = distanceM * 1000;
  const midpoint: [number, number, number] = [
    (p1.x + p2.x) / 2,
    (p1.y + p2.y) / 2,
    (p1.z + p2.z) / 2,
  ];

  const hasScalars =
    typeof p1.scalarValue === 'number' &&
    Number.isFinite(p1.scalarValue) &&
    typeof p2.scalarValue === 'number' &&
    Number.isFinite(p2.scalarValue);

  let scalarDelta: number | undefined;
  let scalarSlope: number | undefined;
  let slopeUnit: string | undefined;

  if (hasScalars) {
    scalarDelta = p2.scalarValue! - p1.scalarValue!;
    if (distanceM > 1e-12) {
      scalarSlope = scalarDelta / distanceM;
      const baseUnit = p1.scalarUnit || p2.scalarUnit || '';
      slopeUnit = baseUnit ? `${baseUnit === '°C' ? 'K' : baseUnit}/m` : '1/m';
    }
  }

  return {
    p1,
    p2,
    dx,
    dy,
    dz,
    distanceM,
    distanceMm,
    midpoint,
    meshHintFineM: distanceM / 15,
    meshHintCoarseM: distanceM / 10,
    scalarDelta,
    scalarSlope,
    scalarLabel: hasScalars ? p1.scalarLabel || p2.scalarLabel : undefined,
    scalarUnit: hasScalars ? p1.scalarUnit || p2.scalarUnit || '' : undefined,
    slopeUnit,
  };
}

/**
 * Computes exact physical bounding box dimensions directly from a flat VTK points array [x0,y0,z0,...].
 */
export function computeVtkPhysicalBounds(points?: number[] | null): BoundingDimensions3D | null {
  if (!Array.isArray(points) || points.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let valid = 0;

  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    valid += 1;
  }
  if (valid === 0) return null;

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [sx, sy, sz],
    diagonalM: Math.hypot(sx, sy, sz),
  };
}

export function formatLengthSI(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters);
  if (abs === 0) return '0.0000 m';
  if (abs >= 1) return `${meters.toFixed(4)} m`;
  if (abs >= 1e-3) return `${(meters * 1000).toFixed(2)} mm (${meters.toFixed(5)} m)`;
  return `${(meters * 1e6).toFixed(1)} µm (${meters.toExponential(3)} m)`;
}
