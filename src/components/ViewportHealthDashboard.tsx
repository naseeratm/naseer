import React, { useEffect, useState, useRef } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  HardDrive,
  Server,
  AlertTriangle,
} from 'lucide-react';
import { JobStatus } from '../types/studio';

export interface LiveJobTelemetry {
  hostname?: string | null;
  sampled_at_utc?: string | null;
  cpu_percent?: number | null;
  cpu_cores?: number | null;
  host_cpu_cores?: number | null;
  load_avg_1m?: number | null;
  load_avg_5m?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  memory_percent?: number | null;
  memory_source?: string | null;
  solver_pid?: number | null;
  solver_rss_mb?: number | null;
  wall_clock_sec?: number | null;
  job_wall_clock_sec?: number | null;
  solver_binary?: string | null;
}

interface LiveTelemetryApiResponse {
  success: boolean;
  source?: string;
  workers_online?: number;
  total_cluster_cores?: number;
  telemetry?: LiveJobTelemetry;
  active_job?: {
    task_id?: string;
    status?: string;
    progress?: number;
    wall_clock_sec?: number | null;
    current_iteration?: number | null;
    status_message?: string | null;
    physics_type?: string | null;
  } | null;
}

export interface ViewportHealthDashboardProps {
  jobStatus: JobStatus;
  activeTaskId?: string | null;
  solverProgress?: number | null;
  currentIteration?: number | null;
  liveJobTelemetry?: LiveJobTelemetry | null;
  jobWallClockSec?: number | null;
  lastCompletedDurationSec?: number | null;
  solverLabel?: string;
}

function formatWallClock(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00:00';
  }
  const s = Math.floor(totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatMemoryGb(mb: number | null | undefined): string {
  if (typeof mb !== 'number' || !Number.isFinite(mb)) return 'N/A';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export const ViewportHealthDashboard: React.FC<ViewportHealthDashboardProps> = ({
  jobStatus,
  activeTaskId,
  solverProgress,
  currentIteration,
  liveJobTelemetry,
  jobWallClockSec,
  lastCompletedDurationSec,
  solverLabel,
}) => {
  const isRunning = jobStatus === 'running' || jobStatus === 'queued';
  const [expanded, setExpanded] = useState<boolean>(false);
  const [polledData, setPolledData] = useState<LiveTelemetryApiResponse | null>(null);
  const [offlineError, setOfflineError] = useState<boolean>(false);
  const [displayWallSec, setDisplayWallSec] = useState<number | null>(null);
  const syncAnchorRef = useRef<{ baseSec: number; syncedAtMs: number } | null>(null);

  // Auto-expand smoothly when a real job begins solving
  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
    }
  }, [isRunning]);

  // Poll real OS/Docker telemetry from GET /api/telemetry/live (Zero-Mock)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/telemetry/live');
        if (!res.ok) {
          if (!cancelled) setOfflineError(true);
          return;
        }
        const json = (await res.json()) as LiveTelemetryApiResponse;
        if (!cancelled && json?.success) {
          setPolledData(json);
          setOfflineError(false);
        }
      } catch {
        if (!cancelled) setOfflineError(true);
      }
    };

    poll();
    const intervalMs = isRunning ? 2000 : expanded ? 4000 : 12000;
    const timer = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isRunning, expanded]);

  // Synchronize wall-clock anchor with real backend job wall_clock_sec
  const authoritativeWallSec =
    liveJobTelemetry?.job_wall_clock_sec ??
    jobWallClockSec ??
    liveJobTelemetry?.wall_clock_sec ??
    polledData?.active_job?.wall_clock_sec ??
    null;

  useEffect(() => {
    if (isRunning) {
      const base = typeof authoritativeWallSec === 'number' && Number.isFinite(authoritativeWallSec)
        ? authoritativeWallSec
        : syncAnchorRef.current?.baseSec ?? 0;
      syncAnchorRef.current = { baseSec: base, syncedAtMs: Date.now() };
      setDisplayWallSec(base);
    } else if (jobStatus === 'completed' && typeof lastCompletedDurationSec === 'number' && Number.isFinite(lastCompletedDurationSec)) {
      syncAnchorRef.current = null;
      setDisplayWallSec(lastCompletedDurationSec);
    } else if (jobStatus === 'idle') {
      syncAnchorRef.current = null;
      setDisplayWallSec(null);
    }
  }, [isRunning, authoritativeWallSec, jobStatus, lastCompletedDurationSec]);

  // Tick real wall-clock smoothly at 1 Hz only while job is genuinely active
  useEffect(() => {
    if (!isRunning) return;
    if (!syncAnchorRef.current) {
      syncAnchorRef.current = { baseSec: 0, syncedAtMs: Date.now() };
    }
    const tick = window.setInterval(() => {
      const anchor = syncAnchorRef.current;
      if (!anchor) return;
      const elapsed = anchor.baseSec + (Date.now() - anchor.syncedAtMs) / 1000;
      setDisplayWallSec(elapsed);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [isRunning]);

  // Prefer live job-attached worker telemetry over idle poll telemetry
  const tel: LiveJobTelemetry | null =
    (isRunning && liveJobTelemetry ? liveJobTelemetry : null) ?? polledData?.telemetry ?? null;

  const cpuPct = typeof tel?.cpu_percent === 'number' && Number.isFinite(tel.cpu_percent) ? tel.cpu_percent : null;
  const memPct = typeof tel?.memory_percent === 'number' && Number.isFinite(tel.memory_percent) ? tel.memory_percent : null;
  const cpuCores = tel?.cpu_cores ?? polledData?.total_cluster_cores ?? null;
  const solverRssMb = typeof tel?.solver_rss_mb === 'number' && Number.isFinite(tel.solver_rss_mb) ? tel.solver_rss_mb : null;
  const sourceTag = offlineError
    ? 'OFFLINE'
    : polledData?.source === 'docker_worker_job' || (isRunning && liveJobTelemetry)
      ? 'WORKER LIVE'
      : polledData?.source === 'docker_worker'
        ? 'WORKER NODE'
        : polledData?.source === 'api_container'
          ? 'API NODE'
          : 'CONNECTING';

  const statusColor = isRunning
    ? 'text-amber-300'
    : jobStatus === 'completed'
      ? 'text-emerald-300'
      : jobStatus === 'failed'
        ? 'text-rose-300'
        : 'text-slate-400';

  const effectiveIter = currentIteration ?? polledData?.active_job?.current_iteration ?? null;
  const effectiveTaskId = activeTaskId ?? polledData?.active_job?.task_id ?? null;

  return (
    <div
      className="pointer-events-auto absolute left-3 top-[66px] z-20 select-none rounded-xl border border-slate-700/80 bg-slate-950/92 shadow-2xl backdrop-blur-md transition-all"
      style={{ width: expanded ? 276 : 'auto' }}
    >
      {/* Compact Header / Wall-Clock Strip (always visible, toggleable) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2.5 px-2.5 py-1.5 text-left hover:bg-slate-900/70 rounded-xl transition-colors"
        title="Simulation Health & Performance Dashboard (Real OS / Docker Telemetry)"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              offlineError
                ? 'bg-rose-500'
                : isRunning
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
            }`}
          />
          <Clock className={`h-3.5 w-3.5 shrink-0 ${isRunning ? 'text-amber-400' : 'text-sky-400'}`} />
          <span className="font-mono text-[11px] font-bold tracking-wider text-slate-100 tabular-nums">
            {formatWallClock(displayWallSec)}
          </span>
          {!expanded && (
            <span className="font-mono text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
              · CPU {cpuPct !== null ? `${cpuPct.toFixed(0)}%` : 'N/A'} · RAM{' '}
              {memPct !== null ? `${memPct.toFixed(0)}%` : 'N/A'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
              offlineError
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : isRunning
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            {sourceTag}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
        </div>
      </button>

      {/* Expanded Real-Time HPC Gauges */}
      {expanded && (
        <div className="border-t border-slate-800/90 px-3 py-2.5 space-y-2.5 text-[11px]">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400 flex items-center gap-1">
              <Activity className="h-3 w-3 text-sky-400" />
              HPC Health Monitor
            </span>
            <span className={`font-bold uppercase ${statusColor}`}>
              {jobStatus}
              {isRunning && typeof solverProgress === 'number' ? ` · ${solverProgress}%` : ''}
            </span>
          </div>

          {offlineError ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/40 p-2 text-[10px] text-rose-200">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span>
                Docker Telemetry (:8000) غير متصل — سياسة Zero-Mock تمنع عرض أي نسب وهمية للمعالج أو الذاكرة.
              </span>
            </div>
          ) : (
            <>
              {/* CPU Core Load */}
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Cpu className="h-3 w-3 text-sky-400" />
                    CPU Load {cpuCores ? `(${cpuCores}c)` : ''}
                  </span>
                  <span className="text-slate-100 font-bold tabular-nums">
                    {cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}
                    {typeof tel?.load_avg_1m === 'number' ? (
                      <span className="text-slate-500 font-normal"> · L1 {tel.load_avg_1m.toFixed(2)}</span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      cpuPct !== null && cpuPct > 85
                        ? 'bg-rose-500'
                        : cpuPct !== null && cpuPct > 60
                          ? 'bg-amber-400'
                          : 'bg-sky-400'
                    }`}
                    style={{ width: `${cpuPct !== null ? Math.min(100, Math.max(0, cpuPct)) : 0}%` }}
                  />
                </div>
              </div>

              {/* Memory Usage */}
              <div className="space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <HardDrive className="h-3 w-3 text-emerald-400" />
                    RAM Usage
                  </span>
                  <span className="text-slate-100 font-bold tabular-nums">
                    {tel?.memory_used_mb != null && tel?.memory_total_mb != null
                      ? `${formatMemoryGb(tel.memory_used_mb)} / ${formatMemoryGb(tel.memory_total_mb)}`
                      : 'N/A'}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      memPct !== null && memPct > 85
                        ? 'bg-rose-500'
                        : memPct !== null && memPct > 65
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                    style={{ width: `${memPct !== null ? Math.min(100, Math.max(0, memPct)) : 0}%` }}
                  />
                </div>
                {solverRssMb !== null && (
                  <div className="flex items-center justify-between font-mono text-[9.5px] text-slate-400">
                    <span>Solver Process RSS ({tel?.solver_binary || 'solver'}):</span>
                    <span className="text-emerald-300 font-semibold tabular-nums">{solverRssMb.toFixed(1)} MB</span>
                  </div>
                )}
              </div>

              {/* Active Job Metadata & Wall-Clock Root */}
              <div className="rounded-lg border border-slate-800/90 bg-slate-900/70 px-2 py-1.5 font-mono text-[9.5px] text-slate-400 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Server className="h-2.5 w-2.5 text-purple-400" />
                    Node:
                  </span>
                  <span className="text-slate-200 truncate max-w-[165px]" title={tel?.hostname || ''}>
                    {tel?.hostname || '—'} ({polledData?.workers_online ?? 0}w)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Active Job:</span>
                  <span className="text-sky-300 truncate max-w-[165px]">
                    {effectiveTaskId ? `#${effectiveTaskId.slice(0, 8)}` : solverLabel || 'Standby'}
                    {effectiveIter && effectiveIter > 0 ? ` · iter ${effectiveIter}` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Source:</span>
                  <span className="text-slate-300">
                    /proc/stat · {tel?.memory_source || 'kernel'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
