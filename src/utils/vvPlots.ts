import { MeshStudyResult, ReferenceDataSet } from '../types/thesis';
import { formatNumber } from './numberFormat';
import { Comparison, SampledProfile } from './validationMetrics';

// SVG generators shared by the on-screen tabs (dark) and the exported reports (light), so both show
// exactly the same figure. All text is escaped; the strings are safe to embed as markup.

export type PlotTheme = 'dark' | 'light';

const PALETTE = {
  dark: { plot: '#0b1220', frame: '#334155', grid: '#1e293b', text: '#94a3b8', title: '#e2e8f0', sim: '#38bdf8', ref: '#f43f5e', halo: '#0b1220', ext: '#34d399' },
  light: { plot: '#f8fafc', frame: '#94a3b8', grid: '#e2e8f0', text: '#475569', title: '#0f172a', sim: '#0369a1', ref: '#dc2626', halo: '#ffffff', ext: '#047857' },
} as const;

const FONT = "'Segoe UI', Arial, sans-serif";

const esc = (value: unknown): string =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "Nice" axis ticks covering [min, max].
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) return [min];
  const rough = (max - min) / Math.max(1, target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step - 1e-9) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const plotWidth = (f: Frame) => f.width - f.left - f.right;
const plotHeight = (f: Frame) => f.height - f.top - f.bottom;
const mapX = (f: Frame, x: number) => f.left + ((x - f.x0) / (f.x1 - f.x0 || 1)) * plotWidth(f);
const mapY = (f: Frame, y: number) => f.top + ((f.y1 - y) / (f.y1 - f.y0 || 1)) * plotHeight(f);

function axes(f: Frame, theme: PlotTheme, xLabel: string, yLabel: string, title: string): string {
  const c = PALETTE[theme];
  const xTicks = niceTicks(f.x0, f.x1, 6);
  const yTicks = niceTicks(f.y0, f.y1, 5);
  return (
    `<text x="${f.left}" y="22" font-size="13" font-weight="bold" fill="${c.title}">${esc(title)}</text>` +
    `<rect x="${f.left}" y="${f.top}" width="${plotWidth(f)}" height="${plotHeight(f)}" fill="${c.plot}" stroke="${c.frame}"/>` +
    yTicks
      .map((t) => {
        const y = mapY(f, t).toFixed(1);
        return `<line x1="${f.left}" y1="${y}" x2="${f.left + plotWidth(f)}" y2="${y}" stroke="${c.grid}" stroke-dasharray="3 3"/>` +
          `<text x="${f.left - 7}" y="${(mapY(f, t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${c.text}">${esc(formatNumber(t))}</text>`;
      })
      .join('') +
    xTicks
      .map((t) => {
        const x = mapX(f, t).toFixed(1);
        return `<line x1="${x}" y1="${f.top + plotHeight(f)}" x2="${x}" y2="${f.top + plotHeight(f) + 4}" stroke="${c.frame}"/>` +
          `<text x="${x}" y="${f.top + plotHeight(f) + 16}" text-anchor="middle" font-size="10" fill="${c.text}">${esc(formatNumber(t))}</text>`;
      })
      .join('') +
    `<text x="${f.left + plotWidth(f) / 2}" y="${f.height - 8}" text-anchor="middle" font-size="11" fill="${c.title}">${esc(xLabel)}</text>` +
    `<text x="14" y="${f.top + plotHeight(f) / 2}" text-anchor="middle" font-size="11" fill="${c.title}" transform="rotate(-90 14 ${f.top + plotHeight(f) / 2})">${esc(yLabel)}</text>`
  );
}

function svgOpen(f: Frame, theme: PlotTheme): string {
  const background = theme === 'light' ? ' style="background:#ffffff"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.width} ${f.height}" width="${f.width}" height="${f.height}" font-family="${FONT}"${background}>`;
}

const pad = (min: number, max: number, fraction = 0.12) => {
  const span = max - min || Math.abs(max) || 1;
  return [min - span * fraction, max + span * fraction] as const;
};

/** Key result against relative cell size, with the Richardson-extrapolated value and the fine-grid uncertainty. */
export function meshConvergenceSvg(study: MeshStudyResult, theme: PlotTheme = 'light'): string {
  const levels = study.levels.filter((l) => l.relative_size !== null && Number.isFinite(l.key_result));
  if (levels.length < 3) return '';
  const c = PALETTE[theme];
  const values = levels.map((l) => l.key_result);
  const extrapolated = study.extrapolated_value;
  const uncertainty = study.uncertainty_fine;
  const fine = levels.find((l) => l.level === 'fine');
  const lows = [...values, ...(extrapolated !== null ? [extrapolated] : []), ...(fine && uncertainty ? [fine.key_result - uncertainty] : [])];
  const highs = [...values, ...(extrapolated !== null ? [extrapolated] : []), ...(fine && uncertainty ? [fine.key_result + uncertainty] : [])];
  const [y0, y1] = pad(Math.min(...lows), Math.max(...highs));
  const xMax = Math.max(...levels.map((l) => l.relative_size as number)) * 1.08;
  const f: Frame = { width: 680, height: 330, left: 84, right: 28, top: 38, bottom: 56, x0: -xMax * 0.04, x1: xMax, y0, y1 };

  const ordered = [...levels].sort((a, b) => (a.relative_size as number) - (b.relative_size as number));
  const line = ordered.map((l) => `${mapX(f, l.relative_size as number).toFixed(1)},${mapY(f, l.key_result).toFixed(1)}`).join(' ');
  let body = axes(
    f,
    theme,
    'Relative cell size h / h_fine  (finer → left)',
    `${study.key_result.label}${study.key_result.unit ? ` (${study.key_result.unit})` : ''}`,
    `${study.key_result.label} vs. mesh size`,
  );
  if (extrapolated !== null && fine) {
    body += `<line x1="${mapX(f, 0).toFixed(1)}" y1="${mapY(f, extrapolated).toFixed(1)}" x2="${mapX(f, fine.relative_size as number).toFixed(1)}" y2="${mapY(f, fine.key_result).toFixed(1)}" stroke="${c.ext}" stroke-dasharray="5 4"/>`;
  }
  body += `<polyline points="${line}" fill="none" stroke="${c.sim}" stroke-width="2"/>`;
  if (fine && uncertainty) {
    const x = mapX(f, fine.relative_size as number).toFixed(1);
    body +=
      `<line x1="${x}" y1="${mapY(f, fine.key_result + uncertainty).toFixed(1)}" x2="${x}" y2="${mapY(f, fine.key_result - uncertainty).toFixed(1)}" stroke="${c.ref}" stroke-width="2"/>` +
      `<line x1="${Number(x) - 5}" y1="${mapY(f, fine.key_result + uncertainty).toFixed(1)}" x2="${Number(x) + 5}" y2="${mapY(f, fine.key_result + uncertainty).toFixed(1)}" stroke="${c.ref}" stroke-width="2"/>` +
      `<line x1="${Number(x) - 5}" y1="${mapY(f, fine.key_result - uncertainty).toFixed(1)}" x2="${Number(x) + 5}" y2="${mapY(f, fine.key_result - uncertainty).toFixed(1)}" stroke="${c.ref}" stroke-width="2"/>`;
  }
  for (const l of ordered) {
    const x = mapX(f, l.relative_size as number);
    body += `<circle cx="${x.toFixed(1)}" cy="${mapY(f, l.key_result).toFixed(1)}" r="4.5" fill="${c.sim}" stroke="${c.halo}" stroke-width="1"/>` +
      `<text x="${x.toFixed(1)}" y="${f.top + plotHeight(f) + 30}" text-anchor="middle" font-size="9" fill="${c.text}">${esc(l.level)}</text>`;
  }
  if (extrapolated !== null) {
    body += `<circle cx="${mapX(f, 0).toFixed(1)}" cy="${mapY(f, extrapolated).toFixed(1)}" r="5" fill="none" stroke="${c.ext}" stroke-width="2"/>` +
      `<text x="${(mapX(f, 0) + 10).toFixed(1)}" y="${(mapY(f, extrapolated) - 8).toFixed(1)}" font-size="10" fill="${c.ext}">extrapolated (h → 0)</text>`;
  }
  return `${svgOpen(f, theme)}${body}</svg>`;
}

/**
 * Simulated profile, optionally overlaid on the user's reference points (out-of-range points are drawn hollow).
 * Without reference data it draws the profile alone, so a cut location can be previewed.
 */
export function validationOverlaySvg(
  profile: SampledProfile,
  reference?: ReferenceDataSet,
  comparison?: Comparison,
  theme: PlotTheme = 'light',
): string {
  const c = PALETTE[theme];
  const refPoints = reference?.points ?? [];
  const xs = [...profile.points.map((p) => p.s), ...refPoints.map((p) => p.x)];
  const ys = [...profile.points.map((p) => p.value), ...refPoints.map((p) => p.y)];
  if (xs.length === 0) return '';
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys), 0.1);
  const xSpan = Math.max(...xs) - Math.min(...xs) || 1;
  const f: Frame = { width: 680, height: 340, left: 84, right: 28, top: 38, bottom: 56, x0: Math.min(...xs) - xSpan * 0.02, x1: Math.max(...xs) + xSpan * 0.02, y0, y1 };

  const path = profile.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${mapX(f, p.s).toFixed(1)},${mapY(f, p.value).toFixed(1)}`).join(' ');
  const outOfRange = new Set((comparison?.rows ?? []).map((row, i) => (row.status === 'out-of-range' ? i : -1)).filter((i) => i >= 0));
  let body = axes(f, theme, profile.abscissaLabel, profile.valueLabel, reference ? `Simulation vs. ${reference.label}` : profile.description);
  body += `<path d="${path}" fill="none" stroke="${c.sim}" stroke-width="2"/>`;
  refPoints.forEach((p, i) => {
    const cx = mapX(f, p.x).toFixed(1);
    const cy = mapY(f, p.y).toFixed(1);
    body += outOfRange.has(i)
      ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="none" stroke="${c.ref}" stroke-width="1.6"/>`
      : `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${c.ref}" stroke="${c.halo}" stroke-width="1"/>`;
  });
  const lx = f.left + 10;
  body += `<line x1="${lx}" y1="${f.top + 14}" x2="${lx + 20}" y2="${f.top + 14}" stroke="${c.sim}" stroke-width="2"/>` +
    `<text x="${lx + 26}" y="${f.top + 18}" font-size="10" fill="${c.text}">Simulation</text>`;
  if (reference) {
    body += `<circle cx="${lx + 10}" cy="${f.top + 32}" r="4.5" fill="${c.ref}" stroke="${c.halo}" stroke-width="1"/>` +
      `<text x="${lx + 26}" y="${f.top + 36}" font-size="10" fill="${c.text}">${esc(reference.label)}</text>`;
  }
  if (outOfRange.size) {
    body += `<circle cx="${lx + 10}" cy="${f.top + 50}" r="4.5" fill="none" stroke="${c.ref}" stroke-width="1.6"/>` +
      `<text x="${lx + 26}" y="${f.top + 54}" font-size="10" fill="${c.text}">outside the simulated cut (not compared)</text>`;
  }
  return `${svgOpen(f, theme)}${body}</svg>`;
}
