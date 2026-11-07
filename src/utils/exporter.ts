import { ThesisProject } from '../types/thesis';
import { meshStudyVerdict } from './meshStudyVerdict';
import { meshConvergenceSvg, validationOverlaySvg } from './vvPlots';
import {
  AI_ASSISTANT_LABEL,
  AI_ASSISTANT_NAME,
  ExportUnavailableError,
  PLATFORM_NAME,
  RealReport,
  ReportMatrix,
  ReportRow,
  ReportSeries,
  buildRealReport,
  formatNumber,
  hasRealSimulationRun,
} from './reportModel';

export { ExportUnavailableError, hasRealSimulationRun };

// ---------------------------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------------------------

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const safeFileStem = (project: ThesisProject): string =>
  `${String(project.id || 'project').replace(/[^A-Za-z0-9_-]+/g, '_')}_NASEER_CAE_report`;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const SERIES_COLORS = ['#0369a1', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2'];

/**
 * Log-scale residual plot of the REAL residual series reported by the solver backend.
 * Mirrors the live console chart (data-driven axes, only positive finite samples).
 * Returns an empty string when the run reported no plottable history, so callers never
 * show an invented curve.
 */
export function generateResidualsPlotSvg(series: ReportSeries[]): string {
  const plottable = series
    .map((item, index) => ({
      name: item.name,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      points: item.points.filter((point) => Number.isFinite(point.iteration) && Number.isFinite(point.value) && point.value > 0),
    }))
    .filter((item) => item.points.length >= 2);
  if (plottable.length === 0) return '';

  const allPoints = plottable.flatMap((item) => item.points);
  const minIteration = Math.min(...allPoints.map((point) => point.iteration));
  const maxIteration = Math.max(...allPoints.map((point) => point.iteration));
  const logs = allPoints.map((point) => Math.log10(point.value));
  const topPower = Math.ceil(Math.max(...logs));
  let bottomPower = Math.floor(Math.min(...logs));
  if (bottomPower === topPower) bottomPower = topPower - 1;

  const width = 680;
  const height = 320;
  const left = 78;
  const right = 22;
  const top = 50;
  const bottom = 50;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const toX = (iteration: number) => left + ((iteration - minIteration) / (maxIteration - minIteration || 1)) * plotWidth;
  const toY = (value: number) => top + ((topPower - Math.log10(value)) / (topPower - bottomPower)) * plotHeight;

  const step = Math.max(1, Math.ceil((topPower - bottomPower) / 6));
  const grid: string[] = [];
  for (let power = topPower; power >= bottomPower; power -= step) {
    const y = top + ((topPower - power) / (topPower - bottomPower)) * plotHeight;
    grid.push(
      `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="#cbd5e1" stroke-dasharray="3 3"/>` +
        `<text x="${left - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#475569">1e${power}</text>`,
    );
  }
  const xTicks = Array.from({ length: 5 }, (_, index) => Math.round(minIteration + ((maxIteration - minIteration) * index) / 4));
  const xLabels = xTicks
    .map(
      (tick) =>
        `<line x1="${toX(tick).toFixed(1)}" y1="${top + plotHeight}" x2="${toX(tick).toFixed(1)}" y2="${top + plotHeight + 4}" stroke="#475569"/>` +
        `<text x="${toX(tick).toFixed(1)}" y="${top + plotHeight + 17}" text-anchor="middle" font-size="10" fill="#475569">${tick}</text>`,
    )
    .join('');
  const paths = plottable
    .map(
      (item) =>
        `<path d="${item.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.iteration).toFixed(2)} ${toY(point.value).toFixed(2)}`).join(' ')}" fill="none" stroke="${item.color}" stroke-width="1.8" stroke-linejoin="round"/>`,
    )
    .join('');
  const legend = plottable
    .map(
      (item, index) =>
        `<line x1="${left + index * 120}" y1="26" x2="${left + index * 120 + 18}" y2="26" stroke="${item.color}" stroke-width="2.5"/>` +
        `<text x="${left + index * 120 + 24}" y="30" font-size="11" fill="#0f172a">${esc(item.name)}</text>`,
    )
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#ffffff;font-family:'Segoe UI',Arial,sans-serif;">` +
    `<rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="#f8fafc" stroke="#94a3b8"/>` +
    grid.join('') +
    paths +
    xLabels +
    legend +
    `<text x="${left + plotWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#0f172a">Iteration (solver log sample)</text>` +
    `<text x="16" y="${top + plotHeight / 2}" text-anchor="middle" font-size="11" fill="#0f172a" transform="rotate(-90 16 ${top + plotHeight / 2})">Residual (log scale)</text>` +
    `</svg>`
  );
}

interface RenderedImage {
  src: string;
  width: number;
  height: number;
}

/** Rasterises a real result matrix (row 0 = y = 0, drawn at the bottom) with a labelled colour bar. */
export function renderMatrixToImage(matrix: ReportMatrix): RenderedImage | undefined {
  try {
    if (typeof document === 'undefined') return undefined;
    const left = 62;
    const top = 40;
    const bottom = 50;
    const barGap = 24;
    const barWidth = 16;
    const labelWidth = 92;
    const maxDimension = 420;
    const aspect = matrix.widthM && matrix.heightM ? matrix.heightM / matrix.widthM : matrix.rows / matrix.cols;
    const plotWidth = Math.max(80, Math.round(aspect >= 1 ? maxDimension / aspect : maxDimension));
    const plotHeight = Math.max(80, Math.round(aspect >= 1 ? maxDimension : maxDimension * aspect));
    const width = left + plotWidth + barGap + barWidth + labelWidth;
    const height = top + plotHeight + bottom;
    const scale = 2;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const range = matrix.max - matrix.min || 1;
    // Same blue→red hue sweep as the live viewport heatmap.
    const colorOf = (value: number) => `hsl(${(1 - Math.min(1, Math.max(0, (value - matrix.min) / range))) * 240}, 100%, 50%)`;

    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(left, top, plotWidth, plotHeight);
    for (let r = 0; r < matrix.rows; r++) {
      const y0 = Math.floor(top + plotHeight - ((r + 1) * plotHeight) / matrix.rows);
      const y1 = Math.ceil(top + plotHeight - (r * plotHeight) / matrix.rows);
      for (let c = 0; c < matrix.cols; c++) {
        const value = matrix.data[r][c];
        if (!Number.isFinite(value)) continue;
        const x0 = Math.floor(left + (c * plotWidth) / matrix.cols);
        const x1 = Math.ceil(left + ((c + 1) * plotWidth) / matrix.cols);
        ctx.fillStyle = colorOf(value);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, plotWidth, plotHeight);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${matrix.label}${matrix.unit ? ` [${matrix.unit}]` : ''}`, left, 24);

    ctx.font = '11px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    const lx = matrix.widthM !== undefined ? `${formatNumber(matrix.widthM)} m` : `${matrix.cols - 1}`;
    const ly = matrix.heightM !== undefined ? `${formatNumber(matrix.heightM)} m` : `${matrix.rows - 1}`;
    ctx.fillText('0', left, top + plotHeight + 15);
    ctx.fillText(lx, left + plotWidth, top + plotHeight + 15);
    ctx.fillText(matrix.widthM !== undefined ? 'x [m]' : 'x (node index)', left + plotWidth / 2, top + plotHeight + 30);
    ctx.textAlign = 'right';
    ctx.fillText('0', left - 6, top + plotHeight);
    ctx.fillText(ly, left - 6, top + 10);
    ctx.save();
    ctx.translate(14, top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(matrix.heightM !== undefined ? 'y [m]' : 'y (node index)', 0, 0);
    ctx.restore();

    const barX = left + plotWidth + barGap;
    for (let i = 0; i < plotHeight; i++) {
      ctx.fillStyle = colorOf(matrix.max - (i / (plotHeight - 1 || 1)) * (matrix.max - matrix.min));
      ctx.fillRect(barX, top + i, barWidth, 1);
    }
    ctx.strokeRect(barX + 0.5, top + 0.5, barWidth, plotHeight);
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.fillText(formatNumber(matrix.max), barX + barWidth + 6, top + 10);
    ctx.fillText(formatNumber((matrix.max + matrix.min) / 2), barX + barWidth + 6, top + plotHeight / 2 + 4);
    ctx.fillText(formatNumber(matrix.min), barX + barWidth + 6, top + plotHeight);

    return { src: canvas.toDataURL('image/png'), width, height };
  } catch (error) {
    console.error('Result field rendering failed:', error);
    return undefined;
  }
}

function utf8ToBase64(text: string): string {
  return btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

async function svgToPngImage(svg: string, width: number, height: number): Promise<RenderedImage> {
  const svgUrl = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
  const fallback = { src: svgUrl, width, height };
  if (typeof document === 'undefined') return fallback;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), 2000);
    const image = new Image();
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(fallback);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ src: canvas.toDataURL('image/png'), width, height });
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(fallback);
    };
    image.src = svgUrl;
  });
}

// ---------------------------------------------------------------------------------------------
// HTML report body (shared by the Word export, the HTML export and the in-app report view)
// ---------------------------------------------------------------------------------------------

export interface ReportAssets {
  matrixImages: Record<string, RenderedImage | undefined>;
  // Ready-to-embed markup (inline <svg> or <img>); each is empty when the run produced nothing to plot.
  residualsHtml: string;
  meshStudyHtml: string;
  validationHtml: string;
}

function validationSvgOf(report: RealReport): string {
  const validation = report.validation;
  return validation?.profile ? validationOverlaySvg(validation.profile, validation.reference, validation.comparison, 'light') : '';
}

export function buildInlineAssets(report: RealReport): ReportAssets {
  return {
    matrixImages: Object.fromEntries(report.matrices.map((matrix) => [matrix.key, renderMatrixToImage(matrix)])),
    residualsHtml: generateResidualsPlotSvg(report.series),
    meshStudyHtml: report.meshStudy ? meshConvergenceSvg(report.meshStudy, 'light') : '',
    validationHtml: validationSvgOf(report),
  };
}

// Word cannot display inline SVG, so each figure is rasterised at the size declared in its viewBox.
async function rasterFigure(svg: string, alt: string): Promise<string> {
  if (!svg) return '';
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const width = box ? Number(box[1]) : 680;
  const height = box ? Number(box[2]) : 340;
  const image = await svgToPngImage(svg, width, height);
  return `<img src="${image.src}" width="${image.width}" height="${image.height}" alt="${esc(alt)}" />`;
}

async function buildRasterAssets(report: RealReport): Promise<ReportAssets> {
  return {
    matrixImages: Object.fromEntries(report.matrices.map((matrix) => [matrix.key, renderMatrixToImage(matrix)])),
    residualsHtml: await rasterFigure(generateResidualsPlotSvg(report.series), 'Residual history'),
    meshStudyHtml: await rasterFigure(report.meshStudy ? meshConvergenceSvg(report.meshStudy, 'light') : '', 'Mesh convergence'),
    validationHtml: await rasterFigure(validationSvgOf(report), 'Simulation vs. reference data'),
  };
}

export const REPORT_CSS = `
.naseer-report { font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.55; direction: ltr; text-align: left; }
.naseer-report .rp-cover { border-bottom: 3px solid #0369a1; padding-bottom: 14px; margin-bottom: 20px; }
.naseer-report .rp-brand { font-size: 12pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0369a1; }
.naseer-report .rp-brand-sub { font-size: 10pt; color: #475569; margin-bottom: 14px; }
.naseer-report h1.rp-title { font-size: 21pt; line-height: 1.25; margin: 6px 0 4px; color: #0f172a; }
.naseer-report .rp-subtitle { font-size: 11pt; color: #334155; margin-bottom: 10px; }
.naseer-report h2.rp-h2 { font-size: 14pt; color: #0f4c81; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 3px; margin: 26px 0 8px; }
.naseer-report h2.rp-h2 .rp-ar { font-size: 11pt; font-weight: 400; color: #64748b; margin-left: 10px; }
.naseer-report p { margin: 6px 0; text-align: justify; }
.naseer-report table.rp-table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 10pt; }
.naseer-report table.rp-table th { background: #0f4c81; color: #ffffff; padding: 6px 9px; border: 1px solid #0b3254; text-align: left; font-weight: 600; }
.naseer-report table.rp-table td { padding: 5px 9px; border: 1px solid #cbd5e1; vertical-align: top; }
.naseer-report table.rp-table td.rp-num { font-family: Consolas, 'Courier New', monospace; text-align: right; white-space: nowrap; }
.naseer-report table.rp-table td.rp-note { color: #475569; font-size: 9.5pt; }
.naseer-report table.rp-meta td { border: none; border-bottom: 1px solid #e2e8f0; padding: 3px 8px 3px 0; }
.naseer-report table.rp-meta td:first-child { color: #475569; width: 28%; }
.naseer-report .rp-figure { text-align: center; margin: 12px 0 4px; page-break-inside: avoid; }
.naseer-report .rp-figure img, .naseer-report .rp-figure svg { max-width: 100%; height: auto; border: 1px solid #cbd5e1; }
.naseer-report .rp-caption { font-size: 9.5pt; color: #334155; text-align: center; margin: 4px 0 16px; }
.naseer-report .rp-empty { color: #64748b; font-style: italic; }
.naseer-report .rp-pass { color: #047857; font-weight: 700; }
.naseer-report .rp-fail { color: #b91c1c; font-weight: 700; }
.naseer-report pre.rp-log { font-family: Consolas, 'Courier New', monospace; font-size: 8.5pt; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 10px; white-space: pre-wrap; word-wrap: break-word; margin: 6px 0 12px; }
.naseer-report .rp-error { border-left: 4px solid #b91c1c; background: #fef2f2; padding: 6px 10px; margin: 6px 0; }
.naseer-report .rp-footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 9pt; color: #64748b; text-align: center; }
.naseer-report .rp-verdict { padding: 7px 11px; margin: 8px 0; border-left: 4px solid #64748b; background: #f1f5f9; font-weight: 600; }
.naseer-report .rp-verdict-good { border-left-color: #047857; background: #ecfdf5; color: #064e3b; }
.naseer-report .rp-verdict-warn { border-left-color: #b45309; background: #fffbeb; color: #78350f; }
.naseer-report .rp-verdict-bad { border-left-color: #b91c1c; background: #fef2f2; color: #7f1d1d; }
.naseer-report ul.rp-list { margin: 4px 0 10px 18px; padding: 0; font-size: 10pt; }
`;

const AR_TITLES = {
  summary: 'الملخص التنفيذي',
  setup: 'إعداد المحاكاة',
  method: 'الطريقة العددية والشبكة',
  results: 'النتائج',
  checks: 'فحوصات التحقق',
  meshStudy: 'دراسة استقلالية الشبكة',
  validation: 'التحقق والمطابقة',
  convergence: 'التقارب',
  log: 'سجل تنفيذ المحلل',
  provenance: 'التوثيق وقابلية الإعادة',
  scope: 'النطاق والقيود',
};

function rowsTable(rows: ReportRow[], emptyText = 'Not reported by the backend for this run.'): string {
  if (rows.length === 0) return `<p class="rp-empty">${esc(emptyText)}</p>`;
  const hasNote = rows.some((item) => item.note);
  return (
    `<table class="rp-table"><thead><tr><th>Quantity</th><th>Value</th><th>Unit</th>${hasNote ? '<th>Basis</th>' : ''}</tr></thead><tbody>` +
    rows
      .map(
        (item) =>
          `<tr><td>${esc(item.label)}</td><td class="rp-num">${esc(item.value)}</td><td>${esc(item.unit ?? '')}</td>${hasNote ? `<td class="rp-note">${esc(item.note ?? '')}</td>` : ''}</tr>`,
      )
      .join('') +
    '</tbody></table>'
  );
}

export function renderReportBody(report: RealReport, assets: ReportAssets): string {
  let section = 0;
  const heading = (english: string, arabic: string) => `<h2 class="rp-h2">${++section}. ${esc(english)}<span class="rp-ar" dir="rtl">${arabic}</span></h2>`;

  const metaRows: [string, string | undefined][] = [
    ['Discipline', report.field],
    ['Simulation type', report.simulationTypeLabel],
    ['Job ID', report.jobId ?? 'direct execution (no job ID)'],
    ['Prepared by', report.preparedBy],
    ['Institution', report.institution],
    ['Report generated', report.generatedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')],
  ];

  const parts: string[] = [];
  parts.push(
    `<div class="rp-cover">` +
      `<div class="rp-brand">${esc(PLATFORM_NAME)}</div>` +
      `<div class="rp-brand-sub">Computational Simulation Report · تقرير المحاكاة الحاسوبية</div>` +
      `<h1 class="rp-title">${esc(report.title)}</h1>` +
      (report.titleEn && report.titleEn !== report.title ? `<div class="rp-subtitle">${esc(report.titleEn)}</div>` : '') +
      `<table class="rp-meta"><tbody>${metaRows
        .filter(([, value]) => !!value)
        .map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`)
        .join('')}</tbody></table>` +
      `<div class="rp-brand-sub" style="margin:8px 0 0;">Interpretation assistant: ${esc(report.assistant)}</div>` +
      `</div>`,
  );

  parts.push(heading('Executive Summary', AR_TITLES.summary) + report.summary.map((line) => `<p>${esc(line)}</p>`).join(''));
  parts.push(heading('Simulation Setup', AR_TITLES.setup) + `<p>Parameters below are the values the backend received for this job.</p>` + rowsTable(report.parameters));
  parts.push(heading('Numerical Method and Mesh', AR_TITLES.method) + rowsTable([...report.solver, ...report.mesh]));

  let figure = 0;
  const figures = report.matrices
    .map((matrix) => {
      const image = assets.matrixImages[matrix.key];
      return image
        ? `<div class="rp-figure"><img src="${image.src}" width="${image.width}" height="${image.height}" alt="${esc(matrix.label)}" /></div>` +
            `<p class="rp-caption">Figure ${++figure}: ${esc(matrix.label)} as returned by the solver (${matrix.cols} × ${matrix.rows} nodes${matrix.nonFiniteCount ? `, ${matrix.nonFiniteCount} non-finite nodes left blank` : ''}).</p>`
        : `<p class="rp-empty">${esc(matrix.label)}: figure not rendered in this environment; its statistics are tabulated above.</p>`;
    })
    .join('');
  parts.push(
    heading('Results', AR_TITLES.results) +
      `<p>All values are taken from the solver result; minimum, maximum and mean are computed directly from the returned arrays.</p>` +
      rowsTable(report.results) +
      figures,
  );

  if (report.checks.length) {
    parts.push(
      heading('Verification Checks', AR_TITLES.checks) +
        `<p>Independent arithmetic checks recomputed from the submitted parameters and the returned arrays.</p>` +
        `<table class="rp-table"><thead><tr><th>Check</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>${report.checks
          .map(
            (check) =>
              `<tr><td>${esc(check.label)}</td><td class="${check.passed ? 'rp-pass' : 'rp-fail'}">${check.passed ? 'PASS' : 'FAIL'}</td><td class="rp-note">${esc(check.detail)}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    );
  }

  // Verification: real mesh-independence (GCI) study.
  if (report.meshStudy) {
    const study = report.meshStudy;
    const verdict = meshStudyVerdict(study);
    const num = (value: number | null | undefined) => (value === null || value === undefined ? '—' : esc(formatNumber(value)));
    const unit = study.key_result.unit ? ` ${study.key_result.unit}` : '';
    parts.push(
      heading('Mesh Independence Study (GCI)', AR_TITLES.meshStudy) +
        `<p>The solver (${esc(study.solver ?? 'unnamed solver')}) was run on three systematically refined ${esc(study.physics_type.replace(/_/g, ' '))} meshes and the Grid Convergence Index of <strong>${esc(study.key_result.label)}</strong> was computed following Celik et al. (2008), with safety factor ${num(study.safety_factor)}. ` +
        `Refinement ratios r<sub>21</sub> = ${num(study.r21)} and r<sub>32</sub> = ${num(study.r32)} were derived from the solver's own cell counts (${study.dimension}-D).</p>` +
        `<p>${esc(study.key_result.description)}</p>` +
        `<div class="rp-verdict rp-verdict-${verdict.tone}">${esc(verdict.text)}</div>` +
        (study.key_result.caveat ? `<p class="rp-note"><strong>Caveat.</strong> ${esc(study.key_result.caveat)}</p>` : '') +
        `<table class="rp-table"><thead><tr><th>Level</th><th>Mesh</th><th>Cells</th><th>Nodes</th><th>h / h<sub>fine</sub></th><th>${esc(study.key_result.label)}${esc(unit ? ` (${study.key_result.unit})` : '')}</th></tr></thead><tbody>${study.levels
          .map(
            (lvl) =>
              `<tr><td style="text-transform:capitalize">${esc(lvl.level)}</td><td class="rp-num">${
                lvl.mesh_size !== null ? `${num(lvl.mesh_size)} m` : lvl.divisions ? `${lvl.divisions.x}×${lvl.divisions.y}×${lvl.divisions.z} divisions` : '—'
              }</td><td class="rp-num">${num(lvl.cells)}</td><td class="rp-num">${num(lvl.nodes)}</td><td class="rp-num">${num(lvl.relative_size)}</td><td class="rp-num">${esc(formatNumber(lvl.key_result))}</td></tr>`,
          )
          .join('')}</tbody></table>` +
        `<table class="rp-table"><thead><tr><th>GCI (fine)</th><th>GCI (medium)</th><th>Observed order p</th><th>Asymptotic ratio</th><th>Extrapolated value</th><th>Fine-grid uncertainty</th><th>Convergence</th></tr></thead><tbody><tr>` +
        `<td class="rp-num">${study.gci_fine_percent === null ? '—' : `${num(study.gci_fine_percent)} %`}</td>` +
        `<td class="rp-num">${study.gci_medium_percent === null ? '—' : `${num(study.gci_medium_percent)} %`}</td>` +
        `<td class="rp-num">${num(study.observed_order)}</td>` +
        `<td class="rp-num">${num(study.asymptotic_ratio)}</td>` +
        `<td class="rp-num">${study.extrapolated_value === null ? '—' : `${num(study.extrapolated_value)}${esc(unit)}`}</td>` +
        `<td class="rp-num">${study.uncertainty_fine === null ? '—' : `± ${num(study.uncertainty_fine)}${esc(unit)}`}</td>` +
        `<td style="text-transform:capitalize">${esc(study.convergence_type ?? '—')}</td>` +
        `</tr></tbody></table>` +
        (study.warnings.length ? `<ul class="rp-list">${study.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '') +
        (study.basis_note ? `<p class="rp-note">${esc(study.basis_note)}</p>` : '') +
        (assets.meshStudyHtml ? `<div class="rp-figure">${assets.meshStudyHtml}</div><p class="rp-caption">Figure ${++figure}: ${esc(study.key_result.label)} against relative cell size; the hollow marker is the Richardson-extrapolated value and the bar is the fine-grid uncertainty.</p>` : ''),
    );
  }

  // Validation: the real solver profile against user-supplied reference data.
  if (report.validation) {
    const v = report.validation;
    const c = v.comparison;
    const num = (value: number | undefined) => (value === undefined ? '—' : esc(formatNumber(value)));
    const unit = v.unit ? ` ${v.unit}` : '';
    parts.push(
      heading('Validation against Reference Data', AR_TITLES.validation) +
        `<p>${v.reference.points.length} reference points ("${esc(v.reference.label)}") are compared with the simulated field${v.fieldLabel ? ` (${esc(v.fieldLabel)})` : ''}` +
        (v.profile ? ` along: <strong>${esc(v.profile.description)}</strong>. Reference X is expressed as <em>${esc(v.profile.abscissaLabel)}</em>; simulated values are bilinearly interpolated between nodes.</p>` : '.</p>') +
        (v.error ? `<div class="rp-error"><strong>Validation could not be evaluated</strong> — ${esc(v.error)}</div>` : '') +
        (assets.validationHtml ? `<div class="rp-figure">${assets.validationHtml}</div><p class="rp-caption">Figure ${++figure}: Simulated profile and reference data.</p>` : '') +
        (c && c.compared > 0
          ? `<table class="rp-table"><thead><tr><th>Points compared</th><th>Outside the cut</th><th>Mean |error|</th><th>Max |error|</th><th>RMSE</th><th>Max abs. error</th><th>NRMSE</th><th>R²</th></tr></thead><tbody><tr>` +
            `<td class="rp-num">${c.compared}</td><td class="rp-num">${c.outOfRange}</td>` +
            `<td class="rp-num">${c.meanAbsPercent === undefined ? '—' : `${num(c.meanAbsPercent)} %`}</td>` +
            `<td class="rp-num">${c.maxAbsPercent === undefined ? '—' : `${num(c.maxAbsPercent)} %`}</td>` +
            `<td class="rp-num">${num(c.rmse)}${esc(unit)}</td><td class="rp-num">${num(c.maxAbsError)}${esc(unit)}</td>` +
            `<td class="rp-num">${c.nrmsePercent === undefined ? '—' : `${num(c.nrmsePercent)} %`}</td><td class="rp-num">${num(c.r2)}</td>` +
            `</tr></tbody></table>`
          : c
            ? `<p class="rp-empty">No reference X value lies inside the simulated cut, so nothing was compared.</p>`
            : '') +
        (c
          ? `<table class="rp-table"><thead><tr><th>x</th><th>Reference</th><th>Simulation</th><th>|Error|</th><th>|Error| %</th></tr></thead><tbody>${c.rows
              .map(
                (r) =>
                  `<tr><td class="rp-num">${esc(formatNumber(r.x))}</td><td class="rp-num">${esc(formatNumber(r.ref))}</td>` +
                  (r.status === 'compared'
                    ? `<td class="rp-num">${num(r.sim)}</td><td class="rp-num">${num(r.absError)}</td><td class="rp-num">${r.percentError === undefined ? '—' : `${num(r.percentError)} %`}</td>`
                    : `<td class="rp-note" colspan="3">outside the simulated cut — not compared</td>`) +
                  `</tr>`,
              )
              .join('')}</tbody></table>` +
            `<p class="rp-note">Percentage error is relative to each reference value, so it depends on the scale of the quantity (for example °C vs. K) and is undefined where the reference is zero; the absolute error is tabulated alongside. Reference points outside the simulated cut are never extrapolated.</p>`
          : ''),
    );
  }

  parts.push(
    heading('Convergence', AR_TITLES.convergence) +
      `<p>${esc(report.convergenceStatement)}</p>` +
      rowsTable(report.convergenceRows, 'The backend reported no convergence metrics for this run.') +
      (assets.residualsHtml
        ? `<div class="rp-figure">${assets.residualsHtml}</div><p class="rp-caption">Figure ${++figure}: Residual history reported by the solver (logarithmic scale).</p>`
        : ''),
  );

  parts.push(
    heading('Solver Execution Log', AR_TITLES.log) +
      (report.errors.length
        ? report.errors.map((error) => `<div class="rp-error"><strong>${esc(error.code ?? 'ERROR')}</strong> — ${esc(error.message)}</div>`).join('')
        : '') +
      (report.logs.length
        ? `<pre class="rp-log">${report.logs.map((line, index) => `${String(index + 1).padStart(3, ' ')}  ${esc(line)}`).join('\n')}</pre>`
        : `<p class="rp-empty">The backend returned no log lines for this run.</p>`),
  );

  parts.push(heading('Provenance and Reproducibility', AR_TITLES.provenance) + rowsTable([...report.job, ...report.provenance]));

  parts.push(
    heading('Scope and Limitations', AR_TITLES.scope) +
      `<p>This document records a single backend execution${report.jobId ? ` (job ${esc(report.jobId)})` : ''}. Every number was read from the stored solver result and the submitted parameters; nothing was estimated, defaulted or back-filled.</p>` +
      (report.meshStudy
        ? `<p>A mesh-independence (GCI) study of ${esc(report.meshStudy.key_result.label)} was performed and is reported above. Its outcome: ${esc(meshStudyVerdict(report.meshStudy).text)}</p>`
        : `<p>This run did not include a grid-convergence (GCI) study, and none is claimed here.</p>`) +
      (report.validation
        ? report.validation.comparison && report.validation.comparison.compared > 0
          ? `<p>A validation against user-supplied reference data was performed and is reported above; the reference data itself was entered by the user and has not been independently checked.</p>`
          : `<p>Reference data was supplied but no point could be compared, so no validation is claimed.</p>`
        : `<p>No experimental or benchmark validation was part of this run, and none is claimed here.</p>`) +
      report.notes.map((note) => `<p>${esc(note)}</p>`).join('') +
      `<p>${esc(AI_ASSISTANT_LABEL)} is the ${esc(PLATFORM_NAME)} assistant for interpreting results; it did not generate or alter any value in this report.</p>`,
  );

  parts.push(
    `<div class="rp-footer">Generated by ${esc(PLATFORM_NAME)} · Interpretation assistant: ${esc(AI_ASSISTANT_NAME)} · Source: backend job ${esc(report.jobId ?? 'direct execution')}</div>`,
  );
  return `<div class="naseer-report">${parts.join('')}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Document builders and exporters
// ---------------------------------------------------------------------------------------------

export async function buildWordHtml(project: ThesisProject): Promise<string> {
  const report = buildRealReport(project);
  const assets = await buildRasterAssets(report);
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${esc(report.title)} — ${esc(PLATFORM_NAME)}</title>
<style>
@page { size: A4; margin: 2.2cm 2cm 2.2cm 2cm; }
body { margin: 0; }
${REPORT_CSS}
</style>
</head>
<body>
${renderReportBody(report, assets)}
</body>
</html>`;
}

export function buildJournalHtml(project: ThesisProject): string {
  const report = buildRealReport(project);
  const assets = buildInlineAssets(report);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(report.title)} — ${esc(PLATFORM_NAME)}</title>
<style>
body { background: #f1f5f9; margin: 0; padding: 24px 12px; }
.paper { max-width: 960px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgba(15,23,42,0.08); padding: 40px 52px; }
${REPORT_CSS}
@media print { body { background: #ffffff; padding: 0; } .paper { border: none; box-shadow: none; padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="paper">
${renderReportBody(report, assets)}
</div>
</body>
</html>`;
}

export async function exportToWordDocument(project: ThesisProject): Promise<void> {
  const html = await buildWordHtml(project);
  downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }), `${safeFileStem(project)}.doc`);
}

export function exportToJournalHTML(project: ThesisProject): void {
  downloadBlob(new Blob([buildJournalHtml(project)], { type: 'text/html;charset=utf-8' }), `${safeFileStem(project)}.html`);
}

// --- LaTeX ---------------------------------------------------------------------------------

const LATEX_SYMBOLS: Record<string, string> = {
  '°': '$^\\circ$',
  '²': '$^2$',
  '³': '$^3$',
  '·': '$\\cdot$',
  '×': '$\\times$',
  '−': '-',
  '…': '\\ldots{}',
  '—': '---',
  '–': '--',
  '≈': '$\\approx$',
  Δ: '$\\Delta$',
};

function latexEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/[\\&%$#_{}~^]/g, (char) =>
      char === '\\' ? '\\textbackslash{}' : char === '~' ? '\\textasciitilde{}' : char === '^' ? '\\textasciicircum{}' : `\\${char}`,
    )
    .replace(/[^\u0000-\u00ff]|[°²³·×]/g, (char) => LATEX_SYMBOLS[char] ?? '?');
}

function latexTable(rows: ReportRow[]): string {
  if (rows.length === 0) return 'Not reported by the backend for this run.\n';
  return (
    '\\begin{longtable}{p{0.38\\textwidth}p{0.27\\textwidth}p{0.25\\textwidth}}\n\\toprule\nQuantity & Value & Unit / basis \\\\\n\\midrule\n\\endhead\n' +
    rows
      .map((item) => `${latexEscape(item.label)} & ${latexEscape(item.value)} & ${latexEscape([item.unit, item.note].filter(Boolean).join(' — '))} \\\\`)
      .join('\n') +
    '\n\\bottomrule\n\\end{longtable}\n'
  );
}

export function buildLatexSource(project: ThesisProject): string {
  const report = buildRealReport(project);
  const residualPlot = report.series.length
    ? `\\begin{figure}[h]\n\\centering\n\\begin{tikzpicture}\n\\begin{semilogyaxis}[width=0.9\\textwidth,height=7cm,xlabel={Iteration (solver log sample)},ylabel={Residual},legend pos=outer north east,grid=major]\n` +
      report.series
        .map(
          (item) =>
            `\\addplot coordinates {${item.points.map((point) => `(${point.iteration},${point.value})`).join(' ')}};\n\\addlegendentry{${latexEscape(item.name)}}`,
        )
        .join('\n') +
      `\n\\end{semilogyaxis}\n\\end{tikzpicture}\n\\caption{Residual history reported by the solver.}\n\\end{figure}\n`
    : '';
  const authorLine = [report.preparedBy, report.institution].filter(Boolean).map(latexEscape).join(' \\\\ ');
  const tex = (value: number | null | undefined) => (value === null || value === undefined ? '---' : latexEscape(formatNumber(value)));

  const study = report.meshStudy;
  const meshStudyTex = study
    ? (() => {
        const verdict = meshStudyVerdict(study);
        const unit = study.key_result.unit ? ` (${study.key_result.unit})` : '';
        const rows = study.levels
          .map(
            (l) =>
              `${latexEscape(l.level)} & ${l.mesh_size !== null ? `${tex(l.mesh_size)} m` : l.divisions ? `${l.divisions.x}$\\times$${l.divisions.y}$\\times$${l.divisions.z}` : '---'} & ${tex(l.cells)} & ${tex(l.nodes)} & ${tex(l.relative_size)} & ${tex(l.key_result)} \\\\`,
          )
          .join('\n');
        const points = study.levels.filter((l) => l.relative_size !== null).map((l) => `(${l.relative_size},${l.key_result})`).join(' ');
        return (
          `\\section{Mesh Independence Study (GCI)}\n` +
          `Grid Convergence Index of \\textbf{${latexEscape(study.key_result.label)}} following Celik et al.\\ (2008), safety factor ${tex(study.safety_factor)}; ` +
          `refinement ratios $r_{21}=${tex(study.r21)}$ and $r_{32}=${tex(study.r32)}$ from the solver's cell counts (${study.dimension}-D).\n\n` +
          `\\noindent\\textbf{${latexEscape(verdict.text)}}\n\n` +
          (study.key_result.caveat ? `\\noindent\\emph{Caveat.} ${latexEscape(study.key_result.caveat)}\n\n` : '') +
          `\\begin{tabular}{llrrrr}\n\\toprule\nLevel & Mesh & Cells & Nodes & $h/h_{fine}$ & ${latexEscape(study.key_result.label + unit)} \\\\\n\\midrule\n${rows}\n\\bottomrule\n\\end{tabular}\n\n\\medskip\n` +
          `\\begin{tabular}{lr}\n\\toprule\nQuantity & Value \\\\\n\\midrule\n` +
          `GCI (fine) & ${study.gci_fine_percent === null ? '---' : `${tex(study.gci_fine_percent)}\\,\\%`} \\\\\n` +
          `GCI (medium) & ${study.gci_medium_percent === null ? '---' : `${tex(study.gci_medium_percent)}\\,\\%`} \\\\\n` +
          `Observed order $p$ & ${tex(study.observed_order)} \\\\\n` +
          `Asymptotic ratio & ${tex(study.asymptotic_ratio)} \\\\\n` +
          `Extrapolated value & ${tex(study.extrapolated_value)}${latexEscape(study.key_result.unit ? ` ${study.key_result.unit}` : '')} \\\\\n` +
          `Fine-grid uncertainty & ${study.uncertainty_fine === null ? '---' : `$\\pm$ ${tex(study.uncertainty_fine)}`}${latexEscape(study.key_result.unit ? ` ${study.key_result.unit}` : '')} \\\\\n` +
          `Convergence & ${latexEscape(study.convergence_type ?? '---')} \\\\\n\\bottomrule\n\\end{tabular}\n` +
          (study.warnings.length ? `\n\\begin{itemize}\n${study.warnings.map((w) => `\\item ${latexEscape(w)}`).join('\n')}\n\\end{itemize}\n` : '') +
          (points
            ? `\n\\begin{figure}[h]\n\\centering\n\\begin{tikzpicture}\n\\begin{axis}[width=0.9\\textwidth,height=7cm,xlabel={Relative cell size $h/h_{fine}$},ylabel={${latexEscape(study.key_result.label + unit)}},grid=major,legend pos=north west]\n` +
              `\\addplot[mark=*] coordinates {${points}};\n\\addlegendentry{Solver results}\n` +
              (study.extrapolated_value !== null ? `\\addplot[only marks,mark=o] coordinates {(0,${study.extrapolated_value})};\n\\addlegendentry{Extrapolated ($h\\to 0$)}\n` : '') +
              `\\end{axis}\n\\end{tikzpicture}\n\\caption{${latexEscape(study.key_result.label)} against relative cell size.}\n\\end{figure}\n`
            : '')
        );
      })()
    : '';

  const val = report.validation;
  const validationTex = val
    ? (() => {
        const c = val.comparison;
        const unit = val.unit ? ` ${val.unit}` : '';
        const compared = c && c.compared > 0;
        return (
          `\\section{Validation against Reference Data}\n` +
          `${val.reference.points.length} reference points (``${latexEscape(val.reference.label)}'') are compared with the simulated field` +
          (val.profile ? ` along: \\textbf{${latexEscape(val.profile.description)}}. Reference X is expressed as ${latexEscape(val.profile.abscissaLabel)}; simulated values are bilinearly interpolated between nodes.\n` : '.\n') +
          (val.error ? `\n\\noindent\\textbf{Validation could not be evaluated:} ${latexEscape(val.error)}\n` : '') +
          (compared
            ? `\n\\begin{tabular}{lr}\n\\toprule\nMetric & Value \\\\\n\\midrule\n` +
              `Points compared & ${c.compared} \\\\\nOutside the simulated cut & ${c.outOfRange} \\\\\n` +
              `Mean absolute error & ${c.meanAbsPercent === undefined ? '---' : `${tex(c.meanAbsPercent)}\\,\\%`} \\\\\n` +
              `Max absolute error & ${c.maxAbsPercent === undefined ? '---' : `${tex(c.maxAbsPercent)}\\,\\%`} \\\\\n` +
              `RMSE & ${tex(c.rmse)}${latexEscape(unit)} \\\\\nMax absolute error (units) & ${tex(c.maxAbsError)}${latexEscape(unit)} \\\\\n` +
              `NRMSE & ${c.nrmsePercent === undefined ? '---' : `${tex(c.nrmsePercent)}\\,\\%`} \\\\\n$R^2$ & ${tex(c.r2)} \\\\\n\\bottomrule\n\\end{tabular}\n` +
              `\n\\begin{longtable}{rrrrr}\n\\toprule\n$x$ & Reference & Simulation & $|$Error$|$ & $|$Error$|$ \\% \\\\\n\\midrule\n\\endhead\n` +
              c.rows
                .map((r) =>
                  r.status === 'compared'
                    ? `${tex(r.x)} & ${tex(r.ref)} & ${tex(r.sim)} & ${tex(r.absError)} & ${r.percentError === undefined ? '---' : tex(r.percentError)} \\\\`
                    : `${tex(r.x)} & ${tex(r.ref)} & \\multicolumn{3}{l}{outside the simulated cut (not compared)} \\\\`,
                )
                .join('\n') +
              `\n\\bottomrule\n\\end{longtable}\n` +
              `Percentage error is relative to each reference value and therefore depends on the scale of the quantity; the absolute error is tabulated alongside. Reference points outside the cut are never extrapolated.\n`
            : c
              ? `\nNo reference X value lies inside the simulated cut, so nothing was compared.\n`
              : '') +
          (val.profile
            ? `\n\\begin{figure}[h]\n\\centering\n\\begin{tikzpicture}\n\\begin{axis}[width=0.9\\textwidth,height=7cm,xlabel={${latexEscape(val.profile.abscissaLabel)}},ylabel={${latexEscape(val.profile.valueLabel)}},grid=major,legend pos=north east]\n` +
              `\\addplot[no marks,thick] coordinates {${val.profile.points.map((p) => `(${p.s},${p.value})`).join(' ')}};\n\\addlegendentry{Simulation}\n` +
              `\\addplot[only marks,mark=*] coordinates {${val.reference.points.map((p) => `(${p.x},${p.y})`).join(' ')}};\n\\addlegendentry{${latexEscape(val.reference.label)}}\n` +
              `\\end{axis}\n\\end{tikzpicture}\n\\caption{Simulated profile and reference data.}\n\\end{figure}\n`
            : '')
        );
      })()
    : '';
  const scopeTex =
    (study ? `A mesh-independence (GCI) study of ${latexEscape(study.key_result.label)} was performed: ${latexEscape(meshStudyVerdict(study).text)} ` : 'No grid-convergence study was part of this run. ') +
    (val ? (val.comparison && val.comparison.compared > 0 ? 'A validation against user-supplied reference data, which has not been independently checked, was performed. ' : 'Reference data was supplied but no point could be compared. ') : 'No experimental or benchmark validation was part of this run. ');

  return String.raw`\documentclass[a4paper,11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{booktabs,longtable,geometry,hyperref,amsmath,pgfplots}
\pgfplotsset{compat=1.14}
\geometry{margin=1in}

\title{${latexEscape(report.titleEn ?? report.title)}\\[4pt]\large ${latexEscape(PLATFORM_NAME)} --- Computational Simulation Report}
\author{${authorLine || latexEscape(PLATFORM_NAME)}}
\date{${latexEscape(report.generatedAt.slice(0, 10))}}

\begin{document}
\maketitle

\noindent Interpretation assistant: ${latexEscape(report.assistant)}.

\section{Executive Summary}
${report.summary.map(latexEscape).join('\n\n')}

\section{Simulation Setup}
${latexTable(report.parameters)}
\section{Numerical Method and Mesh}
${latexTable([...report.solver, ...report.mesh])}
\section{Results}
${latexTable(report.results)}
${
  report.checks.length
    ? `\\section{Verification Checks}\n\\begin{itemize}\n${report.checks.map((check) => `\\item \\textbf{${check.passed ? 'PASS' : 'FAIL'}} --- ${latexEscape(check.label)}: ${latexEscape(check.detail)}`).join('\n')}\n\\end{itemize}\n`
    : ''
}
\section{Convergence}
${latexEscape(report.convergenceStatement)}

${latexTable(report.convergenceRows)}
${residualPlot}
${meshStudyTex}
${validationTex}
\section{Solver Execution Log}
${report.errors.map((error) => `\\noindent\\textbf{${latexEscape(error.code ?? 'ERROR')}}: ${latexEscape(error.message)}\n`).join('\n')}
\begin{verbatim}
${report.logs.map((line, index) => `${String(index + 1).padStart(3, ' ')}  ${line.replace(/\\end\{verbatim\}/g, '')}`).join('\n')}
\end{verbatim}

\section{Provenance and Reproducibility}
${latexTable([...report.job, ...report.provenance])}
\section{Scope and Limitations}
This document records a single backend execution${report.jobId ? ` (job ${latexEscape(report.jobId)})` : ''}. Every number was read from the stored solver result and the submitted parameters. ${scopeTex}${report.notes.map(latexEscape).join(' ')} ${latexEscape(report.assistant)} did not generate or alter any value in this report.

\end{document}
`;
}

export function exportToLatex(project: ThesisProject): void {
  downloadBlob(new Blob([buildLatexSource(project)], { type: 'application/x-tex;charset=utf-8' }), `${safeFileStem(project)}.tex`);
}

// --- CSV -----------------------------------------------------------------------------------

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvLine = (...cells: unknown[]): string => `${cells.map(csvCell).join(',')}\n`;

export function buildCsv(project: ThesisProject): string {
  const report = buildRealReport(project);
  let csv = '\ufeff';
  const rowsBlock = (title: string, rows: ReportRow[]) => {
    csv += csvLine(title);
    csv += csvLine('Quantity', 'Value', 'Unit', 'Basis');
    rows.forEach((item) => (csv += csvLine(item.label, item.value, item.unit, item.note)));
    csv += '\n';
  };
  csv += csvLine(`${report.platform} — real solver data export`);
  csv += csvLine('Project', report.title);
  csv += csvLine('Job ID', report.jobId ?? 'direct execution');
  csv += csvLine('Generated', report.generatedAt);
  csv += '\n';
  rowsBlock('Simulation parameters', report.parameters);
  rowsBlock('Solver and mesh', [...report.solver, ...report.mesh]);
  rowsBlock('Results', report.results);
  rowsBlock('Convergence', report.convergenceRows);
  rowsBlock('Provenance', [...report.job, ...report.provenance]);
  report.series.forEach((item) => {
    csv += csvLine(`Residual series: ${item.name}`);
    csv += csvLine('Iteration (solver log sample)', 'Residual');
    item.points.forEach((point) => (csv += csvLine(point.iteration, point.value)));
    csv += '\n';
  });
  report.matrices.forEach((matrix) => {
    const xs = Array.from({ length: matrix.cols }, (_, c) => (matrix.widthM !== undefined && matrix.cols > 1 ? (matrix.widthM * c) / (matrix.cols - 1) : c));
    csv += csvLine(`${matrix.label}${matrix.unit ? ` [${matrix.unit}]` : ''} — rows are y from the top (y = ${matrix.heightM !== undefined ? 'Ly' : 'last index'}) to the bottom (y = 0); columns are x`);
    csv += csvLine('y \\ x', ...xs);
    for (let r = matrix.rows - 1; r >= 0; r--) {
      const y = matrix.heightM !== undefined && matrix.rows > 1 ? (matrix.heightM * r) / (matrix.rows - 1) : r;
      csv += csvLine(y, ...matrix.data[r]);
    }
    csv += '\n';
  });
  return csv;
}

export function exportToCSV(project: ThesisProject): void {
  downloadBlob(new Blob([buildCsv(project)], { type: 'text/csv;charset=utf-8;' }), `${safeFileStem(project)}.csv`);
}

// --- OpenFOAM case scripts -----------------------------------------------------------------

/**
 * Reconstructs blockMeshDict/controlDict from the REAL submitted CFD job (domain, mesh size and
 * the executable the backend resolved). The authoritative case lives on the backend.
 */
export function buildOpenFoamScripts(project: ThesisProject): string {
  const run = project.simulationRun;
  if (!run) throw new ExportUnavailableError('OpenFOAM case scripts require a completed CFD run.');
  const result = run.result as Record<string, unknown>;
  const data = (typeof result.data === 'object' && result.data ? result.data : result) as Record<string, unknown>;
  const physicsType = String(result.physics_type ?? data.physics_type ?? '');
  if (!physicsType.startsWith('CFD')) throw new ExportUnavailableError('OpenFOAM case scripts are only available for a completed CFD run.');

  const source = (run.backendPayload ?? run.submittedRequest) as Record<string, unknown>;
  const domain = (typeof source.domain === 'object' && source.domain ? source.domain : {}) as Record<string, unknown>;
  const mesh = (typeof source.mesh_settings === 'object' && source.mesh_settings ? source.mesh_settings : {}) as Record<string, unknown>;
  const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
  const width = finite(domain.width_x) ?? finite(source.width_x);
  const height = finite(domain.height_y) ?? finite(source.height_y);
  const size = finite(mesh.mesh_size) ?? finite(source.mesh_size);
  if (width === undefined || height === undefined || size === undefined) {
    throw new ExportUnavailableError('The stored job does not contain the domain size and mesh size needed to write a blockMeshDict.');
  }
  // The backend's own defaults for the extruded depth and cell-count limits.
  const depth = finite(domain.depth_z) ?? finite(domain.depth) ?? 0.1;
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const nx = clamp(Math.round(width / size), 4, 200);
  const ny = clamp(Math.round(height / size), 4, 200);
  const nz = clamp(Math.round(depth / (size * 0.1)), 1, 20);
  const executable = typeof data.executable === 'string' ? data.executable : '';
  const application = executable.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || (typeof result.recommended_solver === 'string' ? result.recommended_solver : '');
  if (!application) throw new ExportUnavailableError('The backend did not report which OpenFOAM solver executable it ran.');
  const compressible = physicsType === 'CFD_Compressible';
  const caseDirectory = typeof data.case_directory === 'string' ? data.case_directory : 'not reported';

  const header = (object: string) =>
    `// ${PLATFORM_NAME} — reconstructed from job ${run.taskId ?? 'direct execution'}\n// Authoritative backend case directory: ${caseDirectory}\nFoamFile { version 2.0; format ascii; class dictionary; object ${object}; }\n`;
  const blockMeshDict = `${header('blockMeshDict')}convertToMeters 1;
vertices ( (0 0 0) (${width} 0 0) (${width} ${height} 0) (0 ${height} 0) (0 0 ${depth}) (${width} 0 ${depth}) (${width} ${height} ${depth}) (0 ${height} ${depth}) );
blocks ( hex (0 1 2 3 4 5 6 7) (${nx} ${ny} ${nz}) simpleGrading (1 1 1) );
edges ();
boundary (
 inlet { type patch; faces ((0 4 7 3)); }
 outlet { type patch; faces ((1 2 6 5)); }
 walls { type wall; faces ((0 1 5 4) (3 7 6 2)); }
 frontAndBack { type empty; faces ((0 3 2 1) (4 5 6 7)); }
);
mergePatchPairs ();
`;
  const controlDict = `${header('controlDict')}application ${application};
startFrom startTime;
startTime 0;
stopAt endTime;
${compressible ? 'endTime 1000;\ndeltaT 1;\nwriteInterval 100;' : 'endTime 1;\ndeltaT 0.001;\nwriteInterval 1;'}
purgeWrite 0;
writeFormat ascii;
writePrecision 8;
timeFormat general;
timePrecision 8;
runTimeModifiable true;
`;
  return `=== system/blockMeshDict ===\n${blockMeshDict}\n=== system/controlDict ===\n${controlDict}`;
}

export function exportToOpenFoamScripts(project: ThesisProject): void {
  downloadBlob(new Blob([buildOpenFoamScripts(project)], { type: 'text/plain;charset=utf-8;' }), `${String(project.id || 'project').replace(/[^A-Za-z0-9_-]+/g, '_')}_OpenFOAM_case_scripts.txt`);
}

// Re-exported for tests and tooling.
export { buildRealReport };
