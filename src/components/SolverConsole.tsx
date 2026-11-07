import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, LineChart, AlertTriangle, XCircle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { ConsoleIssue, ConsoleTab, JobStatus } from '../types/studio';

export interface ResidualSeriesPoint {
  iteration: number;
  value: number;
}

// A single named residual stream exactly as reported by the solver backend.
export interface ResidualSeries {
  name: string;
  points: ResidualSeriesPoint[];
}

interface SolverConsoleProps {
  tab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  logs: string[];
  status: JobStatus;
  progress?: number | null;
  issues: ConsoleIssue[];
  residualSeries?: ResidualSeries[];
  onClearIssues: () => void;
}

const MIN_HEIGHT = 96;
const COLLAPSED_HEIGHT = 32;

const SERIES_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#c084fc', '#f43f5e'];

const lineTone = (line: string) => {
  if (/\b(error|fail(?:ed|ure)?|fatal|exception|diverg)/i.test(line)) return 'text-red-300';
  if (/\bwarn(?:ing)?\b/i.test(line)) return 'text-amber-300';
  if (/\b(complete[d]?|converged|success)/i.test(line)) return 'text-emerald-300';
  return 'text-slate-300';
};

const ConvergenceChart: React.FC<{ series: ResidualSeries[] }> = ({ series }) => {
  // Only real, positive residual samples reported by the backend are plottable on a log scale.
  const usable = series
    .map((item, index) => ({
      name: item.name,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      points: item.points.filter(
        (point) => Number.isFinite(point.iteration) && Number.isFinite(point.value) && point.value > 0,
      ),
    }))
    .filter((item) => item.points.length >= 2);
  const allPoints = usable.flatMap((item) => item.points);
  if (allPoints.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[11px] text-slate-500">
        <LineChart className="h-6 w-6 text-slate-600" />
        <span>Convergence charts will appear here once a solve reports residual history.</span>
      </div>
    );
  }
  const logOf = (value: number) => Math.log10(value);
  const all = allPoints.map((point) => logOf(point.value));
  const minY = Math.floor(Math.min(...all));
  const maxY = Math.ceil(Math.max(...all));
  const spanY = maxY - minY || 1;
  const firstIteration = Math.min(...allPoints.map((point) => point.iteration));
  const lastIteration = Math.max(...allPoints.map((point) => point.iteration));
  const spanX = lastIteration - firstIteration || 1;
  const toPoints = (points: ResidualSeriesPoint[]) =>
    points
      .map(
        (point) =>
          `${((point.iteration - firstIteration) / spanX) * 100},${(1 - (logOf(point.value) - minY) / spanY) * 100}`,
      )
      .join(' ');

  return (
    <div className="flex h-full gap-3">
      <div className="relative min-w-0 flex-1 pl-9">
        <span className="absolute left-0 top-0 font-mono text-[9px] text-slate-500">1e{maxY}</span>
        <span className="absolute bottom-3 left-0 font-mono text-[9px] text-slate-500">1e{minY}</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[calc(100%-12px)] w-full border-b border-l border-slate-700">
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#334155" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          ))}
          {usable.map((item) => (
            <polyline
              key={item.name}
              points={toPoints(item.points)}
              fill="none"
              stroke={item.color}
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span className="absolute bottom-0 right-0 font-mono text-[9px] text-slate-500">iter {lastIteration}</span>
      </div>
      <ul className="w-28 shrink-0 space-y-1 text-[10.5px] text-slate-400">
        {usable.map((item) => (
          <li key={item.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3" style={{ backgroundColor: item.color }} />
            <span className="truncate" title={item.name}>{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const SolverConsole: React.FC<SolverConsoleProps> = ({
  tab,
  onTabChange,
  logs,
  status,
  progress = null,
  issues,
  residualSeries = [],
  onClearIssues,
}) => {
  const [height, setHeight] = useState(232);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const logWarnings = useMemo(
    () => logs.filter((line) => /\bwarn(?:ing)?\b/i.test(line)).map((message, index) => ({ id: -1 - index, time: '', severity: 'warning' as const, message })),
    [logs],
  );
  const combinedIssues: ConsoleIssue[] = [...issues, ...logWarnings];
  const errorCount = combinedIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = combinedIssues.length - errorCount;

  // A tab change requested by the app (e.g. after a failure) must reveal the drawer.
  useEffect(() => {
    setCollapsed(false);
  }, [tab]);

  useEffect(() => {
    if (tab === 'logs' && stickToBottomRef.current) logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs, tab, collapsed]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCollapsed(false);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - event.clientY;
    const max = Math.round(window.innerHeight * 0.65);
    setHeight(Math.min(max, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta)));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const tabs: { id: ConsoleTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: 'logs', label: 'Solver Logs', icon: <Terminal className="h-3.5 w-3.5" /> },
    { id: 'convergence', label: 'Convergence Charts', icon: <LineChart className="h-3.5 w-3.5" /> },
    {
      id: 'errors',
      label: 'Errors/Warnings',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      badge:
        errorCount + warningCount > 0 ? (
          <span className={`rounded px-1 font-mono text-[9px] ${errorCount > 0 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {errorCount + warningCount}
          </span>
        ) : null,
    },
  ];

  return (
    <section
      aria-label="Solver console"
      className="flex shrink-0 flex-col border-t border-slate-800 bg-slate-950 print:hidden"
      style={{ height: collapsed ? COLLAPSED_HEIGHT : height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="h-1 w-full shrink-0 cursor-row-resize bg-slate-800 transition-colors hover:bg-sky-500/60"
      />
      <div className="flex h-[27px] shrink-0 items-center border-b border-slate-800 pl-1 pr-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            aria-pressed={tab === item.id && !collapsed}
            className={`flex h-full items-center gap-1.5 border-b-2 px-3 text-[11px] font-medium transition-colors ${
              tab === item.id ? 'border-sky-400 text-sky-200' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </button>
        ))}
        <span className="ml-auto mr-2 font-mono text-[10px] text-slate-500">
          job: {status}
          {typeof progress === 'number' && ` · ${Math.min(100, Math.max(0, Math.round(progress)))}%`}
        </span>
        {tab === 'errors' && combinedIssues.length > 0 && (
          <button onClick={onClearIssues} title="Clear errors" className="mr-1 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? 'Expand console' : 'Collapse console'}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'logs' && (
            <div
              ref={logScrollRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="h-full overflow-y-auto bg-[#050914] px-3 py-2 font-['JetBrains_Mono',monospace] text-[11px] leading-[1.55]"
            >
              {logs.length === 0 ? (
                <div className="text-slate-600">$ waiting for solver output… press “Run Simulation” to start.</div>
              ) : (
                logs.map((line, index) => (
                  <div key={index} className={`flex gap-3 whitespace-pre-wrap break-words ${lineTone(line)}`}>
                    <span className="w-8 shrink-0 select-none text-right text-slate-700">{index + 1}</span>
                    <span className="min-w-0 flex-1">{line}</span>
                  </div>
                ))
              )}
              {(status === 'queued' || status === 'running') && (
                <div className="mt-1 space-y-1.5">
                  {typeof progress === 'number' && (
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.max(0, Math.round(progress)))}
                      className="h-1 w-full overflow-hidden rounded bg-slate-800"
                    >
                      <div
                        className="h-full bg-sky-500 transition-[width] duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sky-400">
                    <span className="inline-block h-3 w-1.5 animate-pulse bg-sky-400" />
                    {status === 'queued' ? 'job queued on solver backend…' : 'solver running — streaming job state every 1.5 s…'}
                  </div>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          )}

          {tab === 'convergence' && (
            <div className="h-full bg-[#050914] p-3">
              <ConvergenceChart series={residualSeries} />
            </div>
          )}

          {tab === 'errors' && (
            <div className="h-full overflow-y-auto bg-[#050914]">
              {combinedIssues.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[11px] text-slate-600">No errors or warnings.</div>
              ) : (
                <ul className="divide-y divide-slate-800/70">
                  {combinedIssues.map((issue) => (
                    <li key={issue.id} className="flex items-start gap-2 px-3 py-1.5 text-[11.5px]">
                      {issue.severity === 'error' ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      )}
                      <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${issue.severity === 'error' ? 'text-red-200' : 'text-amber-200'}`}>
                        {issue.message}
                      </span>
                      {issue.time && <span className="shrink-0 font-mono text-[10px] text-slate-600">{issue.time}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
