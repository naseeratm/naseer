import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Upload,
  Grid3X3,
  Database,
  Sliders,
  Sparkles,
  Palette,
  ShieldCheck,
  Table as TableIcon,
  FileText,
  Printer,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import {
  ExecutionModeOption,
  SIMULATION_TYPE_OPTIONS,
  SimulationInputs,
  SimulationTypeOption,
  TemperatureUnit,
  TEMPERATURE_FIELDS,
  WorkflowStep,
  convertTemperature,
  getMissingSimulationInputs,
  isFiniteNumberString,
} from '../types/studio';

export interface PanelResults {
  physics_type?: string;
  classified_type?: string;
  recommended_solver?: string;
  solver_engine?: string;
  process_time?: number;
  process_time_ms?: number;
  max_temperature?: number;
  center_temperature?: number;
  calculated_heat_flux?: number;
}

export type PanelDocument = 'overview' | 'contours' | 'mesh' | 'validation' | 'tables' | 'report';

export interface PropertiesPanelActions {
  importModel: () => void;
  openMeshGenerator: () => void;
  openMaterials: () => void;
  openParametricSweep: () => void;
  openAssistant: () => void;
  openDocument: (doc: PanelDocument) => void;
  print: () => void;
}

interface PropertiesPanelProps {
  step: WorkflowStep;
  project: ThesisProject | null;
  inputs: SimulationInputs;
  inputsLocked: boolean;
  results: PanelResults | null;
  actions: PropertiesPanelActions;
  onInputsChange: (patch: Partial<SimulationInputs>) => void;
}

const STEP_TITLES: Record<WorkflowStep, string> = {
  geometry: 'Geometry',
  mesh: 'Mesh',
  physics: 'Physics & Materials',
  copilot: 'OmniSolve AI (Copilot)',
  post: 'Post-Processing',
};

const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-800">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
};

const inputClass =
  'h-7 w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-2 font-mono text-[11px] text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50';

const Field: React.FC<{ label: string; htmlFor: string; hint?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className="grid grid-cols-[94px_minmax(0,1fr)] items-center gap-2">
    <label htmlFor={htmlFor} className="truncate text-[11px] text-slate-400" title={hint || label}>
      {label}
    </label>
    {children}
  </div>
);

const NumberField: React.FC<{
  id: string;
  label: string;
  unit: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, unit, value, placeholder = 'Required', disabled, onChange }) => {
  const hasTyped = value.trim() !== '';
  const invalid = hasTyped && !isFiniteNumberString(value);
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type="number"
          step="any"
          inputMode="decimal"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} pr-11 ${invalid ? 'border-red-500/70 focus:border-red-500' : !hasTyped ? 'border-amber-500/30' : ''}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9.5px] text-slate-500">{unit}</span>
      </div>
    </Field>
  );
};

const ReadRow: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 text-[11px]">
    <span className="shrink-0 text-slate-500">{label}</span>
    <span className="min-w-0 break-words text-right text-slate-200">{value ?? '—'}</span>
  </div>
);

const ActionButton: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }> = ({
  icon,
  label,
  onClick,
  accent,
}) => (
  <button
    onClick={onClick}
    className={`flex h-7 w-full items-center gap-2 rounded border px-2 text-[11px] font-medium transition-colors ${
      accent
        ? 'border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20'
        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white'
    }`}
  >
    <span className="text-slate-400">{icon}</span>
    {label}
  </button>
);

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  step,
  project,
  inputs,
  inputsLocked,
  results,
  actions,
  onInputsChange,
}) => {
  const fineMesh = project?.meshStudy?.meshLevels?.[2];
  const geometryComponent = project?.workbenchComponents?.find((component) => component.type === 'Geometry');
  const temperatureUnitLabel = inputs.temperatureUnit === 'C' ? '°C' : inputs.temperatureUnit === 'F' ? '°F' : 'K';
  const missingInputs = getMissingSimulationInputs(inputs);

  const isCFD = inputs.simulationType === 'CFD_Incompressible' || inputs.simulationType === 'CFD_Compressible';
  const isStructural = inputs.simulationType === 'Structural_Static' || inputs.simulationType === 'Structural_Dynamic';
  const isThermal = inputs.simulationType === 'Thermal_Transient';

  const solverInputs = project ? (
    <React.Fragment key="solver-inputs">
      <Section title="Solver & Domain Setup">
        {missingInputs.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10.5px] leading-snug text-amber-200">
            <div className="flex items-center gap-1 font-semibold text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Required inputs missing ({missingInputs.length}):</span>
            </div>
            <div className="mt-1 text-amber-200/80">{missingInputs.join(', ')}</div>
          </div>
        )}
        <Field label="Simulation Type" htmlFor="sim-type">
          <select
            id="sim-type"
            value={inputs.simulationType}
            disabled={inputsLocked}
            onChange={(event) => onInputsChange({ simulationType: event.target.value as SimulationTypeOption })}
            className={inputClass}
          >
            {SIMULATION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Execution Mode" htmlFor="exec-mode">
          <select
            id="exec-mode"
            value={inputs.executionMode}
            disabled={inputsLocked}
            onChange={(event) => onInputsChange({ executionMode: event.target.value as ExecutionModeOption })}
            className={inputClass}
          >
            <option value="celery">Celery · async queue</option>
            <option value="direct">Direct · in-process</option>
          </select>
        </Field>
        <NumberField id="in-width-x" label="Domain width" unit="m" value={inputs.widthX} disabled={inputsLocked} onChange={(widthX) => onInputsChange({ widthX })} />
        <NumberField id="in-height-y" label="Domain height" unit="m" value={inputs.heightY} disabled={inputsLocked} onChange={(heightY) => onInputsChange({ heightY })} />
        <NumberField id="in-mesh-size" label="Mesh size" unit="m" value={inputs.meshSize} disabled={inputsLocked} onChange={(meshSize) => onInputsChange({ meshSize })} />
        {inputsLocked && <p className="text-[10.5px] text-slate-500">Inputs are locked while a job is running.</p>}
      </Section>

      {isCFD && (
        <Section title="CFD Flow Conditions">
          <NumberField id="in-velocity" label="Velocity" unit="m/s" value={inputs.velocity} disabled={inputsLocked} onChange={(velocity) => onInputsChange({ velocity })} />
          <NumberField id="in-pressure" label="Pressure" unit="Pa" value={inputs.pressure} disabled={inputsLocked} onChange={(pressure) => onInputsChange({ pressure })} />
          <Field label="Temperature" htmlFor="in-temperature">
            <div className="flex gap-1">
              <input
                id="in-temperature"
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="Required"
                value={inputs.temperature}
                disabled={inputsLocked}
                aria-invalid={inputs.temperature.trim() !== '' && !isFiniteNumberString(inputs.temperature)}
                onChange={(event) => onInputsChange({ temperature: event.target.value })}
                className={`${inputClass} ${inputs.temperature.trim() === '' ? 'border-amber-500/30' : !isFiniteNumberString(inputs.temperature) ? 'border-red-500/70' : ''}`}
              />
              <select
                aria-label="Temperature unit"
                value={inputs.temperatureUnit}
                disabled={inputsLocked}
                onChange={(event) => {
                  const nextUnit = event.target.value as TemperatureUnit;
                  const converted: Partial<SimulationInputs> = { temperatureUnit: nextUnit };
                  TEMPERATURE_FIELDS.forEach((field) => {
                    converted[field] = convertTemperature(inputs[field], inputs.temperatureUnit, nextUnit);
                  });
                  onInputsChange(converted);
                }}
                className="h-7 w-14 shrink-0 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none transition-colors focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="K">K</option>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </div>
          </Field>
          {inputs.simulationType === 'CFD_Compressible' && (
            <p className="text-[10.5px] leading-snug text-amber-300/80">Compressible CFD requires a strictly positive absolute pressure.</p>
          )}
        </Section>
      )}

      {isStructural && (
        <Section title="Structural & Material Data">
          <NumberField id="in-displacement" label="Displacement" unit="m" value={inputs.displacement} disabled={inputsLocked} onChange={(displacement) => onInputsChange({ displacement })} />
          <NumberField id="in-young" label="Young's Mod." unit="Pa" value={inputs.youngModulus} disabled={inputsLocked} onChange={(youngModulus) => onInputsChange({ youngModulus })} />
          <NumberField id="in-poisson" label="Poisson Ratio" unit="-" value={inputs.poissonRatio} disabled={inputsLocked} onChange={(poissonRatio) => onInputsChange({ poissonRatio })} />
          <NumberField id="in-density" label="Density" unit="kg/m³" value={inputs.density} disabled={inputsLocked} onChange={(density) => onInputsChange({ density })} />
        </Section>
      )}

      {isThermal && (
        <Section title="Thermal Conditions">
          <Field label="Initial Temp" htmlFor="in-temperature-thermal">
            <div className="flex gap-1">
              <input
                id="in-temperature-thermal"
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="Required"
                value={inputs.temperature}
                disabled={inputsLocked}
                onChange={(event) => onInputsChange({ temperature: event.target.value })}
                className={`${inputClass} ${inputs.temperature.trim() === '' ? 'border-amber-500/30' : ''}`}
              />
              <select
                aria-label="Temperature unit"
                value={inputs.temperatureUnit}
                disabled={inputsLocked}
                onChange={(event) => {
                  const nextUnit = event.target.value as TemperatureUnit;
                  const converted: Partial<SimulationInputs> = { temperatureUnit: nextUnit };
                  TEMPERATURE_FIELDS.forEach((field) => {
                    converted[field] = convertTemperature(inputs[field], inputs.temperatureUnit, nextUnit);
                  });
                  onInputsChange(converted);
                }}
                className="h-7 w-14 shrink-0 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none transition-colors focus:border-sky-500"
              >
                <option value="K">K</option>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </div>
          </Field>
          <NumberField id="in-conductivity" label="Conductivity" unit="W/m·K" value={inputs.thermalConductivity} disabled={inputsLocked} onChange={(thermalConductivity) => onInputsChange({ thermalConductivity })} />
          <NumberField id="in-bc-left" label="Left Temp" unit={temperatureUnitLabel} value={inputs.bcLeft} disabled={inputsLocked} onChange={(bcLeft) => onInputsChange({ bcLeft })} />
          <NumberField id="in-bc-right" label="Right Temp" unit={temperatureUnitLabel} value={inputs.bcRight} disabled={inputsLocked} onChange={(bcRight) => onInputsChange({ bcRight })} />
          <NumberField id="in-bc-top" label="Top Temp" unit={temperatureUnitLabel} value={inputs.bcTop} disabled={inputsLocked} onChange={(bcTop) => onInputsChange({ bcTop })} />
          <NumberField id="in-bc-bottom" label="Bottom Temp" unit={temperatureUnitLabel} value={inputs.bcBottom} disabled={inputsLocked} onChange={(bcBottom) => onInputsChange({ bcBottom })} />
        </Section>
      )}
    </React.Fragment>
  ) : null;

  let contextual: React.ReactNode = null;
  if (!project) {
    contextual = (
      <Section title="Project">
        <p className="text-[11px] leading-relaxed text-slate-500">
          No active project. Create or import a CAD model to define geometry, mesh and physical boundary conditions.
        </p>
      </Section>
    );
  } else if (step === 'geometry') {
    contextual = (
      <>
        <Section title="Geometry">
          <ReadRow label="Project" value={project.title} />
          <ReadRow label="Domain" value={project.field} />
          <ReadRow label="Software" value={project.softwareType} />
          {geometryComponent && <ReadRow label="Component" value={geometryComponent.details} />}
          {geometryComponent && <ReadRow label="Status" value={geometryComponent.status} />}
        </Section>
        {project.boundaryConditions && project.boundaryConditions.length > 0 && (
          <Section title={`Tagged Boundaries (${project.boundaryConditions.length})`}>
            {project.boundaryConditions.map((bc, idx) => (
              <div key={idx} className="rounded border border-slate-800 bg-slate-950 p-2 text-[10.5px]">
                <div className="flex items-center justify-between font-mono font-medium text-slate-200">
                  <span className="truncate max-w-[130px]">{bc.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                      bc.type.includes('Inlet')
                        ? 'bg-sky-500/20 text-sky-300'
                        : bc.type.includes('Outlet')
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-purple-500/20 text-purple-300'
                    }`}
                  >
                    {bc.type}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-slate-400 font-mono text-[10px]">
                  <span>{bc.value} {bc.unit}</span>
                </div>
              </div>
            ))}
          </Section>
        )}
        <Section title="Actions">
          <ActionButton accent icon={<Upload className="h-3.5 w-3.5" />} label="Import Engineering Model" onClick={actions.importModel} />
        </Section>
      </>
    );
  } else if (step === 'mesh') {
    contextual = (
      <>
        <Section title="Mesh Quality">
          <ReadRow label="Elements" value={fineMesh?.elements?.toLocaleString()} />
          <ReadRow label="Nodes" value={fineMesh?.nodes?.toLocaleString()} />
          <ReadRow label="Min orthogonal quality" value={project.meshStudy?.minOrthogonalQuality} />
          <ReadRow label="Max skewness" value={project.meshStudy?.maxSkewness} />
          <ReadRow label="Max aspect ratio" value={project.meshStudy?.maxAspectRatio} />
        </Section>
        <Section title="Actions">
          <ActionButton accent icon={<Grid3X3 className="h-3.5 w-3.5" />} label="Open Mesh Generator" onClick={actions.openMeshGenerator} />
          <ActionButton icon={<Layers className="h-3.5 w-3.5" />} label="Mesh Study (GCI)" onClick={() => actions.openDocument('mesh')} />
        </Section>
      </>
    );
  } else if (step === 'physics') {
    contextual = (
      <>
        <Section title="Material">
          <ReadRow label="Name" value={project.material?.name} />
          <ReadRow label="Density" value={project.material?.density} />
          <ReadRow label="Type" value={project.material?.phaseOrType} />
        </Section>
        <Section title="Actions">
          <ActionButton icon={<Database className="h-3.5 w-3.5" />} label="Materials Database" onClick={actions.openMaterials} />
          <ActionButton icon={<Sliders className="h-3.5 w-3.5" />} label="Parametric Sweep" onClick={actions.openParametricSweep} />
          <ActionButton icon={<Layers className="h-3.5 w-3.5" />} label="Solver Setup Workbench" onClick={() => actions.openDocument('overview')} />
        </Section>
      </>
    );
  } else if (step === 'copilot') {
    contextual = (
      <Section title="OmniSolve AI (Copilot)">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Ask the AI consultant to recommend thermophysical properties, boundary conditions, or solver settings for the active project.
        </p>
        <ActionButton accent icon={<Sparkles className="h-3.5 w-3.5" />} label="Open OmniSolve AI" onClick={actions.openAssistant} />
      </Section>
    );
  } else {
    const physicsType = results?.physics_type || results?.classified_type;
    const processTime =
      typeof results?.process_time === 'number'
        ? `${results.process_time.toFixed(2)} s`
        : typeof results?.process_time_ms === 'number'
          ? `${(results.process_time_ms / 1000).toFixed(2)} s`
          : undefined;
    contextual = (
      <>
        <Section title="Results Summary">
          {results ? (
            <>
              <ReadRow label="Physics" value={physicsType} />
              <ReadRow label="Solver" value={results.recommended_solver || results.solver_engine} />
              <ReadRow label="Process time" value={processTime} />
              <ReadRow label="Max temperature" value={typeof results.max_temperature === 'number' ? `${results.max_temperature.toFixed(1)} °C` : undefined} />
              <ReadRow label="Center temperature" value={typeof results.center_temperature === 'number' ? `${results.center_temperature.toFixed(1)} °C` : undefined} />
              <ReadRow label="Heat flux" value={typeof results.calculated_heat_flux === 'number' ? `${results.calculated_heat_flux.toFixed(2)} W/m²` : undefined} />
            </>
          ) : (
            <p className="text-[11px] text-slate-500">Run a simulation to populate results.</p>
          )}
        </Section>
        <Section title="Result Views">
          <ActionButton icon={<Palette className="h-3.5 w-3.5" />} label="Contours & Vectors" onClick={() => actions.openDocument('contours')} />
          <ActionButton icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Validation (ASME V&V 20)" onClick={() => actions.openDocument('validation')} />
          <ActionButton icon={<TableIcon className="h-3.5 w-3.5" />} label="Data Tables" onClick={() => actions.openDocument('tables')} />
          <ActionButton icon={<FileText className="h-3.5 w-3.5" />} label="Certified Report" onClick={() => actions.openDocument('report')} />
          <ActionButton icon={<Printer className="h-3.5 w-3.5" />} label="Print Report" onClick={actions.print} />
        </Section>
      </>
    );
  }

  return (
    <aside
      aria-label="Properties"
      className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-900/60 print:hidden"
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-slate-800 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Properties</span>
        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">{STEP_TITLES[step]}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {step === 'physics' ? (
          <>
            {solverInputs}
            {contextual}
          </>
        ) : (
          <>
            {contextual}
            {solverInputs}
          </>
        )}
      </div>
    </aside>
  );
};