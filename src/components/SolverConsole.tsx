import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, LineChart, AlertTriangle, XCircle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { ConsoleIssue, ConsoleTab, JobStatus } from '../types/studio';

export interface ResidualPoint {
  iteration: number;
  continuity: number;
  xVelocity: number;
  yVelocity: number;
  energy: number;
}

interface SolverConsoleProps {
  tab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  logs: string[];
  status: JobStatus;
  issues: ConsoleIssue[];
  residuals?: ResidualPoint[];
  onClearIssues: () => void;
}

const MIN_HEIGHT = 96;
const COLLAPSED_HEIGHT = 32;

const SERIES: { key: keyof Omit<ResidualPoint, 'iteration'>; label: string; color: string }[] = [
  { key: 'continuity', label: 'Continuity', color: '#38bdf8' },
  { key: 'xVelocity', label: 'X-Velocity', color: '#34d399' },
  { key: 'yVelocity', label: 'Y-Velocity', color: '#fbbf24' },
  { key: 'energy', label: 'Energy', color: '#f472b6' },
];

const lineTone = (line: string) => {
  if (/\b(error|fail(?:ed|ure)?|fatal|exception|diverg)/i.test(line)) return 'text-red-300';
  if (/\bwarn(?:ing)?\b/i.test(line)) return 'text-amber-300';
  if (/\b(complete[d]?|converged|success)/i.test(line)) return 'text-emerald-300';
  return 'text-slate-300';
};

const ConvergenceChart: React.FC<{ residuals: ResidualPoint[] }> = ({ residuals }) => {
  const usable = residuals.filter((point) => Number.isFinite(point.iteration));
  const logOf = (value: number) => Math.log10(Math.max(value, 1e-12));
  const series = SERIES.map((item) => ({
    ...item,
    values: usable.map((point) => (Number.isFinite(point[item.key]) ? logOf(point[item.key]) : null)),
  }));
  const all = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (usable.length < 2 || all.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[11px] text-slate-500">
        <LineChart className="h-6 w-6 text-slate-600" />
        <span>Convergence charts will appear here once a solve reports residual history.</span>
      </div>
    );
  }
  const minY = Math.floor(Math.min(...all));
  const maxY = Math.ceil(Math.max(...all));
  const spanY = maxY - minY || 1;
  const firstIteration = usable[0].iteration;
  const spanX = usable[usable.length - 1].iteration - firstIteration || 1;
  const toPoints = (values: (number | null)[]) =>
    values
      .map((value, index) =>
        value === null
          ? null
          : `${((usable[index].iteration - firstIteration) / spanX) * 100},${(1 - (value - minY) / spanY) * 100}`,
      )
      .filter(Boolean)
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
          {series.map((item) => (
            <polyline
              key={item.key}
              points={toPoints(item.values)}
              fill="none"
              stroke={item.color}
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <span className="absolute bottom-0 right-0 font-mono text-[9px] text-slate-500">iter {usable[usable.length - 1].iteration}</span>
      </div>
      <ul className="w-28 shrink-0 space-y-1 text-[10.5px] text-slate-400">
        {SERIES.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3" style={{ backgroundColor: item.color }} />
            {item.label}
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
  issues,
  residuals = [],
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
        <span className="ml-auto mr-2 font-mono text-[10px] text-slate-500">job: {status}</span>
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
                <div className="mt-1 flex items-center gap-2 text-sky-400">
                  <span className="inline-block h-3 w-1.5 animate-pulse bg-sky-400" />
                  polling job every 1.5 s…
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          )}

          {tab === 'convergence' && (
            <div className="h-full bg-[#050914] p-3">
              <ConvergenceChart residuals={residuals} />
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
