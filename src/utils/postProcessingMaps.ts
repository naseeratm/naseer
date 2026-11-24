import { VtkFieldPayload } from '../types/thesis';
import { ReportMatrix, formatNumber } from './reportModel';

export type ColormapName = 'turbo' | 'viridis' | 'thermal' | 'coolwarm';
export type ProjectionPlane = 'XY' | 'XZ' | 'YZ';
export type PostViewMode = 'scalar' | 'gradient' | 'vectors';

export interface DerivedGradientField {
  cols: number;
  rows: number;
  widthM: number;
  heightM: number;
  physicalDimensions: boolean;
  dx: number;
  dy: number;
  /** dPhi/dx in [unit / m] (or per normalized unit if domain size missing) */
  gradX: number[][];
  /** dPhi/dy in [unit / m] */
  gradY: number[][];
  /** |grad Phi| magnitude */
  magnitude: number[][];
  /** Vector overlay components: -k*gradT for thermal with known k, else -gradPhi */
  vecX: number[][];
  vecY: number[][];
  minMag: number;
  maxMag: number;
  meanMag: number;
  peakCoords: { x: number; y: number; row: number; col: number };
  gradientUnit: string;
  vectorLabel: string;
  vectorUnit: string;
  conductivityUsed?: number;
}

export interface ProjectedVectorSample {
  u: number;
  v: number;
  vx: number;
  vy: number;
  mag: number;
}

export interface ProjectedVtkVectorField {
  key: string;
  label: string;
  unit: string;
  plane: ProjectionPlane;
  axisULabel: string;
  axisVLabel: string;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  minMag: number;
  maxMag: number;
  meanMag: number;
  nodeCount: number;
  samples: ProjectedVectorSample[];
}

export interface IsoSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type RgbStop = [number, number, number, number]; // [t, r, g, b]

const COLORMAP_STOPS: Record<ColormapName, RgbStop[]> = {
  turbo: [
    [0.0, 48, 18, 59],
    [0.15, 68, 91, 205],
    [0.32, 39, 173, 229],
    [0.5, 92, 230, 128],
    [0.68, 224, 217, 56],
    [0.85, 249, 117, 29],
    [1.0, 122, 4, 3],
  ],
  viridis: [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ],
  thermal: [
    [0.0, 14, 18, 48],
    [0.25, 98, 24, 110],
    [0.5, 198, 52, 68],
    [0.75, 247, 148, 29],
    [1.0, 252, 246, 178],
  ],
  coolwarm: [
    [0.0, 59, 76, 192],
    [0.25, 122, 159, 248],
    [0.5, 221, 221, 221],
    [0.75, 244, 154, 123],
    [1.0, 180, 4, 38],
  ],
};

export function sampleColormap(tRaw: number, palette: ColormapName): [number, number, number] {
  const t = Number.isFinite(tRaw) ? Math.max(0, Math.min(1, tRaw)) : 0;
  const stops = COLORMAP_STOPS[palette] ?? COLORMAP_STOPS.turbo;
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    if (t <= t1 || i === stops.length - 2) {
      const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
      return [
        Math.round(r0 + (r1 - r0) * f),
        Math.round(g0 + (g1 - g0) * f),
        Math.round(b0 + (b1 - b0) * f),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

/**
 * Compute exact 2D spatial gradient (dPhi/dx, dPhi/dy, |grad Phi|) and Fourier heat flux
 * q = -k * grad(T) directly from a real solver 2D matrix using 2nd-order central finite
 * differences in the interior and 1st-order one-sided differences on boundaries.
 * Zero mock data: requires at least a 2x2 finite solver matrix.
 */
export function computeScalarGradientField(
  matrix: ReportMatrix,
  thermalConductivityWmk?: number,
): DerivedGradientField | null {
  const { rows, cols, data } = matrix;
  if (rows < 2 || cols < 2 || !Array.isArray(data) || data.length !== rows) return null;

  const hasPhysical =
    typeof matrix.widthM === 'number' &&
    Number.isFinite(matrix.widthM) &&
    matrix.widthM > 0 &&
    typeof matrix.heightM === 'number' &&
    Number.isFinite(matrix.heightM) &&
    matrix.heightM > 0;

  const widthM = hasPhysical ? matrix.widthM! : 1;
  const heightM = hasPhysical ? matrix.heightM! : 1;
  const dx = widthM / (cols - 1);
  const dy = heightM / (rows - 1);

  const isTemp = matrix.key === 'temperature_matrix' || matrix.label.toLowerCase().includes('temperature');
  const k =
    isTemp &&
    hasPhysical &&
    typeof thermalConductivityWmk === 'number' &&
    Number.isFinite(thermalConductivityWmk) &&
    thermalConductivityWmk > 0
      ? thermalConductivityWmk
      : undefined;

  const gradX: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(NaN));
  const gradY: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(NaN));
  const magnitude: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(NaN));
  const vecX: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(NaN));
  const vecY: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(NaN));

  let minMag = Infinity;
  let maxMag = -Infinity;
  let sumMag = 0;
  let finiteCount = 0;
  let peakRow = 0;
  let peakCol = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const center = data[r][c];
      if (!Number.isFinite(center)) continue;

      let gx = NaN;
      if (c > 0 && c < cols - 1 && Number.isFinite(data[r][c + 1]) && Number.isFinite(data[r][c - 1])) {
        gx = (data[r][c + 1] - data[r][c - 1]) / (2 * dx);
      } else if (c < cols - 1 && Number.isFinite(data[r][c + 1])) {
        gx = (data[r][c + 1] - center) / dx;
      } else if (c > 0 && Number.isFinite(data[r][c - 1])) {
        gx = (center - data[r][c - 1]) / dx;
      }

      let gy = NaN;
      if (r > 0 && r < rows - 1 && Number.isFinite(data[r + 1][c]) && Number.isFinite(data[r - 1][c])) {
        gy = (data[r + 1][c] - data[r - 1][c]) / (2 * dy);
      } else if (r < rows - 1 && Number.isFinite(data[r + 1][c])) {
        gy = (data[r + 1][c] - center) / dy;
      } else if (r > 0 && Number.isFinite(data[r - 1][c])) {
        gy = (center - data[r - 1][c]) / dy;
      }

      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      const mag = Math.hypot(gx, gy);
      gradX[r][c] = gx;
      gradY[r][c] = gy;
      magnitude[r][c] = mag;

      // Fourier's Law: heat flux points down the temperature gradient (-k * grad T)
      const factor = k !== undefined ? -k : -1;
      vecX[r][c] = factor * gx;
      vecY[r][c] = factor * gy;

      if (mag < minMag) minMag = mag;
      if (mag > maxMag) {
        maxMag = mag;
        peakRow = r;
        peakCol = c;
      }
      sumMag += mag;
      finiteCount += 1;
    }
  }

  if (finiteCount === 0) return null;

  const baseUnit = matrix.unit ?? (isTemp ? 'K' : '');
  const gradientUnit = hasPhysical
    ? baseUnit
      ? `${baseUnit === '°C' ? 'K' : baseUnit}/m`
      : '1/m'
    : baseUnit
      ? `${baseUnit}/L`
      : '1/L';

  const vectorLabel = k !== undefined ? 'Heat Flux Vectors (q = -k∇T)' : isTemp ? 'Thermal Gradient Flow (-∇T)' : `Negative Gradient (-∇${matrix.label})`;
  const vectorUnit = k !== undefined ? 'W/m²' : gradientUnit;

  return {
    cols,
    rows,
    widthM,
    heightM,
    physicalDimensions: hasPhysical,
    dx,
    dy,
    gradX,
    gradY,
    magnitude,
    vecX,
    vecY,
    minMag,
    maxMag,
    meanMag: sumMag / finiteCount,
    peakCoords: {
      x: peakCol * dx,
      y: peakRow * dy,
      row: peakRow,
      col: peakCol,
    },
    gradientUnit,
    vectorLabel,
    vectorUnit,
    conductivityUsed: k,
  };
}

/**
 * Extract real 2D orthographic projection of 3D vector fields returned by OpenFOAM (U)
 * or CalculiX (displacement) in vtk_data.vectors. Spatially bins overlapping 3D nodes
 * cleanly onto the selected plane without inventing data where no nodes exist.
 */
export function extractVtkProjectedVectors(
  vtkData: VtkFieldPayload | undefined,
  vectorKey: string,
  plane: ProjectionPlane = 'XY',
  maxBinsPerAxis = 22,
): ProjectedVtkVectorField | null {
  if (!vtkData || !Array.isArray(vtkData.points) || !vtkData.vectors) return null;
  const rawVec = vtkData.vectors[vectorKey];
  if (!Array.isArray(rawVec) || rawVec.length < 3 || vtkData.points.length < 3) return null;

  const count = Math.min(Math.floor(vtkData.points.length / 3), Math.floor(rawVec.length / 3));
  if (count === 0) return null;

  const uIdx = plane === 'YZ' ? 1 : 0;
  const vIdx = plane === 'XZ' ? 2 : plane === 'YZ' ? 2 : 1;
  const axisULabel = plane === 'YZ' ? 'y (m)' : 'x (m)';
  const axisVLabel = plane === 'XY' ? 'y (m)' : 'z (m)';

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let minMag = Infinity;
  let maxMag = -Infinity;
  let sumMag = 0;
  let validCount = 0;

  for (let i = 0; i < count; i++) {
    const base = i * 3;
    const u = vtkData.points[base + uIdx];
    const v = vtkData.points[base + vIdx];
    const vx = rawVec[base + uIdx];
    const vy = rawVec[base + vIdx];
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(vx) || !Number.isFinite(vy)) continue;
    const mag = Math.hypot(vx, vy);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    if (mag < minMag) minMag = mag;
    if (mag > maxMag) maxMag = mag;
    sumMag += mag;
    validCount += 1;
  }

  if (validCount === 0) return null;

  const uSpan = uMax - uMin || 1;
  const vSpan = vMax - vMin || 1;
  const bins = new Map<string, { uSum: number; vSum: number; vxSum: number; vySum: number; n: number }>();

  for (let i = 0; i < count; i++) {
    const base = i * 3;
    const u = vtkData.points[base + uIdx];
    const v = vtkData.points[base + vIdx];
    const vx = rawVec[base + uIdx];
    const vy = rawVec[base + vIdx];
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(vx) || !Number.isFinite(vy)) continue;
    const bu = Math.min(maxBinsPerAxis - 1, Math.max(0, Math.floor(((u - uMin) / uSpan) * maxBinsPerAxis)));
    const bv = Math.min(maxBinsPerAxis - 1, Math.max(0, Math.floor(((v - vMin) / vSpan) * maxBinsPerAxis)));
    const key = `${bu}_${bv}`;
    const entry = bins.get(key);
    if (entry) {
      entry.uSum += u;
      entry.vSum += v;
      entry.vxSum += vx;
      entry.vySum += vy;
      entry.n += 1;
    } else {
      bins.set(key, { uSum: u, vSum: v, vxSum: vx, vySum: vy, n: 1 });
    }
  }

  const samples: ProjectedVectorSample[] = [];
  bins.forEach((b) => {
    const vx = b.vxSum / b.n;
    const vy = b.vySum / b.n;
    samples.push({
      u: b.uSum / b.n,
      v: b.vSum / b.n,
      vx,
      vy,
      mag: Math.hypot(vx, vy),
    });
  });

  const lower = vectorKey.toLowerCase();
  const label =
    vectorKey === 'U' || lower.includes('vel')
      ? 'Velocity Vector Field (U)'
      : lower.includes('disp')
        ? 'Displacement Vector Field'
        : `${vectorKey} Vector Field`;
  const unit = vtkData.units?.[vectorKey] ?? (vectorKey === 'U' ? 'm/s' : lower.includes('disp') ? 'm' : '');

  return {
    key: vectorKey,
    label,
    unit,
    plane,
    axisULabel,
    axisVLabel,
    uMin,
    uMax,
    vMin,
    vMax,
    minMag,
    maxMag,
    meanMag: sumMag / validCount,
    nodeCount: validCount,
    samples,
  };
}

/**
 * Genuine Marching-Squares isocontour extractor on a real 2D scalar matrix.
 * Returns normalized coordinates in [0, 1] x [0, 1] (x left->right, y bottom->top).
 */
export function extractIsoContourSegments(data: number[][], levelsCount = 8): IsoSegment[] {
  const rows = data.length;
  const cols = data[0]?.length ?? 0;
  if (rows < 2 || cols < 2 || levelsCount < 1) return [];

  let minV = Infinity;
  let maxV = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = data[r][c];
      if (!Number.isFinite(val)) continue;
      if (val < minV) minV = val;
      if (val > maxV) maxV = val;
    }
  }
  if (!Number.isFinite(minV) || !Number.isFinite(maxV) || maxV - minV < 1e-12) return [];

  const segments: IsoSegment[] = [];
  const invCols = 1 / (cols - 1);
  const invRows = 1 / (rows - 1);

  for (let l = 1; l <= levelsCount; l++) {
    const iso = minV + ((maxV - minV) * l) / (levelsCount + 1);
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const v00 = data[r][c];
        const v10 = data[r][c + 1];
        const v11 = data[r + 1][c + 1];
        const v01 = data[r + 1][c];
        if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) {
          continue;
        }
        const crossings: [number, number][] = [];
        const interp = (a: number, b: number) => (b === a ? 0.5 : (iso - a) / (b - a));

        // Bottom edge (00 -> 10)
        if ((v00 < iso) !== (v10 < iso)) {
          crossings.push([(c + interp(v00, v10)) * invCols, r * invRows]);
        }
        // Right edge (10 -> 11)
        if ((v10 < iso) !== (v11 < iso)) {
          crossings.push([(c + 1) * invCols, (r + interp(v10, v11)) * invRows]);
        }
        // Top edge (01 -> 11)
        if ((v01 < iso) !== (v11 < iso)) {
          crossings.push([(c + interp(v01, v11)) * invCols, (r + 1) * invRows]);
        }
        // Left edge (00 -> 01)
        if ((v00 < iso) !== (v01 < iso)) {
          crossings.push([c * invCols, (r + interp(v00, v01)) * invRows]);
        }

        if (crossings.length === 2) {
          segments.push({
            x0: crossings[0][0],
            y0: crossings[0][1],
            x1: crossings[1][0],
            y1: crossings[1][1],
          });
        } else if (crossings.length === 4) {
          segments.push({
            x0: crossings[0][0],
            y0: crossings[0][1],
            x1: crossings[1][0],
            y1: crossings[1][1],
          });
          segments.push({
            x0: crossings[2][0],
            y0: crossings[2][1],
            x1: crossings[3][0],
            y1: crossings[3][1],
          });
        }
      }
    }
  }
  return segments;
}

export interface RenderPostMapOptions {
  canvas: HTMLCanvasElement;
  title: string;
  subtitle: string;
  palette: ColormapName;
  theme: 'dark' | 'light';
  showIsocontours: boolean;
  showVectors: boolean;
  vectorDensity: 'sparse' | 'medium' | 'dense';
  vectorScale: number;
  /** Scalar 2D grid to render as filled heatmap (either raw scalar or |grad T|) */
  scalarGrid?: {
    data: number[][];
    min: number;
    max: number;
    mean: number;
    unit: string;
    widthM: number;
    heightM: number;
    physicalDimensions: boolean;
    axisXLabel?: string;
    axisYLabel?: string;
  };
  /** Optional matrix-based vector overlay (e.g., heat flux -k*gradT) */
  matrixVectors?: {
    vecX: number[][];
    vecY: number[][];
    maxMag: number;
    unit: string;
  };
  /** Optional direct VTK 3D projected vector field (e.g., OpenFOAM U or CalculiX displacement) */
  vtkVectors?: ProjectedVtkVectorField;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  lineWidth: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1.5) return;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.min(Math.max(4, len * 0.34), 13 * (lineWidth / 1.5));

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

export interface PlotLayoutBox {
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
}

/**
 * Renders the calibrated publication-grade scientific post-processing map onto a canvas
 * (supports both interactive screen resolution and 2400x1500 300 DPI PNG export).
 */
export function renderPostProcessingCanvas(opts: RenderPostMapOptions): PlotLayoutBox | null {
  const { canvas, title, subtitle, palette, theme, showIsocontours, showVectors, vectorDensity, vectorScale } = opts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const W = canvas.width;
  const H = canvas.height;
  const scale = W / 960;

  const isLight = theme === 'light';
  const bg = isLight ? '#ffffff' : '#0b1120';
  const panelBg = isLight ? '#f8fafc' : '#0f172a';
  const fg = isLight ? '#0f172a' : '#f1f5f9';
  const muted = isLight ? '#475569' : '#94a3b8';
  const gridBorder = isLight ? '#cbd5e1' : '#334155';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  const padLeft = Math.round(78 * scale);
  const padTop = Math.round(64 * scale);
  const padRight = Math.round(126 * scale);
  const padBottom = Math.round(68 * scale);
  const availW = Math.max(120, W - padLeft - padRight);
  const availH = Math.max(120, H - padTop - padBottom);

  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.round(16 * scale)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(title, padLeft, Math.round(28 * scale));

  ctx.fillStyle = muted;
  ctx.font = `${Math.round(11.5 * scale)}px Consolas, ui-monospace, monospace`;
  ctx.fillText(subtitle, padLeft, Math.round(47 * scale));

  // Determine physical aspect ratio
  let xMin = 0;
  let xMax = 1;
  let yMin = 0;
  let yMax = 1;
  let axisXLabel = 'x (m)';
  let axisYLabel = 'y (m)';
  let legendMin = 0;
  let legendMax = 1;
  let legendUnit = '';

  if (opts.scalarGrid) {
    xMin = 0;
    xMax = opts.scalarGrid.widthM;
    yMin = 0;
    yMax = opts.scalarGrid.heightM;
    axisXLabel = opts.scalarGrid.axisXLabel ?? (opts.scalarGrid.physicalDimensions ? 'x (m)' : 'x / Lx');
    axisYLabel = opts.scalarGrid.axisYLabel ?? (opts.scalarGrid.physicalDimensions ? 'y (m)' : 'y / Ly');
    legendMin = opts.scalarGrid.min;
    legendMax = opts.scalarGrid.max;
    legendUnit = opts.scalarGrid.unit;
  } else if (opts.vtkVectors) {
    xMin = opts.vtkVectors.uMin;
    xMax = opts.vtkVectors.uMax;
    yMin = opts.vtkVectors.vMin;
    yMax = opts.vtkVectors.vMax;
    axisXLabel = opts.vtkVectors.axisULabel;
    axisYLabel = opts.vtkVectors.axisVLabel;
    legendMin = opts.vtkVectors.minMag;
    legendMax = opts.vtkVectors.maxMag;
    legendUnit = opts.vtkVectors.unit;
  }

  const physAspect = Math.max(0.3, Math.min(3.4, (xMax - xMin || 1) / (yMax - yMin || 1)));
  let plotW = availW;
  let plotH = plotW / physAspect;
  if (plotH > availH) {
    plotH = availH;
    plotW = plotH * physAspect;
  }
  const plotX = padLeft + Math.round((availW - plotW) / 2);
  const plotY = padTop + Math.round((availH - plotH) / 2);

  // Plot canvas background
  ctx.fillStyle = panelBg;
  ctx.fillRect(plotX, plotY, plotW, plotH);

  // 1. Render scalar or gradient field via smooth offscreen pixel rasterization
  if (opts.scalarGrid) {
    const { data, min, max } = opts.scalarGrid;
    const rows = data.length;
    const cols = data[0]?.length ?? 0;
    const span = max - min || 1;

    if (rows > 0 && cols > 0) {
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        const img = offCtx.createImageData(cols, rows);
        for (let r = 0; r < rows; r++) {
          const canvasRow = rows - 1 - r;
          for (let c = 0; c < cols; c++) {
            const val = data[r][c];
            const idx = (canvasRow * cols + c) * 4;
            if (!Number.isFinite(val)) {
              img.data[idx + 3] = 0;
              continue;
            }
            const [red, green, blue] = sampleColormap((val - min) / span, palette);
            img.data[idx] = red;
            img.data[idx + 1] = green;
            img.data[idx + 2] = blue;
            img.data[idx + 3] = 255;
          }
        }
        offCtx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, plotX, plotY, plotW, plotH);
      }

      // 2. Real Marching-Squares Isocontours / Isotherms
      if (showIsocontours) {
        const segments = extractIsoContourSegments(data, 9);
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.42)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(0.9, 1.0 * scale);
        ctx.beginPath();
        for (const s of segments) {
          ctx.moveTo(plotX + s.x0 * plotW, plotY + (1 - s.y0) * plotH);
          ctx.lineTo(plotX + s.x1 * plotW, plotY + (1 - s.y1) * plotH);
        }
        ctx.stroke();
      }
    }
  }

  // 3. Matrix-based vector overlay (Fourier heat flux q = -k*gradT or -gradPhi)
  if (showVectors && opts.matrixVectors && opts.scalarGrid) {
    const { vecX, vecY, maxMag } = opts.matrixVectors;
    const rows = vecX.length;
    const cols = vecX[0]?.length ?? 0;
    const targetCount = vectorDensity === 'dense' ? 20 : vectorDensity === 'medium' ? 14 : 9;
    const stepR = Math.max(1, Math.floor(rows / targetCount));
    const stepC = Math.max(1, Math.floor(cols / targetCount));
    const baseArrowLen = (Math.min(plotW, plotH) / targetCount) * 0.72 * vectorScale;

    if (maxMag > 1e-12 && rows > 1 && cols > 1) {
      for (let r = Math.floor(stepR / 2); r < rows; r += stepR) {
        for (let c = Math.floor(stepC / 2); c < cols; c += stepC) {
          const vx = vecX[r][c];
          const vy = vecY[r][c];
          if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
          const mag = Math.hypot(vx, vy);
          if (mag < maxMag * 0.02) continue;
          const cx = plotX + (c / (cols - 1)) * plotW;
          const cy = plotY + (1 - r / (rows - 1)) * plotH;
          const len = baseArrowLen * (0.35 + 0.65 * (mag / maxMag));
          const ux = vx / mag;
          const uy = vy / mag;
          const arrowColor = isLight ? 'rgba(15, 23, 42, 0.88)' : 'rgba(248, 250, 252, 0.92)';
          drawArrow(
            ctx,
            cx - ux * len * 0.4,
            cy + uy * len * 0.4,
            cx + ux * len * 0.6,
            cy - uy * len * 0.6,
            arrowColor,
            Math.max(1.2, 1.35 * scale),
          );
        }
      }
    }
  }

  // 4. Direct 3D VTK Solver Vector Field (OpenFOAM U / CalculiX displacement)
  if (opts.vtkVectors) {
    const vf = opts.vtkVectors;
    const uSpan = vf.uMax - vf.uMin || 1;
    const vSpan = vf.vMax - vf.vMin || 1;
    const magSpan = vf.maxMag - vf.minMag || 1;

    // Subtle coordinate grid on vector-only canvas
    if (!opts.scalarGrid) {
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(51, 65, 85, 0.55)';
      ctx.lineWidth = Math.max(0.8, 0.8 * scale);
      for (let i = 1; i < 5; i++) {
        const gx = plotX + (plotW * i) / 5;
        const gy = plotY + (plotH * i) / 5;
        ctx.beginPath();
        ctx.moveTo(gx, plotY);
        ctx.lineTo(gx, plotY + plotH);
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.stroke();
      }
    }

    const stride = vectorDensity === 'dense' ? 1 : vectorDensity === 'medium' ? 2 : 3;
    const baseLen = Math.min(plotW, plotH) * 0.048 * vectorScale;

    vf.samples.forEach((s, idx) => {
      if (idx % stride !== 0) return;
      if (s.mag < vf.maxMag * 0.005) return;
      const px = plotX + ((s.u - vf.uMin) / uSpan) * plotW;
      const py = plotY + (1 - (s.v - vf.vMin) / vSpan) * plotH;
      const norm = (s.mag - vf.minMag) / magSpan;
      const len = baseLen * (0.35 + 0.85 * norm);
      const ux = s.vx / s.mag;
      const uy = s.vy / s.mag;
      const [r, g, b] = sampleColormap(norm, palette);
      const color = opts.scalarGrid
        ? isLight
          ? 'rgba(15, 23, 42, 0.88)'
          : 'rgba(248, 250, 252, 0.92)'
        : `rgb(${r},${g},${b})`;
      drawArrow(
        ctx,
        px - ux * len * 0.35,
        py + uy * len * 0.35,
        px + ux * len * 0.65,
        py - uy * len * 0.65,
        color,
        Math.max(1.3, 1.55 * scale),
      );
    });
  }

  // Plot frame & physical axis ticks
  ctx.strokeStyle = gridBorder;
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.strokeRect(plotX, plotY, plotW, plotH);

  ctx.fillStyle = muted;
  ctx.font = `${Math.round(10.5 * scale)}px Consolas, ui-monospace, monospace`;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const tx = plotX + frac * plotW;
    const xVal = xMin + frac * (xMax - xMin);
    ctx.beginPath();
    ctx.moveTo(tx, plotY + plotH);
    ctx.lineTo(tx, plotY + plotH + 5 * scale);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(formatNumber(xVal), tx, plotY + plotH + 18 * scale);

    const ty = plotY + (1 - frac) * plotH;
    const yVal = yMin + frac * (yMax - yMin);
    ctx.beginPath();
    ctx.moveTo(plotX - 5 * scale, ty);
    ctx.lineTo(plotX, ty);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(formatNumber(yVal), plotX - 9 * scale, ty + 3.5 * scale);
  }

  // Axis labels
  ctx.fillStyle = fg;
  ctx.font = `500 ${Math.round(11.5 * scale)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(axisXLabel, plotX + plotW / 2, plotY + plotH + 38 * scale);

  ctx.save();
  ctx.translate(Math.round(22 * scale), plotY + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(axisYLabel, 0, 0);
  ctx.restore();

  // Calibrated Colorbar Legend
  const barX = plotX + plotW + Math.round(22 * scale);
  const barW = Math.round(18 * scale);
  const barH = plotH;
  const barY = plotY;
  for (let py = 0; py < barH; py++) {
    const t = 1 - py / Math.max(1, barH - 1);
    const [r, g, b] = sampleColormap(t, palette);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(barX, barY + py, barW, 1.5);
  }
  ctx.strokeStyle = gridBorder;
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.round(10.5 * scale)}px Consolas, ui-monospace, monospace`;
  ctx.textAlign = 'left';
  if (legendUnit) {
    ctx.fillText(legendUnit, barX, barY - 8 * scale);
  }
  ctx.fillStyle = muted;
  ctx.font = `${Math.round(10.5 * scale)}px Consolas, ui-monospace, monospace`;
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const val = legendMin + frac * (legendMax - legendMin);
    const ly = barY + (1 - frac) * barH;
    ctx.fillText(formatNumber(val), barX + barW + 7 * scale, ly + 3.5 * scale);
  }

  return { plotX, plotY, plotW, plotH };
}

export interface VtkSurfaceGradientResult {
  values: number[];
  min: number;
  max: number;
  mean: number;
  validTriangles: number;
}

/**
 * Computes exact per-vertex tangential surface gradient magnitude |∇_s φ| directly on a real
 * triangulated 3D VTK surface mesh using linear P1 triangle elements area-averaged to nodes.
 * Zero-Mock: operates strictly on real physical coordinates (meters) and solver nodal scalars.
 */
export function computeVtkSurfaceGradientMagnitude(
  points: number[],
  triangles: number[],
  scalars: number[],
): VtkSurfaceGradientResult | null {
  if (!Array.isArray(points) || !Array.isArray(triangles) || !Array.isArray(scalars)) return null;
  const vertexCount = Math.min(Math.floor(points.length / 3), scalars.length);
  if (vertexCount < 3 || triangles.length < 3) return null;

  const gxSum = new Float64Array(vertexCount);
  const gySum = new Float64Array(vertexCount);
  const gzSum = new Float64Array(vertexCount);
  const areaSum = new Float64Array(vertexCount);
  let validTriangles = 0;

  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;

    const sa = scalars[a];
    const sb = scalars[b];
    const sc = scalars[c];
    if (!Number.isFinite(sa) || !Number.isFinite(sb) || !Number.isFinite(sc)) continue;

    const ax = points[a * 3];
    const ay = points[a * 3 + 1];
    const az = points[a * 3 + 2];
    const e1x = points[b * 3] - ax;
    const e1y = points[b * 3 + 1] - ay;
    const e1z = points[b * 3 + 2] - az;
    const e2x = points[c * 3] - ax;
    const e2y = points[c * 3 + 1] - ay;
    const e2z = points[c * 3 + 2] - az;

    // Triangle normal N = e1 x e2, |N| = 2 * Area
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const twoArea = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(twoArea) || twoArea < 1e-14) continue;

    const invTwoArea = 1 / twoArea;
    const unx = nx * invTwoArea;
    const uny = ny * invTwoArea;
    const unz = nz * invTwoArea;

    // Area-weighted tangential gradient:
    // A * g = 0.5 * [ (sc - sa) * (n_hat x e1) - (sb - sa) * (n_hat x e2) ]
    const nxe1x = uny * e1z - unz * e1y;
    const nxe1y = unz * e1x - unx * e1z;
    const nxe1z = unx * e1y - uny * e1x;

    const nxe2x = uny * e2z - unz * e2y;
    const nxe2y = unz * e2x - unx * e2z;
    const nxe2z = unx * e2y - uny * e2x;

    const d1 = sb - sa;
    const d2 = sc - sa;
    const wgx = 0.5 * (d2 * nxe1x - d1 * nxe2x);
    const wgy = 0.5 * (d2 * nxe1y - d1 * nxe2y);
    const wgz = 0.5 * (d2 * nxe1z - d1 * nxe2z);
    const area = 0.5 * twoArea;

    gxSum[a] += wgx;
    gySum[a] += wgy;
    gzSum[a] += wgz;
    areaSum[a] += area;

    gxSum[b] += wgx;
    gySum[b] += wgy;
    gzSum[b] += wgz;
    areaSum[b] += area;

    gxSum[c] += wgx;
    gySum[c] += wgy;
    gzSum[c] += wgz;
    areaSum[c] += area;

    validTriangles += 1;
  }

  if (validTriangles === 0) return null;

  const values = new Array<number>(vertexCount);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < vertexCount; i++) {
    const aSum = areaSum[i];
    if (aSum > 1e-18) {
      const mag = Math.hypot(gxSum[i], gySum[i], gzSum[i]) / aSum;
      values[i] = mag;
      if (mag < min) min = mag;
      if (mag > max) max = mag;
      sum += mag;
      count += 1;
    } else {
      values[i] = 0;
    }
  }

  if (count === 0 || !Number.isFinite(min) || !Number.isFinite(max)) return null;

  return {
    values,
    min,
    max,
    mean: sum / count,
    validTriangles,
  };
}

export interface Export3DSnapshotOptions {
  webglCanvas: HTMLCanvasElement;
  title: string;
  subtitle: string;
  filename: string;
  legend?: {
    label: string;
    min: number;
    max: number;
    unit: string;
    sampleColor: (t: number) => [number, number, number];
  };
}

/**
 * Composites a freshly-rendered WebGL 3D canvas onto a high-resolution (2400x1500) publication
 * PNG complete with header metadata and calibrated vertical colorbar legend.
 */
export async function exportWebGLSnapshotPng(opts: Export3DSnapshotOptions): Promise<void> {
  const { webglCanvas, title, subtitle, filename, legend } = opts;
  const W = 2400;
  const H = 1500;
  const offscreen = document.createElement('canvas');
  offscreen.width = W;
  offscreen.height = H;
  const ctx = offscreen.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D export canvas.');

  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, W, H);

  const headerH = 128;
  const footerH = 56;
  const legendW = legend ? 290 : 48;
  const padX = 48;
  const viewX = padX;
  const viewY = headerH;
  const viewW = W - padX - legendW;
  const viewH = H - headerH - footerH;

  // Header
  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 38px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, padX, 58);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '24px Consolas, ui-monospace, monospace';
  ctx.fillText(subtitle, padX, 98);

  // Frame + aspect-preserving WebGL capture
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(viewX, viewY, viewW, viewH);

  const srcW = Math.max(1, webglCanvas.width);
  const srcH = Math.max(1, webglCanvas.height);
  const scale = Math.min(viewW / srcW, viewH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const drawX = viewX + (viewW - drawW) / 2;
  const drawY = viewY + (viewH - drawH) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(webglCanvas, drawX, drawY, drawW, drawH);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(viewX, viewY, viewW, viewH);

  // Calibrated Colorbar Legend
  if (legend) {
    const barX = viewX + viewW + 46;
    const barY = viewY + 90;
    const barW = 42;
    const barH = viewH - 180;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 24px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(legend.label, barX, viewY + 34);

    if (legend.unit) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 22px Consolas, ui-monospace, monospace';
      ctx.fillText(`[${legend.unit}]`, barX, viewY + 68);
    }

    for (let py = 0; py < barH; py++) {
      const t = 1 - py / Math.max(1, barH - 1);
      const [r, g, b] = legend.sampleColor(t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(barX, barY + py, barW, 2);
    }
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '22px Consolas, ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const val = legend.min + frac * (legend.max - legend.min);
      const ly = barY + (1 - frac) * barH;
      ctx.fillText(formatNumber(val), barX + barW + 16, ly + 8);
    }
  }

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '20px Consolas, ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('NASEER Universal CAE Studio · WebGL 3D Post-Processing Snapshot (Zero-Mock VTK)', padX, H - 18);

  const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png', 1.0));
  if (!blob) throw new Error('Unable to encode 3D PNG snapshot.');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports a 2400x1500 (~300 DPI for A4/Journal width) PNG directly from the real solver data.
 */
export async function exportHighResPostMapPng(
  options: Omit<RenderPostMapOptions, 'canvas'>,
  filename: string,
): Promise<void> {
  const offscreen = document.createElement('canvas');
  offscreen.width = 2400;
  offscreen.height = 1500;
  renderPostProcessingCanvas({ ...options, canvas: offscreen });

  const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png', 1.0));
  if (!blob) throw new Error('Unable to encode PNG image from canvas.');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
