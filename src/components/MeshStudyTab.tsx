import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Grid3X3, Loader2, Play, XCircle } from 'lucide-react';
import { MeshStudyKeyResult, MeshStudyResult, ThesisProject, isCurrentMeshStudy } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun } from '../utils/exporter';
import { VerdictTone, meshStudyVerdict } from '../utils/meshStudyVerdict';
import { formatNumber } from '../utils/numberFormat';
import { meshConvergenceSvg } from '../utils/vvPlots';
import { EmptyState } from './EmptyState';
import { RunDataTable } from './RunDataTable';

interface MeshStudyTabProps {
  project: ThesisProject;
  // Simulation type currently selected in the setup form; it decides which key results are offered.
  simulationType: string;
  onRunMeshStudy?: (keyResultId: string) => Promise<void>;
  meshStudyRunning?: boolean;
  meshStudyError?: string | null;
}

const fmt = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatNumber(value));

const TONES: Record<VerdictTone, string> = {
  good: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-950/20 text-amber-200',
  bad: 'border-red-500/30 bg-red-950/20 text-red-200',
};

// Mesh independence (Grid Convergence Index, Celik et al. 2008) of a physics-specific key result. Everything shown is
// returned by POST /api/mesh-study; the single-run mesh statistics come from the completed solver run.
export const MeshStudyTab: React.FC<MeshStudyTabProps> = ({
  project,
  simulationType,
  onRunMeshStudy,
  meshStudyRunning = false,
  meshStudyError = null,
}) => {
  const report = useMemo(() => (hasRealSimulationRun(project) ? buildRealReport(project) : null), [project]);
  const study = isCurrentMeshStudy(project.meshStudyResult) ? project.meshStudyResult : undefined;
  const stale = !!project.meshStudyResult && !study;

  const [keyResults, setKeyResults] = useState<MeshStudyKeyResult[]>([]);
  const [selected, setSelected] = useState('');
  const [keysError, setKeysError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKeysError(null);
    fetch(`/api/mesh-study/key-results?simulation_type=${encodeURIComponent(simulationType)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body?.key_results)) throw new Error(body?.error ?? `HTTP ${response.status}`);
        return body.key_results as MeshStudyKeyResult[];
      })
      .then((list) => {
        if (cancelled) return;
        setKeyResults(list);
        setSelected((previous) => (list.some((k) => k.id === previous) ? previous : (list.find((k) => k.default) ?? list[0])?.id ?? ''));
      })
      .catch((error) => {
        if (cancelled) return;
        setKeyResults([]);
        setSelected('');
        setKeysError(error instanceof Error ? error.message : 'Unable to load key results');
      });
    return () => {
      cancelled = true;
    };
  }, [simulationType]);

  const current = keyResults.find((k) => k.id === selected);
  const svg = useMemo(() => (study ? meshConvergenceSvg(study, 'dark') : ''), [study]);
  const verdict = study ? meshStudyVerdict(study) : null;
  const Icon = verdict?.tone === 'good' ? CheckCircle2 : verdict?.tone === 'bad' ? XCircle : AlertTriangle;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-slate-100">Mesh Independence Study (GCI)</h3>
            <p className="text-[11.5px] text-slate-400">
              Solves {simulationType.replace(/_/g, ' ')} on coarse, medium and fine meshes and computes the Grid Convergence Index of one key result.
            </p>
          </div>
          <button
            type="button"
            onClick={() => selected && onRunMeshStudy?.(selected)}
            disabled={!onRunMeshStudy || meshStudyRunning || !selected}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {meshStudyRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {meshStudyRunning ? 'Running study…' : 'Run Mesh Independence Study'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="mesh-key-result" className="text-[11px] uppercase tracking-wide text-slate-500">Key result</label>
          <select
            id="mesh-key-result"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={keyResults.length === 0 || meshStudyRunning}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          >
            {keyResults.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </div>
        {current && <p className="text-[11.5px] leading-relaxed text-slate-400">{current.description}</p>}
        {current?.caveat && (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-amber-300/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {current.caveat}
          </p>
        )}
        {keysError && <p className="text-[11.5px] text-red-300">Unable to load the key results for this physics type: {keysError}</p>}
      </section>

      {meshStudyError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-2.5 text-[12px] text-red-200">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{meshStudyError}</span>
        </div>
      )}

      {stale && (
        <EmptyState
          icon={Grid3X3}
          title="Saved study is from an older version"
          message="The mesh study stored with this project predates the current method and was discarded. Run the study again."
        />
      )}

      {!study && !stale && !report && (
        <EmptyState icon={Grid3X3} message="No data available. Please run a simulation or a mesh independence study to view Mesh Study." />
      )}

      {study && verdict && (
        <>
          <div className={`space-y-1.5 rounded-lg border px-4 py-2.5 text-[12.5px] font-medium ${TONES[verdict.tone]}`}>
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{verdict.text}</span>
            </div>
            {study.key_result.caveat && <p className="pl-6 text-[11.5px] font-normal opacity-90">{study.key_result.caveat}</p>}
          </div>

          {study.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2.5 text-[11.5px] text-amber-200/90">
              {study.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {warning}
                </li>
              ))}
            </ul>
          )}

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
            <h3 className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {study.key_result.label}{study.key_result.unit ? ` (${study.key_result.unit})` : ''} — {study.physics_type.replace(/_/g, ' ')}{study.solver ? ` · ${study.solver}` : ''}
            </h3>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-1.5 font-medium">Level</th>
                  <th className="px-3 py-1.5 font-medium">Mesh</th>
                  <th className="px-3 py-1.5 font-medium">Cells</th>
                  <th className="px-3 py-1.5 font-medium">Nodes</th>
                  <th className="px-3 py-1.5 font-medium">h / h_fine</th>
                  <th className="px-3 py-1.5 font-medium">{study.key_result.label}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {study.levels.map((level) => (
                  <tr key={level.level}>
                    <td className="px-3 py-1.5 capitalize text-slate-300">{level.level}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">
                      {level.mesh_size !== null ? `${fmt(level.mesh_size)} m` : level.divisions ? `${level.divisions.x}×${level.divisions.y}×${level.divisions.z} div.` : '—'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(level.cells)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(level.nodes)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{fmt(level.relative_size)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-100">{formatNumber(level.key_result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['GCI (fine)', study.gci_fine_percent === null ? '—' : `${fmt(study.gci_fine_percent)} %`],
              ['GCI (medium)', study.gci_medium_percent === null ? '—' : `${fmt(study.gci_medium_percent)} %`],
              ['Observed order p', fmt(study.observed_order)],
              ['Asymptotic ratio', fmt(study.asymptotic_ratio)],
              ['Extrapolated value', study.extrapolated_value === null ? '—' : `${fmt(study.extrapolated_value)} ${study.key_result.unit}`],
              ['Fine-grid uncertainty', study.uncertainty_fine === null ? '—' : `± ${fmt(study.uncertainty_fine)} ${study.key_result.unit}`],
              ['Refinement r21 / r32', `${fmt(study.r21)} / ${fmt(study.r32)}`],
              ['Convergence', study.convergence_type ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="break-words font-mono text-[13px] font-semibold capitalize text-slate-100">{value}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Refinement ratios come from the solver's cell counts ({study.dimension}-D, safety factor {fmt(study.safety_factor)}).
            {study.basis_note ? ` ${study.basis_note}` : ''}
          </p>

          {svg && (
            <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="p-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            </section>
          )}
        </>
      )}

      {!study && report && report.mesh.length > 0 && (
        <>
          <RunDataTable title="Mesh reported by the solver (single run)" rows={report.mesh} />
          <p className="text-[11.5px] text-slate-500">
            This run used a single mesh. Run a mesh independence study to compute the GCI across multiple grids.
          </p>
        </>
      )}
    </div>
  );
};
