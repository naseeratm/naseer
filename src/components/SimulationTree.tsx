import React from 'react';
import {
  Box,
  Grid3X3,
  Atom,
  Target,
  Link2,
  Sliders,
  Sparkles,
  Activity,
  ChevronRight,
  ChevronDown,
  Check,
  AlertCircle,
} from 'lucide-react';
import { BoundaryCondition } from '../types/thesis';
import { JobStatus, SimulationInputs, WorkflowStep } from '../types/studio';

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
  inputs: SimulationInputs;
  materialName?: string;
  cadName?: string;
  meshElementCount?: number;
  boundaryConditions?: BoundaryCondition[];
  selectedBoundaryIndex: number | null;
  onSelectBoundary: (index: number | null) => void;
  actions: Record<WorkflowStep, TreeAction[]>;
  onSelectStep: (step: WorkflowStep) => void;
}

const STEPS: { id: WorkflowStep; label: string; icon: React.ReactNode }[] = [
  { id: 'geometry', label: '1. Geometry', icon: <Box className="h-4 w-4" /> },
  { id: 'mesh', label: '2. Mesh & Sizing', icon: <Grid3X3 className="h-4 w-4" /> },
  { id: 'physics', label: '3. Physics & Materials', icon: <Atom className="h-4 w-4" /> },
  { id: 'boundaries', label: '4. Boundary Conditions', icon: <Target className="h-4 w-4" /> },
  { id: 'contacts', label: '5. Contacts & Interfaces', icon: <Link2 className="h-4 w-4" /> },
  { id: 'solution', label: '6. Solution Controls', icon: <Sliders className="h-4 w-4" /> },
  { id: 'copilot', label: '7. OmniSolve AI (Copilot)', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'post', label: '8. Results & Post', icon: <Activity className="h-4 w-4" /> },
];

export const SimulationTree: React.FC<SimulationTreeProps> = ({
  activeStep,
  hasProject,
  jobStatus,
  inputs,
  materialName,
  cadName,
  meshElementCount,
  boundaryConditions = [],
  selectedBoundaryIndex,
  onSelectBoundary,
  actions,
  onSelectStep,
}) => {
  const getStepMeta = (id: WorkflowStep): string | undefined => {
    if (!hasProject) return undefined;
    if (id === 'geometry') return cadName || `${inputs.widthX || '?'}×${inputs.heightY || '?'} m`;
    if (id === 'mesh') {
      return meshElementCount
        ? `${meshElementCount.toLocaleString()} elems`
        : `Order ${inputs.elementOrder}${inputs.inflationLayers ? ` · ${inputs.inflationLayers} BL` : ''}`;
    }
    if (id === 'physics') return materialName || inputs.simulationType.replace('_', ' ');
    if (id === 'boundaries') return `${boundaryConditions.length} assigned`;
    if (id === 'contacts') return inputs.contactType;
    if (id === 'solution') return `${inputs.timeMode === 'transient' ? 'Transient' : 'Steady'} · ${inputs.discretizationScheme === 'second_order' ? '2nd' : '1st'}`;
    if (id === 'post') return jobStatus === 'completed' ? 'Solved' : undefined;
    return undefined;
  };

  return (
    <nav
      aria-label="Simulation workflow"
      className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 print:hidden"
    >
      <div className="flex h-8 items-center justify-between border-b border-slate-800 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        <span>Simulation Tree</span>
        {hasProject && <span className="font-mono text-[9.5px] text-sky-400">CAE Tree</span>}
      </div>

      <ul className="flex-1 overflow-y-auto py-1.5">
        {STEPS.map((step) => {
          const isActive = hasProject && step.id === activeStep;
          const done = hasProject && step.id === 'post' && jobStatus === 'completed';
          const meta = getStepMeta(step.id);
          const stepActions = actions[step.id] || [];
          const showBoundaryChildren = hasProject && step.id === 'boundaries' && (isActive || boundaryConditions.length > 0);

          return (
            <li key={step.id}>
              <button
                disabled={!hasProject}
                onClick={() => onSelectStep(step.id)}
                aria-current={isActive ? 'step' : undefined}
                className={`group relative flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-100'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                {isActive && <span className="absolute inset-y-0 left-0 w-0.5 bg-sky-400" />}
                <span className="mt-0.5 shrink-0">
                  {isActive || showBoundaryChildren ? (
                    <ChevronDown className="h-3 w-3 text-sky-300" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-slate-600 group-hover:text-slate-400" />
                  )}
                </span>
                <span className={`mt-0.5 shrink-0 ${isActive ? 'text-sky-300' : 'text-slate-400 group-hover:text-slate-200'}`}>
                  {step.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium leading-tight">{step.label}</div>
                  {meta && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 tabular-nums">
                      {meta}
                    </div>
                  )}
                </div>
                {done && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
              </button>

              {/* Expandable Live Boundary Conditions Subtree */}
              {showBoundaryChildren && boundaryConditions.length > 0 && (
                <ul className="mb-1 ml-[22px] border-l border-slate-800">
                  {boundaryConditions.map((bc, idx) => {
                    const isBcSelected = isActive && selectedBoundaryIndex === idx;
                    const isDefined = bc.status !== 'Incomplete' && (bc.value !== '' || bc.type.toLowerCase().includes('fixed') || bc.type.toLowerCase().includes('adiabatic') || bc.type.toLowerCase().includes('symmetry'));
                    return (
                      <li key={bc.id || `${bc.name}-${idx}`}>
                        <button
                          onClick={() => {
                            onSelectBoundary(idx);
                            onSelectStep('boundaries');
                          }}
                          className={`flex w-full items-center gap-1.5 py-1.5 pl-3 pr-2 text-left text-[11px] transition-colors ${
                            isBcSelected
                              ? 'bg-sky-500/15 text-sky-200 font-medium'
                              : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                          }`}
                        >
                          {isDefined ? (
                            <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                          ) : (
                            <AlertCircle className="h-3 w-3 shrink-0 text-amber-400" />
                          )}
                          <span className="flex-1 truncate">{bc.name || bc.type}</span>
                          {bc.value !== '' && (
                            <span className="shrink-0 font-mono text-[9.5px] text-slate-500 tabular-nums">
                              {bc.value} {bc.unit}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {isActive && stepActions.length > 0 && (
                <ul className="mb-1 ml-[22px] border-l border-slate-800">
                  {stepActions.map((action) => (
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
        {hasProject
          ? 'Ansys / SimScale Tree · Click any node or BC patch to inspect.'
          : 'Open or create a project to begin.'}
      </div>
    </nav>
  );
};
