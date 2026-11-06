import React from 'react';
import { Box, Grid3X3, Atom, Sparkles, Activity, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { JobStatus, WorkflowStep } from '../types/studio';

export interface TreeAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

interface SimulationTreeProps {
  activeStep: WorkflowStep;
  hasProject: boolean;
  jobStatus: JobStatus;
  actions: Record<WorkflowStep, TreeAction[]>;
  onSelectStep: (step: WorkflowStep) => void;
}

const STEPS: { id: WorkflowStep; label: string; icon: React.ReactNode }[] = [
  { id: 'geometry', label: '1. Geometry', icon: <Box className="h-4 w-4" /> },
  { id: 'mesh', label: '2. Mesh', icon: <Grid3X3 className="h-4 w-4" /> },
  { id: 'physics', label: '3. Physics & Materials', icon: <Atom className="h-4 w-4" /> },
  { id: 'copilot', label: '4. AI Copilot (Nanofluids)', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'post', label: '5. Post-Processing', icon: <Activity className="h-4 w-4" /> },
];

export const SimulationTree: React.FC<SimulationTreeProps> = ({
  activeStep,
  hasProject,
  jobStatus,
  actions,
  onSelectStep,
}) => {
  return (
    <nav
      aria-label="Simulation workflow"
      className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 print:hidden"
    >
      <div className="flex h-8 items-center border-b border-slate-800 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Simulation Tree
      </div>

      <ul className="flex-1 overflow-y-auto py-1.5">
        {STEPS.map((step) => {
          const isActive = hasProject && step.id === activeStep;
          const done = hasProject && step.id === 'post' && jobStatus === 'completed';
          return (
            <li key={step.id}>
              <button
                disabled={!hasProject}
                onClick={() => onSelectStep(step.id)}
                aria-current={isActive ? 'step' : undefined}
                className={`group relative flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-100'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                {isActive && <span className="absolute inset-y-0 left-0 w-0.5 bg-sky-400" />}
                {isActive ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-sky-300" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-600 group-hover:text-slate-400" />
                )}
                <span className={isActive ? 'text-sky-300' : 'text-slate-400 group-hover:text-slate-200'}>{step.icon}</span>
                <span className="flex-1 truncate">{step.label}</span>
                {done && <Check className="h-3.5 w-3.5 text-emerald-400" />}
              </button>

              {isActive && actions[step.id].length > 0 && (
                <ul className="mb-1 ml-[22px] border-l border-slate-800">
                  {actions[step.id].map((action) => (
                    <li key={action.id}>
                      <button
                        onClick={action.onClick}
                        className="flex w-full items-center gap-2 py-1.5 pl-4 pr-3 text-left text-[11.5px] text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100"
                      >
                        <span className="flex h-3.5 w-3.5 items-center justify-center text-slate-500">{action.icon}</span>
                        <span className="truncate">{action.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-slate-800 px-3 py-2 text-[10px] text-slate-500">
        {hasProject ? 'Select a step to edit its properties.' : 'Open or create a project to begin.'}
      </div>
    </nav>
  );
};
