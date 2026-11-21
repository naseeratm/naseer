import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Layers,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { ProfileKind, ProfileSpec, ReferenceDataSet, ReferencePoint, ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun } from '../utils/exporter';
import { formatNumber } from '../utils/numberFormat';
import {
  buildParametricProfile,
  compareToReference,
  evaluateValidation,
  parseReferenceCsv,
} from '../utils/validationMetrics';
import { validationOverlaySvg } from '../utils/vvPlots';
import { EmptyState } from './EmptyState';

interface ValidationTabProps {
  project: ThesisProject;
  onSetReferenceData?: (data: ReferenceDataSet | undefined) => void;
  onSetProfile?: (profile: ProfileSpec) => void;
}

type ValidationMode = 'field' | 'parametric';

const fmt = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? '—' : formatNumber(value));

const KIND_LABELS: Record<ProfileKind, string> = {
  horizontal: 'Horizontal cut (y = constant, along x)',
  vertical: 'Vertical cut (x = constant, along y)',
  diagonal: 'Diagonal (corner to corner)',
  line: 'Custom cut-line (two points)',
};

const PRESETS: { label: string; patch: Partial<ProfileSpec> }[] = [
  { label: 'Horizontal centerline', patch: { kind: 'horizontal', units: 'fraction', position: 0.5 } },
  { label: 'Vertical centerline', patch: { kind: 'vertical', units: 'fraction', position: 0.5 } },
  { label: 'Vertical outlet (x = 0.85 L)', patch: { kind: 'vertical', units: 'fraction', position: 0.85 } },
  { label: 'Diagonal', patch: { kind: 'diagonal' } },
];

const inputClass =
  'w-full rounded-lg border bg-slate-950 px-2 py-1.5 font-mono text-[12px] text-slate-200 focus:outline-none disabled:opacity-50';

const NumberField: React.FC<{ id: string; label: string; value: number; onCommit: (value: number) => void }> = ({
  id,
  label,
  value,
  onCommit,
}) => {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);
  const valid = text.trim() !== '' && Number.isFinite(Number(text));
  return (
    <label htmlFor={id} className="block min-w-[5.5rem] flex-1 text-[10.5px] uppercase tracking-wide text-slate-500">
      {label}
      <input
        id={id}
        value={text}
        inputMode="decimal"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
        }}
        className={`${inputClass} mt-1 ${valid ? 'border-slate-700 focus:border-sky-500' : 'border-red-500/60'}`}
      />
    </label>
  );
};

export const ValidationTab: React.FC<ValidationTabProps> = ({ project, onSetReferenceData, onSetProfile }) => {
  const hasRun = hasRealSimulationRun(project);
  const reference = project.referenceData;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [manualX, setManualX] = useState('');
  const [manualY, setManualY] = useState('');
  const [label, setLabel] = useState(reference?.label ?? 'Reference data');
  const [labelTouched, setLabelTouched] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [mode, setMode] = useState<ValidationMode>('field');

  // Keep label input synced when switching projects or loading a V&V benchmark template.
  useEffect(() => {
    setLabel(reference?.label ?? 'Reference data');
    setLabelTouched(false);
  }, [project.id, reference?.label]);

  const report = useMemo(() => (hasRun ? buildRealReport(project) : null), [hasRun, project]);
  const parametricProfile = useMemo(() => buildParametricProfile(project.casesMatrix), [project.casesMatrix]);
  const hasFieldMatrices = Boolean(hasRun && report && report.matrices.length > 0);
  const hasParametric = Boolean(parametricProfile);

  // Auto-select parametric mode if there is no spatial field yet but a completed parametric sweep exists.
  const activeMode: ValidationMode =
    mode === 'parametric' && hasParametric
      ? 'parametric'
      : hasFieldMatrices
        ? 'field'
        : hasParametric
          ? 'parametric'
          : 'field';

  const fieldEvaluation = useMemo(
    () => evaluateValidation(report?.matrices ?? [], project.validationProfile, reference),
    [report, project.validationProfile, reference],
  );
  const { spec, field, sampled } = fieldEvaluation;

  const activeProfile =
    activeMode === 'parametric'
      ? parametricProfile ?? undefined
      : sampled?.ok
        ? sampled.profile
        : undefined;

  const activeComparison = useMemo(() => {
    if (!activeProfile || !reference || reference.points.length === 0) return undefined;
    return activeMode === 'parametric'
      ? compareToReference(activeProfile.points, reference.points)
      : fieldEvaluation.comparison;
  }, [activeMode, activeProfile, reference, fieldEvaluation.comparison]);

  const activeUnit = activeMode === 'field' ? field?.unit ?? '' : '';

  const svg = useMemo(
    () => (activeProfile ? validationOverlaySvg(activeProfile, reference, activeComparison, 'dark') : ''),
    [activeProfile, reference, activeComparison],
  );

  const updateSpec = (patch: Partial<ProfileSpec>) => onSetProfile?.({ ...spec, ...patch });
  const physical = !!field?.widthM && !!field?.heightM;
  const isVtkProjection = Boolean(field?.key.startsWith('vtk_'));

  const commit = (points: ReferencePoint[], name?: string) => {
    if (!onSetReferenceData) return;
    if (points.length === 0) {
      setNotice({ tone: 'error', text: 'No valid numeric X-Y rows were found.' });
      return;
    }
    onSetReferenceData({
      label: name ?? (label.trim() || 'Reference data'),
      xLabel: activeProfile?.abscissaLabel ?? 'x',
      yLabel: activeProfile?.valueLabel ?? 'value',
      points,
      recordedAt: new Date().toISOString(),
    });
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { points, skipped } = parseReferenceCsv(String(reader.result ?? ''));
      const name = labelTouched && label.trim() ? label.trim() : file.name.replace(/\.[^.]+$/, '');
      if (!labelTouched) setLabel(name);
      setNotice(
        points.length === 0
          ? { tone: 'error', text: 'No valid numeric X-Y rows were found.' }
          : {
              tone: 'info',
              text: `${points.length} points loaded${skipped ? `; ${skipped} non-numeric line${skipped === 1 ? '' : 's'} ignored (for example a header)` : ''}.`,
            },
      );
      commit(points, name);
    };
    reader.readAsText(file);
  };

  const addManual = () => {
    const x = Number(manualX);
    const y = Number(manualY);
    if (manualX.trim() === '' || manualY.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      setNotice({ tone: 'error', text: 'Enter a numeric x and y value.' });
      return;
    }
    setNotice(null);
    commit([...(reference?.points ?? []), { x, y }].sort((a, b) => a.x - b.x));
    setManualX('');
    setManualY('');
  };

  const removePoint = (index: number) => {
    if (!reference) return;
    const points = reference.points.filter((_, i) => i !== index);
    if (points.length === 0) onSetReferenceData?.(undefined);
    else commit(points, reference.label);
  };

  const metrics: [string, string][] =
    activeComparison && activeComparison.compared > 0
      ? [
          ['Mean |error|', activeComparison.meanAbsPercent === undefined ? '—' : `${fmt(activeComparison.meanAbsPercent)} %`],
          ['Max |error|', activeComparison.maxAbsPercent === undefined ? '—' : `${fmt(activeComparison.maxAbsPercent)} %`],
          ['RMSE', `${fmt(activeComparison.rmse)} ${activeUnit}`.trim()],
          ['Max abs. error', `${fmt(activeComparison.maxAbsError)} ${activeUnit}`.trim()],
          ['NRMSE', activeComparison.nrmsePercent === undefined ? '—' : `${fmt(activeComparison.nrmsePercent)} %`],
          ['R²', fmt(activeComparison.r2)],
          ['Points compared', String(activeComparison.compared)],
          ['Outside range', String(activeComparison.outOfRange)],
        ]
      : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Validation Mode Switcher */}
      {(hasFieldMatrices || hasParametric) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-sky-400" />
            <span className="font-semibold text-slate-100">ASME V&amp;V Validation Mode</span>
            <span className="text-slate-500">·</span>
            <span className="text-[11px] text-slate-400">
              Supports OpenFOAM (CFD/CHT/VOF), CalculiX (FEA/Thermal), ElmerFEM &amp; Parametric Sweeps
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('field')}
              disabled={!hasFieldMatrices}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                activeMode === 'field'
                  ? 'bg-sky-600 text-white'
                  : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Spatial Field Cut {hasFieldMatrices ? `(${report!.matrices.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setMode('parametric')}
              disabled={!hasParametric}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                activeMode === 'parametric'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              Parametric Curve {hasParametric ? `(${parametricProfile!.points.length} DPs)` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Reference data ingestion */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-[13px] font-semibold text-slate-100">
          Reference Data (Experimental / Published Paper / Analytical Benchmark)
        </h3>
        <p className="mt-0.5 text-[11.5px] text-slate-400">
          Upload a CSV of X-Y points from your lab experiment or base paper, or enter points manually. X must match the abscissa of the active cut or parametric sweep.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.dat,.tsv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-500"
          >
            <Upload className="h-3.5 w-3.5" /> Upload CSV
          </button>
          <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
            Label
            <input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelTouched(true);
              }}
              onBlur={() =>
                reference && label.trim() && label.trim() !== reference.label && commit(reference.points, label.trim())
              }
              className={`${inputClass} mt-1 w-48 border-slate-700 font-sans focus:border-sky-500`}
            />
          </label>
          <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
            x
            <input
              value={manualX}
              onChange={(event) => setManualX(event.target.value)}
              className={`${inputClass} mt-1 w-24 border-slate-700 focus:border-sky-500`}
            />
          </label>
          <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
            y
            <input
              value={manualY}
              onChange={(event) => setManualY(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addManual()}
              className={`${inputClass} mt-1 w-24 border-slate-700 focus:border-sky-500`}
            />
          </label>
          <button
            type="button"
            onClick={addManual}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[12px] text-slate-200 hover:bg-slate-700"
          >
            <Plus className="h-3.5 w-3.5" /> Add point
          </button>
          {reference && (
            <button
              type="button"
              onClick={() => {
                onSetReferenceData?.(undefined);
                setNotice(null);
              }}
              className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-950/30 px-2.5 py-1.5 text-[12px] text-red-300 hover:bg-red-950/50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
        {notice && (
          <p className={`mt-2 text-[11.5px] ${notice.tone === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
            {notice.text}
          </p>
        )}
        {reference && !notice && (
          <p className="mt-2 text-[11.5px] text-slate-400">
            {reference.points.length} reference points loaded (<span className="text-slate-200">{reference.label}</span>).
          </p>
        )}
      </section>

      {!hasRun && !hasParametric && !reference && (
        <EmptyState
          icon={ShieldCheck}
          title="Validation ready for live solver data"
          message="Run a real simulation (OpenFOAM, CalculiX, or ElmerFEM) or a Parametric Sweep, and upload experimental / paper X-Y reference data to compute RMSE, Mean |Error| %, and R²."
        />
      )}

      {!hasRun && !hasParametric && reference && (
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-950/25 px-4 py-3 text-[12px] text-sky-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <div className="font-semibold">
              Reference data loaded ({reference.points.length} points) — awaiting live solver run
            </div>
            <p className="mt-0.5 text-[11.5px] text-sky-300/80">
              Click <strong>Run Simulation</strong> in the top bar (or execute a <strong>Parametric Sweep</strong>) to overlay real OpenFOAM / CalculiX / ElmerFEM results against this reference curve and compute live error metrics.
            </p>
          </div>
        </div>
      )}

      {/* Spatial field profile controls */}
      {activeMode === 'field' && hasRun && report && report.matrices.length === 0 && (
        <EmptyState
          icon={Crosshair}
          title="No spatial field returned by this solver run"
          message="This run returned scalar summaries without 2-D field matrices or 3-D VTK nodal scalars. Re-run with VTK output enabled or run a Parametric Sweep to validate a multi-point curve."
        />
      )}

      {activeMode === 'field' && hasRun && field && (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100">
                  <Crosshair className="h-4 w-4 text-sky-400" /> Profile location
                </h3>
                <span
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold border ${
                    isVtkProjection
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                      : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {isVtkProjection
                    ? `3D VTK Mid-Plane Projection (${field.cols}×${field.rows})`
                    : `Native 2D Solver Matrix (${field.cols}×${field.rows})`}
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-slate-400">
                Choose the physical field and cut line. Values are bilinearly interpolated directly from real solver nodes (no extrapolation outside the domain).
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => updateSpec(preset.patch)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              Solved Field
              <select
                value={spec.fieldKey}
                onChange={(event) => updateSpec({ fieldKey: event.target.value })}
                className={`${inputClass} mt-1 border-slate-700 font-sans`}
              >
                {report!.matrices.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                    {m.unit ? ` (${m.unit})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              Cut
              <select
                id="profile-kind"
                value={spec.kind}
                onChange={(event) => updateSpec({ kind: event.target.value as ProfileKind })}
                className={`${inputClass} mt-1 border-slate-700 font-sans`}
              >
                {(Object.keys(KIND_LABELS) as ProfileKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            {spec.kind !== 'diagonal' && (
              <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
                Coordinates
                <select
                  id="profile-units"
                  value={spec.units}
                  onChange={(event) => updateSpec({ units: event.target.value as ProfileSpec['units'] })}
                  className={`${inputClass} mt-1 border-slate-700 font-sans`}
                >
                  <option value="fraction">Fraction of the domain (0–1)</option>
                  <option value="m" disabled={!physical}>
                    Meters{physical ? '' : ' (domain size not reported)'}
                  </option>
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {(spec.kind === 'horizontal' || spec.kind === 'vertical') && (
              <NumberField
                id="profile-position"
                label={spec.kind === 'horizontal' ? 'y position' : 'x position'}
                value={spec.position}
                onCommit={(value) => updateSpec({ position: value })}
              />
            )}
            {spec.kind === 'line' && (
              <>
                <NumberField id="profile-x0" label="x start" value={spec.x0} onCommit={(value) => updateSpec({ x0: value })} />
                <NumberField id="profile-y0" label="y start" value={spec.y0} onCommit={(value) => updateSpec({ y0: value })} />
                <NumberField id="profile-x1" label="x end" value={spec.x1} onCommit={(value) => updateSpec({ x1: value })} />
                <NumberField id="profile-y1" label="y end" value={spec.y1} onCommit={(value) => updateSpec({ y1: value })} />
              </>
            )}
            <label className="flex items-center gap-2 pb-1.5 text-[11.5px] text-slate-300">
              <input
                type="checkbox"
                checked={spec.normalizeAbscissa}
                onChange={(event) => updateSpec({ normalizeAbscissa: event.target.checked })}
                className="accent-sky-500"
              />
              Reference X is normalised (0–1 along the cut)
            </label>
          </div>

          {sampled?.ok ? (
            <p className="text-[11.5px] text-slate-400">
              {sampled.profile.description} · {sampled.profile.points.length} samples · reference X must be{' '}
              <span className="font-mono text-slate-300">{sampled.profile.abscissaLabel}</span>
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-1.5 text-[11.5px] text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{' '}
              {sampled && !sampled.ok ? sampled.error : 'No profile.'}
            </p>
          )}
        </section>
      )}

      {/* Parametric Sweep Curve summary */}
      {activeMode === 'parametric' && parametricProfile && (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-200">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span>{parametricProfile.description}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-400">
            Comparing real completed Parametric Sweep outputs against your experimental / published curve. Reference X must be{' '}
            <span className="font-mono text-slate-200">{parametricProfile.abscissaLabel}</span> and Y must be{' '}
            <span className="font-mono text-slate-200">{parametricProfile.valueLabel}</span>.
          </p>
        </section>
      )}

      {/* Overlay Plot */}
      {svg && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <div className="p-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </section>
      )}

      {/* Quantitative Error Analysis */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map(([name, value]) => (
            <div key={name} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
              <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{name}</div>
              <div className="break-words font-mono text-[13px] font-semibold text-slate-100">{value}</div>
            </div>
          ))}
        </div>
      )}

      {activeComparison && activeComparison.compared === 0 && reference && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          None of the reference X values fall inside the simulated range ({activeProfile?.abscissaLabel}); nothing could be compared. Check the coordinate units and whether X is normalised (0–1).
        </p>
      )}

      {reference && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <h3 className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {activeComparison ? 'Point-by-point comparison' : 'Reference points'}
          </h3>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">x</th>
                <th className="px-3 py-1.5 font-medium">Reference</th>
                {activeComparison && <th className="px-3 py-1.5 font-medium">Simulation</th>}
                {activeComparison && <th className="px-3 py-1.5 font-medium">|Error|</th>}
                {activeComparison && <th className="px-3 py-1.5 font-medium">|Error| %</th>}
                <th className="w-8 px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {reference.points.map((point, index) => {
                const row = activeComparison?.rows[index];
                return (
                  <tr key={`${point.x}-${index}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-300">{fmt(point.x)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(point.y)}</td>
                    {activeComparison && (
                      <>
                        <td className="px-3 py-1.5 font-mono text-slate-100">
                          {row?.status === 'compared' ? fmt(row.sim) : <span className="text-slate-600">outside range</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(row?.absError)}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {row?.percentError === undefined ? (
                            '—'
                          ) : (
                            <span className={row.percentError <= 5 ? 'text-emerald-300' : 'text-amber-300'}>
                              {fmt(row.percentError)} %
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Remove point ${index + 1}`}
                        onClick={() => removePoint(index)}
                        className="text-slate-600 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeComparison && (
            <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
              Percentage error is relative to each reference value and is undefined where the reference is zero; absolute error is shown alongside. Reference points outside the solved range are excluded and never extrapolated.
            </p>
          )}
        </section>
      )}

      {hasRun && report && report.checks.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Solver consistency checks</h3>
          {report.checks.map((check) => (
            <div
              key={check.label}
              className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 ${
                check.passed ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/30 bg-red-950/20'
              }`}
            >
              {check.passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              )}
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-100">{check.label}</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">{check.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};
