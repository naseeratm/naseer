import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Crosshair, Plus, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import { ProfileKind, ProfileSpec, ReferenceDataSet, ReferencePoint, ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun } from '../utils/exporter';
import { formatNumber } from '../utils/numberFormat';
import { evaluateValidation, parseReferenceCsv } from '../utils/validationMetrics';
import { validationOverlaySvg } from '../utils/vvPlots';
import { EmptyState } from './EmptyState';

interface ValidationTabProps {
  project: ThesisProject;
  onSetReferenceData?: (data: ReferenceDataSet | undefined) => void;
  onSetProfile?: (profile: ProfileSpec) => void;
}

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
  { label: 'Diagonal', patch: { kind: 'diagonal' } },
];

const inputClass =
  'w-full rounded-lg border bg-slate-950 px-2 py-1.5 font-mono text-[12px] text-slate-200 focus:outline-none disabled:opacity-50';

// Free-typing numeric input: the text is committed only while it parses, so "0." or "-" never becomes NaN.
const NumberField: React.FC<{ id: string; label: string; value: number; onCommit: (value: number) => void }> = ({ id, label, value, onCommit }) => {
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

  const report = useMemo(() => (hasRun ? buildRealReport(project) : null), [hasRun, project]);
  const evaluation = useMemo(
    () => evaluateValidation(report?.matrices ?? [], project.validationProfile, reference),
    [report, project.validationProfile, reference],
  );
  const { spec, field, sampled, comparison } = evaluation;
  const profile = sampled?.ok ? sampled.profile : undefined;
  const svg = useMemo(() => (profile ? validationOverlaySvg(profile, reference, comparison, 'dark') : ''), [profile, reference, comparison]);

  const updateSpec = (patch: Partial<ProfileSpec>) => onSetProfile?.({ ...spec, ...patch });
  const physical = !!field?.widthM && !!field?.heightM;

  const commit = (points: ReferencePoint[], name?: string) => {
    if (!onSetReferenceData) return;
    if (points.length === 0) {
      setNotice({ tone: 'error', text: 'No valid numeric X-Y rows were found.' });
      return;
    }
    onSetReferenceData({
      label: name ?? (label.trim() || 'Reference data'),
      xLabel: profile?.abscissaLabel ?? 'x',
      yLabel: profile?.valueLabel ?? 'value',
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
          : { tone: 'info', text: `${points.length} points loaded${skipped ? `; ${skipped} non-numeric line${skipped === 1 ? '' : 's'} ignored (for example a header)` : ''}.` },
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

  const metrics: [string, string][] = comparison && comparison.compared > 0
    ? [
        ['Mean |error|', comparison.meanAbsPercent === undefined ? '—' : `${fmt(comparison.meanAbsPercent)} %`],
        ['Max |error|', comparison.maxAbsPercent === undefined ? '—' : `${fmt(comparison.maxAbsPercent)} %`],
        ['RMSE', `${fmt(comparison.rmse)} ${field?.unit ?? ''}`],
        ['Max abs. error', `${fmt(comparison.maxAbsError)} ${field?.unit ?? ''}`],
        ['NRMSE', comparison.nrmsePercent === undefined ? '—' : `${fmt(comparison.nrmsePercent)} %`],
        ['R²', fmt(comparison.r2)],
        ['Points compared', String(comparison.compared)],
        ['Outside the cut', String(comparison.outOfRange)],
      ]
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Reference data ingestion */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-[13px] font-semibold text-slate-100">Reference Data (experimental / base paper)</h3>
        <p className="mt-0.5 text-[11.5px] text-slate-400">
          Upload a CSV of X-Y points or enter them manually. X must be expressed in the coordinate of the profile selected below.
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
          <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-500">
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
              onBlur={() => reference && label.trim() && label.trim() !== reference.label && commit(reference.points, label.trim())}
              className={`${inputClass} mt-1 w-44 border-slate-700 font-sans focus:border-sky-500`}
            />
          </label>
          <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
            x
            <input value={manualX} onChange={(event) => setManualX(event.target.value)} className={`${inputClass} mt-1 w-24 border-slate-700 focus:border-sky-500`} />
          </label>
          <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
            y
            <input value={manualY} onChange={(event) => setManualY(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addManual()} className={`${inputClass} mt-1 w-24 border-slate-700 focus:border-sky-500`} />
          </label>
          <button type="button" onClick={addManual} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[12px] text-slate-200 hover:bg-slate-700">
            <Plus className="h-3.5 w-3.5" /> Add point
          </button>
          {reference && (
            <button type="button" onClick={() => { onSetReferenceData?.(undefined); setNotice(null); }} className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-950/30 px-2.5 py-1.5 text-[12px] text-red-300 hover:bg-red-950/50">
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
        {notice && <p className={`mt-2 text-[11.5px] ${notice.tone === 'error' ? 'text-red-400' : 'text-slate-400'}`}>{notice.text}</p>}
        {reference && !notice && <p className="mt-2 text-[11.5px] text-slate-500">{reference.points.length} reference points loaded ({reference.label}).</p>}
      </section>

      {!hasRun && !reference && <EmptyState icon={ShieldCheck} message="No data available. Please run a simulation and load reference data to view Validation." />}
      {!hasRun && reference && (
        <p className="text-[12px] text-slate-400">Run a simulation to overlay its results on the reference data.</p>
      )}

      {/* Profile location */}
      {hasRun && report && report.matrices.length === 0 && (
        <EmptyState
          icon={Crosshair}
          title="No 2-D field to cut a profile from"
          message="This run returned scalar results only (for example CFD and structural runs report peak values, not field arrays), so a profile cannot be compared with reference data."
        />
      )}
      {hasRun && field && (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100"><Crosshair className="h-4 w-4 text-sky-400" /> Profile location</h3>
              <p className="text-[11.5px] text-slate-400">Choose where the simulated field is cut. Values are bilinearly interpolated between nodes.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => updateSpec(preset.patch)} className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {report!.matrices.length > 1 && (
              <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
                Field
                <select value={spec.fieldKey} onChange={(event) => updateSpec({ fieldKey: event.target.value })} className={`${inputClass} mt-1 border-slate-700 font-sans`}>
                  {report!.matrices.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </label>
            )}
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              Cut
              <select id="profile-kind" value={spec.kind} onChange={(event) => updateSpec({ kind: event.target.value as ProfileKind })} className={`${inputClass} mt-1 border-slate-700 font-sans`}>
                {(Object.keys(KIND_LABELS) as ProfileKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
              </select>
            </label>
            {spec.kind !== 'diagonal' && (
              <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
                Coordinates
                <select id="profile-units" value={spec.units} onChange={(event) => updateSpec({ units: event.target.value as ProfileSpec['units'] })} className={`${inputClass} mt-1 border-slate-700 font-sans`}>
                  <option value="fraction">Fraction of the domain (0–1)</option>
                  <option value="m" disabled={!physical}>Meters{physical ? '' : ' (domain size not reported)'}</option>
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {(spec.kind === 'horizontal' || spec.kind === 'vertical') && (
              <NumberField id="profile-position" label={spec.kind === 'horizontal' ? 'y position' : 'x position'} value={spec.position} onCommit={(value) => updateSpec({ position: value })} />
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
              <input type="checkbox" checked={spec.normalizeAbscissa} onChange={(event) => updateSpec({ normalizeAbscissa: event.target.checked })} className="accent-sky-500" />
              Reference X is normalised (0–1 along the cut)
            </label>
          </div>

          {sampled?.ok ? (
            <p className="text-[11.5px] text-slate-400">
              {sampled.profile.description} · {sampled.profile.points.length} samples · reference X must be <span className="font-mono text-slate-300">{sampled.profile.abscissaLabel}</span>
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-1.5 text-[11.5px] text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {sampled && !sampled.ok ? sampled.error : 'No profile.'}
            </p>
          )}
        </section>
      )}

      {/* Overlay */}
      {svg && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <div className="p-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </section>
      )}

      {/* Error analysis */}
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
      {comparison && comparison.compared === 0 && reference && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          None of the reference X values fall inside the simulated cut ({profile?.abscissaLabel}); nothing could be compared. Check the units and whether X is normalised.
        </p>
      )}

      {reference && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <h3 className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {comparison ? 'Point-by-point comparison' : 'Reference points'}
          </h3>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">x</th>
                <th className="px-3 py-1.5 font-medium">Reference</th>
                {comparison && <th className="px-3 py-1.5 font-medium">Simulation</th>}
                {comparison && <th className="px-3 py-1.5 font-medium">|Error|</th>}
                {comparison && <th className="px-3 py-1.5 font-medium">|Error| %</th>}
                <th className="w-8 px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {reference.points.map((point, index) => {
                const row = comparison?.rows[index];
                return (
                  <tr key={`${point.x}-${index}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-300">{fmt(point.x)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(point.y)}</td>
                    {comparison && (
                      <>
                        <td className="px-3 py-1.5 font-mono text-slate-100">{row?.status === 'compared' ? fmt(row.sim) : <span className="text-slate-600">outside the cut</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(row?.absError)}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {row?.percentError === undefined ? '—' : <span className={row.percentError <= 5 ? 'text-emerald-300' : 'text-amber-300'}>{fmt(row.percentError)} %</span>}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" aria-label={`Remove point ${index + 1}`} onClick={() => removePoint(index)} className="text-slate-600 hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {comparison && (
            <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
              Percentage error is relative to each reference value, so it depends on the scale of the quantity (for example °C vs. K) and is undefined where the reference is zero; the absolute error is shown alongside.
              Reference points outside the simulated cut are not compared and never extrapolated.
            </p>
          )}
        </section>
      )}

      {hasRun && report && report.checks.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Solver consistency checks</h3>
          {report.checks.map((check) => (
            <div key={check.label} className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 ${check.passed ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/30 bg-red-950/20'}`}>
              {check.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
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
