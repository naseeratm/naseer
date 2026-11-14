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

interface BaseFluidPreset {
  id: string;
  name: string;
  rho: number; // kg/m3
  mu: number;  // Pa.s
  k: number;   // W/(m.K)
  cp: number;  // J/(kg.K)
}

interface NanoparticlePreset {
  id: string;
  name: string;
  rho: number; // kg/m3
  k: number;   // W/(m.K)
  cp: number;  // J/(kg.K)
}

export interface SweepCaseRow {
  id: string;
  caseName: string;
  fluidLabel: string;
  phiPercent: number;
  velocity: number;      // m/s
  inletTempK: number;    // K
  heatFlux: number;      // W/m2
  dhMeters: number;      // m
  reynolds: number;
  regime: 'laminar' | 'kOmegaSST';
  rhoEff: number;
  muEff: number;         // Pa.s
  nuEff: number;         // m2/s
  kEff: number;          // W/(m.K)
  cpEff: number;         // J/(kg.K)
  prandtl: number;
  status: 'Ready' | 'Queued' | 'Running' | 'Completed' | 'Error';
  resultSummary?: string;
  nuResult?: number;
  deltaPResult?: number;
  hResult?: number;
  tMaxResult?: number;
}

const BASE_FLUIDS: BaseFluidPreset[] = [
  { id: 'water', name: 'Pure Water (20°C)', rho: 998.2, mu: 0.001002, k: 0.598, cp: 4182 },
  { id: 'eg_water', name: 'Ethylene Glycol / Water (50:50)', rho: 1067, mu: 0.0038, k: 0.382, cp: 3300 },
  { id: 'air', name: 'Air (Standard 20°C)', rho: 1.204, mu: 1.825e-5, k: 0.0251, cp: 1007 },
];

const NANOPARTICLES: NanoparticlePreset[] = [
  { id: 'none', name: 'None (Pure Base Fluid)', rho: 0, k: 0, cp: 0 },
  { id: 'al2o3', name: 'Al₂O₃ (Alumina)', rho: 3970, k: 40.0, cp: 765 },
  { id: 'cuo', name: 'CuO (Copper Oxide)', rho: 6500, k: 18.0, cp: 540 },
  { id: 'tio2', name: 'TiO₂ (Titanium Dioxide)', rho: 4250, k: 8.95, cp: 686 },
  { id: 'sio2', name: 'SiO₂ (Silicon Dioxide)', rho: 2220, k: 1.38, cp: 745 },
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
  projectName = 'Corrugated_Duct_CHT',
  boundaryConditions = [],
  onAutoFixBoundaries,
  onApplyToProject,
  onRunRealBatch,
}) => {
  // 1. Internal Cooling / Duct Physics Wizard State
  const [hydraulicDiameterMm, setHydraulicDiameterMm] = useState<number>(20);
  const [inletVelocity, setInletVelocity] = useState<number>(0.25);
  const [inletTempC, setInletTempC] = useState<number>(25);
  const [wallHeatFlux, setWallHeatFlux] = useState<number>(5000);

  // 2. Nanofluid Mixture Calculator State
  const [baseFluidId, setBaseFluidId] = useState<string>('water');
  const [nanoId, setNanoId] = useState<string>('al2o3');
  const [phiPercent, setPhiPercent] = useState<number>(2.0);

  // 3. Parametric Sweep Queue State
  const [sweepRows, setSweepRows] = useState<SweepCaseRow[]>([]);
  const [dispatchLog, setDispatchLog] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  // Real-time Physical Mixture Calculation (Pak & Cho + Brinkman + Maxwell)
  const mixture = useMemo(() => {
    const bf = BASE_FLUIDS.find((f) => f.id === baseFluidId) || BASE_FLUIDS[0];
    const np = NANOPARTICLES.find((n) => n.id === nanoId) || NANOPARTICLES[0];
    const phiRaw = np.id === 'none' ? 0 : phiPercent / 100;
    const phi = Math.max(0, Math.min(0.15, phiRaw));

    const rhoEff = (1 - phi) * bf.rho + phi * np.rho;
    const cpEff =
      phi === 0
        ? bf.cp
        : ((1 - phi) * bf.rho * bf.cp + phi * np.rho * np.cp) / rhoEff;
    const muEff = phi === 0 ? bf.mu : bf.mu / Math.pow(1 - phi, 2.5);
    const nuEff = muEff / rhoEff;

    let kEff = bf.k;
    if (phi > 0 && np.k > 0) {
      const num = np.k + 2 * bf.k - 2 * phi * (bf.k - np.k);
      const den = np.k + 2 * bf.k + phi * (bf.k - np.k);
      kEff = bf.k * (num / den);
    }

    const alphaEff = kEff / (rhoEff * cpEff);
    const prandtl = nuEff / alphaEff;
    const dhMeters = hydraulicDiameterMm / 1000;
    const reynolds = dhMeters > 0 ? (rhoEff * Math.max(0, inletVelocity) * dhMeters) / muEff : 0;
    const regime: 'laminar' | 'kOmegaSST' = reynolds < 2300 ? 'laminar' : 'kOmegaSST';

    return {
      bf,
      np,
      phi,
      rhoEff,
      cpEff,
      muEff,
      nuEff,
      kEff,
      prandtl,
      dhMeters,
      reynolds,
      regime,
    };
  }, [baseFluidId, nanoId, phiPercent, hydraulicDiameterMm, inletVelocity]);

  // Pre-Flight Physics Check (Green / Red Automated Verification)
  const preFlightChecks = useMemo(() => {
    const hasInlet = boundaryConditions.some((b) =>
      `${b.name} ${b.type}`.toLowerCase().includes('inlet')
    );
    const hasOutlet = boundaryConditions.some((b) =>
      `${b.name} ${b.type}`.toLowerCase().includes('outlet')
    );
    const bcPass = hasInlet && hasOutlet;

    // Units check: Dh converted to SI meters (0.0005 m <= Dh <= 2.0 m)
    const unitsPass =
      Number.isFinite(mixture.dhMeters) &&
      mixture.dhMeters >= 0.0005 &&
      mixture.dhMeters <= 2.0;

    // Impossible physical values check
    const validPhi = nanoId === 'none' || (phiPercent >= 0 && phiPercent <= 10);
    const validTempK = inletTempC + 273.15 > 273.15 && inletTempC + 273.15 < 1500;
    const validVel = Number.isFinite(inletVelocity) && inletVelocity > 0 && inletVelocity <= 100;
    const validProps =
      mixture.rhoEff > 0 &&
      mixture.muEff > 0 &&
      mixture.kEff > 0 &&
      mixture.cpEff > 0 &&
      wallHeatFlux >= 0;
    const physicsPass = validPhi && validTempK && validVel && validProps;

    return {
      items: [
        {
          id: 'bc',
          title: 'Inlet & Outlet Boundaries',
          passed: bcPass,
          detail: bcPass
            ? 'Detected active Inlet & Outlet boundaries in simulation tree.'
            : `Missing ${!hasInlet ? 'Inlet' : ''}${!hasInlet && !hasOutlet ? ' & ' : ''}${!hasOutlet ? 'Outlet' : ''} boundary condition in project tree.`,
        },
        {
          id: 'units',
          title: 'SI Units Consistency (Meters)',
          passed: unitsPass,
          detail: unitsPass
            ? `Hydraulic diameter converted to SI: Dh = ${mixture.dhMeters.toFixed(4)} m (${hydraulicDiameterMm} mm).`
            : `Invalid hydraulic diameter (${hydraulicDiameterMm} mm → ${mixture.dhMeters} m). Check mm-to-m scaling.`,
        },
        {
          id: 'physics',
          title: 'Physical Bounds & Conservation',
          passed: physicsPass,
          detail: physicsPass
            ? `Valid state: U=${inletVelocity} m/s, Tin=${(inletTempC + 273.15).toFixed(2)} K, φ=${nanoId === 'none' ? 0 : phiPercent}%, ρ=${mixture.rhoEff.toFixed(1)} kg/m³.`
            : 'Out-of-range physical value detected (check U > 0, 0 ≤ φ ≤ 10%, Tin > 0°C, q" ≥ 0).',
        },
      ],
      allPassed: bcPass && unitsPass && physicsPass,
    };
  }, [
    boundaryConditions,
    mixture,
    hydraulicDiameterMm,
    nanoId,
    phiPercent,
    inletTempC,
    inletVelocity,
    wallHeatFlux,
  ]);

  const buildRowForVelocity = (vel: number): SweepCaseRow => {
    const fluidShort =
      mixture.np.id === 'none'
        ? 'Pure_Water'
        : `${mixture.np.id.toUpperCase()}_${phiPercent}pct`;
    const re =
      mixture.dhMeters > 0
        ? (mixture.rhoEff * Math.max(0, vel) * mixture.dhMeters) / mixture.muEff
        : 0;
    const reg: 'laminar' | 'kOmegaSST' = re < 2300 ? 'laminar' : 'kOmegaSST';

    return {
      id: `run_${Date.now()}_${vel}_${Math.random().toString(36).slice(2, 6)}`,
      caseName: `${projectName.replace(/\s+/g, '_')}_${fluidShort}_U${vel}`,
      fluidLabel:
        mixture.np.id === 'none'
          ? mixture.bf.name
          : `${mixture.np.name} (${phiPercent}%)`,
      phiPercent: mixture.np.id === 'none' ? 0 : phiPercent,
      velocity: vel,
      inletTempK: Number((inletTempC + 273.15).toFixed(2)),
      heatFlux: wallHeatFlux,
      dhMeters: mixture.dhMeters,
      reynolds: Math.round(re),
      regime: reg,
      rhoEff: Number(mixture.rhoEff.toFixed(2)),
      muEff: Number(mixture.muEff.toExponential(4)),
      nuEff: Number(mixture.nuEff.toExponential(4)),
      kEff: Number(mixture.kEff.toFixed(4)),
      cpEff: Number(mixture.cpEff.toFixed(1)),
      prandtl: Number(mixture.prandtl.toFixed(2)),
      status: 'Ready',
    };
  };

  const openFoamDictionaries = useMemo(() => {
    const transportDict = `FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      transportProperties;
}

transportModel  Newtonian;
nu              [0 2 -1 0 0 0 0] ${mixture.nuEff.toExponential(5)};
rho             [1 -3 0 0 0 0 0] ${mixture.rhoEff.toFixed(3)};
Cp              [0 2 -2 -1 0 0 0] ${mixture.cpEff.toFixed(2)};
kappa           [1 1 -3 -1 0 0 0] ${mixture.kEff.toFixed(5)};
Pr              [0 0 0 0 0 0 0] ${mixture.prandtl.toFixed(3)};`;

    const turbulenceDict = `FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      turbulenceProperties;
}

// Auto-detected from Re = ${Math.round(mixture.reynolds)}
simulationType  ${mixture.regime === 'laminar' ? 'laminar' : 'RAS'};
${
  mixture.regime === 'kOmegaSST'
    ? `RAS
{
    RASModel        kOmegaSST;
    turbulence      on;
    printCoeffs     on;
}`
    : ''
}`;

    return { transportDict, turbulenceDict };
  }, [mixture]);

  const addCurrentToSweep = () => {
    setSweepRows((prev) => [...prev, buildRowForVelocity(inletVelocity)]);
  };

  const addStandardVelocitySweep = () => {
    const velocities = [0.2, 0.5, 1.0, 1.5];
    setSweepRows((prev) => [...prev, ...velocities.map((v) => buildRowForVelocity(v))]);
  };

  const removeSweepRow = (id: string) => {
    setSweepRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, patch: Partial<SweepCaseRow>) => {
    setSweepRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // Compute Thermal-Hydraulic Performance Evaluation Criterion: eta = (Nu/Nu0) / (dP/dP0)^(1/3)
  const rowsWithEta = useMemo(() => {
    const baseline = sweepRows.find(
      (r) =>
        r.status === 'Completed' &&
        typeof r.nuResult === 'number' &&
        r.nuResult > 0 &&
        typeof r.deltaPResult === 'number' &&
        r.deltaPResult > 0
    );
    return sweepRows.map((row) => {
      if (
        !baseline ||
        row.status !== 'Completed' ||
        typeof row.nuResult !== 'number' ||
        typeof row.deltaPResult !== 'number' ||
        row.deltaPResult <= 0
      ) {
        return { ...row, eta: undefined as number | undefined };
      }
      const nuRatio = row.nuResult / baseline.nuResult!;
      const dpRatio = row.deltaPResult / baseline.deltaPResult!;
      const eta = nuRatio / Math.cbrt(dpRatio);
      return { ...row, eta: Number(eta.toFixed(3)) };
    });
  }, [sweepRows]);

  const completedChartRows = useMemo(
    () =>
      rowsWithEta.filter(
        (r) =>
          r.status === 'Completed' &&
          typeof r.nuResult === 'number' &&
          typeof r.deltaPResult === 'number'
      ),
    [rowsWithEta]
  );

  const downloadDictionaries = () => {
    const combined = `${openFoamDictionaries.transportDict}\n\n// ==========================================\n\n${openFoamDictionaries.turbulenceDict}`;
    const blob = new Blob([combined], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_OpenFOAM_Dicts.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSweepCsv = () => {
    if (rowsWithEta.length === 0) return;
    const headers = [
      'Case_ID',
      'Fluid',
      'Phi_pct',
      'Velocity_m_s',
      'Reynolds',
      'Model',
      'Nu',
      'h_W_m2K',
      'PressureDrop_Pa',
      'Tmax_K',
      'ThermalPerformance_eta',
    ];
    const lines = rowsWithEta.map((r) =>
      [
        r.caseName,
        `"${r.fluidLabel}"`,
        r.phiPercent,
        r.velocity,
        r.reynolds,
        r.regime,
        r.nuResult ?? '',
        r.hResult ?? '',
        r.deltaPResult ?? '',
        r.tMaxResult ?? '',
        r.eta ?? '',
      ].join(',')
    );
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_Parametric_Sweep.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunBatch = async () => {
    if (sweepRows.length === 0 || !onRunRealBatch) return;
    setIsSending(true);
    setDispatchLog(null);
    try {
      await onRunRealBatch(sweepRows, updateRow);
      setDispatchLog(`✓ Completed real solver execution for ${sweepRows.length} case(s).`);
    } catch (err: any) {
      setDispatchLog(`Solver execution error: ${err?.message || 'Check backend server'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 bg-slate-950 text-slate-200 text-xs rounded-2xl border border-slate-800">
      {/* 0. Pre-Flight Physics Check (Green / Red Automated Gate) */}
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

      {/* 1. Internal Cooling / Duct Physics Wizard */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-sky-400 text-sm">
            <Sliders className="w-4 h-4" />
            <span>1. Internal Duct / Heat Exchanger Wizard (SI Unit Auto-Conversion)</span>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold ${
              mixture.regime === 'laminar'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }`}
          >
            Re = {Math.round(mixture.reynolds).toLocaleString()} → {mixture.regime}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-slate-400 block mb-1">
              Hydraulic Dia. Dh (mm → {mixture.dhMeters.toFixed(4)} m)
            </label>
            <input
              type="number"
              min={0.5}
              step="any"
              value={hydraulicDiameterMm}
              onChange={(e) => setHydraulicDiameterMm(parseFloat(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono"
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Inlet Velocity U (m/s)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={inletVelocity}
              onChange={(e) => setInletVelocity(parseFloat(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono"
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Inlet Temp. Tin (°C)</label>
            <input
              type="number"
              step="any"
              value={inletTempC}
              onChange={(e) => setInletTempC(parseFloat(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono"
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Corrugated Heat Flux (W/m²)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={wallHeatFlux}
              onChange={(e) => setWallHeatFlux(parseFloat(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono"
            />
          </div>
        </div>
      </div>

      {/* 2. Nanofluid Mixture Calculator */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
            <FlaskConical className="w-4 h-4" />
            <span>2. Nanofluid Mixture Calculator (Pak & Cho / Brinkman / Maxwell)</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onApplyToProject && (
              <button
                type="button"
                onClick={() => onApplyToProject(buildRowForVelocity(inletVelocity))}
                className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold flex items-center gap-1.5 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply to Active Project</span>
              </button>
            )}
            <button
              type="button"
              onClick={addCurrentToSweep}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Run</span>
            </button>
            <button
              type="button"
              onClick={addStandardVelocitySweep}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 transition-colors"
              title="Add U = 0.2, 0.5, 1.0, 1.5 m/s for current fluid"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>+4 Velocities (0.2–1.5 m/s)</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-slate-400 block mb-1">Base Fluid</label>
            <select
              value={baseFluidId}
              onChange={(e) => setBaseFluidId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              {BASE_FLUIDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Nanoparticle Type</label>
            <select
              value={nanoId}
              onChange={(e) => setNanoId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white"
            >
              {NANOPARTICLES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Volume Fraction φ (%)</label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              disabled={nanoId === 'none'}
              value={nanoId === 'none' ? 0 : phiPercent}
              onChange={(e) => setPhiPercent(parseFloat(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono disabled:opacity-40"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px]">
          <div>
            <span className="text-slate-500 block">ρ_eff (kg/m³)</span>
            <strong className="text-white">{mixture.rhoEff.toFixed(2)}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">ν_eff (m²/s)</span>
            <strong className="text-sky-400">{mixture.nuEff.toExponential(3)}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">k_eff (W/m·K)</span>
            <strong className="text-emerald-400">{mixture.kEff.toFixed(4)}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Cp_eff (J/kg·K)</span>
            <strong className="text-white">{mixture.cpEff.toFixed(1)}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Prandtl (Pr)</span>
            <strong className="text-amber-300">{mixture.prandtl.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      {/* 3. Parametric Sweep Table & Comparison Curve */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-amber-400 text-sm">
            <Table2 className="w-4 h-4" />
            <span>3. Parametric Sweep Queue ({rowsWithEta.length} Cases)</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={downloadDictionaries}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>OpenFOAM Dicts</span>
            </button>
            <button
              type="button"
              disabled={rowsWithEta.length === 0}
              onClick={exportSweepCsv}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              disabled={rowsWithEta.length === 0 || isSending || !onRunRealBatch || !preFlightChecks.allPassed}
              onClick={handleRunBatch}
              title={!preFlightChecks.allPassed ? 'Resolve Pre-Flight Physics Check errors first' : ''}
              className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-bold flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? 'Solving on Backend...' : 'Run Parametric Sweep'}</span>
            </button>
          </div>
        </div>

        {dispatchLog && (
          <div className="p-2.5 rounded-lg bg-slate-950 border border-sky-500/40 text-sky-300 font-mono text-[11px] flex items-center gap-2">
            {dispatchLog.startsWith('✓') ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{dispatchLog}</span>
          </div>
        )}

        {rowsWithEta.length === 0 ? (
          <div className="p-4 text-center rounded-lg bg-slate-950/60 border border-dashed border-slate-800 text-slate-400">
            Click <strong>Add Run</strong> or <strong>+4 Velocities (0.2–1.5 m/s)</strong> to populate the sweep table, then click <strong>Run Parametric Sweep</strong>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-1.5 px-2">Case ID</th>
                  <th className="py-1.5 px-2">Working Fluid</th>
                  <th className="py-1.5 px-2">U (m/s)</th>
                  <th className="py-1.5 px-2">Re</th>
                  <th className="py-1.5 px-2">Nu</th>
                  <th className="py-1.5 px-2">ΔP (Pa)</th>
                  <th className="py-1.5 px-2">η (PEC)</th>
                  <th className="py-1.5 px-2">Tmax (K)</th>
                  <th className="py-1.5 px-2">Status</th>
                  <th className="py-1.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {rowsWithEta.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/60 hover:bg-slate-950/50">
                    <td className="py-1.5 px-2 text-white">{row.caseName}</td>
                    <td className="py-1.5 px-2 text-emerald-300">{row.fluidLabel}</td>
                    <td className="py-1.5 px-2 text-sky-300">{row.velocity}</td>
                    <td className="py-1.5 px-2">{row.reynolds}</td>
                    <td className="py-1.5 px-2 text-cyan-300 font-bold">
                      {row.nuResult !== undefined ? row.nuResult.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-amber-300">
                      {row.deltaPResult !== undefined ? row.deltaPResult.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 px-2 font-bold">
                      {row.eta !== undefined ? (
                        <span className={row.eta >= 1.0 ? 'text-emerald-400' : 'text-slate-300'}>
                          {row.eta.toFixed(3)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-slate-200">
                      {row.tMaxResult !== undefined ? row.tMaxResult.toFixed(2) : '—'}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={
                          row.status === 'Completed'
                            ? 'text-emerald-400 font-bold'
                            : row.status === 'Error'
                            ? 'text-rose-400 font-bold'
                            : row.status === 'Running'
                            ? 'text-sky-400 animate-pulse'
                            : 'text-slate-300'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeSweepRow(row.id)}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Parametric Comparison Curve (Nu, Pressure Drop ΔP, and Thermal Performance η) */}
        {completedChartRows.length >= 2 && (
          <div className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 font-bold text-cyan-400 text-xs">
                <BarChart3 className="w-4 h-4" />
                <span>Parametric Comparison Curve: Nusselt (Nu), Pressure Drop (ΔP) & Performance Factor (η)</span>
              </div>
              <div className="flex items-center gap-4 text-[10.5px] font-mono">
                <span className="flex items-center gap-1 text-cyan-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" /> Nu
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> ΔP (Pa)
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> η (PEC)
                </span>
              </div>
            </div>

            {(() => {
              const W = 680;
              const H = 190;
              const padL = 44;
              const padR = 44;
              const padT = 18;
              const padB = 34;
              const plotW = W - padL - padR;
              const plotH = H - padT - padB;

              const maxNu = Math.max(...completedChartRows.map((r) => r.nuResult || 0), 1);
              const maxDp = Math.max(...completedChartRows.map((r) => r.deltaPResult || 0), 1);
              const maxEta = Math.max(...completedChartRows.map((r) => r.eta || 1), 1.5);

              const getX = (idx: number) =>
                padL +
                (completedChartRows.length === 1
                  ? plotW / 2
                  : (idx / (completedChartRows.length - 1)) * plotW);

              const nuPoints = completedChartRows
                .map((r, i) => `${getX(i)},${padT + plotH - ((r.nuResult || 0) / maxNu) * plotH}`)
                .join(' ');
              const dpPoints = completedChartRows
                .map((r, i) => `${getX(i)},${padT + plotH - ((r.deltaPResult || 0) / maxDp) * plotH}`)
                .join(' ');
              const etaPoints = completedChartRows
                .map((r, i) => `${getX(i)},${padT + plotH - ((r.eta || 1) / maxEta) * plotH}`)
                .join(' ');

              const etaOneY = padT + plotH - (1.0 / maxEta) * plotH;

              return (
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48 overflow-visible">
                  {/* Grid lines */}
                  {[0, 0.5, 1].map((g) => (
                    <line
                      key={g}
                      x1={padL}
                      x2={W - padR}
                      y1={padT + g * plotH}
                      y2={padT + g * plotH}
                      stroke="#1e293b"
                      strokeDasharray="3 3"
                    />
                  ))}
                  {/* η = 1.0 reference line */}
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={etaOneY}
                    y2={etaOneY}
                    stroke="#10b981"
                    strokeOpacity={0.35}
                    strokeDasharray="4 4"
                  />
                  {/* Curves */}
                  <polyline fill="none" stroke="#22d3ee" strokeWidth="2.2" points={nuPoints} />
                  <polyline fill="none" stroke="#fbbf24" strokeWidth="2.2" points={dpPoints} />
                  <polyline fill="none" stroke="#34d399" strokeWidth="2.2" points={etaPoints} />

                  {/* Points & X-axis labels */}
                  {completedChartRows.map((r, i) => {
                    const cx = getX(i);
                    const yNu = padT + plotH - ((r.nuResult || 0) / maxNu) * plotH;
                    const yDp = padT + plotH - ((r.deltaPResult || 0) / maxDp) * plotH;
                    const yEta = padT + plotH - ((r.eta || 1) / maxEta) * plotH;
                    return (
                      <g key={r.id}>
                        <circle cx={cx} cy={yNu} r="3.5" fill="#22d3ee" />
                        <circle cx={cx} cy={yDp} r="3.5" fill="#fbbf24" />
                        <circle cx={cx} cy={yEta} r="3.5" fill="#34d399" />
                        <text
                          x={cx}
                          y={H - 12}
                          textAnchor="middle"
                          fill="#94a3b8"
                          fontSize="9.5"
                          fontFamily="monospace"
                        >
                          {`U=${r.velocity} (${r.phiPercent}%)`}
                        </text>
                      </g>
                    );
                  })}
                  {/* Axis scales */}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#22d3ee" fontSize="9">
                    {maxNu.toFixed(0)}
                  </text>
                  <text x={W - padR + 6} y={padT + 4} textAnchor="start" fill="#fbbf24" fontSize="9">
                    {maxDp.toFixed(0)}Pa
                  </text>
                </svg>
              );
            })()}
          </div>
        )}
      </div>

      {/* Live OpenFOAM Dictionary Translation Preview */}
      <details className="rounded-xl bg-slate-900/60 border border-slate-800 p-3">
        <summary className="cursor-pointer font-mono font-bold text-slate-300 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-sky-400" />
          <span>Inspect Live OpenFOAM Dictionaries (constant/transportProperties & turbulenceProperties)</span>
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