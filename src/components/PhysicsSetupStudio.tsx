import React, { useState, useMemo } from 'react';
import {
  Sliders,
  FlaskConical,
  Table2,
  Plus,
  Trash2,
  Code2,
  Send,
  CheckCircle2,
  AlertTriangle,
  Download,
  Check,
  ShieldCheck,
  XCircle,
  BarChart3,
  Zap,
  Wrench,
} from 'lucide-react';
import { BoundaryCondition } from '../types/thesis';

export type GeometryPhysicsMode =
  | 'smooth_channel'
  | 'corrugated_channel'
  | 'external_flow'
  | 'cavity'
  | 'structural_fea';

interface BaseFluidPreset {
  id: string;
  name: string;
  rho: number;
  mu: number;
  k: number;
  cp: number;
}

interface NanoparticlePreset {
  id: string;
  name: string;
  rho: number;
  k: number;
  cp: number;
}

interface SolidMaterialPreset {
  id: string;
  name: string;
  rho: number;
  elasticModulusGpa: number;
  poissonRatio: number;
  yieldStrengthMpa: number;
  k: number;
  cp: number;
}

export interface SweepCaseRow {
  id: string;
  caseName: string;
  geometryMode: GeometryPhysicsMode;
  domainLengthM: number;
  dhMeters: number;
  fluidLabel: string;
  phiPercent: number;
  velocity: number;
  inletTempK: number;
  thermalBcType: 'heat_flux' | 'wall_temp';
  heatFlux: number;
  wallTempK?: number;
  waveCount?: number;
  waveAmplitudeRatio?: number;
  reynolds: number;
  regime: 'laminar' | 'kOmegaSST' | 'structural';
  rhoEff: number;
  muEff: number;
  nuEff: number;
  kEff: number;
  cpEff: number;
  prandtl: number;
  elasticModulusGpa?: number;
  poissonRatio?: number;
  yieldStrengthMpa?: number;
  supportType?: string;
  status: 'Ready' | 'Queued' | 'Running' | 'Completed' | 'Error';
  resultSummary?: string;
  nuResult?: number;
  deltaPResult?: number;
  hResult?: number;
  tMaxResult?: number;
}

const BASE_FLUIDS: BaseFluidPreset[] = [
  { id: 'water', name: 'Pure Water (20 C)', rho: 998.2, mu: 0.001002, k: 0.598, cp: 4182 },
  { id: 'eg_water', name: 'Ethylene Glycol / Water (50:50)', rho: 1067, mu: 0.0038, k: 0.382, cp: 3300 },
  { id: 'engine_oil', name: 'Engine Oil (SAE 30)', rho: 876, mu: 0.29, k: 0.145, cp: 1900 },
  { id: 'air', name: 'Air (Standard 20 C)', rho: 1.204, mu: 1.825e-5, k: 0.0251, cp: 1007 },
  { id: 'custom_fluid', name: 'Custom Fluid Properties...', rho: 1000, mu: 0.001, k: 0.6, cp: 4180 },
];

const NANOPARTICLES: NanoparticlePreset[] = [
  { id: 'none', name: 'None (Pure Single-Phase Fluid)', rho: 0, k: 0, cp: 0 },
  { id: 'al2o3', name: 'Al2O3 (Alumina)', rho: 3970, k: 40.0, cp: 765 },
  { id: 'cuo', name: 'CuO (Copper Oxide)', rho: 6500, k: 18.0, cp: 540 },
  { id: 'tio2', name: 'TiO2 (Titanium Dioxide)', rho: 4250, k: 8.95, cp: 686 },
  { id: 'sio2', name: 'SiO2 (Silicon Dioxide)', rho: 2220, k: 1.38, cp: 745 },
];

const SOLID_MATERIALS: SolidMaterialPreset[] = [
  { id: 'steel_4340', name: 'Structural Steel 4340', rho: 7850, elasticModulusGpa: 205, poissonRatio: 0.29, yieldStrengthMpa: 470, k: 44.5, cp: 475 },
  { id: 'al_6061', name: 'Aluminum Alloy 6061-T6', rho: 2700, elasticModulusGpa: 68.9, poissonRatio: 0.33, yieldStrengthMpa: 276, k: 167, cp: 896 },
  { id: 'copper_c11', name: 'Copper C11000', rho: 8940, elasticModulusGpa: 117, poissonRatio: 0.34, yieldStrengthMpa: 210, k: 391, cp: 385 },
  { id: 'ti_6al4v', name: 'Titanium Ti-6Al-4V', rho: 4430, elasticModulusGpa: 113.8, poissonRatio: 0.34, yieldStrengthMpa: 880, k: 6.7, cp: 526 },
];

export interface PhysicsSetupStudioProps {
  projectName?: string;
  boundaryConditions?: BoundaryCondition[];
  onAutoFixBoundaries?: () => void;
  onApplyToProject?: (caseRow: SweepCaseRow) => void;
  onRunRealBatch?: (
    cases: SweepCaseRow[],
    onRowUpdate: (id: string, patch: Partial<SweepCaseRow>) => void
  ) => Promise<void>;
}

export const PhysicsSetupStudio: React.FC<PhysicsSetupStudioProps> = ({
  projectName = 'Engineering_Model',
  boundaryConditions = [],
  onAutoFixBoundaries,
  onApplyToProject,
  onRunRealBatch,
}) => {
  const [geometryMode, setGeometryMode] = useState<GeometryPhysicsMode>('smooth_channel');
  const [domainLengthMm, setDomainLengthMm] = useState<number>(250);
  const [characteristicHeightMm, setCharacteristicHeightMm] = useState<number>(20);
  const [waveCount, setWaveCount] = useState<number>(4);
  const [waveAmplitudePct, setWaveAmplitudePct] = useState<number>(5);

  const [inletVelocity, setInletVelocity] = useState<number>(0.25);
  const [inletTempC, setInletTempC] = useState<number>(25);
  const [thermalBcType, setThermalBcType] = useState<'heat_flux' | 'wall_temp'>('heat_flux');
  const [wallHeatFlux, setWallHeatFlux] = useState<number>(5000);
  const [wallTempC, setWallTempC] = useState<number>(80);

  const [appliedPressureMpa, setAppliedPressureMpa] = useState<number>(15);
  const [supportType, setSupportType] = useState<string>('cantilever');
  const [solidMaterialId, setSolidMaterialId] = useState<string>('steel_4340');

  const [baseFluidId, setBaseFluidId] = useState<string>('water');
  const [customRho, setCustomRho] = useState<number>(1000);
  const [customMu, setCustomMu] = useState<number>(0.001);
  const [customK, setCustomK] = useState<number>(0.6);
  const [customCp, setCustomCp] = useState<number>(4180);

  const [nanoId, setNanoId] = useState<string>('none');
  const [phiPercent, setPhiPercent] = useState<number>(2.0);

  const [sweepRows, setSweepRows] = useState<SweepCaseRow[]>([]);
  const [dispatchLog, setDispatchLog] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  const isStructural = geometryMode === 'structural_fea';

  const physicsState = useMemo(() => {
    const lxMeters = domainLengthMm / 1000;
    const lyMeters = characteristicHeightMm / 1000;

    if (isStructural) {
      const solid = SOLID_MATERIALS.find((s) => s.id === solidMaterialId) || SOLID_MATERIALS[0];
      return {
        lxMeters,
        lyMeters,
        rhoEff: solid.rho,
        cpEff: solid.cp,
        muEff: 0,
        nuEff: 0,
        kEff: solid.k,
        prandtl: 0,
        reynolds: 0,
        regime: 'structural' as const,
        fluidName: solid.name,
        solid,
      };
    }

    const basePreset = BASE_FLUIDS.find((f) => f.id === baseFluidId) || BASE_FLUIDS[0];
    const bf: BaseFluidPreset =
      baseFluidId === 'custom_fluid'
        ? { ...basePreset, rho: customRho, mu: customMu, k: customK, cp: customCp }
        : basePreset;

    const np = NANOPARTICLES.find((n) => n.id === nanoId) || NANOPARTICLES[0];
    const phiRaw = np.id === 'none' ? 0 : phiPercent / 100;
    const phi = Math.max(0, Math.min(0.15, phiRaw));

    const rhoEff = (1 - phi) * bf.rho + phi * np.rho;
    const cpEff =
      phi === 0
        ? bf.cp
        : ((1 - phi) * bf.rho * bf.cp + phi * np.rho * np.cp) / Math.max(1e-6, rhoEff);
    const muEff = phi === 0 ? bf.mu : bf.mu / Math.pow(1 - phi, 2.5);
    const nuEff = muEff / Math.max(1e-6, rhoEff);

    let kEff = bf.k;
    if (phi > 0 && np.k > 0) {
      const num = np.k + 2 * bf.k - 2 * phi * (bf.k - np.k);
      const den = np.k + 2 * bf.k + phi * (bf.k - np.k);
      kEff = bf.k * (num / den);
    }

    const alphaEff = kEff / Math.max(1e-6, rhoEff * cpEff);
    const prandtl = nuEff / Math.max(1e-12, alphaEff);
    const reynolds =
      lyMeters > 0 && muEff > 0
        ? (rhoEff * Math.max(0, inletVelocity) * lyMeters) / muEff
        : 0;
    const regime: 'laminar' | 'kOmegaSST' = reynolds < 2300 ? 'laminar' : 'kOmegaSST';

    return {
      lxMeters,
      lyMeters,
      rhoEff,
      cpEff,
      muEff,
      nuEff,
      kEff,
      prandtl,
      reynolds,
      regime,
      fluidName: np.id === 'none' ? bf.name : `${bf.name} + ${np.name} (${phiPercent}%)`,
      solid: undefined,
    };
  }, [
    isStructural,
    domainLengthMm,
    characteristicHeightMm,
    solidMaterialId,
    baseFluidId,
    customRho,
    customMu,
    customK,
    customCp,
    nanoId,
    phiPercent,
    inletVelocity,
  ]);

  const preFlightChecks = useMemo(() => {
    const unitsPass =
      Number.isFinite(physicsState.lxMeters) &&
      physicsState.lxMeters >= 0.001 &&
      Number.isFinite(physicsState.lyMeters) &&
      physicsState.lyMeters >= 0.0005;

    if (isStructural) {
      const hasConstraint = boundaryConditions.some((b) =>
        Boolean(`${b.name}${b.type}`.toLowerCase().match(/fix|support|clamp|load|force|pressure/))
      );
      const bcPass = boundaryConditions.length === 0 ? true : hasConstraint;
      const boundsPass = appliedPressureMpa > 0 && physicsState.lxMeters > 0 && physicsState.lyMeters > 0;

      return {
        items: [
          {
            id: 'bc',
            title: 'Structural Supports & Loads',
            passed: bcPass,
            detail: `Support: ${supportType}, Applied Load:${appliedPressureMpa} MPa.`,
          },
          {
            id: 'units',
            title: 'SI Geometry Dimensions (Meters)',
            passed: unitsPass,
            detail: `Lx = ${physicsState.lxMeters.toFixed(4)} m, Ly =${physicsState.lyMeters.toFixed(4)} m.`,
          },
          {
            id: 'physics',
            title: 'Material Constitutive Bounds',
            passed: boundsPass,
            detail: `${physicsState.fluidName} (E =${physicsState.solid?.elasticModulusGpa} GPa, Yield = ${physicsState.solid?.yieldStrengthMpa} MPa).`, }, ], allPassed: bcPass && unitsPass && boundsPass, }; }  const needsInletOutlet = geometryMode !== 'cavity'; const hasInlet = boundaryConditions.some((b) => `${b.name} ${b.type}`.toLowerCase().includes('inlet') ); const hasOutlet = boundaryConditions.some((b) => `${b.name} ${b.type}`.toLowerCase().includes('outlet') ); const bcPass = !needsInletOutlet || (hasInlet && hasOutlet);  const validPhi = nanoId === 'none' || (phiPercent >= 0 && phiPercent <= 10); const validTempK = inletTempC + 273.15 > 0 && inletTempC + 273.15 < 2500; const validVel = Number.isFinite(inletVelocity) && inletVelocity > 0 && inletVelocity <= 300; const validProps = physicsState.rhoEff > 0 && physicsState.muEff > 0 && physicsState.kEff > 0 && physicsState.cpEff > 0; const physicsPass = validPhi && validTempK && validVel && validProps;  return { items: [ { id: 'bc', title: needsInletOutlet ? 'Inlet & Outlet Boundaries' : 'Closed Cavity Walls', passed: bcPass, detail: bcPass ? 'Active boundary conditions verified in project tree.' : `Missing ${!hasInlet ? 'Inlet' : ''}${!hasInlet && !hasOutlet ? ' & ' : ''}${!hasOutlet ? 'Outlet' : ''} boundary condition in project tree.`,
        },
        {
          id: 'units',
          title: 'SI Domain Dimensions (Meters)',
          passed: unitsPass,
          detail: unitsPass
            ? `Domain: Lx = ${physicsState.lxMeters.toFixed(4)} m, Ly = ${physicsState.lyMeters.toFixed(4)} m.` : 'Invalid domain dimensions (must be > 0 mm).', }, { id: 'physics', title: 'Conservation & Thermophysical Bounds', passed: physicsPass, detail: physicsPass ? `U=${inletVelocity} m/s, Tin=${(inletTempC + 273.15).toFixed(2)} K, rho=${physicsState.rhoEff.toFixed(1)} kg/m3.`
            : 'Invalid physical parameter detected (check U > 0, rho > 0, mu > 0, k > 0).',
        },
      ],
      allPassed: bcPass && unitsPass && physicsPass,
    };
  }, [
    isStructural,
    geometryMode,
    boundaryConditions,
    physicsState,
    appliedPressureMpa,
    supportType,
    nanoId,
    phiPercent,
    inletTempC,
    inletVelocity,
  ]);

  const buildCaseRow = (overrideVelOrLoad?: number, overridePhiPct?: number): SweepCaseRow => {
    const val = overrideVelOrLoad ?? (isStructural ? appliedPressureMpa : inletVelocity);

    if (isStructural) {
      const solid = physicsState.solid!;
      return {
        id: `run_${Date.now()}_${val}_${Math.random().toString(36).slice(2, 6)}`, caseName: `${projectName.replace(/\s+/g, '_')}_FEA_P${val}MPa`, geometryMode, domainLengthM: physicsState.lxMeters, dhMeters: physicsState.lyMeters, fluidLabel: solid.name, phiPercent: 0, velocity: val, inletTempK: Number((inletTempC + 273.15).toFixed(2)), thermalBcType, heatFlux: 0, reynolds: 0, regime: 'structural', rhoEff: solid.rho, muEff: 0, nuEff: 0, kEff: solid.k, cpEff: solid.cp, prandtl: 0, elasticModulusGpa: solid.elasticModulusGpa, poissonRatio: solid.poissonRatio, yieldStrengthMpa: solid.yieldStrengthMpa, supportType, status: 'Ready', }; }  const activePhiPct = overridePhiPct !== undefined ? overridePhiPct : nanoId === 'none' ? 0 : phiPercent; const basePreset = BASE_FLUIDS.find((f) => f.id === baseFluidId) || BASE_FLUIDS[0]; const bf = baseFluidId === 'custom_fluid' ? { ...basePreset, rho: customRho, mu: customMu, k: customK, cp: customCp } : basePreset; const np = NANOPARTICLES.find((n) => n.id === nanoId) || NANOPARTICLES[0]; const phi = activePhiPct <= 0 || np.id === 'none' ? 0 : activePhiPct / 100;  const rhoEff = (1 - phi) * bf.rho + phi * np.rho; const cpEff = phi === 0 ? bf.cp : ((1 - phi) * bf.rho * bf.cp + phi * np.rho * np.cp) / rhoEff; const muEff = phi === 0 ? bf.mu : bf.mu / Math.pow(1 - phi, 2.5); const nuEff = muEff / rhoEff; let kEff = bf.k; if (phi > 0 && np.k > 0) { const num = np.k + 2 * bf.k - 2 * phi * (bf.k - np.k); const den = np.k + 2 * bf.k + phi * (bf.k - np.k); kEff = bf.k * (num / den); } const prandtl = nuEff / (kEff / (rhoEff * cpEff)); const re = (rhoEff * val * physicsState.lyMeters) / muEff; const reg: 'laminar' | 'kOmegaSST' = re < 2300 ? 'laminar' : 'kOmegaSST';  const tag = phi === 0 ? bf.id.toUpperCase() : `${np.id.toUpperCase()}_${activePhiPct}pct`;  return { id: `run_${Date.now()}_${val}_${activePhiPct}_${Math.random().toString(36).slice(2, 6)}`, caseName: `${projectName.replace(/\s+/g, '_')}_${tag}_U${val}`,
      geometryMode,
      domainLengthM: physicsState.lxMeters,
      dhMeters: physicsState.lyMeters,
      fluidLabel: phi === 0 ? bf.name : `${bf.name} +${np.name} (${activePhiPct}\%)`, phiPercent: activePhiPct, velocity: val, inletTempK: Number((inletTempC + 273.15).toFixed(2)), thermalBcType, heatFlux: thermalBcType === 'heat_flux' ? wallHeatFlux : 0, wallTempK: thermalBcType === 'wall_temp' ? Number((wallTempC + 273.15).toFixed(2)) : undefined, waveCount: geometryMode === 'corrugated_channel' ? waveCount : undefined, waveAmplitudeRatio: geometryMode === 'corrugated_channel' ? waveAmplitudePct / 100 : undefined, reynolds: Math.round(re), regime: reg, rhoEff: Number(rhoEff.toFixed(2)), muEff: Number(muEff.toExponential(4)), nuEff: Number(nuEff.toExponential(4)), kEff: Number(kEff.toFixed(4)), cpEff: Number(cpEff.toFixed(1)), prandtl: Number(prandtl.toFixed(2)), status: 'Ready', }; };  const openFoamDictionaries = useMemo(() => { if (isStructural) { return { transportDict: `*MATERIAL, NAME=${physicsState.fluidName.replace(/\s+/g, '_')}
*ELASTIC
${(physicsState.solid?.elasticModulusGpa || 205) * 1e9}, ${physicsState.solid?.poissonRatio || 0.29}
*DENSITY
${physicsState.rhoEff}`,
        turbulenceDict: `*STEP
*STATIC
*DLOAD
TOP_SURFACE, P, ${appliedPressureMpa}e6
*END STEP`,
      };
    }

    const transportDict = `FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      transportProperties;
}

transportModel  Newtonian;
nu              [0 2 -1 0 0 0 0] ${physicsState.nuEff.toExponential(5)};
rho             [1 -3 0 0 0 0 0] ${physicsState.rhoEff.toFixed(3)};
Cp              [0 2 -2 -1 0 0 0] ${physicsState.cpEff.toFixed(2)};
kappa           [1 1 -3 -1 0 0 0] ${physicsState.kEff.toFixed(5)};
Pr              [0 0 0 0 0 0 0] ${physicsState.prandtl.toFixed(3)};`;

    const turbulenceDict = `FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      turbulenceProperties;
}

// Geometry: ${geometryMode} || Re =${Math.round(physicsState.reynolds)}
simulationType  ${physicsState.regime === 'laminar' ? 'laminar' : 'RAS'};
${ physicsState.regime === 'kOmegaSST' ? `RAS { RASModel        kOmegaSST; turbulence      on; printCoeffs     on; }` : '' }`;  return { transportDict, turbulenceDict }; }, [isStructural, physicsState, appliedPressureMpa, geometryMode]);  const addCurrentCase = () => { setSweepRows((prev) => [...prev, buildCaseRow()]); };  const addVelocityOrLoadSweep = () => { const values = isStructural ? [5, 10, 20, 30] : [0.2, 0.5, 1.0, 1.5]; setSweepRows((prev) => [...prev, ...values.map((v) => buildCaseRow(v))]); };  const addConcentrationSweep = () => { const fracs = [0, 1, 2, 4]; setSweepRows((prev) => [...prev, ...fracs.map((f) => buildCaseRow(inletVelocity, f))]); };  const removeSweepRow = (id: string) => { setSweepRows((prev) => prev.filter((r) => r.id !== id)); };  const updateRow = (id: string, patch: Partial<SweepCaseRow>) => { setSweepRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); };  const rowsWithEta = useMemo(() => { const baseline = sweepRows.find( (r) => r.status === 'Completed' && typeof r.nuResult === 'number' && r.nuResult > 0 && typeof r.deltaPResult === 'number' && r.deltaPResult > 0 ); return sweepRows.map((row) => { if ( row.geometryMode === 'structural_fea' || !baseline || row.status !== 'Completed' || typeof row.nuResult !== 'number' || typeof row.deltaPResult !== 'number' || row.deltaPResult <= 0 ) { return { ...row, eta: undefined as number | undefined }; } const nuRatio = row.nuResult / baseline.nuResult!; const dpRatio = row.deltaPResult / baseline.deltaPResult!; const eta = nuRatio / Math.cbrt(dpRatio); return { ...row, eta: Number(eta.toFixed(3)) }; }); }, [sweepRows]);  const completedChartRows = useMemo( () => rowsWithEta.filter( (r) => r.status === 'Completed' && typeof r.nuResult === 'number' && typeof r.deltaPResult === 'number' ), [rowsWithEta] );  const downloadDictionaries = () => { const combined = `${openFoamDictionaries.transportDict}\n\n// ==========================================\n\n${openFoamDictionaries.turbulenceDict}`; const blob = new Blob([combined], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${projectName}_Solver_Deck.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSweepCsv = () => {
    if (rowsWithEta.length === 0) return;
    const headers = [
      'Case_ID',
      'Geometry_Mode',
      'Material_Fluid',
      'Phi_pct',
      'Velocity_or_Load',
      'Reynolds',
      'Primary_Metric_Nu_or_Stress',
      'Secondary_Metric_dP_or_Disp',
      'Tmax_K',
      'Performance_eta',
    ];
    const lines = rowsWithEta.map((r) =>
      [
        r.caseName,
        r.geometryMode,
        `"${r.fluidLabel}"`, r.phiPercent, r.velocity, r.reynolds, r.nuResult ?? '', r.deltaPResult ?? '', r.tMaxResult ?? '', r.eta ?? '', ].join(',') ); const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;', }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${projectName}_Parametric_Study.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunBatch = async () => {
    if (sweepRows.length === 0 || !onRunRealBatch) return;
    setIsSending(true);
    setDispatchLog(null);
    try {
      await onRunRealBatch(sweepRows, updateRow);
      setDispatchLog(`Completed deterministic solver execution for ${sweepRows.length} case(s).`);
    } catch (err: any) {
      setDispatchLog(`Solver execution error: ${err?.message || 'Check Python backend server'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 bg-slate-950 text-slate-200 text-xs rounded-2xl border border-slate-800">
      {/* 0. Adaptive Pre-Flight Physics Check */}
      <div
        className={`p-4 rounded-xl border space-y-2.5 ${
          preFlightChecks.allPassed
            ? 'bg-emerald-950/20 border-emerald-500/40'
            : 'bg-rose-950/25 border-rose-500/50'
        }`}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            {preFlightChecks.allPassed ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span className={preFlightChecks.allPassed ? 'text-emerald-300' : 'text-rose-300'}>
              Pre-Flight Physics Check:{' '}
              {preFlightChecks.allPassed ? 'READY TO RUN (ALL CHECKS PASSED)' : 'ACTION REQUIRED'}
            </span>
          </div>
          {!preFlightChecks.items[0].passed && onAutoFixBoundaries && (
            <button
              type="button"
              onClick={onAutoFixBoundaries}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 text-[11px]"
            >
              <Wrench className="w-3 h-3" />
              <span>Auto-Add Inlet & Outlet BCs</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {preFlightChecks.items.map((chk) => (
            <div
              key={chk.id}
              className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                chk.passed
                  ? 'bg-slate-900/90 border-emerald-500/30 text-emerald-200'
                  : 'bg-slate-900/90 border-rose-500/40 text-rose-200'
              }`}
            >
              {chk.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-bold text-[11px]">{chk.title}</div>
                <div className="text-[10.5px] text-slate-300 mt-0.5">{chk.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 1. Universal Geometry & Boundary Wizard */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-sky-400 text-sm">
            <Sliders className="w-4 h-4" />
            <span>1. Geometry Configuration & Operating Conditions (SI Unit Conversion)</span>
          </div>
          {!isStructural && (
            <span
              className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold ${ physicsState.regime === 'laminar' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40' }`} > Re = {Math.round(physicsState.reynolds).toLocaleString()} -&gt; {physicsState.regime} </span> )} </div>  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"> <div> <label className="text-slate-400 block mb-1">Geometry & Physics Configuration</label> <select value={geometryMode} onChange={(e) => setGeometryMode(e.target.value as GeometryPhysicsMode)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > <option value="smooth_channel">Internal Smooth Channel / Pipe</option> <option value="corrugated_channel">Internal Corrugated / Ribbed Channel</option> <option value="external_flow">External Flow Over Body / Airfoil</option> <option value="cavity">Closed Thermal / Lid-Driven Cavity</option> <option value="structural_fea">Structural Solid Body (2D FEA)</option> </select> </div> <div> <label className="text-slate-400 block mb-1"> Domain Length Lx (mm -&gt; {physicsState.lxMeters.toFixed(4)} m) </label> <input type="number" min={1} step="any" value={domainLengthMm} onChange={(e) => setDomainLengthMm(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1"> Characteristic Height / Dia. Ly (mm -&gt; {physicsState.lyMeters.toFixed(4)} m) </label> <input type="number" min={0.5} step="any" value={characteristicHeightMm} onChange={(e) => setCharacteristicHeightMm(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> </div>  {geometryMode === 'corrugated_channel' && ( <div className="grid grid-cols-2 gap-3 p-2.5 rounded-lg bg-slate-950/80 border border-sky-500/30"> <div> <label className="text-sky-300 block mb-1">Corrugation Wave Count (Cycles)</label> <input type="number" min={1} max={30} value={waveCount} onChange={(e) => setWaveCount(parseInt(e.target.value, 10) || 4)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-sky-300 block mb-1">Wave Amplitude Ratio (\% of Ly)</label> <input type="number" min={1} max={25} step={0.5} value={waveAmplitudePct} onChange={(e) => setWaveAmplitudePct(parseFloat(e.target.value) || 5)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" /> </div> </div> )}  {isStructural ? ( <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"> <div> <label className="text-slate-400 block mb-1">Applied Surface Pressure Load (MPa)</label> <input type="number" step="any" value={appliedPressureMpa} onChange={(e) => setAppliedPressureMpa(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">Support Constraint Type</label> <select value={supportType} onChange={(e) => setSupportType(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > <option value="cantilever">Cantilever (Fixed Left End)</option> <option value="simply_supported">Simply Supported (Both Ends)</option> <option value="clamped_both">Fully Clamped (Both Ends)</option> </select> </div> </div> ) : ( <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"> <div> <label className="text-slate-400 block mb-1">Flow Velocity U (m/s)</label> <input type="number" min={0} step="any" value={inletVelocity} onChange={(e) => setInletVelocity(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">Inlet / Free-Stream Temp (C)</label> <input type="number" step="any" value={inletTempC} onChange={(e) => setInletTempC(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">Wall Thermal Condition</label> <select value={thermalBcType} onChange={(e) => setThermalBcType(e.target.value as 'heat_flux' | 'wall_temp')} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > <option value="heat_flux">Constant Heat Flux q (W/m2)</option> <option value="wall_temp">Constant Wall Temp Tw (C)</option> </select> </div> <div> <label className="text-slate-400 block mb-1"> {thermalBcType === 'heat_flux' ? 'Wall Heat Flux q (W/m2)' : 'Wall Temperature Tw (C)'} </label> <input type="number" step="any" value={thermalBcType === 'heat_flux' ? wallHeatFlux : wallTempC} onChange={(e) => { const v = parseFloat(e.target.value) || 0; if (thermalBcType === 'heat_flux') setWallHeatFlux(v); else setWallTempC(v); }} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" /> </div> </div> )} </div>  {/* 2. Universal Material Library & Optional Nanofluid Calculator */} <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3"> <div className="flex items-center justify-between flex-wrap gap-2"> <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm"> <FlaskConical className="w-4 h-4" /> <span> {isStructural ? '2. Engineering Solid Material Library' : '2. Working Fluid & Optional Nanofluid Mixture Calculator'} </span> </div> <div className="flex items-center gap-2 flex-wrap"> {onApplyToProject && ( <button type="button" onClick={() => onApplyToProject(buildCaseRow())} className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1.5 transition-colors" > <Check className="w-3.5 h-3.5" /> <span>Apply to Active Project</span> </button> )} <button type="button" onClick={addCurrentCase} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 transition-colors" > <Plus className="w-3.5 h-3.5" /> <span>Add Case</span> </button> <button type="button" onClick={addVelocityOrLoadSweep} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 transition-colors" > <Zap className="w-3.5 h-3.5" /> <span>{isStructural ? '+4 Loads (5-30 MPa)' : '+4 Velocities (0.2-1.5 m/s)'}</span> </button> {!isStructural && nanoId !== 'none' && ( <button type="button" onClick={addConcentrationSweep} className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-bold flex items-center gap-1.5 transition-colors" > <Zap className="w-3.5 h-3.5" /> <span>+4 phi\% (0, 1, 2, 4\%)</span> </button> )} </div> </div>  {isStructural ? ( <div className="grid grid-cols-1 sm:grid-cols-4 gap-3"> <div className="sm:col-span-2"> <label className="text-slate-400 block mb-1">Solid Material</label> <select value={solidMaterialId} onChange={(e) => setSolidMaterialId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > {SOLID_MATERIALS.map((s) => ( <option key={s.id} value={s.id}> {s.name} </option> ))} </select> </div> <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono"> <span className="text-slate-500 block">Young Modulus (E)</span> <strong className="text-sky-400">{physicsState.solid?.elasticModulusGpa} GPa</strong> </div> <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono"> <span className="text-slate-500 block">Yield Strength</span> <strong className="text-emerald-400">{physicsState.solid?.yieldStrengthMpa} MPa</strong> </div> </div> ) : ( <> <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"> <div> <label className="text-slate-400 block mb-1">Base Working Fluid</label> <select value={baseFluidId} onChange={(e) => setBaseFluidId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > {BASE_FLUIDS.map((f) => ( <option key={f.id} value={f.id}> {f.name} </option> ))} </select> </div> <div> <label className="text-slate-400 block mb-1">Nanoparticle Additive (Optional)</label> <select value={nanoId} onChange={(e) => setNanoId(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" > {NANOPARTICLES.map((n) => ( <option key={n.id} value={n.id}> {n.name} </option> ))} </select> </div> <div> <label className="text-slate-400 block mb-1">Volume Fraction phi (\%)</label> <input type="number" min={0} max={10} step={0.5} disabled={nanoId === 'none'} value={nanoId === 'none' ? 0 : phiPercent} onChange={(e) => setPhiPercent(parseFloat(e.target.value) || 0)} className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono disabled:opacity-40" /> </div> </div>  {baseFluidId === 'custom_fluid' && ( <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800"> <div> <label className="text-slate-400 block mb-1">rho (kg/m3)</label> <input type="number" step="any" value={customRho} onChange={(e) => setCustomRho(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">mu (Pa.s)</label> <input type="number" step="any" value={customMu} onChange={(e) => setCustomMu(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">k (W/m.K)</label> <input type="number" step="any" value={customK} onChange={(e) => setCustomK(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white font-mono" /> </div> <div> <label className="text-slate-400 block mb-1">Cp (J/kg.K)</label> <input type="number" step="any" value={customCp} onChange={(e) => setCustomCp(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white font-mono" /> </div> </div> )}  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px]"> <div> <span className="text-slate-500 block">rho_eff (kg/m3)</span> <strong className="text-white">{physicsState.rhoEff.toFixed(2)}</strong> </div> <div> <span className="text-slate-500 block">nu_eff (m2/s)</span> <strong className="text-sky-400">{physicsState.nuEff.toExponential(3)}</strong> </div> <div> <span className="text-slate-500 block">k_eff (W/m.K)</span> <strong className="text-emerald-400">{physicsState.kEff.toFixed(4)}</strong> </div> <div> <span className="text-slate-500 block">Cp_eff (J/kg.K)</span> <strong className="text-white">{physicsState.cpEff.toFixed(1)}</strong> </div> <div> <span className="text-slate-500 block">Prandtl (Pr)</span> <strong className="text-amber-300">{physicsState.prandtl.toFixed(2)}</strong> </div> </div> </> )} </div>  {/* 3. Parametric Sweep Table & Comparison Curve */} <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3"> <div className="flex items-center justify-between flex-wrap gap-2"> <div className="flex items-center gap-2 font-bold text-amber-400 text-sm"> <Table2 className="w-4 h-4" /> <span>3. Parametric Sweep Queue ({rowsWithEta.length} Cases)</span> </div> <div className="flex items-center gap-2 flex-wrap"> <button type="button" onClick={downloadDictionaries} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5" > <Download className="w-3.5 h-3.5" /> <span>Solver Deck</span> </button> <button type="button" disabled={rowsWithEta.length === 0} onClick={exportSweepCsv} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold flex items-center gap-1.5" > <Download className="w-3.5 h-3.5" /> <span>Export CSV</span> </button> <button type="button" disabled={rowsWithEta.length === 0 || isSending || !onRunRealBatch || !preFlightChecks.allPassed} onClick={handleRunBatch} title={!preFlightChecks.allPassed ? 'Resolve Pre-Flight Physics Check errors first' : ''} className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-bold flex items-center gap-1.5" > <Send className="w-3.5 h-3.5" /> <span>{isSending ? 'Solving on Docker Engine (:8000)...' : 'Run Parametric Sweep'}</span> </button> </div> </div>  {dispatchLog && ( <div className="p-2.5 rounded-lg bg-slate-950 border border-sky-500/40 text-sky-300 font-mono text-[11px] flex items-center gap-2"> {dispatchLog.startsWith('Completed') ? ( <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> ) : ( <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /> )} <span>{dispatchLog}</span> </div> )}  {rowsWithEta.length === 0 ? ( <div className="p-4 text-center rounded-lg bg-slate-950/60 border border-dashed border-slate-800 text-slate-400"> Click <strong>Add Case</strong> or a sweep preset button above to populate the study table, then click <strong>Run Parametric Sweep</strong>. </div> ) : ( <div className="overflow-x-auto"> <table className="w-full text-left border-collapse font-mono text-[11px]"> <thead> <tr className="border-b border-slate-800 text-slate-400"> <th className="py-1.5 px-2">Case ID</th> <th className="py-1.5 px-2">Material / Fluid</th> <th className="py-1.5 px-2">{isStructural ? 'Load (MPa)' : 'U (m/s)'}</th> <th className="py-1.5 px-2">{isStructural ? 'Mode' : 'Re'}</th> <th className="py-1.5 px-2">{isStructural ? 'Stress (MPa)' : 'Nu'}</th> <th className="py-1.5 px-2">{isStructural ? 'Disp (mm)' : 'dP (Pa)'}</th> <th className="py-1.5 px-2">eta (PEC)</th> <th className="py-1.5 px-2">Tmax (K)</th> <th className="py-1.5 px-2">Status</th> <th className="py-1.5 px-2"></th> </tr> </thead> <tbody> {rowsWithEta.map((row) => ( <tr key={row.id} className="border-b border-slate-800/60 hover:bg-slate-950/50"> <td className="py-1.5 px-2 text-white">{row.caseName}</td> <td className="py-1.5 px-2 text-emerald-300">{row.fluidLabel}</td> <td className="py-1.5 px-2 text-sky-300">{row.velocity}</td> <td className="py-1.5 px-2">{row.geometryMode === 'structural_fea' ? 'FEA' : row.reynolds}</td> <td className="py-1.5 px-2 text-cyan-300 font-bold"> {row.nuResult !== undefined ? row.nuResult.toFixed(2) : '-'} </td> <td className="py-1.5 px-2 text-amber-300"> {row.deltaPResult !== undefined ? row.deltaPResult.toFixed(2) : '-'} </td> <td className="py-1.5 px-2 font-bold"> {row.eta !== undefined ? ( <span className={row.eta >= 1.0 ? 'text-emerald-400' : 'text-slate-300'}> {row.eta.toFixed(3)} </span> ) : ( '-' )} </td> <td className="py-1.5 px-2 text-slate-200"> {row.tMaxResult !== undefined ? row.tMaxResult.toFixed(2) : '-'} </td> <td className="py-1.5 px-2"> <span className={ row.status === 'Completed' ? 'text-emerald-400 font-bold' : row.status === 'Error' ? 'text-rose-400 font-bold' : row.status === 'Running' ? 'text-sky-400' : 'text-slate-300' } > {row.status} </span> </td> <td className="py-1.5 px-2 text-right"> <button type="button" onClick={() => removeSweepRow(row.id)} className="text-slate-500 hover:text-rose-400" > <Trash2 className="w-3.5 h-3.5" /> </button> </td> </tr> ))} </tbody> </table> </div> )}  {/* Parametric Comparison Curve */} {completedChartRows.length >= 2 && ( <div className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2"> <div className="flex items-center justify-between flex-wrap gap-2"> <div className="flex items-center gap-2 font-bold text-cyan-400 text-xs"> <BarChart3 className="w-4 h-4" /> <span>Parametric Comparison Curve</span> </div> <div className="flex items-center gap-4 text-[10.5px] font-mono"> <span className="flex items-center gap-1 text-cyan-400"> <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />{' '} {isStructural ? 'Stress (MPa)' : 'Nu'} </span> <span className="flex items-center gap-1 text-amber-400"> <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />{' '} {isStructural ? 'Disp (mm)' : 'dP (Pa)'} </span> {!isStructural && ( <span className="flex items-center gap-1 text-emerald-400"> <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> eta (PEC) </span> )} </div> </div>  {(() => { const W = 680; const H = 190; const padL = 44; const padR = 44; const padT = 18; const padB = 34; const plotW = W - padL - padR; const plotH = H - padT - padB;  const maxNu = Math.max(...completedChartRows.map((r) => r.nuResult || 0), 1); const maxDp = Math.max(...completedChartRows.map((r) => r.deltaPResult || 0), 1); const maxEta = Math.max(...completedChartRows.map((r) => r.eta || 1), 1.5);  const getX = (idx: number) => padL + (completedChartRows.length === 1 ? plotW / 2 : (idx / (completedChartRows.length - 1)) * plotW);  const nuPoints = completedChartRows .map((r, i) => `${getX(i)},${padT + plotH - ((r.nuResult || 0) / maxNu) * plotH}`) .join(' '); const dpPoints = completedChartRows .map((r, i) => `${getX(i)},${padT + plotH - ((r.deltaPResult || 0) / maxDp) * plotH}`) .join(' '); const etaPoints = completedChartRows .map((r, i) => `${getX(i)},${padT + plotH - ((r.eta || 1) / maxEta) * plotH}`) .join(' ');  const etaOneY = padT + plotH - (1.0 / maxEta) * plotH;  return ( <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48 overflow-visible"> {[0, 0.5, 1].map((g) => ( <line key={g} x1={padL} x2={W - padR} y1={padT + g * plotH} y2={padT + g * plotH} stroke="#1e293b" strokeDasharray="3 3" /> ))} {!isStructural && ( <line x1={padL} x2={W - padR} y1={etaOneY} y2={etaOneY} stroke="#10b981" strokeOpacity={0.35} strokeDasharray="4 4" /> )} <polyline fill="none" stroke="#22d3ee" strokeWidth="2.2" points={nuPoints} /> <polyline fill="none" stroke="#fbbf24" strokeWidth="2.2" points={dpPoints} /> {!isStructural && ( <polyline fill="none" stroke="#34d399" strokeWidth="2.2" points={etaPoints} /> )}  {completedChartRows.map((r, i) => { const cx = getX(i); const yNu = padT + plotH - ((r.nuResult || 0) / maxNu) * plotH; const yDp = padT + plotH - ((r.deltaPResult || 0) / maxDp) * plotH; const yEta = padT + plotH - ((r.eta || 1) / maxEta) * plotH; return ( <g key={r.id}> <circle cx={cx} cy={yNu} r="3.5" fill="#22d3ee" /> <circle cx={cx} cy={yDp} r="3.5" fill="#fbbf24" /> {!isStructural && <circle cx={cx} cy={yEta} r="3.5" fill="#34d399" />} <text x={cx} y={H - 12} textAnchor="middle" fill="#94a3b8" fontSize="9.5" fontFamily="monospace" > {isStructural ? `P=${r.velocity}MPa` : `U=${r.velocity} (${r.phiPercent}%)`}
                        </text>
                      </g>
                    );
                  })}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#22d3ee" fontSize="9">
                    {maxNu.toFixed(0)}
                  </text>
                  <text x={W - padR + 6} y={padT + 4} textAnchor="start" fill="#fbbf24" fontSize="9">
                    {maxDp.toFixed(0)}
                  </text>
                </svg>
              );
            })()}
          </div>
        )}
      </div>

      {/* Live Solver Deck Preview */}
      <details className="rounded-xl bg-slate-900/60 border border-slate-800 p-3">
        <summary className="cursor-pointer font-mono font-bold text-slate-300 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-sky-400" />
          <span>Inspect Live Solver Input Deck</span>
        </summary>
        <pre className="mt-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-[10.5px] font-mono text-emerald-300 overflow-x-auto">
          {openFoamDictionaries.transportDict}
          {'\n\n'}
          {openFoamDictionaries.turbulenceDict}
        </pre>
      </details>
    </div>
  );
};