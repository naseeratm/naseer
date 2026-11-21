import { CaseStudyItem, ProfileSpec, ReferencePoint, VtkFieldPayload } from '../types/thesis';
import { formatNumber } from './numberFormat';

// A 2-D result field on a uniform grid: row 0 is y = 0, column 0 is x = 0.
export interface FieldGrid {
  key: string;
  label: string;
  unit?: string;
  rows: number;
  cols: number;
  data: number[][];
  widthM?: number;
  heightM?: number;
  source?: 'matrix' | 'vtk_midplane';
}

const VTK_FIELD_LABELS: Record<string, string> = {
  U_mag: 'Velocity magnitude |U| (VTK mid-plane)',
  p: 'Pressure p (VTK mid-plane)',
  T: 'Temperature T (VTK mid-plane)',
  temperature: 'Temperature T (VTK mid-plane)',
  k: 'Turbulent kinetic energy k (VTK mid-plane)',
  epsilon: 'Turbulent dissipation ε (VTK mid-plane)',
  omega: 'Specific dissipation ω (VTK mid-plane)',
  alpha_water: 'Water phase fraction α (VTK mid-plane)',
  von_mises: 'Von Mises stress σ_vM (VTK mid-plane)',
  displacement: 'Displacement magnitude |u| (VTK mid-plane)',
  displacement_mag: 'Displacement magnitude |u| (VTK mid-plane)',
  potential: 'Electric potential φ (VTK mid-plane)',
  electric_field_mag: 'Electric field |E| (VTK mid-plane)',
  magnetic_flux_mag: 'Magnetic flux density |B| (VTK mid-plane)',
  pressure_real: 'Acoustic pressure Re(p) (VTK mid-plane)',
};

const humanizeScalarKey = (key: string): string =>
  VTK_FIELD_LABELS[key] ??
  `${key.replace(/[_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} (VTK mid-plane)`;

/**
 * Projects real 3D VTK nodal scalars from OpenFOAM, CalculiX, or ElmerFEM onto a deterministic 2D
 * mid-Z FieldGrid so Spatial Profile Validation and exported reports work for all physics engines.
 * Uses only real solver nodes (no extrapolation outside the geometry; empty exterior bins remain NaN).
 */
export function vtkToFieldGrids(vtkData: VtkFieldPayload | undefined): FieldGrid[] {
  if (!vtkData || !Array.isArray(vtkData.points) || vtkData.points.length < 12 || !vtkData.scalars) {
    return [];
  }
  const points = vtkData.points;
  const nodeCount = Math.floor(points.length / 3);
  if (nodeCount < 4) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < nodeCount; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const W = maxX - minX;
  const H = maxY - minY;
  const D = maxZ - minZ;
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 1e-12 || H <= 1e-12) return [];

  // Select nodes on/near mid-Z plane; fall back to all nodes for 1-cell-thick quasi-2D meshes where
  // nodes sit only at z = minZ and z = maxZ.
  const zMid = 0.5 * (minZ + maxZ);
  let selectedIndices: number[] = [];
  if (D > 1e-9 * Math.max(W, H)) {
    const halfSlab = 0.15 * D;
    for (let i = 0; i < nodeCount; i++) {
      const z = points[i * 3 + 2];
      if (Number.isFinite(z) && Math.abs(z - zMid) <= halfSlab) {
        selectedIndices.push(i);
      }
    }
  }
  if (selectedIndices.length < Math.min(16, nodeCount)) {
    selectedIndices = [];
    for (let i = 0; i < nodeCount; i++) {
      if (Number.isFinite(points[i * 3]) && Number.isFinite(points[i * 3 + 1])) {
        selectedIndices.push(i);
      }
    }
  }
  if (selectedIndices.length < 4) return [];

  // Choose grid resolution matching domain aspect ratio and real node density.
  const aspect = Math.min(4, Math.max(0.25, W / H));
  const approxScale = Math.min(36, Math.max(12, Math.round(Math.sqrt(selectedIndices.length) * 0.9)));
  const cols = Math.min(56, Math.max(12, Math.round(approxScale * Math.sqrt(aspect))));
  const rows = Math.min(56, Math.max(12, Math.round(approxScale / Math.sqrt(aspect))));
  const dx = W / (cols - 1);
  const dy = H / (rows - 1);
  const maxSearchDistSq = (2.6 * Math.max(dx, dy)) ** 2;

  const xs = new Float64Array(selectedIndices.length);
  const ys = new Float64Array(selectedIndices.length);
  for (let k = 0; k < selectedIndices.length; k++) {
    const idx = selectedIndices[k];
    xs[k] = points[idx * 3] - minX;
    ys[k] = points[idx * 3 + 1] - minY;
  }

  // Pre-compute bin membership and fallback IDW neighbor lists once for all scalar fields.
  const binNodes: number[][][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => []),
  );
  for (let k = 0; k < selectedIndices.length; k++) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(xs[k] / dx)));
    const r = Math.min(rows - 1, Math.max(0, Math.round(ys[k] / dy)));
    binNodes[r][c].push(k);
  }

  type NeighborWeight = { k: number; w: number };
  const fallbackWeights: (NeighborWeight[] | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
  for (let r = 0; r < rows; r++) {
    const gy = r * dy;
    for (let c = 0; c < cols; c++) {
      if (binNodes[r][c].length > 0) continue;
      const gx = c * dx;
      // Search nearby bins (radius 3) first; if sparse mesh, scan selected nodes bounded by maxSearchDistSq.
      const candidates: { k: number; d2: number }[] = [];
      const rMin = Math.max(0, r - 3);
      const rMax = Math.min(rows - 1, r + 3);
      const cMin = Math.max(0, c - 3);
      const cMax = Math.min(cols - 1, c + 3);
      for (let rr = rMin; rr <= rMax; rr++) {
        for (let cc = cMin; cc <= cMax; cc++) {
          const list = binNodes[rr][cc];
          for (let j = 0; j < list.length; j++) {
            const k = list[j];
            const d2 = (xs[k] - gx) ** 2 + (ys[k] - gy) ** 2;
            if (d2 <= maxSearchDistSq) candidates.push({ k, d2 });
          }
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => a.d2 - b.d2);
      const top = candidates.slice(0, 4);
      if (top[0].d2 < 1e-18) {
        fallbackWeights[r][c] = [{ k: top[0].k, w: 1 }];
      } else {
        let wSum = 0;
        const weights = top.map((item) => {
          const w = 1 / item.d2;
          wSum += w;
          return { k: item.k, w };
        });
        fallbackWeights[r][c] = weights.map((item) => ({ k: item.k, w: item.w / wSum }));
      }
    }
  }

  const units = vtkData.units ?? {};
  const grids: FieldGrid[] = [];
  for (const [scalarKey, rawValues] of Object.entries(vtkData.scalars)) {
    if (!Array.isArray(rawValues) || rawValues.length < nodeCount) continue;
    let finiteCount = 0;
    const data: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(Number.NaN));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const direct = binNodes[r][c];
        if (direct.length > 0) {
          let sum = 0;
          let cnt = 0;
          for (let j = 0; j < direct.length; j++) {
            const v = rawValues[selectedIndices[direct[j]]];
            if (typeof v === 'number' && Number.isFinite(v)) {
              sum += v;
              cnt += 1;
            }
          }
          if (cnt > 0) {
            data[r][c] = sum / cnt;
            finiteCount += 1;
          }
        } else {
          const nw = fallbackWeights[r][c];
          if (nw && nw.length > 0) {
            let sum = 0;
            let wAcc = 0;
            for (let j = 0; j < nw.length; j++) {
              const v = rawValues[selectedIndices[nw[j].k]];
              if (typeof v === 'number' && Number.isFinite(v)) {
                sum += v * nw[j].w;
                wAcc += nw[j].w;
              }
            }
            if (wAcc > 0) {
              data[r][c] = sum / wAcc;
              finiteCount += 1;
            }
          }
        }
      }
    }
    if (finiteCount < 4) continue;
    grids.push({
      key: `vtk_${scalarKey}`,
      label: humanizeScalarKey(scalarKey),
      unit: units[scalarKey],
      rows,
      cols,
      data,
      widthM: W,
      heightM: H,
      source: 'vtk_midplane',
    });
  }
  return grids;
}

/**
 * Extracts a real X-Y curve from completed Parametric Sweep cases (`project.casesMatrix`) so
 * researchers can validate sweep trends (e.g. Velocity vs ΔP, Load vs Stress) against experimental data.
 */
export function buildParametricProfile(cases: CaseStudyItem[] | undefined): SampledProfile | null {
  if (!Array.isArray(cases) || cases.length < 2) return null;
  let paramName = 'Parameter';
  let paramUnit = '';
  let outputName = 'Output';
  let outputUnit = '';
  const points: ProfilePoint[] = [];

  for (const item of cases) {
    if (!item || item.status === 'Pending') continue;
    if (typeof item.keyOutputValue !== 'number' || !Number.isFinite(item.keyOutputValue)) continue;
    const raw = String(item.studyVariable || '');
    const match = raw.match(/^\s*([^=]+?)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(.*)$/);
    if (!match) continue;
    const xVal = Number(match[2]);
    if (!Number.isFinite(xVal)) continue;
    if (points.length === 0) {
      paramName = match[1].trim() || 'Parameter';
      paramUnit = match[3].trim();
      outputName = item.keyOutputName || 'Key Output';
      outputUnit = item.keyOutputUnit || '';
    }
    points.push({ s: xVal, value: item.keyOutputValue, x: xVal, y: item.keyOutputValue });
  }

  points.sort((a, b) => a.s - b.s);
  if (points.length < 2 || points[points.length - 1].s === points[0].s) return null;

  const abscissaLabel = paramUnit ? `${paramName} (${paramUnit})` : paramName;
  const valueLabel = outputUnit ? `${outputName} (${outputUnit})` : outputName;
  return {
    points,
    abscissaLabel,
    valueLabel,
    description: `Parametric Sweep: ${outputName} vs. ${abscissaLabel} (${points.length} real design points)`,
    physical: true,
  };
}

export const DEFAULT_PROFILE_SPEC: ProfileSpec = {
  kind: 'horizontal',
  fieldKey: 'temperature_matrix',
  units: 'fraction',
  position: 0.5,
  x0: 0,
  y0: 0.5,
  x1: 1,
  y1: 0.5,
  normalizeAbscissa: false,
};

export interface ProfilePoint {
  // Abscissa as the reference data is expressed (coordinate, arc length, or s/L when normalised).
  s: number;
  value: number;
  x: number;
  y: number;
}

export interface SampledProfile {
  points: ProfilePoint[];
  abscissaLabel: string;
  valueLabel: string;
  description: string;
  // True when coordinates are physical meters; false when the solver gave no domain size (fractions only).
  physical: boolean;
}

export type ProfileResult = { ok: true; profile: SampledProfile } | { ok: false; error: string };

const TOL = 1e-9;

// Bilinear interpolation that ignores nodes with zero weight, so a sample sitting exactly on a node is not
// discarded just because a neighbouring node is non-finite.
function bilinearAt(data: number[][], fx: number, fy: number): number {
  const rows = data.length;
  const cols = data[0].length;
  const c0 = Math.min(Math.max(Math.floor(fx), 0), cols - 2);
  const r0 = Math.min(Math.max(Math.floor(fy), 0), rows - 2);
  const tx = Math.min(Math.max(fx - c0, 0), 1);
  const ty = Math.min(Math.max(fy - r0, 0), 1);
  const corners: [number, number][] = [
    [data[r0][c0], (1 - tx) * (1 - ty)],
    [data[r0][c0 + 1], tx * (1 - ty)],
    [data[r0 + 1][c0], (1 - tx) * ty],
    [data[r0 + 1][c0 + 1], tx * ty],
  ];
  let sum = 0;
  for (const [value, weight] of corners) {
    if (weight < 1e-12) continue;
    if (!Number.isFinite(value)) return NaN;
    sum += value * weight;
  }
  return sum;
}

const fail = (error: string): ProfileResult => ({ ok: false, error });

export function sampleProfile(grid: FieldGrid, spec: ProfileSpec): ProfileResult {
  if (grid.rows < 2 || grid.cols < 2) return fail('The field needs at least 2 × 2 nodes to cut a profile.');
  const physical = !!grid.widthM && !!grid.heightM && grid.widthM > 0 && grid.heightM > 0;
  if (spec.units === 'm' && !physical) {
    return fail('The solver did not report the domain size, so coordinates in meters are unavailable. Use fractions of the domain.');
  }
  // Without a reported domain size the grid is treated as the unit square and coordinates are fractions.
  const W = physical ? (grid.widthM as number) : 1;
  const H = physical ? (grid.heightM as number) : 1;
  const toX = (value: number) => (spec.units === 'fraction' ? value * W : value);
  const toY = (value: number) => (spec.units === 'fraction' ? value * H : value);
  const insideX = (x: number) => x >= -TOL * W && x <= W * (1 + TOL);
  const insideY = (y: number) => y >= -TOL * H && y <= H * (1 + TOL);
  const coord = (axis: 'x' | 'y', value: number) =>
    physical ? `${axis} = ${formatNumber(value)} m` : `${axis}/L${axis} = ${formatNumber(value / (axis === 'x' ? W : H))}`;
  const fractionHint = (axis: 'x' | 'y', raw: number) =>
    spec.units === 'fraction' && physical ? ` (${formatNumber(raw)}·L${axis})` : '';

  let start: { x: number; y: number };
  let end: { x: number; y: number };
  let extent: number;
  let count: number;
  let description: string;

  switch (spec.kind) {
    case 'horizontal': {
      const y = toY(spec.position);
      if (!Number.isFinite(y) || !insideY(y)) return fail(`The horizontal cut ${coord('y', y)} lies outside the domain.`);
      start = { x: 0, y };
      end = { x: W, y };
      extent = W;
      count = grid.cols;
      description = `Horizontal cut at ${coord('y', y)}${fractionHint('y', spec.position)}`;
      break;
    }
    case 'vertical': {
      const x = toX(spec.position);
      if (!Number.isFinite(x) || !insideX(x)) return fail(`The vertical cut ${coord('x', x)} lies outside the domain.`);
      start = { x, y: 0 };
      end = { x, y: H };
      extent = H;
      count = grid.rows;
      description = `Vertical cut at ${coord('x', x)}${fractionHint('x', spec.position)}`;
      break;
    }
    case 'diagonal': {
      start = { x: 0, y: 0 };
      end = { x: W, y: H };
      extent = Math.hypot(W, H);
      count = Math.max(grid.cols, grid.rows);
      description = 'Diagonal cut from the origin to the opposite corner';
      break;
    }
    case 'line': {
      start = { x: toX(spec.x0), y: toY(spec.y0) };
      end = { x: toX(spec.x1), y: toY(spec.y1) };
      if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return fail('The cut-line coordinates must be numbers.');
      if (!insideX(start.x) || !insideY(start.y) || !insideX(end.x) || !insideY(end.y)) {
        return fail('The cut-line end points must lie inside the domain; extrapolating outside the solved region is not allowed.');
      }
      extent = Math.hypot(end.x - start.x, end.y - start.y);
      if (extent <= 1e-12 * Math.max(W, H)) return fail('The cut-line start and end points coincide.');
      count = Math.min(4000, Math.max(2, Math.ceil(extent / Math.min(W / (grid.cols - 1), H / (grid.rows - 1))) + 1));
      description = `Cut-line from (${formatNumber(start.x)}, ${formatNumber(start.y)}) to (${formatNumber(end.x)}, ${formatNumber(end.y)})${physical ? ' m' : ' (fractions of the domain)'}`;
      break;
    }
    default:
      return fail('Unknown profile type.');
  }

  const points: ProfilePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const x = Math.min(Math.max(start.x + t * (end.x - start.x), 0), W);
    const y = Math.min(Math.max(start.y + t * (end.y - start.y), 0), H);
    const value = bilinearAt(grid.data, (x / W) * (grid.cols - 1), (y / H) * (grid.rows - 1));
    if (!Number.isFinite(value)) continue;
    const along = spec.kind === 'horizontal' ? x : spec.kind === 'vertical' ? y : t * extent;
    points.push({ s: spec.normalizeAbscissa ? along / extent : along, value, x, y });
  }
  if (points.length < 2) return fail('The cut passes through too few valid nodes to form a profile.');

  const axis = spec.kind === 'horizontal' ? 'x' : spec.kind === 'vertical' ? 'y' : 's';
  const lengthName = spec.kind === 'horizontal' ? 'Lx' : spec.kind === 'vertical' ? 'Ly' : 'L';
  const abscissaLabel =
    spec.normalizeAbscissa || !physical
      ? `${axis} / ${lengthName}`
      : `${axis} (m)${axis === 's' ? ' along the cut' : ''}`;
  return {
    ok: true,
    profile: {
      points,
      abscissaLabel,
      valueLabel: `${grid.label}${grid.unit ? ` (${grid.unit})` : ''}`,
      description,
      physical,
    },
  };
}

// Parses X-Y reference data from CSV/TSV/whitespace text. Header lines and anything non-numeric are skipped and
// counted so the UI can say so; points are returned sorted by X.
export function parseReferenceCsv(text: string): { points: ReferencePoint[]; skipped: number } {
  const points: ReferencePoint[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const parts = line.split(/[,;\t\s]+/).filter((part) => part !== '');
    const x = parts.length >= 2 ? Number(parts[0]) : Number.NaN;
    const y = parts.length >= 2 ? Number(parts[1]) : Number.NaN;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    else skipped += 1;
  }
  return { points: points.sort((a, b) => a.x - b.x), skipped };
}

export interface ValidationEvaluation {
  spec: ProfileSpec;
  field?: FieldGrid;
  sampled?: ProfileResult;
  comparison?: Comparison;
}

// The single place that decides which field is cut, where, and how it is compared; the validation tab and the
// exported report both call it, so they cannot disagree.
export function evaluateValidation(
  fields: FieldGrid[],
  spec: ProfileSpec | undefined,
  reference: { points: ReferencePoint[] } | undefined,
): ValidationEvaluation {
  const merged: ProfileSpec = { ...DEFAULT_PROFILE_SPEC, ...spec };
  const field = fields.find((candidate) => candidate.key === merged.fieldKey) ?? fields[0];
  if (!field) return { spec: merged };
  const resolved: ProfileSpec = { ...merged, fieldKey: field.key };
  const sampled = sampleProfile(field, resolved);
  const comparison = sampled.ok && reference && reference.points.length > 0 ? compareToReference(sampled.profile.points, reference.points) : undefined;
  return { spec: resolved, field, sampled, comparison };
}

export interface ComparisonRow {
  x: number;
  ref: number;
  sim?: number;
  absError?: number;
  // |sim − ref| / |ref| × 100; undefined when the reference value is exactly zero.
  percentError?: number;
  status: 'compared' | 'out-of-range';
}

export interface Comparison {
  rows: ComparisonRow[];
  compared: number;
  outOfRange: number;
  zeroReference: number;
  meanAbsError?: number;
  maxAbsError?: number;
  rmse?: number;
  meanAbsPercent?: number;
  maxAbsPercent?: number;
  // RMSE as a percentage of the reference range.
  nrmsePercent?: number;
  r2?: number;
}

// Compares the simulated profile with reference points by linear interpolation along the profile.
// Reference points outside the sampled range are excluded, never extrapolated.
export function compareToReference(profile: ProfilePoint[], reference: ReferencePoint[]): Comparison {
  const sorted = [...profile].sort((a, b) => a.s - b.s);
  const low = sorted[0]?.s ?? 0;
  const high = sorted[sorted.length - 1]?.s ?? 0;
  const eps = TOL * Math.max(1, Math.abs(high - low));

  const interpolate = (s: number): number | undefined => {
    if (sorted.length === 0 || s < low - eps || s > high + eps) return undefined;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (s >= a.s - eps && s <= b.s + eps) {
        const span = b.s - a.s;
        return span > 0 ? a.value + ((Math.min(Math.max(s, a.s), b.s) - a.s) / span) * (b.value - a.value) : a.value;
      }
    }
    return undefined;
  };

  const rows: ComparisonRow[] = reference.map((point) => {
    const sim = interpolate(point.x);
    if (sim === undefined) return { x: point.x, ref: point.y, status: 'out-of-range' };
    const absError = Math.abs(sim - point.y);
    return {
      x: point.x,
      ref: point.y,
      sim,
      absError,
      percentError: point.y !== 0 ? (absError / Math.abs(point.y)) * 100 : undefined,
      status: 'compared',
    };
  });

  const compared = rows.filter((row) => row.status === 'compared');
  const result: Comparison = {
    rows,
    compared: compared.length,
    outOfRange: rows.length - compared.length,
    zeroReference: compared.filter((row) => row.percentError === undefined).length,
  };
  if (compared.length === 0) return result;

  const abs = compared.map((row) => row.absError as number);
  result.meanAbsError = abs.reduce((sum, v) => sum + v, 0) / abs.length;
  result.maxAbsError = Math.max(...abs);
  result.rmse = Math.sqrt(abs.reduce((sum, v) => sum + v * v, 0) / abs.length);
  const percents = compared.map((row) => row.percentError).filter((v): v is number => v !== undefined);
  if (percents.length) {
    result.meanAbsPercent = percents.reduce((sum, v) => sum + v, 0) / percents.length;
    result.maxAbsPercent = Math.max(...percents);
  }
  const refs = compared.map((row) => row.ref);
  const range = Math.max(...refs) - Math.min(...refs);
  if (range > 0) result.nrmsePercent = (result.rmse / range) * 100;
  if (compared.length >= 2) {
    const mean = refs.reduce((sum, v) => sum + v, 0) / refs.length;
    const total = refs.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    const residual = abs.reduce((sum, v) => sum + v * v, 0);
    if (total > 0) result.r2 = 1 - residual / total;
  }
  return result;
}
