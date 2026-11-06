import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Menu, Loader2, Box } from 'lucide-react';
import { JobStatus } from '../types/studio';

export interface HeaderMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface HeaderMenuGroup {
  id: string;
  label: string;
  items: HeaderMenuItem[];
}

interface StudioHeaderProps {
  projectTitle?: string | null;
  status: JobStatus;
  progress: number | null;
  canRun: boolean;
  runDisabledReason?: string;
  engineLabel: string;
  menuGroups: HeaderMenuGroup[];
  onRun: () => void;
  onCancel: () => void;
  onHome: () => void;
}

const STATUS_STYLES: Record<JobStatus, { label: string; dot: string; text: string }> = {
  idle: { label: 'Idle', dot: 'bg-slate-500', text: 'text-slate-400' },
  queued: { label: 'Queued', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  running: { label: 'Running', dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300' },
  completed: { label: 'Completed', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-300' },
  cancelled: { label: 'Cancelled', dot: 'bg-orange-400', text: 'text-orange-300' },
};

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  projectTitle,
  status,
  progress,
  canRun,
  runDisabledReason,
  engineLabel,
  menuGroups,
  onRun,
  onCancel,
  onHome,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isRunning = status === 'queued' || status === 'running';
  const statusStyle = STATUS_STYLES[status];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 print:hidden">
      <button onClick={onHome} className="flex shrink-0 items-center gap-2 whitespace-nowrap pr-2 text-left" title="Back to start page">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-sky-500 to-indigo-600 shadow shadow-sky-500/30">
          <Box className="h-3.5 w-3.5 text-white" />
        </span>
        <span className="text-[13px] font-semibold tracking-wide text-slate-100">
          NASEER <span className="font-normal text-slate-400">Universal CAE Studio</span>
        </span>
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
            menuOpen
              ? 'border-sky-500/60 bg-sky-500/10 text-sky-200'
              : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white'
          }`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Menu className="h-3.5 w-3.5" />
          Project
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-9 z-50 max-h-[80vh] w-64 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-2xl shadow-black/60"
          >
            {menuGroups.map((group) => (
              <div key={group.id} className="border-b border-slate-800 py-1 last:border-b-0">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onClick();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-300 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="flex h-4 w-4 items-center justify-center text-slate-400">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 hidden h-5 w-px bg-slate-800 md:block" />
      <div className="hidden min-w-0 flex-1 items-center gap-2 text-[12px] md:flex">
        <span className="truncate text-slate-300" title={projectTitle || undefined}>
          {projectTitle || 'No active project'}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
        <span className="hidden text-[11px] text-slate-500 lg:inline">{engineLabel}</span>

        <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2 py-1" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
          <span className={`text-[11px] font-medium ${statusStyle.text}`}>{statusStyle.label}</span>
          {isRunning && typeof progress === 'number' && (
            <span className="font-mono text-[10px] text-slate-400">{Math.round(progress)}%</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onRun}
            disabled={!canRun || isRunning}
            title={!canRun ? runDisabledReason : 'Run simulation'}
            className="flex h-7 items-center gap-1.5 rounded bg-gradient-to-b from-emerald-500 to-emerald-600 px-3 text-[12px] font-semibold text-white shadow shadow-emerald-900/50 ring-1 ring-emerald-400/40 transition hover:from-emerald-400 hover:to-emerald-600 active:translate-y-px disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none disabled:ring-slate-600"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            Run Simulation
          </button>
          <button
            onClick={onCancel}
            disabled={!isRunning}
            title="Cancel the running simulation"
            className="flex h-7 items-center gap-1.5 rounded border border-red-500/40 bg-red-500/10 px-3 text-[12px] font-semibold text-red-300 transition hover:bg-red-500/20 active:translate-y-px disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Cancel
          </button>
        </div>
      </div>

      {isRunning && (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-slate-800">
          <div
            className="h-full bg-sky-400 transition-all duration-500"
            style={{ width: `${typeof progress === 'number' ? Math.max(5, progress) : 30}%` }}
          />
        </div>
      )}
    </header>
  );
};
