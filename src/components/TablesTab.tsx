import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  Square,
  Table as TableIcon,
  XCircle,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun } from '../utils/exporter';
import { withEnterpriseAuthHeaders } from '../utils/enterpriseAuth';
import { readJsonSafe } from '../utils/jobStream';
import {
  JobSummaryItem,
  buildSessionFallbackJobs,
  formatActionLabel,
  formatDuration,
  formatJobFinalSummary,
  mergeProjectJobs,
} from '../utils/jobSummary';
import { EmptyState } from './EmptyState';
import { RunDataTable } from './RunDataTable';

interface TablesTabProps {
  project: ThesisProject;
}

type ScopeMode = 'project' | 'all';
type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);

const statusBadgeClass = (status: string): string => {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
    case 'RUNNING':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/35';
    case 'QUEUED':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/35';
    case 'FAILED':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/35';
    case 'CANCELLED':
      return 'bg-slate-700/60 text-slate-300 border-slate-600/70';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />;
    case 'RUNNING':
      return <Loader2 className="h-3 w-3 animate-spin text-sky-400 shrink-0" />;
    case 'QUEUED':
      return <Clock className="h-3 w-3 text-amber-400 shrink-0" />;
    case 'FAILED':
      return <XCircle className="h-3 w-3 text-rose-400 shrink-0" />;
    default:
      return <AlertCircle className="h-3 w-3 text-slate-400 shrink-0" />;
  }
};

// Every table is built strictly from real stored backend jobs & runs (Zero-Mock).
export const TablesTab: React.FC<TablesTabProps> = ({ project }) => {
  const report = useMemo(() => (hasRealSimulationRun(project) ? buildRealReport(project) : null), [project]);
  const sessionJobs = useMemo(() => buildSessionFallbackJobs(project), [project]);

  const [scope, setScope] = useState<ScopeMode>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [backendJobs, setBackendJobs] = useState<JobSummaryItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState<boolean>(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchJobs = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingJobs(true);
      try {
        const query =
          scope === 'project'
            ? `?project_id=${encodeURIComponent(project.id)}&limit=100`
            : '?limit=100';
        const res = await fetch(`/api/jobs${query}`, {
          headers: withEnterpriseAuthHeaders(),
        });
        const parsed = await readJsonSafe<{ success?: boolean; jobs?: JobSummaryItem[]; error?: string }>(res);
        if (!res.ok || !parsed.data || parsed.data.success === false) {
          throw new Error(parsed.data?.error || parsed.diagnosticMessage || `HTTP ${res.status}`);
        }
        setBackendJobs(Array.isArray(parsed.data.jobs) ? parsed.data.jobs : []);
        setJobsError(null);
      } catch (err: any) {
        setJobsError(err?.message || 'تعذر قراءة سجل المهام من الخادم (:8000)');
      } finally {
        if (!silent) setLoadingJobs(false);
      }
    },
    [project.id, scope],
  );

  useEffect(() => {
    fetchJobs(false);
  }, [fetchJobs, project.simulationRun?.taskId, project.meshStudyResult?.recordedAt]);

  const allJobs = useMemo(() => {
    const scopedSession =
      scope === 'project'
        ? sessionJobs.filter((j) => j.project_id === project.id)
        : sessionJobs;
    return mergeProjectJobs(backendJobs, scopedSession);
  }, [backendJobs, sessionJobs, scope, project.id]);

  const hasActiveJobs = useMemo(
    () => allJobs.some((j) => ACTIVE_STATUSES.has(String(j.status || '').toUpperCase())),
    [allJobs],
  );

  // Auto-refresh every 2.5s only while concurrent jobs are actively QUEUED or RUNNING
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      fetchJobs(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [hasActiveJobs, fetchJobs]);

  const visibleJobs = useMemo(() => {
    return allJobs.filter((j) => {
      const st = String(j.status || '').toUpperCase();
      if (statusFilter === 'active') return ACTIVE_STATUSES.has(st);
      if (statusFilter === 'completed') return st === 'COMPLETED';
      if (statusFilter === 'failed') return st === 'FAILED' || st === 'CANCELLED';
      return true;
    });
  }, [allJobs, statusFilter]);

  const activeCount = useMemo(
    () => allJobs.filter((j) => ACTIVE_STATUSES.has(String(j.status || '').toUpperCase())).length,
    [allJobs],
  );
  const completedCount = useMemo(
    () => allJobs.filter((j) => String(j.status || '').toUpperCase() === 'COMPLETED').length,
    [allJobs],
  );
  const failedCount = useMemo(
    () => allJobs.filter((j) => ['FAILED', 'CANCELLED'].includes(String(j.status || '').toUpperCase())).length,
    [allJobs],
  );

  const handleCancelJob = async (taskId: string) => {
    setCancellingId(taskId);
    try {
      await fetch(`/api/jobs/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: withEnterpriseAuthHeaders(),
      });
      await fetchJobs(true);
    } catch {
      // Errors will be reflected on next refresh
    } finally {
      setCancellingId(null);
    }
  };

  const handleDownloadCase = async (taskId: string) => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/export-case`, {
        headers: withEnterpriseAuthHeaders(),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `naseer-case-${taskId.slice(0, 12)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silent fail on network abort
    }
  };

  if (!report && allJobs.length === 0 && !loadingJobs) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <EmptyState icon={TableIcon} message="No data available. Please run a simulation to view Tables." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Global CAE Job Monitor & Concurrent Study Runs Summary Table */}
      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Activity className={`h-4 w-4 ${hasActiveJobs ? 'text-sky-400' : 'text-slate-400'}`} />
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                Project &amp; Cluster Study Runs Monitor (سجل المهام والجولات المتزامنة)
              </h3>
              <p className="text-[10.5px] text-slate-400">
                {allJobs.length} total · {activeCount} active · {completedCount} completed · {failedCount} failed/cancelled
                {hasActiveJobs ? ' · Live auto-refresh ON' : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <div className="inline-flex overflow-hidden rounded-md border border-slate-700/80 bg-slate-900">
              <button
                type="button"
                onClick={() => setScope('project')}
                className={`px-2 py-1 font-medium transition-colors ${
                  scope === 'project' ? 'bg-sky-600/80 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Active Project
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`px-2 py-1 font-medium transition-colors ${
                  scope === 'all' ? 'bg-sky-600/80 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Runs
              </button>
            </div>

            <div className="inline-flex overflow-hidden rounded-md border border-slate-700/80 bg-slate-900">
              {(['all', 'active', 'completed', 'failed'] as StatusFilter[]).map((flt) => (
                <button
                  key={flt}
                  type="button"
                  onClick={() => setStatusFilter(flt)}
                  className={`px-2 py-1 capitalize transition-colors ${
                    statusFilter === flt ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {flt}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => fetchJobs(false)}
              disabled={loadingJobs}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-800/80 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              title="Refresh live jobs from Docker JobRepository"
            >
              <RefreshCw className={`h-3 w-3 ${loadingJobs ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {jobsError && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-950/30 px-3 py-1.5 text-[11px] text-amber-200">
            <span>{jobsError} — يتم عرض السجلات المحفوظة في الجلسة الحالية إن وُجدت.</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Job / Study</th>
                <th className="px-3 py-2 font-medium">Physics / Solver</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Progress</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Final Results / Live Output</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visibleJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">
                    {loadingJobs
                      ? 'Loading real jobs from Docker JobRepository...'
                      : 'No matching jobs recorded for this filter yet.'}
                  </td>
                </tr>
              ) : (
                visibleJobs.map((job) => {
                  const st = String(job.status || 'QUEUED').toUpperCase();
                  const isActive = ACTIVE_STATUSES.has(st);
                  const pct = Math.max(0, Math.min(100, Math.round(Number(job.progress || 0))));
                  const summaryText = formatJobFinalSummary(job);
                  const timeLabel = job.created_at
                    ? new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '';

                  return (
                    <tr key={job.task_id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-2 align-middle whitespace-nowrap">
                        <div className="font-medium text-slate-200">{formatActionLabel(job.action)}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {job.task_id.slice(0, 12)}
                          {timeLabel ? ` · ${timeLabel}` : ''}
                          {job.sweep_parameter && job.sweep_value !== undefined && job.sweep_value !== null
                            ? ` · ${job.sweep_parameter}=${job.sweep_value}`
                            : ''}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-middle whitespace-nowrap">
                        <div className="text-slate-200">{job.physics_type || '—'}</div>
                        <div className="font-mono text-[10px] text-slate-400">{job.solver || '—'}</div>
                      </td>

                      <td className="px-3 py-2 align-middle whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${statusBadgeClass(st)}`}
                        >
                          <StatusIcon status={st} />
                          <span>{st}</span>
                        </span>
                      </td>

                      <td className="px-3 py-2 align-middle whitespace-nowrap min-w-[110px]">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full transition-all duration-300 ${
                                st === 'FAILED'
                                  ? 'bg-rose-500'
                                  : st === 'COMPLETED'
                                    ? 'bg-emerald-500'
                                    : st === 'CANCELLED'
                                      ? 'bg-slate-500'
                                      : 'bg-sky-400'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] text-slate-300">{pct}%</span>
                        </div>
                      </td>

                      <td className="px-3 py-2 align-middle font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        {formatDuration(job.wall_clock_sec)}
                      </td>

                      <td className="px-3 py-2 align-middle max-w-[320px]">
                        <div
                          className={`truncate font-mono text-[11px] ${
                            st === 'FAILED' ? 'text-rose-300' : 'text-slate-200'
                          }`}
                          title={summaryText}
                        >
                          {summaryText}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-middle text-right whitespace-nowrap">
                        {isActive && job.source === 'backend' ? (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(job.task_id)}
                            disabled={cancellingId === job.task_id}
                            className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10.5px] font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                            <span>{cancellingId === job.task_id ? '...' : 'Cancel'}</span>
                          </button>
                        ) : job.has_case_archive && st === 'COMPLETED' ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadCase(job.task_id)}
                            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-200 hover:bg-sky-500/25"
                            title="Download real solver case ZIP archive"
                          >
                            <Download className="h-3 w-3" />
                            <span>Case ZIP</span>
                          </button>
                        ) : (
                          <span className="text-[10.5px] text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Detailed Active Simulation Run Tables */}
      {report && (
        <>
          <RunDataTable title="Simulation parameters" rows={report.parameters} />
          <RunDataTable title="Solver and mesh" rows={[...report.solver, ...report.mesh]} />
          <RunDataTable title="Results" rows={report.results} />
          <RunDataTable title="Convergence" rows={report.convergenceRows} />
          <RunDataTable title="Provenance" rows={[...report.job, ...report.provenance]} />
        </>
      )}
    </div>
  );
};
