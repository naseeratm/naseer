import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  Play,
  BarChart3,
  CheckCircle2,
  Download,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { CaseStudyItem, ThesisProject } from '../types/thesis';
import { SimulationInputs, SimulationType } from '../types/studio';
import { BoundaryMarker } from './Interactive3DViewport';

interface DesignPointItem {
  dpId: string;
  taskId?: string;
  paramVal: number;
  paramLabel: string;
  outputVal1: number | null;
  outputLabel1: string;
  outputVal2: number | null;
  outputLabel2: string;
  solverUsed?: string;
  status: 'Queued' | 'Running' | 'Converged' | 'Failed';
  error?: string;
}

type BackendSweepParam = 'velocity' | 'heat_flux' | 'temperature' | 'pressure_load_mpa' | 'mesh_size';

interface ParametricSweepToolProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: ThesisProject | null;
  simulationInputs?: SimulationInputs;
  uploadedCadStl?: { name: string; base64: string } | null;
  viewportBoundaryMarkers?: BoundaryMarker[];
  onSweepComplete?: (cases: CaseStudyItem[]) => void;
}

const SWEEP_PRESETS: Record<
  BackendSweepParam,
  { labelAr: string; unit: string; defaultMin: number; defaultMax: number }
> = {
  velocity: {
    labelAr: 'سرعة الدخول (Inlet Velocity)',
    unit: 'm/s',
    defaultMin: 2,
    defaultMax: 12,
  },
  heat_flux: {
    labelAr: 'الفيض الحراري الجداري (Heat Flux)',
    unit: 'W/m²',
    defaultMin: 2000,
    defaultMax: 15000,
  },
  temperature: {
    labelAr: 'درجة الحرارة الحدية (Temperature)',
    unit: 'K',
    defaultMin: 320,
    defaultMax: 450,
  },
  pressure_load_mpa: {
    labelAr: 'الإجهاد / الضغط المطبق (Pressure Load)',
    unit: 'MPa',
    defaultMin: 10,
    defaultMax: 100,
  },
  mesh_size: {
    labelAr: 'مقاس عنصر الشبكة (Mesh Size Δx)',
    unit: 'm',
    defaultMin: 0.03,
    defaultMax: 0.1,
  },
};

function inferSimulationType(project: ThesisProject | null): SimulationType {
  const existing = project?.simulationRun?.result?.physics_type;
  if (typeof existing === 'string' && existing.length > 0) {
    return existing as SimulationType;
  }
  if (project?.field === 'FEA') return 'Structural_Static';
  if (project?.field === 'Thermal') return 'Thermal_Steady';
  if (project?.field === 'Multiphysics') return 'CHT_Coupled';
  return 'CFD_Incompressible';
}

function extractPointOutputs(
  simType: string,
  resultWrapper: any,
): { out1: number | null; label1: string; out2: number | null; label2: string; solver: string; nodes: number; cells: number } {
  const res = resultWrapper?.data ?? resultWrapper ?? {};
  const solver = String(res.solver ?? resultWrapper?.solver ?? 'Docker CAE Engine');
  const summary = res.field_summary ?? {};
  const metrics = res.metrics ?? {};
  const integrals = res.integrals ?? {};
  const meshInfo = res.mesh ?? {};
  const vtkData = res.vtk_data ?? {};
  const nodes = Number(meshInfo.nodes ?? vtkData.points?.length ?? 0) || 0;
  const cells = Number(meshInfo.cells ?? meshInfo.elements ?? vtkData.triangles?.length ?? 0) || 0;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : null;

  if (simType.startsWith('Structural') || simType === 'Thermal_Structural') {
    const stressMax =
      num(integrals.max_von_mises_pa !== undefined ? Number(integrals.max_von_mises_pa) / 1e6 : undefined) ??
      num(res.stress?.von_mises_max_mpa) ??
      num(res.von_mises_max_mpa) ??
      num(summary.max);
    const dispMax =
      num(integrals.max_displacement_m !== undefined ? Number(integrals.max_displacement_m) * 1000 : undefined) ??
      num(res.displacements?.max_mm) ??
      num(res.max_displacement_mm) ??
      num(res.max_deflection_mm);
    return {
      out1: stressMax,
      label1: 'أقصى إجهاد Von Mises (MPa)',
      out2: dispMax,
      label2: 'أقصى إزاحة / تشوه (mm)',
      solver,
      nodes,
      cells,
    };
  }

  if (simType.startsWith('Thermal') || simType === 'CHT_Coupled') {
    const nu = num(integrals.nusselt_number ?? res.nusselt_number);
    const maxT = num(res.max_temperature) ?? num(summary.max) ?? num(integrals.field_max);
    const qFlux =
      nu ??
      num(integrals.total_heat_transfer_w) ??
      num(res.calculated_heat_flux) ??
      num(res.total_heat_transfer_w) ??
      num(summary.min);
    return {
      out1: maxT,
      label1: 'أقصى درجة حرارة (K / °C)',
      out2: qFlux,
      label2: nu !== null ? 'رقم نسلت المحسوب (Nu)' : 'التدفق الحراري المحسوب (W)',
      solver,
      nodes,
      cells,
    };
  }

  const maxVel = num(integrals.max_velocity_mps) ?? num(metrics.max_velocity) ?? num(res.max_velocity) ?? num(summary.max);
  const pDrop = num(integrals.pressure_drop_pa) ?? num(metrics.pressure_drop) ?? num(res.pressure_drop) ?? num(summary.min);
  return {
    out1: maxVel,
    label1: 'السرعة القصوى / ذروة الحقل (m/s)',
    out2: pDrop,
    label2: 'هبوط الضغط / أدنى قيمة (Pa)',
    solver,
    nodes,
    cells,
  };
}

export const ParametricSweepTool: React.FC<ParametricSweepToolProps> = ({
  isOpen,
  onClose,
  currentProject,
  simulationInputs,
  uploadedCadStl,
  viewportBoundaryMarkers,
  onSweepComplete,
}) => {
  const defaultParam: BackendSweepParam =
    currentProject?.field === 'FEA'
      ? 'pressure_load_mpa'
      : currentProject?.field === 'Thermal'
      ? 'heat_flux'
      : 'velocity';

  const [simulationType, setSimulationType] = useState<SimulationType>(() =>
    inferSimulationType(currentProject),
  );
  const [sweepParam, setSweepParam] = useState<BackendSweepParam>(defaultParam);
  const [minVal, setMinVal] = useState<number>(SWEEP_PRESETS[defaultParam].defaultMin);
  const [maxVal, setMaxVal] = useState<number>(SWEEP_PRESETS[defaultParam].defaultMax);
  const [steps, setSteps] = useState<number>(4);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [designPoints, setDesignPoints] = useState<DesignPointItem[]>([]);

  useEffect(() => {
    setSimulationType(inferSimulationType(currentProject));
    const nextParam: BackendSweepParam =
      currentProject?.field === 'FEA'
        ? 'pressure_load_mpa'
        : currentProject?.field === 'Thermal'
        ? 'heat_flux'
        : 'velocity';
    setSweepParam(nextParam);
    setMinVal(SWEEP_PRESETS[nextParam].defaultMin);
    setMaxVal(SWEEP_PRESETS[nextParam].defaultMax);
  }, [currentProject?.id, currentProject?.field]);

  if (!isOpen) return null;

  const preset = SWEEP_PRESETS[sweepParam];

  const handleParamChange = (nextParam: BackendSweepParam) => {
    setSweepParam(nextParam);
    setMinVal(SWEEP_PRESETS[nextParam].defaultMin);
    setMaxVal(SWEEP_PRESETS[nextParam].defaultMax);
    setDesignPoints([]);
    setSweepError(null);
  };

  const handleRunParametricSweep = async () => {
    if (steps < 2 || steps > 12) {
      setSweepError('عدد نقاط التصميم يجب أن يكون بين 2 و 12 نقطة.');
      return;
    }
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || minVal === maxVal) {
      setSweepError('يجب تحديد حد أدنى وحد أقصى مختلفين وبقيم عددية صالحة.');
      return;
    }

    setIsSweeping(true);
    setSweepError(null);

    const stepSize = (maxVal - minVal) / (steps - 1);
    const values = Array.from({ length: steps }, (_, i) =>
      Number((minVal + i * stepSize).toFixed(4)),
    );

    const initialPoints: DesignPointItem[] = values.map((val, i) => ({
      dpId: `DP-${i}`,
      paramVal: val,
      paramLabel: `${val} ${preset.unit}`,
      outputVal1: null,
      outputLabel1: 'المخرج الفيزيائي الأول',
      outputVal2: null,
      outputLabel2: 'المخرج الفيزيائي الثاني',
      status: 'Queued',
    }));
    setDesignPoints(initialPoints);

    try {
      const numOrUndef = (raw: string | undefined): number | undefined => {
        if (!raw || raw.trim() === '') return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const basePayload: Record<string, unknown> = {
        simulation_type: simulationType,
        execution_mode: 'celery',
        sweep_parameter: sweepParam,
        values,
      };
      const wx = numOrUndef(simulationInputs?.widthX);
      const hy = numOrUndef(simulationInputs?.heightY);
      const dz = numOrUndef(simulationInputs?.depthZ);
      const ms = numOrUndef(simulationInputs?.meshSize);
      const vel = numOrUndef(simulationInputs?.velocity);
      const press = numOrUndef(simulationInputs?.pressure);
      const temp = numOrUndef(simulationInputs?.temperature);
      const kCond = numOrUndef(simulationInputs?.thermalConductivity);
      const youngs = numOrUndef(simulationInputs?.youngModulus);
      const nu = numOrUndef(simulationInputs?.poissonRatio);
      const density = numOrUndef(simulationInputs?.fluidDensity ?? simulationInputs?.density);
      const visc = numOrUndef(simulationInputs?.dynamicViscosity);
      const hFlux = numOrUndef(simulationInputs?.heatFlux);
      const pCores = numOrUndef(simulationInputs?.parallelCores);
      const infLayers = numOrUndef(simulationInputs?.inflationLayers);
      const firstLayerH = numOrUndef(simulationInputs?.firstLayerHeight);
      const growthR = numOrUndef(simulationInputs?.growthRate);
      const tStep = numOrUndef(simulationInputs?.timeStep);
      const tEnd = numOrUndef(simulationInputs?.endTime);
      const gravY = numOrUndef(simulationInputs?.gravityY);
      const currDens = numOrUndef(simulationInputs?.currentDensity);
      const relPerm = numOrUndef(simulationInputs?.relativePermeability);
      const relEps = numOrUndef(simulationInputs?.relativePermittivity);
      const elecCond = numOrUndef(simulationInputs?.electricalConductivity);
      const thermExp = numOrUndef(simulationInputs?.thermalExpansion);

      if (wx !== undefined) basePayload.width_x = wx;
      if (hy !== undefined) basePayload.height_y = hy;
      if (dz !== undefined) basePayload.depth_z = dz;
      if (ms !== undefined) basePayload.mesh_size = ms;
      if (vel !== undefined) basePayload.velocity = vel;
      if (press !== undefined) basePayload.pressure = press;
      if (temp !== undefined) {
        basePayload.temperature = temp;
        basePayload.temperature_unit = simulationInputs?.temperatureUnit || 'K';
      }
      if (kCond !== undefined) basePayload.thermal_conductivity_k = kCond;
      if (youngs !== undefined) basePayload.young_modulus = youngs;
      if (nu !== undefined) basePayload.poisson_ratio = nu;
      if (density !== undefined) basePayload.density = density;
      if (visc !== undefined) basePayload.dynamic_viscosity = visc;
      if (hFlux !== undefined) basePayload.heat_flux = hFlux;
      if (simulationInputs?.turbulenceModel) basePayload.turbulence_model = simulationInputs.turbulenceModel;
      if (pCores !== undefined && pCores >= 1) basePayload.parallel_cores = Math.round(pCores);
      if (simulationInputs?.elementOrder !== undefined) basePayload.element_order = Number(simulationInputs.elementOrder);
      if (infLayers !== undefined) basePayload.inflation_layers = Math.round(infLayers);
      if (firstLayerH !== undefined) basePayload.first_layer_height = firstLayerH;
      if (growthR !== undefined) basePayload.growth_rate = growthR;
      if (simulationInputs?.timeMode) basePayload.time_mode = simulationInputs.timeMode;
      if (tStep !== undefined) basePayload.time_step = tStep;
      if (tEnd !== undefined) basePayload.end_time = tEnd;
      if (simulationInputs?.gravityEnabled !== undefined) basePayload.gravity_enabled = simulationInputs.gravityEnabled;
      if (gravY !== undefined) basePayload.gravity_y = gravY;
      if (simulationInputs?.emSubmode) basePayload.em_submode = simulationInputs.emSubmode;
      if (currDens !== undefined) basePayload.current_density = currDens;
      if (relPerm !== undefined) basePayload.relative_permeability = relPerm;
      if (relEps !== undefined) basePayload.relative_permittivity = relEps;
      if (elecCond !== undefined) basePayload.electric_conductivity = elecCond;
      if (thermExp !== undefined) basePayload.thermal_expansion_coeff = thermExp;
      if (simulationInputs?.nonlinear !== undefined) basePayload.nonlinear = Boolean(simulationInputs.nonlinear);
      if (simulationInputs?.contactType) basePayload.contact_type = simulationInputs.contactType;
      if (simulationInputs?.materialModel) basePayload.material_model = simulationInputs.materialModel;
      const syMpa = numOrUndef(simulationInputs?.yieldStressMpa);
      const etMpa = numOrUndef(simulationInputs?.tangentModulusMpa);
      const c10Mpa = numOrUndef(simulationInputs?.hyperC10Mpa);
      const d1Val = numOrUndef(simulationInputs?.hyperD1);
      const muFric = numOrUndef(simulationInputs?.frictionCoeff);
      const mrfRpm = numOrUndef(simulationInputs?.mrfOmegaRpm);
      const mrfRad = numOrUndef(simulationInputs?.mrfRadius);
      if (syMpa !== undefined && syMpa > 0) basePayload.yield_stress_pa = syMpa * 1e6;
      if (etMpa !== undefined && etMpa > 0) basePayload.tangent_modulus_pa = etMpa * 1e6;
      if (c10Mpa !== undefined && c10Mpa > 0) basePayload.hyper_c10_pa = c10Mpa * 1e6;
      if (d1Val !== undefined && d1Val >= 0) basePayload.hyper_d1_inv_pa = d1Val;
      if (muFric !== undefined && muFric >= 0) basePayload.friction_coeff = muFric;
      if (simulationInputs?.mrfEnabled && mrfRpm !== undefined && mrfRpm !== 0) {
        basePayload.mrf_enabled = true;
        basePayload.mrf_omega_rad_s = mrfRpm * ((2 * Math.PI) / 60);
        basePayload.mrf_axis = simulationInputs.mrfAxis || 'z';
        if (mrfRad !== undefined && mrfRad > 0) basePayload.mrf_radius = mrfRad;
      }

      if (uploadedCadStl) {
        basePayload.cad_file_b64 = uploadedCadStl.base64;
        basePayload.cad_stl_b64 = uploadedCadStl.base64;
        basePayload.cad_filename = uploadedCadStl.name;
      }
      if (viewportBoundaryMarkers && viewportBoundaryMarkers.length > 0) {
        basePayload.boundary_markers = viewportBoundaryMarkers;
      }
      if (currentProject?.boundaryConditions && currentProject.boundaryConditions.length > 0) {
        basePayload.boundary_patches = currentProject.boundaryConditions.map((bc) => ({
          name: bc.name,
          type: bc.type,
          value: bc.value,
          unit: bc.unit,
          patchName: bc.patchName,
          markerId: bc.markerId,
        }));
      }

      const response = await fetch('/api/parametric-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload),
      });

      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload?.runs)) {
        throw new Error(
          payload?.error ||
            payload?.message ||
            `فشل إرسال دراسة المسح إلى خادم Docker (:8000) — HTTP ${response.status}`,
        );
      }

      const runs: { value: number; task_id: string; status: string }[] = payload.runs;
      setDesignPoints((prev) =>
        prev.map((dp, idx) => ({
          ...dp,
          taskId: runs[idx]?.task_id,
          status: 'Queued',
        })),
      );

      // Poll real Celery/Docker tasks until every DP completes or fails
      const pending = new Set(runs.map((r) => r.task_id));
      const startedAt = Date.now();
      const timeoutMs = 180_000;
      const completedRecords = new Map<
        string,
        {
          paramVal: number;
          extracted: ReturnType<typeof extractPointOutputs>;
          durationSec: number;
        }
      >();

      while (pending.size > 0 && Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        await Promise.all(
          Array.from(pending).map(async (taskId) => {
            try {
              const jobRes = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`);
              if (!jobRes.ok) return;
              const job = await jobRes.json();
              const jobStatus = String(job.status || '').toUpperCase();

              if (jobStatus === 'RUNNING') {
                setDesignPoints((prev) =>
                  prev.map((dp) => (dp.taskId === taskId ? { ...dp, status: 'Running' } : dp)),
                );
              } else if (jobStatus === 'COMPLETED') {
                pending.delete(taskId);
                const extracted = extractPointOutputs(simulationType, job.result);
                const runEntry = runs.find((r) => r.task_id === taskId);
                completedRecords.set(taskId, {
                  paramVal: runEntry?.value ?? 0,
                  extracted,
                  durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
                });
                setDesignPoints((prev) =>
                  prev.map((dp) =>
                    dp.taskId === taskId
                      ? {
                          ...dp,
                          outputVal1: extracted.out1,
                          outputLabel1: extracted.label1,
                          outputVal2: extracted.out2,
                          outputLabel2: extracted.label2,
                          solverUsed: extracted.solver,
                          status: 'Converged',
                        }
                      : dp,
                  ),
                );
              } else if (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') {
                pending.delete(taskId);
                setDesignPoints((prev) =>
                  prev.map((dp) =>
                    dp.taskId === taskId
                      ? {
                          ...dp,
                          status: 'Failed',
                          error: String(job.error || 'فشل التنفيذ داخل حاوية المحاكي'),
                        }
                      : dp,
                  ),
                );
              }
            } catch {
              // Retry on next poll tick
            }
          }),
        );
      }

      if (completedRecords.size > 0 && onSweepComplete) {
        const orderedRuns = runs
          .map((r, idx) => ({ taskId: r.task_id, idx, record: completedRecords.get(r.task_id) }))
          .filter((item): item is { taskId: string; idx: number; record: NonNullable<typeof item.record> } => Boolean(item.record));
        const baselineVal = orderedRuns[0]?.record.extracted.out1 ?? 0;
        const casesMatrix: CaseStudyItem[] = orderedRuns.map(({ idx, record }) => {
          const outVal = record.extracted.out1 ?? 0;
          const diffPct =
            idx === 0 || Math.abs(baselineVal) < 1e-12
              ? 0
              : Number((((outVal - baselineVal) / Math.abs(baselineVal)) * 100).toFixed(2));
          return {
            caseId: `DP-${idx + 1}`,
            name: `${preset.labelAr}: ${record.paramVal} ${preset.unit}`,
            nameAr: `${preset.labelAr}: ${record.paramVal} ${preset.unit}`,
            studyVariable: `${sweepParam} = ${record.paramVal} ${preset.unit}`,
            purpose: idx === 0 ? 'نقطة التصميم المرجعية (Baseline DP)' : 'دراسة حساسية المسح البارامتري',
            meshElements: record.extracted.cells,
            meshNodes: record.extracted.nodes,
            solverEngine: record.extracted.solver,
            keyOutputName: record.extracted.label1,
            keyOutputValue: outVal,
            keyOutputUnit: '',
            discrepancyPercent: diffPct,
            runDurationSec: record.durationSec,
            status: idx === 0 ? 'Baseline' : 'Converged',
          };
        });
        onSweepComplete(casesMatrix);
      }

      if (pending.size > 0) {
        setSweepError('انتهت مهلة انتظار بعض نقاط التصميم بينما ما زال التنفيذ مستمراً في Celery.');
      }
    } catch (err: any) {
      setSweepError(err?.message || 'تعذر الاتصال ببوابة Docker (:8000) لتنفيذ المسح.');
      setDesignPoints((prev) =>
        prev.map((dp) => (dp.status === 'Queued' || dp.status === 'Running' ? { ...dp, status: 'Failed' } : dp)),
      );
    } finally {
      setIsSweeping(false);
    }
  };

  const handleExportCSV = () => {
    if (designPoints.length === 0) return;
    const headers = [
      'Design Point',
      'Task ID',
      `${preset.labelAr} (${preset.unit})`,
      designPoints[0].outputLabel1,
      designPoints[0].outputLabel2,
      'Solver',
      'Status',
    ].join(',');
    const rows = designPoints.map((dp) =>
      [
        dp.dpId,
        dp.taskId || '',
        dp.paramVal,
        dp.outputVal1 ?? '',
        dp.outputVal2 ?? '',
        dp.solverUsed || '',
        dp.status,
      ].join(','),
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `parametric_sweep_${sweepParam}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const validPoints = designPoints.filter((d) => typeof d.outputVal1 === 'number' && Number.isFinite(d.outputVal1));
  const maxChartOut = validPoints.length > 0 ? Math.max(...validPoints.map((d) => Math.abs(d.outputVal1 ?? 0)), 1e-9) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-950/50">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                  أداة المسح البارامتري الحقيقي (Docker Parametric Sweep)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Live Celery :8000
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                إرسال كل نقطة تصميم (DP) كوظيفة فعلية مستقلة إلى حاويات OpenFOAM / CalculiX / ElmerFEM واستخراج الاستجابة الحقيقية
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Setup Toolbar */}
        <div className="p-6 bg-slate-950/60 border-b border-slate-800/80 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">
                المتغير الفيزيائي المستقل (Backend Parameter):
              </label>
              <select
                value={sweepParam}
                onChange={(e) => handleParamChange(e.target.value as BackendSweepParam)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              >
                {Object.entries(SWEEP_PRESETS).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.labelAr} ({item.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">محرك الفيزياء:</label>
              <select
                value={simulationType}
                onChange={(e) => setSimulationType(e.target.value as SimulationType)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-sky-400 text-xs focus:outline-none"
              >
                <option value="CFD_Incompressible">CFD_Incompressible</option>
                <option value="CFD_Compressible">CFD_Compressible</option>
                <option value="CHT_Coupled">CHT_Coupled</option>
                <option value="Multiphase_VOF">Multiphase_VOF</option>
                <option value="Thermal_Steady">Thermal_Steady</option>
                <option value="Thermal_Transient">Thermal_Transient</option>
                <option value="Thermal_Structural">Thermal_Structural</option>
                <option value="Structural_Static">Structural_Static</option>
                <option value="Structural_Dynamic">Structural_Dynamic</option>
                <option value="Structural_Buckling">Structural_Buckling</option>
                <option value="Electromagnetic">Electromagnetic</option>
                <option value="Acoustics">Acoustics</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">عدد نقاط التصميم (2-12):</label>
              <input
                type="number"
                min={2}
                max={12}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-white text-xs focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 block">الحد الأدنى ({preset.unit}):</span>
                <input
                  type="number"
                  step="any"
                  value={minVal}
                  onChange={(e) => setMinVal(Number(e.target.value))}
                  className="w-28 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white"
                />
              </div>

              <span className="text-slate-500 font-bold self-end pb-2">← إلى →</span>

              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 block">الحد الأقصى ({preset.unit}):</span>
                <input
                  type="number"
                  step="any"
                  value={maxVal}
                  onChange={(e) => setMaxVal(Number(e.target.value))}
                  className="w-28 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSweeping}
              onClick={handleRunParametricSweep}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSweeping ? <Loader2 className="w-4 h-4 animate-spin text-sky-200" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isSweeping ? 'جاري التنفيذ عبر حاويات Docker...' : 'تشغيل المسح الحقيقي على Docker'}</span>
            </button>
          </div>

          {sweepError && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 flex items-center gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{sweepError}</span>
            </div>
          )}
        </div>

        {/* Results & Design Points Table */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {designPoints.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-3">
              <BarChart3 className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">لم يتم تشغيل أي مسح بارامتري بعد</p>
              <p className="text-xs text-slate-500">
                اختر المتغير ونطاق القيم واضغط "تشغيل المسح الحقيقي على Docker" لإرسال الوظائف إلى Celery (:8000)
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  مصفوفة نقاط التصميم الحقيقية (Design Points Matrix — Docker/Celery):
                </span>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير النتائج (CSV)</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800 shadow-md">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono">
                      <th className="py-2.5 px-3">DP</th>
                      <th className="py-2.5 px-3">{preset.labelAr}</th>
                      <th className="py-2.5 px-3 text-sky-300">{designPoints[0]?.outputLabel1}</th>
                      <th className="py-2.5 px-3 text-emerald-300">{designPoints[0]?.outputLabel2}</th>
                      <th className="py-2.5 px-3">المحرك</th>
                      <th className="py-2.5 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-mono">
                    {designPoints.map((dp) => (
                      <tr key={dp.dpId} className="hover:bg-slate-900/60">
                        <td className="py-2.5 px-3 font-bold text-slate-200">
                          <div>{dp.dpId}</div>
                          {dp.taskId && (
                            <div className="text-[9px] text-slate-500">{dp.taskId.slice(0, 8)}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-amber-400 font-bold">{dp.paramLabel}</td>
                        <td className="py-2.5 px-3 text-sky-400 font-bold">
                          {dp.outputVal1 !== null ? dp.outputVal1 : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-emerald-400 font-bold">
                          {dp.outputVal2 !== null ? dp.outputVal2 : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 text-[10px]">
                          {dp.solverUsed || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              dp.status === 'Converged'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : dp.status === 'Running'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : dp.status === 'Failed'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {dp.status}
                          </span>
                          {dp.error && (
                            <div className="text-[9px] text-rose-400 mt-0.5 max-w-[160px] truncate" title={dp.error}>
                              {dp.error}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validPoints.length > 0 && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-400 block">
                    منحنى الاستجابة المستخرج من المحرك ({designPoints[0]?.outputLabel1}):
                  </span>
                  <div className="h-28 w-full bg-slate-900 rounded-xl border border-slate-800/80 p-3 flex items-end justify-between gap-2">
                    {designPoints.map((dp, i) => {
                      const val = dp.outputVal1;
                      const heightPct =
                        val !== null ? Math.max(10, (Math.abs(val) / maxChartOut) * 100) : 6;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                          <span className="text-[9px] font-mono text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            {val !== null ? val : '—'}
                          </span>
                          <div
                            className={`w-full rounded-t transition-all ${
                              val !== null
                                ? 'bg-gradient-to-t from-indigo-600 to-sky-400'
                                : 'bg-slate-800'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                          <span className="text-[9px] font-mono text-slate-500">{dp.paramVal}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
