import { ThesisProject } from '../types/thesis';

export type JobActionKind = 'simulation' | 'mesh_study' | 'vv_suite' | 'mesh_generate' | string;

export interface JobSummaryMetrics {
  kind?: string;
  key_result_label?: string;
  key_result_unit?: string;
  gci_fine_percent?: number | null;
  observed_order?: number | null;
  convergence_type?: string | null;
  grid_independent?: boolean | null;
  levels_completed?: number;
  total_levels?: number;
  overall_status?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  completed_count?: number;
  total?: number;
  nodes_count?: number | null;
  elements_count?: number | null;
  max_velocity_mps?: number | null;
  pressure_drop_pa?: number | null;
  max_von_mises_pa?: number | null;
  max_displacement_m?: number | null;
  center_temperature?: number | null;
  max_temperature?: number | null;
  nusselt_number?: number | null;
  em_peak?: number | null;
  em_unit?: string | null;
  converged?: boolean | null;
}

export interface JobSummaryItem {
  task_id: string;
  project_id: string;
  action: JobActionKind;
  physics_type?: string | null;
  solver?: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
  progress: number;
  status_message?: string | null;
  current_iteration?: number | null;
  wall_clock_sec?: number | null;
  sweep_parameter?: string | null;
  sweep_value?: number | null;
  summary_metrics?: JobSummaryMetrics;
  has_case_archive?: boolean;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  source?: 'backend' | 'session';
}

const fmtNum = (val: unknown, digits = 3): string | null => {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  const abs = Math.abs(val);
  if (abs === 0) return '0';
  if (abs >= 1e5 || abs < 1e-3) return val.toExponential(2);
  return Number(val.toPrecision(digits + 1)).toString();
};

export function formatActionLabel(action: string): string {
  switch (action) {
    case 'mesh_study':
      return 'Mesh Study (GCI)';
    case 'vv_suite':
      return 'V&V Verification';
    case 'mesh_generate':
      return 'Gmsh 3D Mesh';
    default:
      return 'Simulation Run';
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds - mins * 60;
  return `${mins}m ${rem.toFixed(0)}s`;
}

export function formatJobFinalSummary(job: JobSummaryItem): string {
  const status = String(job.status || '').toUpperCase();
  if (status === 'FAILED') {
    return job.error ? `Error: ${job.error}` : 'Execution failed';
  }
  if (status === 'CANCELLED') {
    return job.error || 'Cancelled by engineer';
  }

  const m = job.summary_metrics || {};

  if (job.action === 'mesh_study' || m.kind === 'mesh_study') {
    if (status === 'RUNNING' || status === 'QUEUED') {
      const done = typeof m.levels_completed === 'number' ? m.levels_completed : 0;
      return job.status_message || `Grid levels completed: ${done}/3`;
    }
    const parts: string[] = [];
    if (typeof m.gci_fine_percent === 'number') {
      parts.push(`GCI_fine = ${m.gci_fine_percent.toFixed(2)}%`);
    }
    if (typeof m.observed_order === 'number') {
      parts.push(`p = ${m.observed_order.toFixed(2)}`);
    }
    if (m.convergence_type) {
      parts.push(String(m.convergence_type));
    }
    if (typeof m.grid_independent === 'boolean') {
      parts.push(m.grid_independent ? 'Grid Independent' : 'Refinement Needed');
    }
    return parts.length > 0 ? parts.join(' · ') : 'Completed';
  }

  if (job.action === 'vv_suite' || m.kind === 'vv_suite') {
    const passed = typeof m.passed === 'number' ? m.passed : 0;
    const failed = typeof m.failed === 'number' ? m.failed : 0;
    const skipped = typeof m.skipped === 'number' ? m.skipped : 0;
    if (status === 'RUNNING' || status === 'QUEUED') {
      const done = typeof m.completed_count === 'number' ? m.completed_count : passed + failed + skipped;
      const total = typeof m.total === 'number' && m.total > 0 ? m.total : 6;
      return `${done}/${total} benchmarks (${passed} PASS · ${failed} FAIL · ${skipped} SKIP)`;
    }
    const verdict = m.overall_status ? `${m.overall_status} — ` : '';
    return `${verdict}${passed} PASS · ${failed} FAIL · ${skipped} SKIPPED`;
  }

  if (job.action === 'mesh_generate' || m.kind === 'mesh_generate') {
    const parts: string[] = [];
    if (typeof m.nodes_count === 'number') parts.push(`${m.nodes_count.toLocaleString()} nodes`);
    if (typeof m.elements_count === 'number') parts.push(`${m.elements_count.toLocaleString()} elements`);
    return parts.length > 0 ? parts.join(' · ') : (status === 'COMPLETED' ? 'Mesh generated' : 'Meshing...');
  }

  const parts: string[] = [];
  if (typeof m.max_velocity_mps === 'number') {
    parts.push(`V_max = ${fmtNum(m.max_velocity_mps)} m/s`);
  }
  if (typeof m.pressure_drop_pa === 'number') {
    parts.push(`ΔP = ${fmtNum(m.pressure_drop_pa)} Pa`);
  }
  if (typeof m.max_von_mises_pa === 'number') {
    const mpa = m.max_von_mises_pa >= 1e5 ? `${(m.max_von_mises_pa / 1e6).toFixed(2)} MPa` : `${fmtNum(m.max_von_mises_pa)} Pa`;
    parts.push(`σ_vm = ${mpa}`);
  }
  if (typeof m.max_displacement_m === 'number') {
    parts.push(`δ_max = ${(m.max_displacement_m * 1e3).toFixed(3)} mm`);
  }
  if (typeof m.center_temperature === 'number') {
    parts.push(`T_center = ${fmtNum(m.center_temperature)} °C`);
  } else if (typeof m.max_temperature === 'number') {
    parts.push(`T_max = ${fmtNum(m.max_temperature)}`);
  }
  if (typeof m.nusselt_number === 'number') {
    parts.push(`Nu = ${fmtNum(m.nusselt_number)}`);
  }
  if (typeof m.em_peak === 'number') {
    parts.push(`Peak = ${fmtNum(m.em_peak)}${m.em_unit ? ` ${m.em_unit}` : ''}`);
  }

  if (parts.length > 0) return parts.join(' · ');
  if (status === 'RUNNING' || status === 'QUEUED') {
    if (typeof job.current_iteration === 'number' && job.current_iteration > 0) {
      return `Iteration ${job.current_iteration}${job.status_message ? ` — ${job.status_message}` : ''}`;
    }
    return job.status_message || (status === 'QUEUED' ? 'Waiting for worker slot...' : 'Solving...');
  }
  return 'Completed (real solver output)';
}

/**
 * Extract real session-recorded runs from the active ThesisProject when not already returned by backend
 * (e.g., direct mode runs or when inspecting a saved project while Docker is offline).
 */
export function buildSessionFallbackJobs(project: ThesisProject): JobSummaryItem[] {
  const items: JobSummaryItem[] = [];

  if (project.simulationRun?.result) {
    const run = project.simulationRun;
    const res: any = run.result;
    const nested: any = res?.data && typeof res.data === 'object' ? res.data : res;
    const integrals: any = nested?.integrals && typeof nested.integrals === 'object' ? nested.integrals : {};
    items.push({
      task_id: run.taskId || `session-sim-${project.id.slice(0, 8)}`,
      project_id: project.id,
      action: 'simulation',
      physics_type: res?.physics_type || String(run.submittedRequest?.simulation_type || project.field),
      solver: res?.solver || res?.recommended_solver || nested?.solver || '',
      status: 'COMPLETED',
      progress: typeof run.progress === 'number' ? run.progress : 100,
      wall_clock_sec: typeof res?.process_time === 'number' ? res.process_time : null,
      summary_metrics: {
        kind: 'simulation',
        max_velocity_mps: integrals?.max_velocity_mps ?? nested?.max_velocity ?? null,
        pressure_drop_pa: integrals?.pressure_drop_pa ?? nested?.pressure_drop_pa ?? null,
        max_von_mises_pa: integrals?.max_von_mises_pa ?? nested?.max_von_mises_pa ?? null,
        max_displacement_m: integrals?.max_displacement_m ?? nested?.max_displacement_m ?? null,
        center_temperature: nested?.center_temperature ?? null,
        max_temperature: nested?.max_temperature ?? nested?.temperature_max ?? null,
        nusselt_number: integrals?.nusselt_number ?? nested?.nusselt_number ?? null,
      },
      has_case_archive: Boolean(run.taskId && (res?.case_directory || nested?.case_directory)),
      created_at: run.createdAt || run.recordedAt,
      completed_at: run.completedAt || run.recordedAt,
      source: 'session',
    });
  }

  if (project.meshStudyResult) {
    const study = project.meshStudyResult;
    items.push({
      task_id: `session-gci-${project.id.slice(0, 8)}`,
      project_id: project.id,
      action: 'mesh_study',
      physics_type: study.physics_type,
      solver: study.solver || '',
      status: 'COMPLETED',
      progress: 100,
      summary_metrics: {
        kind: 'mesh_study',
        key_result_label: study.key_result?.label,
        key_result_unit: study.key_result?.unit,
        gci_fine_percent: study.gci_fine_percent,
        observed_order: study.observed_order,
        convergence_type: study.convergence_type,
        grid_independent: study.grid_independent,
        levels_completed: Array.isArray(study.levels) ? study.levels.length : 3,
      },
      created_at: study.recordedAt,
      completed_at: study.recordedAt,
      source: 'session',
    });
  }

  return items;
}

/**
 * Merge live backend JobRepository rows with any non-duplicate in-session project records.
 */
export function mergeProjectJobs(
  backendJobs: JobSummaryItem[],
  sessionJobs: JobSummaryItem[],
): JobSummaryItem[] {
  const seen = new Set<string>();
  const merged: JobSummaryItem[] = [];

  for (const job of backendJobs) {
    if (!job?.task_id || seen.has(job.task_id)) continue;
    seen.add(job.task_id);
    merged.push({ ...job, source: 'backend' });
  }

  for (const job of sessionJobs) {
    if (!job?.task_id || seen.has(job.task_id)) continue;
    // Skip synthetic session-gci entry if a completed backend mesh_study already exists for this project
    if (
      job.task_id.startsWith('session-gci-') &&
      merged.some((b) => b.action === 'mesh_study' && b.status === 'COMPLETED' && b.project_id === job.project_id)
    ) {
      continue;
    }
    seen.add(job.task_id);
    merged.push(job);
  }

  return merged.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
}
