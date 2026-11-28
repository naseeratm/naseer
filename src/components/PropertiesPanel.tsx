import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Upload,
  Grid3X3,
  Database,
  Sliders,
  Palette,
  ShieldCheck,
  Table as TableIcon,
  FileText,
  Printer,
  Layers,
  AlertCircle,
  Plus,
  Trash2,
  Loader2,
  Play,
  Download,
} from 'lucide-react';
import {
  BoundaryCondition,
  CadAssemblyInspection,
  CadBodyRole,
  ThesisProject,
} from '../types/thesis';
import {
  CFD_BOUNDARY_SUBTYPES,
  ExecutionModeOption,
  FEA_BOUNDARY_SUBTYPES,
  SIMULATION_TYPE_OPTIONS,
  SimulationInputs,
  SimulationTypeOption,
  THERMAL_BOUNDARY_SUBTYPES,
  TemperatureUnit,
  TEMPERATURE_FIELDS,
  WorkflowStep,
  convertTemperature,
  getMissingSimulationInputs,
  isCfdFamily,
  isElmerFamily,
  isFiniteNumberString,
  isStructuralFamily,
  isThermalFamily,
} from '../types/studio';

export interface PanelResults {
  physics_type?: string;
  classified_type?: string;
  recommended_solver?: string;
  solver_engine?: string;
  parallel_cores?: number;
  process_time?: number;
  process_time_ms?: number;
  max_temperature?: number;
  center_temperature?: number;
  calculated_heat_flux?: number;
}

export interface MeshPreviewSummary {
  elements_count?: number;
  nodes_count?: number;
  volume_elements_count?: number;
  surface_triangles_count?: number;
  min_quality?: number;
  avg_quality?: number;
  max_skewness?: number;
  element_order?: number;
  inflation_layers?: number;
  patches?: Array<{ id: string; name: string; dim?: number }>;
}

export type PanelDocument = 'overview' | 'contours' | 'mesh' | 'validation' | 'tables' | 'report';

export interface PropertiesPanelActions {
  importModel: () => void;
  openMeshGenerator: () => void;
  openMaterials: () => void;
  openParametricSweep: () => void;
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
  selectedBoundaryIndex: number | null;
  onSelectBoundary: (index: number | null) => void;
  onUpdateBoundaryCondition: (index: number, patch: Partial<BoundaryCondition>) => void;
  onDeleteBoundaryCondition: (index: number) => void;
  onAddBoundaryCondition: (bc: BoundaryCondition) => void;
  meshPreviewStats?: MeshPreviewSummary | null;
  meshGenerating?: boolean;
  onGenerateMeshPreview?: () => void;
  cadPatches?: Array<{ id: string; name: string }>;
  cadAssembly?: CadAssemblyInspection | null;
  preparedCadPath?: string | null;
  cadUnitOverride?: string;
  cadPrepBusy?: boolean;
  cadPrepError?: string | null;
  highlightedBodyIndex?: number | null;
  onChangeCadUnit?: (unit: string) => void;
  onUpdateCadBodyRole?: (bodyId: string, role: CadBodyRole) => void;
  onHighlightCadBody?: (index: number | null) => void;
  onExtractFluidVolume?: (
    mode: 'external_enclosure' | 'internal_cavity',
    params?: { upstream_mult?: number; downstream_mult?: number; lateral_mult?: number },
  ) => void;
  onPrepareAssembly?: (conformalCht: boolean) => void;
  lastTaskId?: string | null;
  onDownloadCaseArchive?: (taskId: string) => void;
}

const STEP_TITLES: Record<WorkflowStep, string> = {
  geometry: 'Geometry',
  mesh: 'Mesh & Sizing',
  physics: 'Physics & Materials',
  boundaries: 'Boundary Conditions',
  contacts: 'Contacts & Interfaces',
  solution: 'Solution Controls',
  post: 'Results & Post',
};

const INTEGRAL_LABELS: Record<string, { label: string; unit: string }> = {
  mass_flow_kg_s: { label: 'Mass Flow Rate', unit: 'kg/s' },
  pressure_drop_pa: { label: 'Pressure Drop (ΔP)', unit: 'Pa' },
  max_velocity_mps: { label: 'Max Velocity', unit: 'm/s' },
  y_plus_min: { label: 'Wall y+ (Min)', unit: '-' },
  y_plus_avg: { label: 'Wall y+ (Avg)', unit: '-' },
  y_plus_max: { label: 'Wall y+ (Max)', unit: '-' },
  drag_coefficient_cd: { label: 'Drag Coeff (Cd)', unit: '-' },
  lift_coefficient_cl: { label: 'Lift Coeff (Cl)', unit: '-' },
  wall_shear_stress_max_pa: { label: 'Max Wall Shear (τw)', unit: 'Pa' },
  heat_transfer_coeff_h: { label: 'Convection Coeff (h)', unit: 'W/m²·K' },
  nusselt_number: { label: 'Nusselt Number (Nu)', unit: '-' },
  total_heat_transfer_w: { label: 'Total Heat Transfer', unit: 'W' },
  heat_flux_w_m2: { label: 'Boundary Heat Flux', unit: 'W/m²' },
  max_von_mises_pa: { label: 'Max Von Mises Stress', unit: 'Pa' },
  avg_von_mises_pa: { label: 'Avg Von Mises Stress', unit: 'Pa' },
  max_displacement_m: { label: 'Max Displacement', unit: 'm' },
  max_reaction_n: { label: 'Max Nodal Reaction', unit: 'N' },
  total_reaction_x_n: { label: 'Reaction Force Rx', unit: 'N' },
  total_reaction_y_n: { label: 'Reaction Force Ry', unit: 'N' },
  total_reaction_z_n: { label: 'Reaction Force Rz', unit: 'N' },
  field_average: { label: 'Field Average', unit: '' },
  field_min: { label: 'Field Minimum', unit: '' },
  field_max: { label: 'Field Maximum', unit: '' },
  domain_volume_m3: { label: 'Domain Volume', unit: 'm³' },
  surface_area_m2: { label: 'Surface Area', unit: 'm²' },
  wetted_area_m2: { label: 'Wetted Area', unit: 'm²' },
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
  'h-7 w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-2 font-mono text-[11px] text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50 tabular-nums';

const Field: React.FC<{ label: string; htmlFor: string; hint?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2">
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
          className={`${inputClass} pr-12 ${invalid ? 'border-red-500/70 focus:border-red-500' : !hasTyped && placeholder === 'Required' ? 'border-amber-500/30' : ''}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9.5px] text-slate-500">{unit}</span>
      </div>
    </Field>
  );
};

const ReadRow: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 text-[11px]">
    <span className="shrink-0 text-slate-500">{label}</span>
    <span className="min-w-0 break-words text-right font-mono tabular-nums text-slate-200">{value ?? '—'}</span>
  </div>
);

const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onClick, accent, disabled }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className={`flex h-7 w-full items-center gap-2 rounded border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
  selectedBoundaryIndex,
  onSelectBoundary,
  onUpdateBoundaryCondition,
  onDeleteBoundaryCondition,
  onAddBoundaryCondition,
  meshPreviewStats,
  meshGenerating = false,
  onGenerateMeshPreview,
  cadPatches = [],
  cadAssembly = null,
  preparedCadPath = null,
  cadUnitOverride = 'auto',
  cadPrepBusy = false,
  cadPrepError = null,
  highlightedBodyIndex = null,
  onChangeCadUnit,
  onUpdateCadBodyRole,
  onHighlightCadBody,
  onExtractFluidVolume,
  onPrepareAssembly,
  lastTaskId = null,
  onDownloadCaseArchive,
}) => {
  const [enclosureUpstream, setEnclosureUpstream] = useState<string>('3.0');
  const [enclosureDownstream, setEnclosureDownstream] = useState<string>('6.0');
  const [enclosureLateral, setEnclosureLateral] = useState<string>('2.5');
  const [conformalChtMode, setConformalChtMode] = useState<boolean>(true);
  const fineMesh = project?.meshStudy?.meshLevels?.[2];
  const geometryComponent = project?.workbenchComponents?.find((component) => component.type === 'Geometry');
  const temperatureUnitLabel = inputs.temperatureUnit === 'C' ? '°C' : inputs.temperatureUnit === 'F' ? '°F' : 'K';
  const missingInputs = getMissingSimulationInputs(inputs);

  const isCFD = isCfdFamily(inputs.simulationType);
  const isStructural = isStructuralFamily(inputs.simulationType);
  const isThermal = isThermalFamily(inputs.simulationType);
  const isElmer = isElmerFamily(inputs.simulationType);

  const handleTemperatureUnitChange = (nextUnit: TemperatureUnit) => {
    const converted: Partial<SimulationInputs> = { temperatureUnit: nextUnit };
    TEMPERATURE_FIELDS.forEach((field) => {
      converted[field] = convertTemperature(inputs[field], inputs.temperatureUnit, nextUnit);
    });
    onInputsChange(converted);
  };

  const boundarySubtypes = isStructural
    ? FEA_BOUNDARY_SUBTYPES
    : isThermal && !isCFD
    ? THERMAL_BOUNDARY_SUBTYPES
    : CFD_BOUNDARY_SUBTYPES;

  const domainAndModelSection = project ? (
    <Section key="domain-setup" title="Domain & Model Selection">
      {missingInputs.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10.5px] leading-snug text-amber-200">
          <div className="flex items-center gap-1 font-semibold text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Required inputs missing ({missingInputs.length}):</span>
          </div>
          <div className="mt-1 text-amber-200/80">{missingInputs.join(', ')}</div>
        </div>
      )}
      <Field label="Analysis Type" htmlFor="sim-type">
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
      <NumberField id="in-width-x" label="Domain width" unit="m" value={inputs.widthX} disabled={inputsLocked} onChange={(widthX) => onInputsChange({ widthX })} />
      <NumberField id="in-height-y" label="Domain height" unit="m" value={inputs.heightY} disabled={inputsLocked} onChange={(heightY) => onInputsChange({ heightY })} />
      <NumberField id="in-depth-z" label="Domain depth" unit="m" value={inputs.depthZ} placeholder="Optional" disabled={inputsLocked} onChange={(depthZ) => onInputsChange({ depthZ })} />
      <NumberField id="in-mesh-size" label="Mesh size" unit="m" value={inputs.meshSize} disabled={inputsLocked} onChange={(meshSize) => onInputsChange({ meshSize })} />
      {inputsLocked && <p className="text-[10.5px] text-slate-500">Inputs are locked while a job is running.</p>}
    </Section>
  ) : null;

  const physicsSections = project ? (
    <React.Fragment key="physics-inputs">
      {isCFD && (
        <Section title="Fluid & Turbulence (OpenFOAM)">
          <Field label="Turbulence" htmlFor="turb-model">
            <select
              id="turb-model"
              value={inputs.turbulenceModel || 'laminar'}
              disabled={inputsLocked}
              onChange={(event) => onInputsChange({ turbulenceModel: event.target.value })}
              className={inputClass}
            >
              <option value="laminar">Laminar</option>
              <option value="kOmegaSST">RAS · Menter SST k-ω</option>
              <option value="kEpsilon">RAS · Standard k-ε</option>
              <option value="SpalartAllmaras">RAS · Spalart-Allmaras</option>
              <option value="WALE">LES · WALE (Transient 3D)</option>
              <option value="Smagorinsky">LES · Smagorinsky (Transient 3D)</option>
              <option value="kEqn">LES · One-Eqn kEqn (Transient 3D)</option>
              <option value="SpalartAllmarasDDES">DDES · Spalart-Allmaras DDES</option>
            </select>
          </Field>
          <NumberField id="in-fluid-rho" label="Fluid Density" unit="kg/m³" value={inputs.fluidDensity} placeholder="998.2" disabled={inputsLocked} onChange={(fluidDensity) => onInputsChange({ fluidDensity })} />
          <NumberField id="in-fluid-mu" label="Dyn. Viscosity" unit="Pa·s" value={inputs.dynamicViscosity} placeholder="0.001" disabled={inputsLocked} onChange={(dynamicViscosity) => onInputsChange({ dynamicViscosity })} />
          <NumberField id="in-velocity" label="Inlet Velocity" unit="m/s" value={inputs.velocity} disabled={inputsLocked} onChange={(velocity) => onInputsChange({ velocity })} />
          <NumberField id="in-pressure" label="Operating Pres." unit="Pa" value={inputs.pressure} disabled={inputsLocked} onChange={(pressure) => onInputsChange({ pressure })} />
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
                onChange={(event) => handleTemperatureUnitChange(event.target.value as TemperatureUnit)}
                className="h-7 w-14 shrink-0 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none transition-colors focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="K">K</option>
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
            </div>
          </Field>
          <label className="flex items-center justify-between pt-1.5 text-[11px] text-slate-300 cursor-pointer border-t border-slate-800/80">
            <span>Rotating Zone (OpenFOAM MRF)</span>
            <input
              type="checkbox"
              checked={inputs.mrfEnabled}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ mrfEnabled: e.target.checked })}
              className="accent-sky-500"
            />
          </label>
          {inputs.mrfEnabled && (
            <>
              <NumberField id="in-mrf-rpm" label="Rotor Speed ω" unit="RPM" value={inputs.mrfOmegaRpm} placeholder="Required (e.g. 1500)" disabled={inputsLocked} onChange={(mrfOmegaRpm) => onInputsChange({ mrfOmegaRpm })} />
              <NumberField id="in-mrf-radius" label="Zone Radius" unit="m" value={inputs.mrfRadius} placeholder="Auto (0.3·min)" disabled={inputsLocked} onChange={(mrfRadius) => onInputsChange({ mrfRadius })} />
              <Field label="Rotation Axis" htmlFor="in-mrf-axis">
                <select
                  id="in-mrf-axis"
                  value={inputs.mrfAxis || 'z'}
                  disabled={inputsLocked}
                  onChange={(e) => onInputsChange({ mrfAxis: e.target.value as 'x' | 'y' | 'z' })}
                  className={inputClass}
                >
                  <option value="z">Z-Axis (0 0 1)</option>
                  <option value="y">Y-Axis (0 1 0)</option>
                  <option value="x">X-Axis (1 0 0)</option>
                </select>
              </Field>
            </>
          )}
        </Section>
      )}

      {isStructural && (
        <Section title="Structural & Material (CalculiX)">
          <Field label="Support Type" htmlFor="in-support-type">
            <select
              id="in-support-type"
              value={inputs.supportType}
              disabled={inputsLocked}
              onChange={(event) => onInputsChange({ supportType: event.target.value as SimulationInputs['supportType'] })}
              className={inputClass}
            >
              <option value="cantilever">Cantilever (Clamp Left)</option>
              <option value="simply_supported">Simply Supported (L+R)</option>
              <option value="fixed_both">Clamped Both Ends</option>
            </select>
          </Field>
          <Field label="Material Law" htmlFor="in-material-model">
            <select
              id="in-material-model"
              value={inputs.materialModel || 'linear_elastic'}
              disabled={inputsLocked}
              onChange={(event) =>
                onInputsChange({
                  materialModel: event.target.value as SimulationInputs['materialModel'],
                  nonlinear: event.target.value !== 'linear_elastic' ? true : inputs.nonlinear,
                })
              }
              className={inputClass}
            >
              <option value="linear_elastic">Linear Elastic (*ELASTIC)</option>
              <option value="plastic">Elastoplastic (*PLASTIC · Mises)</option>
              <option value="hyperelastic">Hyperelastic (*HYPERELASTIC · Neo-Hooke)</option>
            </select>
          </Field>
          <NumberField id="in-displacement" label="Prescribed Disp." unit="m" value={inputs.displacement} placeholder="0 or load" disabled={inputsLocked} onChange={(displacement) => onInputsChange({ displacement })} />
          <NumberField id="in-force-n" label="Force Load" unit="N" value={inputs.forceN} placeholder="Optional" disabled={inputsLocked} onChange={(forceN) => onInputsChange({ forceN })} />
          <NumberField id="in-press-mpa" label="Pressure Load" unit="MPa" value={inputs.pressureLoadMpa} placeholder="Optional" disabled={inputsLocked} onChange={(pressureLoadMpa) => onInputsChange({ pressureLoadMpa })} />
          <NumberField id="in-young" label="Young's Mod." unit="Pa" value={inputs.youngModulus} disabled={inputsLocked} onChange={(youngModulus) => onInputsChange({ youngModulus })} />
          <NumberField id="in-poisson" label="Poisson Ratio" unit="-" value={inputs.poissonRatio} disabled={inputsLocked} onChange={(poissonRatio) => onInputsChange({ poissonRatio })} />
          <NumberField id="in-density" label="Density" unit="kg/m³" value={inputs.density} disabled={inputsLocked} onChange={(density) => onInputsChange({ density })} />
          {inputs.materialModel === 'plastic' && (
            <>
              <NumberField id="in-yield-mpa" label="Yield Stress σy" unit="MPa" value={inputs.yieldStressMpa} placeholder="Required (e.g. 250)" disabled={inputsLocked} onChange={(yieldStressMpa) => onInputsChange({ yieldStressMpa })} />
              <NumberField id="in-tangent-mpa" label="Tangent Mod. Et" unit="MPa" value={inputs.tangentModulusMpa} placeholder="Optional (5% E)" disabled={inputsLocked} onChange={(tangentModulusMpa) => onInputsChange({ tangentModulusMpa })} />
            </>
          )}
          {inputs.materialModel === 'hyperelastic' && (
            <>
              <NumberField id="in-hyper-c10" label="Neo-Hooke C10" unit="MPa" value={inputs.hyperC10Mpa} placeholder="Auto from E, ν" disabled={inputsLocked} onChange={(hyperC10Mpa) => onInputsChange({ hyperC10Mpa })} />
              <NumberField id="in-hyper-d1" label="Compress. D1" unit="1/Pa" value={inputs.hyperD1} placeholder="Auto from E, ν" disabled={inputsLocked} onChange={(hyperD1) => onInputsChange({ hyperD1 })} />
            </>
          )}
          <NumberField id="in-thermal-exp" label="Therm. Exp." unit="1/K" value={inputs.thermalExpansion} placeholder="Optional" disabled={inputsLocked} onChange={(thermalExpansion) => onInputsChange({ thermalExpansion })} />
          {(inputs.simulationType === 'Structural_Dynamic' || inputs.simulationType === 'Structural_Buckling') && (
            <NumberField id="in-modes-count" label="Eigenmodes" unit="#" value={inputs.modesCount} placeholder="5" disabled={inputsLocked} onChange={(modesCount) => onInputsChange({ modesCount })} />
          )}
          <label className="flex items-center justify-between pt-1 text-[11px] text-slate-300 cursor-pointer">
            <span>Geometric Nonlinearity (*NLGEOM)</span>
            <input
              type="checkbox"
              checked={inputs.nonlinear}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ nonlinear: e.target.checked })}
              className="accent-sky-500"
            />
          </label>
        </Section>
      )}

      {isThermal && (
        <Section title="Thermal / Conjugate Heat">
          {!isCFD && (
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
                  onChange={(event) => handleTemperatureUnitChange(event.target.value as TemperatureUnit)}
                  className="h-7 w-14 shrink-0 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none transition-colors focus:border-sky-500"
                >
                  <option value="K">K</option>
                  <option value="C">°C</option>
                  <option value="F">°F</option>
                </select>
              </div>
            </Field>
          )}
          <NumberField id="in-conductivity" label="Conductivity" unit="W/m·K" value={inputs.thermalConductivity} disabled={inputsLocked} onChange={(thermalConductivity) => onInputsChange({ thermalConductivity })} />
          <NumberField id="in-specific-heat" label="Specific Heat" unit="J/kg·K" value={inputs.specificHeat} placeholder="Optional" disabled={inputsLocked} onChange={(specificHeat) => onInputsChange({ specificHeat })} />
          <NumberField id="in-heat-flux" label="Heat Flux" unit="W/m²" value={inputs.heatFlux} placeholder="Optional" disabled={inputsLocked} onChange={(heatFlux) => onInputsChange({ heatFlux })} />
          <NumberField id="in-convection-h" label="Convection h" unit="W/m²K" value={inputs.convectionH} placeholder="Optional" disabled={inputsLocked} onChange={(convectionH) => onInputsChange({ convectionH })} />
          {inputs.simulationType === 'Thermal_Radiation' && (
            <>
              <NumberField id="in-emissivity" label="Emissivity ε" unit="-" value={inputs.emissivity} placeholder="0.85" disabled={inputsLocked} onChange={(emissivity) => onInputsChange({ emissivity })} />
              <NumberField id="in-ambient-c" label="Ambient Temp" unit="°C" value={inputs.ambientTempC} placeholder="25" disabled={inputsLocked} onChange={(ambientTempC) => onInputsChange({ ambientTempC })} />
            </>
          )}
          <NumberField id="in-bc-left" label="Left Temp" unit={temperatureUnitLabel} value={inputs.bcLeft} placeholder={inputs.simulationType === 'CHT_Coupled' ? 'Optional' : 'Required'} disabled={inputsLocked} onChange={(bcLeft) => onInputsChange({ bcLeft })} />
          <NumberField id="in-bc-right" label="Right Temp" unit={temperatureUnitLabel} value={inputs.bcRight} placeholder={inputs.simulationType === 'CHT_Coupled' ? 'Optional' : 'Required'} disabled={inputsLocked} onChange={(bcRight) => onInputsChange({ bcRight })} />
          <NumberField id="in-bc-top" label="Top Temp" unit={temperatureUnitLabel} value={inputs.bcTop} placeholder={inputs.simulationType === 'CHT_Coupled' ? 'Optional' : 'Required'} disabled={inputsLocked} onChange={(bcTop) => onInputsChange({ bcTop })} />
          <NumberField id="in-bc-bottom" label="Bottom Temp" unit={temperatureUnitLabel} value={inputs.bcBottom} placeholder={inputs.simulationType === 'CHT_Coupled' ? 'Optional' : 'Required'} disabled={inputsLocked} onChange={(bcBottom) => onInputsChange({ bcBottom })} />
        </Section>
      )}

      {isElmer && (
        <Section title={inputs.simulationType === 'Acoustics' ? 'Acoustics (ElmerFEM)' : 'Electromagnetics (ElmerFEM)'}>
          {inputs.simulationType === 'Electromagnetic' && (
            <Field label="EM Submode" htmlFor="in-em-submode">
              <select
                id="in-em-submode"
                value={inputs.emSubmode}
                disabled={inputsLocked}
                onChange={(e) => onInputsChange({ emSubmode: e.target.value as SimulationInputs['emSubmode'] })}
                className={inputClass}
              >
                <option value="Electrostatic">Electrostatics (StatElecSolve)</option>
                <option value="Magnetostatic">Magnetostatics (MagnetoDynamics)</option>
                <option value="EddyCurrent">Harmonic Eddy Current</option>
              </select>
            </Field>
          )}
          <NumberField
            id="in-em-source"
            label={inputs.simulationType === 'Acoustics' ? 'Source SPL' : inputs.emSubmode === 'Electrostatic' ? 'Source Volt' : 'Coil Current'}
            unit={inputs.simulationType === 'Acoustics' ? 'Pa' : inputs.emSubmode === 'Electrostatic' ? 'V' : 'A'}
            value={inputs.bcLeft}
            disabled={inputsLocked}
            onChange={(bcLeft) => onInputsChange({ bcLeft })}
          />
          <NumberField
            id="in-em-ref"
            label="Ground / Ref"
            unit={inputs.simulationType === 'Acoustics' ? 'Pa' : 'V'}
            value={inputs.bcRight}
            placeholder="0"
            disabled={inputsLocked}
            onChange={(bcRight) => onInputsChange({ bcRight })}
          />
          <NumberField id="in-em-freq" label="Frequency" unit="Hz" value={inputs.velocity} placeholder="1000" disabled={inputsLocked} onChange={(velocity) => onInputsChange({ velocity })} />
          {inputs.simulationType === 'Electromagnetic' && (
            <>
              <NumberField id="in-em-sigma" label="Conductivity σ" unit="S/m" value={inputs.electricalConductivity} placeholder="5.96e7" disabled={inputsLocked} onChange={(electricalConductivity) => onInputsChange({ electricalConductivity })} />
              <NumberField id="in-em-mur" label="Rel. Perm. μr" unit="-" value={inputs.relativePermeability} placeholder="1" disabled={inputsLocked} onChange={(relativePermeability) => onInputsChange({ relativePermeability })} />
              <NumberField id="in-em-epsr" label="Rel. Perm. εr" unit="-" value={inputs.relativePermittivity} placeholder="1" disabled={inputsLocked} onChange={(relativePermittivity) => onInputsChange({ relativePermittivity })} />
              <NumberField id="in-em-j" label="Current Dens. J" unit="A/m²" value={inputs.currentDensity} placeholder="Optional" disabled={inputsLocked} onChange={(currentDensity) => onInputsChange({ currentDensity })} />
            </>
          )}
        </Section>
      )}
    </React.Fragment>
  ) : null;

  let contextual: React.ReactNode = null;

  if (!project) {
    contextual = (
      <Section title="Project">
        <p className="text-[11px] leading-relaxed text-slate-500">
          No active project. Create or import a CAD model (.stl, .step, .iges, .inp) to configure geometry, mesh and physics.
        </p>
      </Section>
    );
  } else if (step === 'geometry') {
    const patches = cadPatches.length > 0 ? cadPatches : meshPreviewStats?.patches || [];
    contextual = (
      <>
        <Section title="Geometry Properties">
          <ReadRow label="Model Title" value={project.title} />
          <ReadRow label="Domain Type" value={project.field} />
          <ReadRow label="Target Solver" value={project.softwareType} />
          {geometryComponent && <ReadRow label="Geometry" value={geometryComponent.details} />}
          {geometryComponent && <ReadRow label="Status" value={geometryComponent.status} />}
        </Section>
        {patches.length > 0 && (
          <Section title={`Detected CAD Faces (${patches.length})`}>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {patches.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[10.5px] font-mono text-slate-300">
                  <span className="truncate">{p.name}</span>
                  <span className="text-[9.5px] text-slate-500">{p.id}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
        {(cadAssembly || cadPrepBusy || cadPrepError) && (
          <Section title="OpenCASCADE CAD Preparation">
            {cadPrepBusy && (
              <div className="flex items-center gap-2 rounded border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-2 text-[11px] text-cyan-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                <span>Executing OpenCASCADE kernel operation...</span>
              </div>
            )}

            {cadPrepError && (
              <div className="rounded border border-rose-500/40 bg-rose-950/40 p-2 text-[10.5px] leading-snug text-rose-200">
                <div className="flex items-center gap-1 font-semibold text-rose-300">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>CAD Preparation Error</span>
                </div>
                <p className="mt-1 break-words text-rose-200/90">{cadPrepError}</p>
              </div>
            )}

            {cadAssembly && (
              <div className="space-y-2.5">
                {/* Detected Units & SI Override */}
                <div className="rounded border border-slate-800 bg-slate-950 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-medium text-slate-400">Detected CAD Units</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                      {cadAssembly.unit_info.detected_unit} ({cadAssembly.unit_info.source})
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <label htmlFor="cad-unit-override" className="text-[10.5px] text-slate-400">
                      Unit Override → SI (m)
                    </label>
                    <select
                      id="cad-unit-override"
                      value={cadUnitOverride}
                      disabled={cadPrepBusy || inputsLocked}
                      onChange={(e) => onChangeCadUnit?.(e.target.value)}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10.5px] font-mono text-slate-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="auto">Auto ({cadAssembly.unit_info.detected_unit})</option>
                      <option value="m">Meters (m)</option>
                      <option value="mm">Millimeters (mm)</option>
                      <option value="cm">Centimeters (cm)</option>
                      <option value="in">Inches (in)</option>
                    </select>
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-slate-500">
                    SI Extent: {cadAssembly.dimensions.length.toFixed(4)} × {cadAssembly.dimensions.width.toFixed(4)} × {cadAssembly.dimensions.height.toFixed(4)} m
                  </div>
                  {cadAssembly.unit_info.warning && (
                    <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                      {cadAssembly.unit_info.warning}
                    </div>
                  )}
                  {preparedCadPath && (
                    <div className="mt-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-300">
                      Active Prepared B-Rep: {cadAssembly.prepared_filename || 'prepared.brep'}
                      {typeof cadAssembly.fluid_volume_m3 === 'number' && (
                        <span> · V={cadAssembly.fluid_volume_m3.toExponential(3)} m³</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Multi-Body Assembly Tree */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10.5px] font-medium text-slate-400">
                    <span>Solid Bodies ({cadAssembly.bodies.length})</span>
                    {highlightedBodyIndex !== null && (
                      <button
                        type="button"
                        onClick={() => onHighlightCadBody?.(null)}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300"
                      >
                        Clear Highlight
                      </button>
                    )}
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {cadAssembly.bodies.map((body, idx) => {
                      const isHighlighted = highlightedBodyIndex === idx;
                      return (
                        <div
                          key={body.body_id}
                          className={`rounded border p-1.5 text-[10.5px] transition-colors ${
                            isHighlighted
                              ? 'border-amber-400/60 bg-amber-500/10'
                              : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => onHighlightCadBody?.(isHighlighted ? null : idx)}
                              className="min-w-0 flex-1 truncate text-left font-mono text-slate-200 hover:text-amber-300"
                              title="Click to highlight body in 3D viewport"
                            >
                              {body.name}
                            </button>
                            <span className="shrink-0 font-mono text-[9.5px] text-slate-400">
                              {body.volume_m3 >= 1e-3
                                ? `${body.volume_m3.toFixed(4)} m³`
                                : `${(body.volume_m3 * 1e6).toFixed(2)} cm³`}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[9.5px] font-mono text-slate-500">
                              {body.body_id} · {body.surface_tags.length} faces
                            </span>
                            <select
                              aria-label={`Role for ${body.name}`}
                              value={body.role}
                              disabled={cadPrepBusy || inputsLocked}
                              onChange={(e) => onUpdateCadBodyRole?.(body.body_id, e.target.value as CadBodyRole)}
                              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                            >
                              <option value="solid">Solid</option>
                              <option value="fluid">Fluid</option>
                              <option value="contact_master">Contact Master</option>
                              <option value="contact_slave">Contact Slave</option>
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Detected Mating Interfaces */}
                {cadAssembly.interfaces.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10.5px] font-medium text-slate-400">
                      Mating Interfaces ({cadAssembly.interfaces.length})
                    </div>
                    <div className="max-h-28 space-y-1 overflow-y-auto">
                      {cadAssembly.interfaces.map((iface) => (
                        <div
                          key={iface.id}
                          className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-mono text-slate-300"
                        >
                          <span className="truncate">
                            {iface.body_a} ↔ {iface.body_b}
                          </span>
                          <span className="shrink-0 text-[9.5px] text-cyan-300">
                            {iface.interface_type === 'conformal_shared' ? 'Conformal' : 'Contact'} · {(iface.gap_m * 1000).toFixed(3)} mm
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fluid Volume Extraction (OpenCASCADE Booleans) */}
                <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950 p-2">
                  <div className="text-[10.5px] font-semibold text-slate-300">
                    Fluid Volume Extraction (OCC Boolean)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="flex flex-col gap-0.5 text-[9.5px] text-slate-400">
                      <span>Up (×L)</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={enclosureUpstream}
                        disabled={cadPrepBusy || inputsLocked}
                        onChange={(e) => setEnclosureUpstream(e.target.value)}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-200"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[9.5px] text-slate-400">
                      <span>Down (×L)</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={enclosureDownstream}
                        disabled={cadPrepBusy || inputsLocked}
                        onChange={(e) => setEnclosureDownstream(e.target.value)}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-200"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[9.5px] text-slate-400">
                      <span>Lat (×W)</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={enclosureLateral}
                        disabled={cadPrepBusy || inputsLocked}
                        onChange={(e) => setEnclosureLateral(e.target.value)}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-200"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={cadPrepBusy || inputsLocked}
                      onClick={() =>
                        onExtractFluidVolume?.('external_enclosure', {
                          upstream_mult: Number(enclosureUpstream) || 3.0,
                          downstream_mult: Number(enclosureDownstream) || 6.0,
                          lateral_mult: Number(enclosureLateral) || 2.5,
                        })
                      }
                      className="flex items-center justify-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Extract External Wind Tunnel</span>
                    </button>
                    <button
                      type="button"
                      disabled={cadPrepBusy || inputsLocked}
                      onClick={() => onExtractFluidVolume?.('internal_cavity')}
                      className="flex items-center justify-center gap-1.5 rounded border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Extract Internal Fluid Cavity</span>
                    </button>
                  </div>
                </div>

                {/* Multi-Body Preparation (when >= 2 bodies) */}
                {cadAssembly.bodies.length >= 2 && (
                  <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950 p-2">
                    <div className="text-[10.5px] font-semibold text-slate-300">
                      Multi-Body Interface Mode
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        disabled={cadPrepBusy || inputsLocked}
                        onClick={() => setConformalChtMode(true)}
                        className={`rounded border px-2 py-1 text-[10px] font-medium ${
                          conformalChtMode
                            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
                            : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Conformal CHT
                      </button>
                      <button
                        type="button"
                        disabled={cadPrepBusy || inputsLocked}
                        onClick={() => setConformalChtMode(false)}
                        className={`rounded border px-2 py-1 text-[10px] font-medium ${
                          !conformalChtMode
                            ? 'border-amber-500/50 bg-amber-500/20 text-amber-200'
                            : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Disjoint Contact
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={cadPrepBusy || inputsLocked}
                      onClick={() => onPrepareAssembly?.(conformalChtMode)}
                      className="flex w-full items-center justify-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>Prepare Multi-Body Assembly</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}
        <Section title="CAD Actions">
          <ActionButton accent icon={<Upload className="h-3.5 w-3.5" />} label="Import CAD / Solver File (.stl/.step/.inp)" onClick={actions.importModel} />
        </Section>
      </>
    );
  } else if (step === 'mesh') {
    const elCount =
      meshPreviewStats?.elements_count ??
      fineMesh?.elements ??
      (project.normalizedSolverResult?.vtkData?.triangle_count ??
        (project.normalizedSolverResult?.vtkData?.triangles
          ? Math.floor(project.normalizedSolverResult.vtkData.triangles.length / 3)
          : undefined));
    const nodeCount =
      meshPreviewStats?.nodes_count ??
      fineMesh?.nodes ??
      (project.normalizedSolverResult?.vtkData?.node_count ??
        (project.normalizedSolverResult?.vtkData?.points
          ? Math.floor(project.normalizedSolverResult.vtkData.points.length / 3)
          : undefined));
    contextual = (
      <>
        <Section title="Gmsh Sizing & Inflation">
          <NumberField id="mesh-size-ctrl" label="Base Size" unit="m" value={inputs.meshSize} disabled={inputsLocked} onChange={(meshSize) => onInputsChange({ meshSize })} />
          <Field label="Element Order" htmlFor="mesh-order">
            <select
              id="mesh-order"
              value={inputs.elementOrder}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ elementOrder: e.target.value as '1' | '2' })}
              className={inputClass}
            >
              <option value="1">Linear (1st Order)</option>
              <option value="2">Quadratic (2nd Order)</option>
            </select>
          </Field>
          <NumberField id="mesh-inf-layers" label="Inflation Layers" unit="#" value={inputs.inflationLayers} placeholder="0 (Off)" disabled={inputsLocked} onChange={(inflationLayers) => onInputsChange({ inflationLayers })} />
          <NumberField id="mesh-inf-h0" label="First Layer h₀" unit="m" value={inputs.firstLayerHeight} placeholder="0.002" disabled={inputsLocked} onChange={(firstLayerHeight) => onInputsChange({ firstLayerHeight })} />
          <NumberField id="mesh-inf-gr" label="Growth Rate" unit="-" value={inputs.growthRate} placeholder="1.2" disabled={inputsLocked} onChange={(growthRate) => onInputsChange({ growthRate })} />
          {onGenerateMeshPreview && (
            <ActionButton
              accent
              disabled={meshGenerating || !isFiniteNumberString(inputs.meshSize)}
              icon={meshGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              label={meshGenerating ? 'Meshing via Gmsh…' : 'Generate & Preview 3D Mesh'}
              onClick={onGenerateMeshPreview}
            />
          )}
        </Section>
        {isCFD && (
          <Section title="External Aero (OpenFOAM snappyHexMesh)">
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-200 cursor-pointer">
              <span>Auto Wind Tunnel + snappyHexMesh</span>
              <input
                type="checkbox"
                checked={Boolean(inputs.externalAero)}
                disabled={inputsLocked}
                onChange={(e) => onInputsChange({ externalAero: e.target.checked })}
                className="accent-sky-500"
              />
            </label>
            {inputs.externalAero ? (
              <>
                <p className="text-[10.5px] leading-snug text-sky-300/90">
                  Wraps your uploaded .STL/.STEP body in a slip-wall 3D wind tunnel, extracts edges, refines the wake box, adds prism layers, and computes Cd / Cl on the obstacle patch.
                </p>
                <NumberField
                  id="aero-surf-lvl"
                  label="Surface Level"
                  unit="1–4"
                  value={inputs.aeroSurfaceLevel}
                  placeholder="2"
                  disabled={inputsLocked}
                  onChange={(aeroSurfaceLevel) => onInputsChange({ aeroSurfaceLevel })}
                />
                <NumberField
                  id="aero-wake-lvl"
                  label="Wake Level"
                  unit="1–3"
                  value={inputs.aeroWakeLevel}
                  placeholder="1"
                  disabled={inputsLocked}
                  onChange={(aeroWakeLevel) => onInputsChange({ aeroWakeLevel })}
                />
                <NumberField
                  id="aero-up-mult"
                  label="Upstream Pad"
                  unit="×L"
                  value={inputs.tunnelUpstreamMult}
                  placeholder="3"
                  disabled={inputsLocked}
                  onChange={(tunnelUpstreamMult) => onInputsChange({ tunnelUpstreamMult })}
                />
                <NumberField
                  id="aero-down-mult"
                  label="Wake Length"
                  unit="×L"
                  value={inputs.tunnelDownstreamMult}
                  placeholder="6"
                  disabled={inputsLocked}
                  onChange={(tunnelDownstreamMult) => onInputsChange({ tunnelDownstreamMult })}
                />
              </>
            ) : (
              <p className="text-[10.5px] leading-snug text-slate-500">
                Enable for external aerodynamics around an uploaded 3D airfoil, vehicle, or bluff body (.STL / .STEP).
              </p>
            )}
          </Section>
        )}
        <Section title="Mesh Statistics">
          <ReadRow label="Elements" value={elCount !== undefined ? elCount.toLocaleString() : undefined} />
          <ReadRow label="Nodes" value={nodeCount !== undefined ? nodeCount.toLocaleString() : undefined} />
          <ReadRow label="Element Order" value={meshPreviewStats?.element_order ? `Order ${meshPreviewStats.element_order}` : undefined} />
          <ReadRow label="Min Quality (SICN)" value={meshPreviewStats?.min_quality ?? (project.meshStudy?.minOrthogonalQuality || undefined)} />
          <ReadRow label="Max Skewness" value={meshPreviewStats?.max_skewness ?? (project.meshStudy?.maxSkewness || undefined)} />
          <ReadRow label="Max Aspect Ratio" value={project.meshStudy?.maxAspectRatio || undefined} />
        </Section>
        <Section title="Mesh Tools">
          <ActionButton icon={<Grid3X3 className="h-3.5 w-3.5" />} label="Advanced Gmsh Inspector" onClick={actions.openMeshGenerator} />
          <ActionButton icon={<Layers className="h-3.5 w-3.5" />} label="Mesh Study (Roache GCI)" onClick={() => actions.openDocument('mesh')} />
        </Section>
      </>
    );
  } else if (step === 'physics') {
    contextual = (
      <>
        <Section title="Assigned Material">
          <ReadRow label="Material" value={project.material?.name} />
          <ReadRow label="Density" value={project.material?.density} />
          <ReadRow label="Phase / Class" value={project.material?.phaseOrType} />
        </Section>
        <Section title="Physics Tools">
          <ActionButton icon={<Database className="h-3.5 w-3.5" />} label="Materials Database" onClick={actions.openMaterials} />
          <ActionButton icon={<Sliders className="h-3.5 w-3.5" />} label="Parametric Sweep" onClick={actions.openParametricSweep} />
          <ActionButton icon={<Layers className="h-3.5 w-3.5" />} label="Solver Setup Workbench" onClick={() => actions.openDocument('overview')} />
        </Section>
      </>
    );
  } else if (step === 'boundaries') {
    const bcs = project.boundaryConditions || [];
    const activeBc = selectedBoundaryIndex !== null && bcs[selectedBoundaryIndex] ? bcs[selectedBoundaryIndex] : null;
    const availablePatches =
      cadPatches.length > 0
        ? cadPatches
        : meshPreviewStats?.patches && meshPreviewStats.patches.length > 0
          ? meshPreviewStats.patches
          : project.normalizedSolverResult?.vtkData?.patches || [];
    contextual = (
      <>
        {availablePatches.length > 0 && (
          <Section title={`Detected CAD Faces (${availablePatches.length})`}>
            <p className="text-[10.5px] text-slate-400">
              Click a CAD face to bind it to the selected boundary or create a new patch condition:
            </p>
            <div className="flex flex-wrap gap-1 pt-0.5 max-h-28 overflow-y-auto">
              {availablePatches.map((p) => {
                const isBoundToActive = activeBc?.patchName === p.name;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={inputsLocked}
                    onClick={() => {
                      if (selectedBoundaryIndex !== null && activeBc) {
                        onUpdateBoundaryCondition(selectedBoundaryIndex, {
                          patchName: p.name,
                          name: `${activeBc.type} (${p.name})`,
                          location: `CAD Patch: ${p.name}`,
                        });
                      } else {
                        const nextIdx = bcs.length;
                        onAddBoundaryCondition({
                          id: `bc_${Date.now()}`,
                          patchName: p.name,
                          name: `${boundarySubtypes[0]} (${p.name})`,
                          type: boundarySubtypes[0],
                          value: isStructural ? '0' : '1.0',
                          unit: isStructural ? 'N' : 'm/s',
                          description: `Bound to CAD surface patch ${p.name}`,
                          location: `CAD Patch: ${p.name}`,
                          status: 'Defined',
                        });
                        onSelectBoundary(nextIdx);
                      }
                    }}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      isBoundToActive
                        ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-500/60 hover:text-white'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Section title={`Assigned Boundaries (${bcs.length})`}>
          {bcs.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Click surface patches directly in the 3D Viewport (+ Inlet, + Outlet, + Heat, + Wall) or add a manual condition below.
            </p>
          ) : (
            <div className="max-h-44 space-y-1.5 overflow-y-auto">
              {bcs.map((bc, idx) => (
                <div
                  key={bc.id || `${bc.name}-${idx}`}
                  onClick={() => onSelectBoundary(idx)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1.5 text-[11px] transition-colors ${
                    selectedBoundaryIndex === idx
                      ? 'border-sky-500/70 bg-sky-500/10 text-sky-100'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium flex items-center gap-1.5">
                      <span className="truncate">{bc.name}</span>
                      {bc.patchName && (
                        <span className="shrink-0 rounded bg-cyan-950 border border-cyan-500/40 px-1 py-0.2 font-mono text-[9px] text-cyan-300">
                          {bc.patchName}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[9.5px] text-slate-400">
                      {bc.type} · {bc.value || '—'} {bc.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Delete Boundary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBoundaryCondition(idx);
                    }}
                    className="shrink-0 text-slate-500 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <ActionButton
            accent
            disabled={inputsLocked}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Add Boundary Condition"
            onClick={() => {
              const nextIdx = bcs.length;
              onAddBoundaryCondition({
                id: `bc_${Date.now()}`,
                name: `Patch_${nextIdx + 1}`,
                type: boundarySubtypes[0],
                value: isStructural ? '0' : '1.0',
                unit: isStructural ? 'N' : 'm/s',
                description: 'User-defined surface condition',
                status: 'Defined',
              });
              onSelectBoundary(nextIdx);
            }}
          />
        </Section>

        {activeBc && selectedBoundaryIndex !== null && (
          <Section title="Selected Boundary Inspector">
            <Field label="Patch Name" htmlFor="bc-name">
              <input
                id="bc-name"
                type="text"
                value={activeBc.name}
                disabled={inputsLocked}
                onChange={(e) => onUpdateBoundaryCondition(selectedBoundaryIndex, { name: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Target CAD Patch" htmlFor="bc-cad-patch">
              {availablePatches.length > 0 ? (
                <select
                  id="bc-cad-patch"
                  value={activeBc.patchName || ''}
                  disabled={inputsLocked}
                  onChange={(e) =>
                    onUpdateBoundaryCondition(selectedBoundaryIndex, {
                      patchName: e.target.value || undefined,
                      location: e.target.value ? `CAD Patch: ${e.target.value}` : activeBc.location,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">Spatial / Auto-Nearest</option>
                  {availablePatches.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="bc-cad-patch"
                  type="text"
                  placeholder="e.g. Face_1, inlet, left"
                  value={activeBc.patchName || ''}
                  disabled={inputsLocked}
                  onChange={(e) =>
                    onUpdateBoundaryCondition(selectedBoundaryIndex, {
                      patchName: e.target.value.trim() || undefined,
                    })
                  }
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="BC Subtype" htmlFor="bc-subtype">
              <select
                id="bc-subtype"
                value={activeBc.type}
                disabled={inputsLocked}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const nextUnit =
                    nextType.includes('Mass Flow') ? 'kg/s'
                    : nextType.includes('Velocity') ? 'm/s'
                    : nextType.includes('Pressure Outlet') || nextType.includes('Pressure Inlet') ? 'Pa'
                    : nextType.includes('Pressure Load') ? 'MPa'
                    : nextType.includes('Force') ? 'N'
                    : nextType.includes('Heat Flux') ? 'W/m²'
                    : nextType.includes('Convection') ? 'W/m²K'
                    : nextType.includes('Temp') ? 'K'
                    : activeBc.unit;
                  onUpdateBoundaryCondition(selectedBoundaryIndex, { type: nextType, unit: nextUnit });
                }}
                className={inputClass}
              >
                {!(boundarySubtypes as readonly string[]).includes(activeBc.type) && (
                  <option value={activeBc.type}>{activeBc.type}</option>
                )}
                {boundarySubtypes.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Magnitude" htmlFor="bc-val">
              <div className="flex gap-1">
                <input
                  id="bc-val"
                  type="text"
                  value={activeBc.value}
                  disabled={inputsLocked}
                  onChange={(e) => onUpdateBoundaryCondition(selectedBoundaryIndex, {
                    value: e.target.value,
                    status: e.target.value.trim() !== '' ? 'Defined' : 'Incomplete',
                  })}
                  className={inputClass}
                />
                <input
                  aria-label="Boundary unit"
                  type="text"
                  value={activeBc.unit}
                  disabled={inputsLocked}
                  onChange={(e) => onUpdateBoundaryCondition(selectedBoundaryIndex, { unit: e.target.value })}
                  className="h-7 w-14 shrink-0 rounded border border-slate-700 bg-slate-950 px-1.5 font-mono text-[10.5px] text-slate-300 outline-none focus:border-sky-500"
                />
              </div>
            </Field>
            <ReadRow label="Location / Normal" value={activeBc.location || activeBc.description} />
          </Section>
        )}
      </>
    );
  } else if (step === 'contacts') {
    contextual = (
      <>
        <Section title="Contacts & Multi-Body Interfaces (CalculiX)">
          <Field label="Interface Type" htmlFor="contact-type">
            <select
              id="contact-type"
              value={inputs.contactType}
              disabled={inputsLocked}
              onChange={(e) =>
                onInputsChange({
                  contactType: e.target.value as SimulationInputs['contactType'],
                  nonlinear:
                    e.target.value === 'Frictional' || e.target.value === 'Contact_Frictionless'
                      ? true
                      : inputs.nonlinear,
                })
              }
              className={inputClass}
            >
              <option value="Bonded">Bonded (Single-Body Support)</option>
              <option value="Sliding">Frictionless Sliding Support</option>
              <option value="Tie">2-Body Tied Assembly (*TIE)</option>
              <option value="Frictional">2-Body Frictional Contact (*CONTACT PAIR + *FRICTION)</option>
              <option value="Contact_Frictionless">2-Body Frictionless Contact (*CONTACT PAIR)</option>
            </select>
          </Field>
          {inputs.contactType === 'Frictional' && (
            <NumberField
              id="in-friction-mu"
              label="Friction Coeff. μ"
              unit="-"
              value={inputs.frictionCoeff}
              placeholder="Required (e.g. 0.25)"
              disabled={inputsLocked}
              onChange={(frictionCoeff) => onInputsChange({ frictionCoeff })}
            />
          )}
          <ReadRow
            label="Domain Coupling"
            value={
              inputs.contactType === 'Frictional'
                ? '2-Body Surface-to-Surface (*CONTACT PAIR + *FRICTION)'
                : inputs.contactType === 'Contact_Frictionless'
                ? '2-Body Surface-to-Surface (*CONTACT PAIR)'
                : inputs.contactType === 'Tie'
                ? '2-Body Tied Assembly (*TIE)'
                : inputs.simulationType === 'CHT_Coupled'
                ? 'Fluid–Solid Thermal Interface'
                : inputs.simulationType === 'Thermal_Structural'
                ? 'Thermal–Structural One-Way C3D8T'
                : 'Single-Region Domain'
            }
          />
          <ActionButton icon={<Layers className="h-3.5 w-3.5" />} label="Open Solver Setup Workbench" onClick={() => actions.openDocument('overview')} />
        </Section>
      </>
    );
  } else if (step === 'solution') {
    contextual = (
      <>
        <Section title="Execution & Time Stepping">
          <Field label="Execution Mode" htmlFor="exec-mode">
            <select
              id="exec-mode"
              value={inputs.executionMode}
              disabled={inputsLocked}
              onChange={(event) => onInputsChange({ executionMode: event.target.value as ExecutionModeOption })}
              className={inputClass}
            >
              <option value="celery">Celery · Docker Queue (:8000)</option>
              <option value="direct">Direct · Sync Engine</option>
            </select>
          </Field>
          <Field label="Parallel Cores (MPI/OMP)" htmlFor="ctrl-parallel-cores">
            <select
              id="ctrl-parallel-cores"
              value={inputs.parallelCores || '1'}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ parallelCores: e.target.value })}
              className={inputClass}
            >
              <option value="1">1 Core (Serial)</option>
              <option value="2">2 Cores (MPI / OpenMP)</option>
              <option value="4">4 Cores (MPI / OpenMP)</option>
              <option value="8">8 Cores (MPI / OpenMP)</option>
              <option value="16">16 Cores (MPI / OpenMP)</option>
            </select>
          </Field>
          <Field label="Time Mode" htmlFor="time-mode">
            <select
              id="time-mode"
              value={inputs.timeMode}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ timeMode: e.target.value as 'steady' | 'transient' })}
              className={inputClass}
            >
              <option value="steady">Steady State</option>
              <option value="transient">Transient (pimpleFoam / *HEAT)</option>
            </select>
          </Field>
          {inputs.timeMode === 'transient' && (
            <>
              <NumberField id="ctrl-dt" label="Time Step Δt" unit="s" value={inputs.timeStep} placeholder="0.01" disabled={inputsLocked} onChange={(timeStep) => onInputsChange({ timeStep })} />
              <NumberField id="ctrl-end-t" label="End Time" unit="s" value={inputs.endTime} placeholder="1.0" disabled={inputsLocked} onChange={(endTime) => onInputsChange({ endTime })} />
            </>
          )}
          <label className="flex items-center justify-between pt-1 text-[11px] text-slate-300 cursor-pointer">
            <span>Enable Gravity (Y-axis)</span>
            <input
              type="checkbox"
              checked={inputs.gravityEnabled}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ gravityEnabled: e.target.checked })}
              className="accent-sky-500"
            />
          </label>
          {inputs.gravityEnabled && (
            <NumberField id="ctrl-grav-y" label="Gravity gy" unit="m/s²" value={inputs.gravityY} placeholder="-9.81" disabled={inputsLocked} onChange={(gravityY) => onInputsChange({ gravityY })} />
          )}
        </Section>
        <Section title="Numerics & Convergence">
          <Field label="Discretization" htmlFor="ctrl-scheme">
            <select
              id="ctrl-scheme"
              value={inputs.discretizationScheme}
              disabled={inputsLocked}
              onChange={(e) => onInputsChange({ discretizationScheme: e.target.value as 'first_order' | 'second_order' })}
              className={inputClass}
            >
              <option value="second_order">Second Order (linearUpwind)</option>
              <option value="first_order">First Order (upwind)</option>
            </select>
          </Field>
          <NumberField id="ctrl-iters" label="Max Iterations" unit="#" value={inputs.solverIterations} placeholder="250" disabled={inputsLocked} onChange={(solverIterations) => onInputsChange({ solverIterations })} />
          <NumberField id="ctrl-res" label="Residual Target" unit="-" value={inputs.residualTarget} placeholder="1e-5" disabled={inputsLocked} onChange={(residualTarget) => onInputsChange({ residualTarget })} />
          <NumberField id="ctrl-urp" label="Relaxation (p)" unit="-" value={inputs.relaxationP} placeholder="0.3" disabled={inputsLocked} onChange={(relaxationP) => onInputsChange({ relaxationP })} />
          <NumberField id="ctrl-uru" label="Relaxation (U)" unit="-" value={inputs.relaxationU} placeholder="0.7" disabled={inputsLocked} onChange={(relaxationU) => onInputsChange({ relaxationU })} />
          <NumberField id="ctrl-urt" label="Relaxation (T)" unit="-" value={inputs.relaxationT} placeholder="0.8" disabled={inputsLocked} onChange={(relaxationT) => onInputsChange({ relaxationT })} />
        </Section>
      </>
    );
  } else {
    const norm = project.normalizedSolverResult;
    const physicsType = results?.physics_type || results?.classified_type || norm?.physics || norm?.simulationType;
    const activeField =
      norm?.vtkData?.active_field ||
      (typeof (norm?.fields?.field_summary as any)?.primary_field === 'string'
        ? (norm?.fields?.field_summary as any).primary_field
        : undefined);
    const activeUnit =
      activeField && norm?.vtkData?.units?.[activeField]
        ? norm.vtkData.units[activeField]
        : typeof (norm?.fields?.field_summary as any)?.unit === 'string'
          ? (norm?.fields?.field_summary as any).unit
          : '';
    const fieldMin = norm?.values?.field_min;
    const fieldMax = norm?.values?.field_max;
    const processTime =
      typeof results?.process_time === 'number'
        ? `${results.process_time.toFixed(2)} s`
        : typeof results?.process_time_ms === 'number'
          ? `${(results.process_time_ms / 1000).toFixed(2)} s`
          : undefined;
    const integralsEntries = Object.entries(norm?.integrals || {});

    contextual = (
      <>
        <Section title="Results Summary">
          {results || norm ? (
            <>
              <ReadRow label="Physics" value={physicsType} />
              <ReadRow label="Solver" value={results?.recommended_solver || results?.solver_engine || norm?.solver} />
              <ReadRow
                label="Parallel Cores"
                value={
                  typeof results?.parallel_cores === 'number'
                    ? `${results.parallel_cores} ${results.parallel_cores === 1 ? 'Core' : 'Cores'}`
                    : typeof norm?.values?.parallel_cores === 'number'
                      ? `${norm.values.parallel_cores} ${norm.values.parallel_cores === 1 ? 'Core' : 'Cores'}`
                      : undefined
                }
              />
              <ReadRow label="Process time" value={processTime} />
              {activeField && (
                <ReadRow label="Primary Field" value={activeUnit ? `${activeField} (${activeUnit})` : activeField} />
              )}
              {typeof fieldMin === 'number' && typeof fieldMax === 'number' && (
                <ReadRow
                  label="Field Range"
                  value={`${fieldMin.toExponential(3)} .. ${fieldMax.toExponential(3)}`}
                />
              )}
              <ReadRow label="Max temperature" value={typeof results?.max_temperature === 'number' ? `${results.max_temperature.toFixed(1)} °C` : undefined} />
              <ReadRow label="Center temperature" value={typeof results?.center_temperature === 'number' ? `${results.center_temperature.toFixed(1)} °C` : undefined} />
              <ReadRow label="Heat flux" value={typeof results?.calculated_heat_flux === 'number' ? `${results.calculated_heat_flux.toFixed(2)} W/m²` : undefined} />
            </>
          ) : (
            <p className="text-[11px] text-slate-500">Run a simulation to populate solver results.</p>
          )}
        </Section>
        {integralsEntries.length > 0 && (
          <Section title="Surface & Field Integrals">
            <div className="space-y-1.5">
              {integralsEntries.map(([key, val]) => {
                const meta = INTEGRAL_LABELS[key];
                const label = meta?.label || key.replace(/_/g, ' ');
                const formatted =
                  typeof val === 'number'
                    ? (Math.abs(val) > 1e4 || (Math.abs(val) > 0 && Math.abs(val) < 1e-3)
                        ? val.toExponential(4)
                        : val.toLocaleString(undefined, { maximumFractionDigits: 4 }))
                    : String(val);
                return (
                  <ReadRow
                    key={key}
                    label={label}
                    value={meta?.unit ? `${formatted} ${meta.unit}` : formatted}
                  />
                );
              })}
            </div>
          </Section>
        )}
        <Section title="Result Views">
          {onDownloadCaseArchive && (
            <ActionButton
              accent
              disabled={!lastTaskId}
              icon={<Download className="h-3.5 w-3.5" />}
              label={lastTaskId ? 'Download Solver Deck & VTK (.zip)' : 'Solver Deck (.zip requires Celery job)'}
              onClick={() => {
                if (lastTaskId) onDownloadCaseArchive(lastTaskId);
              }}
            />
          )}
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
      className="flex w-76 shrink-0 flex-col border-l border-slate-800 bg-slate-900/60 print:hidden"
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-slate-800 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Properties</span>
        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">{STEP_TITLES[step]}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {step === 'physics' ? (
          <>
            {domainAndModelSection}
            {physicsSections}
            {contextual}
          </>
        ) : step === 'mesh' || step === 'boundaries' || step === 'contacts' || step === 'solution' || step === 'post' ? (
          <>
            {contextual}
            {domainAndModelSection}
          </>
        ) : (
          <>
            {contextual}
            {domainAndModelSection}
            {physicsSections}
          </>
        )}
      </div>
    </aside>
  );
};