import React, { useState, useEffect, useRef } from 'react';
import { HeatmapCanvas } from './HeatmapCanvas';
import {
  Layers,
  Grid3X3,
  Palette,
  ShieldCheck,
  Table as TableIcon,
  FileText,
  Cpu,
  Upload,
  RotateCcw,
  FolderOpen,
  Save,
  Check,
  X,
  PlusCircle,
  Database,
  Sliders,
  Cloud,
  Printer,
  FileSpreadsheet,
  FileCode,
  Globe,
  FlaskConical,
  Download,
} from 'lucide-react';
import {
  ThesisProject,
  BoundaryCondition,
  CloudServerConfig,
  SimulationRunRecord,
  MeshStudyResult,
  ProfileSpec,
  ReferenceDataSet,
  VtkFieldPayload,
  isCurrentMeshStudy,
} from './types/thesis';
import { StudioHeader, HeaderMenuGroup } from './components/StudioHeader';
import { SimulationTree, TreeAction } from './components/SimulationTree';
import { ViewportCanvas } from './components/ViewportCanvas';
import { LiveJobTelemetry } from './components/ViewportHealthDashboard';
import { CadModelStats, BoundaryMarker } from './components/Interactive3DViewport';
import { PropertiesPanel, PanelDocument, MeshPreviewSummary } from './components/PropertiesPanel';
import { SolverConsole, ResidualSeries } from './components/SolverConsole';
import {
  ConsoleIssue,
  ConsoleTab,
  DEFAULT_SIMULATION_INPUTS,
  JobStatus,
  SimulationInputs,
  WorkflowStep,
  buildSimulationRequest,
  defaultSimulationTypeForField,
  getMissingSimulationInputs,
} from './types/studio';
import { exportToWordDocument, exportToCSV, exportToLatex, exportToJournalHTML, hasRealSimulationRun } from './utils/exporter';
import { setEnterpriseAuthToken as syncEnterpriseAuthToken, withEnterpriseAuthHeaders } from './utils/enterpriseAuth';
import { readJsonSafe, streamJobUntilDone } from './utils/jobStream';
import { CleanWorkspaceHome } from './components/CleanWorkspaceHome';
import { OverviewTab } from './components/OverviewTab';
import { MeshStudyTab } from './components/MeshStudyTab';
import { ContoursTab } from './components/ContoursTab';
import { VVBenchmarkTemplate } from './data/vvBenchmarks';
import { ValidationTab } from './components/ValidationTab';
import { TablesTab } from './components/TablesTab';
import { ThesisReportTab } from './components/ThesisReportTab';
import { ScriptUploaderModal } from './components/ScriptUploaderModal';
import { ProjectsLibraryModal } from './components/ProjectsLibraryModal';
import { CloudServerSettingsModal } from './components/CloudServerSettingsModal';
import { EnterpriseAdminModal } from './components/EnterpriseAdminModal';
import { AuditReportModal } from './components/AuditReportModal';
import { MeshGenerativeTool } from './components/MeshGenerativeTool';
import { NewProjectModal } from './components/NewProjectModal';
import { MaterialsDatabaseModal } from './components/MaterialsDatabaseModal';
import { ParametricSweepTool } from './components/ParametricSweepTool';
import { PhysicsSetupStudio, SweepCaseRow } from './components/PhysicsSetupStudio';
import { normalizeSolverResponse } from './utils/normalizedSolverResults';
import { defaultPresets } from './data/defaultPresets';

export type TabType = 'report' | 'contours' | 'mesh' | 'validation' | 'tables' | 'overview' | 'wizard';

interface SimulationResults {
  temperature_matrix?: number[][];
  physics_type?: string;
  classified_type?: string;
  recommended_solver?: string;
  solver_engine?: string;
  parallel_cores?: number;
  process_time?: number;
  process_time_ms?: number;
  temperature_min?: number;
  temperature_max?: number;
  max_temperature?: number;
  center_temperature?: number;
  calculated_heat_flux?: number;
}

class SimulationCancelledError extends Error {
  constructor() {
    super('Simulation cancelled by user');
    this.name = 'SimulationCancelledError';
  }
}

const toRealTemperatureMatrix = (value: unknown): number[][] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((row): row is unknown[] => Array.isArray(row))) return undefined;
  const columnCount = value[0].length;
  if (columnCount === 0 || value.some((row) => row.length !== columnCount)) return undefined;
  const matrix = value.map((row) => row.map((cell) => (typeof cell === 'number' ? cell : NaN)));
  if (!matrix.some((row) => row.some((cell) => Number.isFinite(cell)))) return undefined;
  return matrix;
};

export default function App() {
  const [currentProject, setCurrentProject] = useState<ThesisProject | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const [isMaterialsModalOpen, setIsMaterialsModalOpen] = useState<boolean>(false);
  const [isParametricSweepOpen, setIsParametricSweepOpen] = useState<boolean>(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isProjectsLibraryOpen, setIsProjectsLibraryOpen] = useState<boolean>(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState<boolean>(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [isMeshGeneratorOpen, setIsMeshGeneratorOpen] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [solverJobStatus, setSolverJobStatus] = useState<JobStatus>('idle');
  const [solverLogs, setSolverLogs] = useState<string[]>([]);
  const [solverProgress, setSolverProgress] = useState<number | null>(null);
  const [solverCurrentIteration, setSolverCurrentIteration] = useState<number | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [liveJobTelemetry, setLiveJobTelemetry] = useState<LiveJobTelemetry | null>(null);
  const [jobWallClockSec, setJobWallClockSec] = useState<number | null>(null);
  const [lastCompletedDurationSec, setLastCompletedDurationSec] = useState<number | null>(null);
  const [meshStudyRunning, setMeshStudyRunning] = useState<boolean>(false);
  const [meshStudyError, setMeshStudyError] = useState<string | null>(null);
  const [solverResidualSeries, setSolverResidualSeries] = useState<ResidualSeries[]>([]);
  const [simulationInputs, setSimulationInputs] = useState<SimulationInputs>(DEFAULT_SIMULATION_INPUTS);
  const [appliedPhysicsOverrides, setAppliedPhysicsOverrides] = useState<Record<string, unknown> | null>(null);
  const [viewportBoundaryMarkers, setViewportBoundaryMarkers] = useState<BoundaryMarker[]>([]);
  const [viewportRegionBox, setViewportRegionBox] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);
  const [uploadedCadStl, setUploadedCadStl] = useState<{ name: string; base64: string } | null>(null);
  const [meshPreviewVtk, setMeshPreviewVtk] = useState<VtkFieldPayload | null>(null);
  const [meshPreviewStats, setMeshPreviewStats] = useState<MeshPreviewSummary | null>(null);
  const [cadPatches, setCadPatches] = useState<Array<{ id: string; name: string }>>([]);
  const [cadPreviewLoading, setCadPreviewLoading] = useState<boolean>(false);
  const [meshGenerating, setMeshGenerating] = useState<boolean>(false);
  const [selectedBoundaryIndex, setSelectedBoundaryIndex] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState<WorkflowStep>('geometry');
  const [documentOpen, setDocumentOpen] = useState<boolean>(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('logs');
  const [consoleIssues, setConsoleIssues] = useState<ConsoleIssue[]>([]);
  const [isEnterpriseModalOpen, setIsEnterpriseModalOpen] = useState<boolean>(false);
  // Session auth token held strictly in React memory (never persisted to localStorage/sessionStorage)
  const [enterpriseAuthToken, setEnterpriseAuthToken] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const issueIdRef = useRef(0);
  const activeTaskIdRef = useRef<string | null>(null);
  const simAbortRef = useRef<AbortController | null>(null);
  const meshStudyAbortRef = useRef<AbortController | null>(null);
  const isSolverRunning = solverJobStatus === 'queued' || solverJobStatus === 'running';

  const extractApiError = (body: any, fallback: string): string => {
    const source = body?.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : body;
    const code = typeof source?.code === 'string' ? source.code : undefined;
    let message: string | undefined;
    if (typeof source?.error === 'string') message = source.error;
    else if (Array.isArray(source?.details)) {
      message = source.details
        .map((d: any) => {
          const path = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== 'body').join('.') : '';
          return `${path ? `${path}: ` : ''}${d?.msg ?? JSON.stringify(d)}`;
        })
        .join('; ');
    } else if (typeof body?.detail === 'string') message = body.detail;
    else if (Array.isArray(body?.detail)) message = body.detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    message = message || fallback;
    return code ? `[${code}] ${message}` : message;
  };

  const readJson = async (response: Response): Promise<any> => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };

  const handleRunSimulation = async (): Promise<unknown> => {
    if (!currentProject) throw new Error('No active engineering project');
    const runId = ++runIdRef.current;
    const assertActive = () => {
      if (runIdRef.current !== runId) throw new SimulationCancelledError();
    };

   const baseRequest = buildSimulationRequest(simulationInputs);
   const boundaryPatchesPayload = (currentProject.boundaryConditions || [])
     .filter((bc) => Boolean(bc.patchName && bc.patchName.trim()))
     .map((bc) => ({
       patchName: bc.patchName!.trim(),
       name: bc.name,
       type: bc.type,
       value: bc.value,
       unit: bc.unit,
     }));
  const requestBody: Record<string, unknown> = {
    ...baseRequest,
    project_id: currentProject.id,
    ...(appliedPhysicsOverrides || {}),
    ...(viewportBoundaryMarkers.length > 0 ? { boundary_markers: viewportBoundaryMarkers } : {}),
    ...(boundaryPatchesPayload.length > 0 ? { boundary_patches: boundaryPatchesPayload } : {}),
    ...(viewportRegionBox ? { region_box: viewportRegionBox } : {}),
    ...(uploadedCadStl ? { cad_file_b64: uploadedCadStl.base64, cad_stl_b64: uploadedCadStl.base64, cad_filename: uploadedCadStl.name } : {}),
  };
  const simulationType = String(requestBody.simulation_type);

  setSolverJobStatus('queued');
  setSolverProgress(null);
  setSolverCurrentIteration(null);
  setResults(null);
  setSolverResidualSeries([]);
  activeTaskIdRef.current = null;
  setCurrentProject(project => project ? { ...project, simulationRun: undefined, normalizedSolverResult: undefined } : project);
  let latestLogs = [`[${new Date().toISOString()}] Submitting ${currentProject.field} simulation (${simulationType}) to Docker Engine (:8000)`];
  setSolverLogs(latestLogs);

  const submitResponse = await fetch('/api/run-simulation', {
    method: 'POST',
    headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(requestBody),
  });
  const submitPayload = await readJson(submitResponse);
  assertActive();
  if (!submitResponse.ok || submitPayload?.success === false) {
    throw new Error(extractApiError(submitPayload, `Simulation request failed (${submitResponse.status})`));
  }

  const isDirect =
    requestBody.execution_mode === 'direct' ||
    (!submitPayload?.task_id && Boolean(submitPayload?.result || submitPayload?.data));

  let job: any;
  let completedTaskId: string | undefined;
  if (isDirect) {
    const directResult = submitPayload?.result ?? submitPayload?.data ?? submitPayload;
    job = { status: 'COMPLETED', result: directResult, logs: [] };
    latestLogs = [...latestLogs, `[${new Date().toISOString()}] Direct solver execution completed`];
    setSolverLogs(latestLogs);
  } else {
      const taskId = submitPayload?.task_id as string | undefined;
      if (!taskId) throw new Error('Simulation backend did not return a task_id');
      completedTaskId = taskId;
      activeTaskIdRef.current = taskId;
      setActiveTaskId(taskId);
      setLiveJobTelemetry(null);
      setJobWallClockSec(0);

      simAbortRef.current?.abort();
      const abortController = new AbortController();
      simAbortRef.current = abortController;

      const applyJobSnapshot = (snap: any) => {
        if (runIdRef.current !== runId) return;
        const jobStatus = String(snap?.status ?? 'QUEUED').toUpperCase();
        setSolverJobStatus(
          jobStatus === 'RUNNING' ? 'running' :
          jobStatus === 'COMPLETED' ? 'completed' :
          jobStatus === 'FAILED' ? 'failed' :
          jobStatus === 'CANCELLED' ? 'cancelled' :
          'queued'
        );
        if (typeof snap?.progress === 'number') setSolverProgress(snap.progress);
        if (typeof snap?.current_iteration === 'number' && snap.current_iteration > 0) {
          setSolverCurrentIteration(snap.current_iteration);
        }
        if (typeof snap?.wall_clock_sec === 'number' && Number.isFinite(snap.wall_clock_sec)) {
          setJobWallClockSec(snap.wall_clock_sec);
        }
        if (snap?.telemetry && typeof snap.telemetry === 'object') {
          setLiveJobTelemetry(snap.telemetry as LiveJobTelemetry);
        }
        if (Array.isArray(snap?.logs) && snap.logs.length > 0) {
          latestLogs = snap.logs.map(String);
          setSolverLogs(latestLogs);
        }
        if (snap?.live_residuals && typeof snap.live_residuals === 'object') {
          const liveSeries: ResidualSeries[] = Object.entries(snap.live_residuals)
            .map(([name, raw]: [string, any]) => {
              const iters: number[] = Array.isArray(raw?.iterations) ? raw.iterations : [];
              const vals: number[] = Array.isArray(raw?.values) ? raw.values : [];
              const points = vals
                .map((value, idx) => ({ iteration: Number(iters[idx] ?? idx + 1), value: Number(value) }))
                .filter((pt) => Number.isFinite(pt.iteration) && Number.isFinite(pt.value) && pt.value > 0);
              return { name, points };
            })
            .filter((s) => s.points.length >= 2);
          if (liveSeries.length > 0) {
            setSolverResidualSeries(liveSeries);
          }
        }
      };

      try {
        job = await streamJobUntilDone(taskId, {
          signal: abortController.signal,
          pollIntervalMs: 1000,
          onProgress: applyJobSnapshot,
        });
      } catch (streamErr: any) {
        if (streamErr?.name === 'AbortError' || runIdRef.current !== runId) {
          throw new SimulationCancelledError();
        }
        throw streamErr;
      } finally {
        if (simAbortRef.current === abortController) {
          simAbortRef.current = null;
        }
      }

      assertActive();
      const finalStatus = String(job?.status ?? 'FAILED').toUpperCase();
      activeTaskIdRef.current = null;
      setActiveTaskId(null);

      if (finalStatus === 'COMPLETED') {
        const finalDur =
          typeof job?.wall_clock_sec === 'number'
            ? job.wall_clock_sec
            : typeof job?.result?.process_time === 'number'
              ? job.result.process_time
              : null;
        if (finalDur !== null) setLastCompletedDurationSec(finalDur);
      } else {
        const backendError = typeof job?.error === 'string' && job.error.trim() !== '' ? job.error : undefined;
        if (backendError && !latestLogs.includes(backendError)) {
          latestLogs = [...latestLogs, backendError];
          setSolverLogs(latestLogs);
        }
        throw new Error(extractApiError(job, `Solver job ${finalStatus.toLowerCase()}`));
      }
    }

    const payload = job.result && typeof job.result === 'object' ? job.result : {};
    const solverData = payload?.data?.solver_results ?? payload?.data ?? payload;
    setResults({
      ...payload,
      ...solverData,
      temperature_matrix: toRealTemperatureMatrix(solverData?.temperature_matrix),
    });
    setSaveToast(`Solver completed: ${payload.solver || payload.recommended_solver || simulationType}`);
    const normalized = normalizeSolverResponse(payload, currentProject);
    normalized.logs = latestLogs;
    setSolverResidualSeries(normalized.residualSeries ?? []);
    const optionalText = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const simulationRun: SimulationRunRecord = {
      taskId: completedTaskId || optionalText(job?.task_id),
      executionMode: isDirect ? 'direct' : 'celery',
      submittedRequest: requestBody,
      backendPayload: job?.payload && typeof job.payload === 'object' ? job.payload : undefined,
      result: payload,
      logs: latestLogs,
      progress: typeof job?.progress === 'number' ? job.progress : undefined,
      createdAt: optionalText(job?.created_at),
      startedAt: optionalText(job?.started_at),
      completedAt: optionalText(job?.completed_at),
      recordedAt: new Date().toISOString(),
    };
    setCurrentProject(project => project ? {
      ...project,
      normalizedSolverResult: normalized,
      simulationRun,
      scriptExecutionLog: [...(project.scriptExecutionLog || []), ...latestLogs],
    } : project);
    setSolverJobStatus('completed');
    setSolverProgress(100);
    return payload;
  };

  // Apply computed nanofluid & flow regime directly to the active project & solver inputs
  const handleApplyWizardCaseToProject = (row: SweepCaseRow) => {
    const isFea = row.geometryMode === 'structural_fea';
    const isCht = row.heatFlux > 0 || (row.wallTempK ?? 0) > row.inletTempK + 0.1;
    const simType = isFea ? 'Structural_Static' : isCht ? 'CHT_Coupled' : 'CFD_Incompressible';
    setAppliedPhysicsOverrides(
      isFea
        ? {
            simulation_type: 'Structural_Static',
            geometry_mode: row.geometryMode,
            domain_length: row.domainLengthM,
            domain_height: row.dhMeters,
            pressure_load_mpa: row.velocity,
            elastic_modulus_gpa: row.elasticModulusGpa,
            poisson_ratio: row.poissonRatio,
            yield_strength_mpa: row.yieldStrengthMpa,
            support_type: row.supportType,
          }
        : {
            simulation_type: simType,
            geometry_mode: row.geometryMode,
            domain_length: row.domainLengthM,
            domain_height: row.dhMeters,
            hydraulic_diameter: row.dhMeters,
            velocity: row.velocity,
            inlet_temperature: row.inletTempK,
            heat_flux: row.heatFlux,
            wall_temperature: row.wallTempK,
            density: row.rhoEff,
            viscosity: row.muEff,
            thermal_conductivity: row.kEff,
            specific_heat: row.cpEff,
            turbulence_model: row.regime,
            wave_count: row.waveCount,
            wave_amplitude_ratio: row.waveAmplitudeRatio,
          }
    );
    if (!currentProject) return;
    setSimulationInputs((prev) => ({
      ...prev,
      simulationType: simType,
      widthX: String(row.domainLengthM),
      heightY: String(row.dhMeters),
      velocity: String(row.velocity),
      temperature: String(row.inletTempK),
      pressure: prev.pressure || '101325',
      meshSize: prev.meshSize || String(Number((row.dhMeters / 10).toFixed(4))),
      thermalConductivity: String(row.kEff),
    }));
    setCurrentProject((prev) =>
      prev
        ? {
            ...prev,
            material: {
              name: row.fluidLabel,
              phaseOrType: isFea ? 'Solid' : 'Fluid',
              density: `${row.rhoEff} kg/m³`,
              viscosity: `${row.muEff} Pa·s`,
              thermalConductivity: `${row.kEff} W/(m·K)`,
              specificHeat: `${row.cpEff} J/(kg·K)`,
            },
            solver: {
              ...prev.solver,
              scheme: `Second Order Upwind (${row.regime}, Re=${row.reynolds})`,
            },
            workbenchComponents: prev.workbenchComponents?.map((wb) =>
              wb.type === 'Engineering Data'
                ? { ...wb, status: 'Up-to-date', details: `${row.fluidLabel} (k=${row.kEff} W/m·K)` }
                : wb
            ),
          }
        : prev
    );
    setSaveToast(`تم تطبيق خواص (${row.fluidLabel}) وسرعة (${row.velocity} m/s) ونموذج (${row.regime}) على المشروع!`);
    setTimeout(() => setSaveToast(null), 4000);
  };

  // Execute every queued parametric sweep row through the REAL Docker Celery /api/run-simulation pipeline
  const handleRunRealWizardBatch = async (
    cases: SweepCaseRow[],
    onRowUpdate: (id: string, patch: Partial<SweepCaseRow>) => void
  ) => {
    for (const c of cases) {
      onRowUpdate(c.id, { status: 'Running' });
      try {
        const isFea = c.geometryMode === 'structural_fea';
        const isCht = !isFea && (c.heatFlux > 0 || (c.wallTempK ?? 0) > c.inletTempK + 0.1);
        const payload: Record<string, unknown> = isFea
          ? {
              project_id: currentProject?.id || '',
              simulation_type: 'Structural_Static',
              execution_mode: 'celery',
              width_x: c.domainLengthM,
              height_y: c.dhMeters,
              geometry_mode: c.geometryMode,
              domain_length: c.domainLengthM,
              domain_height: c.dhMeters,
              pressure_load_mpa: c.velocity,
              elastic_modulus_gpa: c.elasticModulusGpa,
              poisson_ratio: c.poissonRatio,
              yield_strength_mpa: c.yieldStrengthMpa,
              support_type: c.supportType,
            }
          : {
              project_id: currentProject?.id || '',
              simulation_type: isCht ? 'CHT_Coupled' : 'CFD_Incompressible',
              execution_mode: 'celery',
              width_x: c.domainLengthM,
              height_y: c.dhMeters,
              geometry_mode: c.geometryMode,
              domain_length: c.domainLengthM,
              domain_height: c.dhMeters,
              hydraulic_diameter: c.dhMeters,
              velocity: c.velocity,
              temperature: c.inletTempK,
              inlet_temperature: c.inletTempK,
              heat_flux: c.heatFlux,
              wall_temperature: c.wallTempK,
              density: c.rhoEff,
              viscosity: c.muEff,
              thermal_conductivity: c.kEff,
              thermal_conductivity_k: c.kEff,
              specific_heat: c.cpEff,
              turbulence_model: c.regime,
              wave_count: c.waveCount,
              wave_amplitude_ratio: c.waveAmplitudeRatio,
            };

        const response = await fetch('/api/run-simulation', {
          method: 'POST',
          headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        const data = await readJson(response);
        if (!response.ok || data?.success === false) {
          throw new Error(extractApiError(data, `Solver error (${response.status})`));
        }

        let raw: any = data?.result ?? data?.data ?? data;
        if (data?.task_id) {
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const statusResp = await fetch(`/api/jobs/${encodeURIComponent(data.task_id)}`, {
              headers: withEnterpriseAuthHeaders(),
            });
            const jobBody = await readJson(statusResp);
            if (!statusResp.ok) throw new Error(extractApiError(jobBody, `Job ${data.task_id} failed`));
            const st = String(jobBody?.status || '').toUpperCase();
            if (st === 'COMPLETED') {
              raw = jobBody?.result ?? jobBody;
              break;
            }
            if (st === 'FAILED' || st === 'CANCELLED') {
              throw new Error(jobBody?.error || `Solver job ${st.toLowerCase()}`);
            }
          }
        }
        const res = raw?.data?.solver_results ?? raw?.solver_results ?? raw?.data ?? raw;

        if (isFea) {
          const stressVal = Number(res?.max_von_mises_mpa ?? res?.max_von_mises_stress ?? 0);
          const dispVal = Number(res?.max_displacement_mm ?? res?.max_displacement ?? 0);
          onRowUpdate(c.id, {
            status: 'Completed',
            nuResult: stressVal,
            deltaPResult: dispVal,
            resultSummary: `σ_vm=${stressVal.toFixed(2)} MPa, δ=${dispVal.toFixed(3)} mm`,
          });
        } else {
          const nuVal = Number(res?.nusselt_number ?? 0);
          const dpVal = Number(res?.pressure_drop_pa ?? res?.pressure_drop ?? 0);
          const hVal = Number(res?.heat_transfer_coeff_h ?? 0);
          const tMaxVal = Number(res?.temperature_max ?? res?.max_temperature ?? c.inletTempK);
          onRowUpdate(c.id, {
            status: 'Completed',
            nuResult: nuVal,
            deltaPResult: dpVal,
            hResult: hVal,
            tMaxResult: tMaxVal,
            resultSummary: `Nu=${nuVal.toFixed(2)}, ΔP=${dpVal.toFixed(2)} Pa`,
          });
        }

        setResults(res);
        if (currentProject) {
          const norm = normalizeSolverResponse(raw, currentProject);
          setCurrentProject((proj) => (proj ? { ...proj, normalizedSolverResult: norm } : proj));
        }
      } catch (err: any) {
        onRowUpdate(c.id, {
          status: 'Error',
          resultSummary: err?.message || 'Execution failed',
        });
        throw err;
      }
    }
  };

  const recordIssue = (message: string, severity: 'error' | 'warning' = 'error') => {
    const id = ++issueIdRef.current;
    setConsoleIssues((prev) => [
      ...prev,
      { id, message, severity, time: new Date().toISOString() },
    ]);
  };
  const cancelSimulation = () => {
    const taskId = activeTaskIdRef.current;
    activeTaskIdRef.current = null;
    runIdRef.current += 1;
    simAbortRef.current?.abort();
    simAbortRef.current = null;
    setSolverJobStatus('cancelled');
    setSolverProgress(null);
    setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] Simulation cancelled by user.`]);
    if (taskId) {
      fetch(`/api/jobs/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: withEnterpriseAuthHeaders(),
      }).catch(() => {});
    }
  };

  const runSimulation = async () => {
    try {
      await handleRunSimulation();
    } catch (error) {
      if (error instanceof SimulationCancelledError) return;
      const message = error instanceof Error ? error.message : 'Simulation execution failed';
      setSolverJobStatus('failed');
      setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] ERROR: ${message}`]);
      recordIssue(message);
      setConsoleTab('errors');
    }
  };

  const runMeshStudy = async (keyResultId: string): Promise<void> => {
    if (!currentProject || meshStudyRunning) return;
    const studiedProjectId = currentProject.id;
    setMeshStudyRunning(true);
    setMeshStudyError(null);
    setConsoleTab('logs');
    const baseLogPrefix = `[${new Date().toISOString()}] Starting mesh independence study (${keyResultId}, 3 grid levels)`;
    setSolverLogs(previous => [...previous, baseLogPrefix]);

    meshStudyAbortRef.current?.abort();
    const abortController = new AbortController();
    meshStudyAbortRef.current = abortController;

    try {
      const boundaryPatchesPayload = (currentProject.boundaryConditions || [])
        .filter((bc) => Boolean(bc.patchName && bc.patchName.trim()))
        .map((bc) => ({
          patchName: bc.patchName!.trim(),
          name: bc.name,
          type: bc.type,
          value: bc.value,
          unit: bc.unit,
        }));
      const requestBody = {
        ...buildSimulationRequest(simulationInputs),
        project_id: currentProject.id,
        ...(viewportBoundaryMarkers.length > 0 ? { boundary_markers: viewportBoundaryMarkers } : {}),
        ...(boundaryPatchesPayload.length > 0 ? { boundary_patches: boundaryPatchesPayload } : {}),
        ...(viewportRegionBox ? { region_box: viewportRegionBox } : {}),
        ...(uploadedCadStl ? { cad_file_b64: uploadedCadStl.base64, cad_stl_b64: uploadedCadStl.base64, cad_filename: uploadedCadStl.name } : {}),
        key_result: keyResultId,
      };
      const response = await fetch('/api/mesh-study', {
        method: 'POST',
        headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      const parsed = await readJsonSafe<any>(response);
      const payload = parsed.data;
      if (!response.ok || payload?.success === false) {
        throw new Error(
          payload
            ? extractApiError(payload, `Mesh study failed (${response.status})`)
            : parsed.diagnosticMessage || `Mesh study failed (${response.status})`,
        );
      }

      let rawStudy: any = payload?.study;

      // Async Celery job (HTTP 202 Accepted) -> track live via SSE /api/jobs/{taskId}/stream (with polling fallback)
      if (!rawStudy && typeof payload?.task_id === 'string' && payload.task_id) {
        const taskId: string = payload.task_id;
        setSolverJobStatus('queued');
        setSolverProgress(5);
        setSolverLogs(previous => [
          ...previous,
          `[${new Date().toISOString()}] Mesh study queued (task ${taskId.slice(0, 8)}) — streaming live level-by-level solver output...`,
        ]);
        const seenLogSet = new Set<string>();
        const finalJob = await streamJobUntilDone(taskId, {
          signal: abortController.signal,
          pollIntervalMs: 1000,
          onProgress: (snap: any) => {
            const st = String(snap?.status || 'QUEUED').toUpperCase();
            setSolverJobStatus(
              st === 'RUNNING' ? 'running' :
              st === 'COMPLETED' ? 'completed' :
              st === 'FAILED' ? 'failed' :
              st === 'CANCELLED' ? 'cancelled' :
              'queued',
            );
            if (typeof snap?.progress === 'number') {
              setSolverProgress(snap.progress);
            }
            if (snap?.telemetry && typeof snap.telemetry === 'object') {
              setLiveJobTelemetry(snap.telemetry as LiveJobTelemetry);
            }
            if (typeof snap?.wall_clock_sec === 'number' && Number.isFinite(snap.wall_clock_sec)) {
              setJobWallClockSec(snap.wall_clock_sec);
            }
            if (Array.isArray(snap?.logs) && snap.logs.length > 0) {
              const incoming: string[] = [];
              for (const line of snap.logs) {
                const text = String(line);
                if (!seenLogSet.has(text)) {
                  seenLogSet.add(text);
                  incoming.push(text);
                }
              }
              if (incoming.length > 0) {
                setSolverLogs(previous => [...previous, ...incoming]);
              }
            }
          },
        });

        const finalStatus = String(finalJob?.status || 'FAILED').toUpperCase();
        if (finalStatus !== 'COMPLETED') {
          throw new Error(
            extractApiError(finalJob?.result || finalJob, `Mesh study job ${finalStatus.toLowerCase()}`),
          );
        }
        const jobRes = finalJob?.result;
        if (jobRes?.success === false) {
          throw new Error(extractApiError(jobRes, 'Mesh study failed on worker'));
        }
        rawStudy = jobRes?.study ?? finalJob?.study;
      }

      if (!isCurrentMeshStudy(rawStudy)) {
        throw new Error('The mesh study backend returned an unrecognised response (expected schema version 2).');
      }
      const study = rawStudy;
      const meshStudyResult: MeshStudyResult = { ...study, recordedAt: new Date().toISOString() };
      setCurrentProject(project => (project && project.id === studiedProjectId ? { ...project, meshStudyResult } : project));
      const outcome = study.gci_fine_percent !== null
        ? `GCI (fine) = ${study.gci_fine_percent}%`
        : `no GCI (${study.convergence_type})`;
      setSolverJobStatus('completed');
      setSolverProgress(100);
      setSolverLogs(previous => [
        ...previous,
        `[${new Date().toISOString()}] Mesh study complete: ${study.key_result.label}, ${study.convergence_type}, ${outcome}` +
          (study.observed_order !== null ? `, observed order p = ${study.observed_order}` : ''),
      ]);
      setSaveToast(`Mesh independence study complete — ${outcome}`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Mesh study failed';
      setMeshStudyError(message);
      setSolverJobStatus('failed');
      setSolverLogs(previous => [...previous, `[${new Date().toISOString()}] ERROR: ${message}`]);
      recordIssue(message);
      setConsoleTab('errors');
    } finally {
      if (meshStudyAbortRef.current === abortController) {
        meshStudyAbortRef.current = null;
      }
      setMeshStudyRunning(false);
    }
  };

  const setReferenceData = (referenceData: ReferenceDataSet | undefined) => {
    setCurrentProject(project => (project ? { ...project, referenceData } : project));
  };

  const setValidationProfile = (validationProfile: ProfileSpec) => {
    setCurrentProject(project => (project ? { ...project, validationProfile } : project));
  };

  useEffect(() => () => {
    runIdRef.current += 1;
    simAbortRef.current?.abort();
    meshStudyAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    runIdRef.current += 1;
    simAbortRef.current?.abort();
    meshStudyAbortRef.current?.abort();
    setDocumentOpen(false);
    setActiveStep('geometry');
    setResults(null);
    setSolverResidualSeries([]);
    setSolverLogs([]);
    setSolverProgress(null);
    setSolverJobStatus('idle');
    setMeshStudyError(null);
    setMeshPreviewVtk(null);
    setMeshPreviewStats(null);
    setCadPatches([]);
    setSelectedBoundaryIndex(null);
    setUploadedCadStl(null);
    setSimulationInputs(previous => ({ ...previous, simulationType: defaultSimulationTypeForField(currentProject?.field) }));
  }, [currentProject?.id]);

  const [cloudConfig, setCloudConfig] = useState<CloudServerConfig>(() => {
    const defaultCfg: CloudServerConfig = {
      backendUrl: 'http://127.0.0.1:8000',
      workingDirectory: '/app/jobs',
      parallelCores: 8,
      storageCapacityGb: 400,
      solverBackend: 'openfoam',
      licenseServerHost: '127.0.0.1',
      licenseFlexNetPort: 1055,
      licenseAnsysLiPort: 2325,
      licenseType: 'open_source_unlicensed',
      autoFallbackToOpenSource: false,
      status: 'unconfigured',
    };
    try {
      const saved = localStorage.getItem('workbench_cloud_config');
      if (!saved) return defaultCfg;
      const parsed = JSON.parse(saved);
      // Auto-migrate stale legacy port 8001 / scipy_deterministic defaults to Docker :8000
      if (parsed.backendUrl === 'http://127.0.0.1:8001' || parsed.backendUrl === 'http://localhost:8001') {
        parsed.backendUrl = 'http://127.0.0.1:8000';
      }
      if (parsed.solverBackend === 'scipy_deterministic') {
        parsed.solverBackend = 'openfoam';
      }
      if (parsed.workingDirectory === '/data/ansys_workspace') {
        parsed.workingDirectory = '/app/jobs';
      }
      return { ...defaultCfg, ...parsed };
    } catch {
      return defaultCfg;
    }
  });

  const [customProjects, setCustomProjects] = useState<ThesisProject[]>(() => {
    try {
      const saved = localStorage.getItem('workbench_custom_projects');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  });

  const defaultBenchmarkProjects = defaultPresets.map((p) => ({ ...p, isCustom: false }));
  const customProjectIds = new Set(customProjects.map((p) => p.id));
  const allAvailableProjects: ThesisProject[] = [
    ...defaultBenchmarkProjects.filter((p) => !customProjectIds.has(p.id)),
    ...customProjects,
  ];

  useEffect(() => {
    try {
      localStorage.setItem('workbench_cloud_config', JSON.stringify(cloudConfig));
      fetch('/api/cloud/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudConfig),
      }).catch(() => {});
    } catch (e) {
      console.error('Error saving cloud config:', e);
    }
  }, [cloudConfig]);

  const handleStartProject = (newProject: ThesisProject) => {
    setCurrentProject(newProject);
    setActiveTab('overview');
  };

  const handleCreateNewProject = (createdProject: ThesisProject) => {
    setCurrentProject(createdProject);
    const updated = [createdProject, ...customProjects.filter((p) => p.id !== createdProject.id)];
    setCustomProjects(updated);
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving new project:', e);
    }
    setActiveTab('overview');
    setSaveToast(`تم تدشين المشروع الهندسي (${createdProject.title}) بنجاح!`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleFactoryReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.error('Error clearing storage:', e);
    }
    setCustomProjects([]);
    setCurrentProject(null);
    window.location.reload();
  };

  const handleImportProject = (importedProj: ThesisProject) => {
    setCurrentProject(importedProj);
    const updated = [importedProj, ...customProjects.filter((p) => p.id !== importedProj.id)];
    setCustomProjects(updated);
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving imported project:', e);
    }
    setActiveTab('overview');
    setSaveToast(`تم استيراد المشروع (${importedProj.title}) بنجاح!`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleSaveCurrentProject = () => {
    if (!currentProject) return;
    const projectToSave: ThesisProject = {
      ...currentProject,
      isCustom: true,
      lastModified: new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const existingIdx = customProjects.findIndex((p) => p.id === projectToSave.id);
    let updated: ThesisProject[];
    if (existingIdx >= 0) {
      updated = [...customProjects];
      updated[existingIdx] = projectToSave;
    } else {
      updated = [projectToSave, ...customProjects];
    }

    setCustomProjects(updated);
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving custom project:', e);
    }

    setSaveToast('تم حفظ هذا المشروع بنجاح في مكتبة مشاريعك السابقة');
    setTimeout(() => {
      setSaveToast(null);
    }, 3500);
  };

  const parseNumericProperty = (raw: unknown): number | null => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/,/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) return null;
    const val = Number(match[0]);
    return Number.isFinite(val) ? val : null;
  };

  const handleSelectMaterialFromDatabase = (mat: any) => {
    if (!currentProject) return;
    const updatedProj: ThesisProject = {
      ...currentProject,
      material: mat,
      workbenchComponents: currentProject.workbenchComponents?.map((wb) =>
        wb.type === 'Engineering Data'
          ? { ...wb, details: `${mat.name} (كثافة = ${mat.density})` }
          : wb
      ),
    };
    setCurrentProject(updatedProj);

    // Sync physical material properties directly into simulationInputs sent to OpenFOAM / CalculiX / Elmer
    const densityVal = parseNumericProperty(mat.density);
    const kVal = parseNumericProperty(mat.thermalConductivity);
    const cpVal = parseNumericProperty(mat.specificHeat);
    const poissonVal = parseNumericProperty(mat.poissonRatio);
    const viscVal = parseNumericProperty(mat.viscosity);
    const rawModulus = typeof mat.elasticModulus === 'string' ? mat.elasticModulus : '';
    const modulusBase = parseNumericProperty(rawModulus);
    let youngPa: number | null = null;
    if (modulusBase !== null) {
      if (/gpa/i.test(rawModulus)) youngPa = modulusBase * 1e9;
      else if (/mpa/i.test(rawModulus)) youngPa = modulusBase * 1e6;
      else youngPa = modulusBase;
    }

    const isFluidMat = String(mat.phaseOrType || '').toLowerCase() === 'fluid';
    setSimulationInputs((prev) => ({
      ...prev,
      ...(densityVal !== null ? (isFluidMat ? { fluidDensity: String(densityVal) } : { density: String(densityVal) }) : {}),
      ...(viscVal !== null ? { dynamicViscosity: String(viscVal) } : {}),
      ...(youngPa !== null ? { youngModulus: String(youngPa) } : {}),
      ...(poissonVal !== null ? { poissonRatio: String(poissonVal) } : {}),
      ...(kVal !== null ? { thermalConductivity: String(kVal) } : {}),
      ...(cpVal !== null ? { specificHeat: String(cpVal) } : {}),
    }));

    setSaveToast(`تم تطبيق مادة (${mat.name}) ومزامنة خصائصها الفيزيائية مع المحلل بنجاح!`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleDeleteCustomProject = (projectId: string) => {
    const updated = customProjects.filter((p) => p.id !== projectId);
    setCustomProjects(updated);
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
    }
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error deleting project:', e);
    }
    setSaveToast('تم حذف المشروع المخصص بنجاح.');
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleApplyMeshToStudy = (applied: {
    elementCount: number;
    nodeCount: number;
    minOrthogonalQuality: number;
    maxSkewness: number;
    description: string;
    vtkData?: VtkFieldPayload;
    meshSize: number;
    elementOrder: 1 | 2;
    inflationLayers: number;
    firstLayerHeight: number;
    growthRate: number;
    widthX: number;
    heightY: number;
    depthZ: number;
    patches?: Array<{ id: string; name: string }>;
    cadFile?: { name: string; base64: string } | null;
  }) => {
    if (!currentProject) return;
    if (applied.vtkData) {
      setMeshPreviewVtk(applied.vtkData);
      setMeshPreviewStats({
        elements_count: applied.elementCount,
        nodes_count: applied.nodeCount,
        element_order: applied.elementOrder,
        min_quality: applied.minOrthogonalQuality,
        max_skewness: applied.maxSkewness,
        patches: applied.patches,
      });
    }
    if (Array.isArray(applied.patches) && applied.patches.length > 0) {
      setCadPatches(applied.patches);
    }
    if (applied.cadFile) {
      setUploadedCadStl(applied.cadFile);
    }
    setSimulationInputs((prev) => ({
      ...prev,
      meshSize: String(applied.meshSize),
      elementOrder: String(applied.elementOrder) as '1' | '2',
      inflationLayers: String(applied.inflationLayers),
      firstLayerHeight: String(applied.firstLayerHeight),
      growthRate: String(applied.growthRate),
      ...(!applied.cadFile && !uploadedCadStl
        ? {
            widthX: String(applied.widthX),
            heightY: String(applied.heightY),
            depthZ: String(applied.depthZ),
          }
        : {}),
    }));
    const updatedLevels = [...currentProject.meshStudy.meshLevels];
    if (updatedLevels.length > 2) {
      updatedLevels[2] = {
        ...updatedLevels[2],
        elements: applied.elementCount,
        nodes: applied.nodeCount,
      };
    }
    const updatedProj: ThesisProject = {
      ...currentProject,
      meshStudy: {
        ...currentProject.meshStudy,
        minOrthogonalQuality: applied.minOrthogonalQuality,
        maxSkewness: applied.maxSkewness,
        recommendation: `${applied.description} - تم التحقق من جودة العناصر وفق معايير تقارب روتش (Roache GCI).`,
        meshLevels: updatedLevels,
      },
    };
    setCurrentProject(updatedProj);
    setSaveToast(`تم اعتماد الشبكة (${applied.elementCount.toLocaleString()} عنصر، h=${applied.meshSize}m، Order ${applied.elementOrder}) ومزامنتها مع الاستوديو`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleCadLoaded = (stats: CadModelStats) => {
    if (!currentProject) return;
    const updatedProj: ThesisProject = {
      ...currentProject,
      title: `CAD: ${stats.name}`,
      workbenchComponents: currentProject.workbenchComponents?.map((wb) =>
        wb.type === 'Geometry'
          ? { ...wb, details: `${stats.name} (${stats.triangles.toLocaleString()} faces)` }
          : wb
      ),
    };
    setCurrentProject(updatedProj);
    setSimulationInputs((prev) => ({
      ...prev,
      widthX: stats.dimensions[0].toFixed(2),
      heightY: stats.dimensions[1].toFixed(2),
      depthZ: stats.dimensions[2] > 0 ? stats.dimensions[2].toFixed(2) : prev.depthZ,
    }));
    setSaveToast(`تم استيراد النموذج الهندسي ${stats.name} (${stats.triangles.toLocaleString()} مثلث/وجه) وتحديث أبعاد النطاق.`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleCadFileUploaded = async ({
    name,
    base64,
    ext,
  }: {
    name: string;
    base64: string;
    ext: string;
    stats?: CadModelStats;
  }) => {
    setUploadedCadStl({ name, base64 });
    if (ext === '.stl') return;

    setCadPreviewLoading(true);
    setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] Tessellating CAD (${name}) via Docker /api/cad-preview...`]);
    try {
      const response = await fetch('/api/cad-preview', {
        method: 'POST',
        headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cad_file_b64: base64, cad_filename: name }),
      });
      const data = await readJson(response);
      if (!response.ok || data?.success === false || !data?.vtk_data) {
        throw new Error(extractApiError(data, `CAD preview failed (${response.status})`));
      }
      setMeshPreviewVtk(data.vtk_data as VtkFieldPayload);
      if (Array.isArray(data.patches)) {
        setCadPatches(data.patches);
      }
      if (Array.isArray(data.dimensions) && data.dimensions.length >= 3) {
        setSimulationInputs((prev) => ({
          ...prev,
          widthX: Number(data.dimensions[0]).toFixed(3),
          heightY: Number(data.dimensions[1]).toFixed(3),
          depthZ: Number(data.dimensions[2]).toFixed(3),
        }));
      }
      if (currentProject) {
        setCurrentProject((prev) =>
          prev
            ? {
                ...prev,
                title: `CAD: ${name}`,
                workbenchComponents: prev.workbenchComponents?.map((wb) =>
                  wb.type === 'Geometry'
                    ? { ...wb, details: `${name} (${data.vtk_data?.triangle_count || 0} triangles via ${data.backend || 'gmsh'})` }
                    : wb
                ),
              }
            : prev
        );
      }
      setSaveToast(`Loaded ${name} via Docker CAD engine (${data.vtk_data?.triangle_count || 0} surface faces).`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'CAD preview failed';
      recordIssue(msg);
      setConsoleTab('errors');
      setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] ERROR: ${msg}`]);
    } finally {
      setCadPreviewLoading(false);
    }
  };

  const handleGenerateMeshPreview = async () => {
    if (!currentProject || meshGenerating) return;
    setMeshGenerating(true);
    setConsoleTab('logs');
    setSolverLogs((prev) => [
      ...prev,
      `[${new Date().toISOString()}] Running Gmsh 3D mesher (h=${simulationInputs.meshSize} m, Order ${simulationInputs.elementOrder}) via Docker :8000...`,
    ]);
    try {
      const bodyPayload: Record<string, unknown> = {
        width_x: Number(simulationInputs.widthX) || 1.0,
        height_y: Number(simulationInputs.heightY) || 0.4,
        depth_z: Number(simulationInputs.depthZ) || 0.2,
        mesh_size: Number(simulationInputs.meshSize) || 0.05,
        dimension: 3,
        element_order: Number(simulationInputs.elementOrder || 1),
        inflation_layers: Number(simulationInputs.inflationLayers || 0),
        first_layer_height: Number(simulationInputs.firstLayerHeight || 0.002),
        growth_rate: Number(simulationInputs.growthRate || 1.2),
        execution_mode: simulationInputs.executionMode,
      };
      if (uploadedCadStl) {
        bodyPayload.cad_file_b64 = uploadedCadStl.base64;
        bodyPayload.cad_stl_b64 = uploadedCadStl.base64;
        bodyPayload.cad_filename = uploadedCadStl.name;
      }

      const res = await fetch('/api/mesh-generate', {
        method: 'POST',
        headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(bodyPayload),
      });
      const payload = await readJson(res);
      if (!res.ok || payload?.success === false) {
        throw new Error(extractApiError(payload, `Gmsh meshing failed (${res.status})`));
      }

      let meshData = payload?.mesh;
      if (!meshData && payload?.task_id) {
        const started = Date.now();
        while (Date.now() - started < 120_000) {
          await new Promise((r) => setTimeout(r, 1000));
          const jobRes = await fetch(`/api/jobs/${encodeURIComponent(payload.task_id)}`, {
            headers: withEnterpriseAuthHeaders(),
          });
          if (!jobRes.ok) continue;
          const job = await readJson(jobRes);
          const st = String(job?.status || '').toUpperCase();
          if (st === 'COMPLETED') {
            meshData = job?.result?.mesh || job?.result?.data || job?.result;
            break;
          }
          if (st === 'FAILED' || st === 'CANCELLED') {
            throw new Error(job?.error || `Gmsh task ${st.toLowerCase()}`);
          }
        }
      }

      if (!meshData || !meshData.elements_count) {
        throw new Error('Gmsh did not return valid mesh elements.');
      }

      if (meshData.vtk_data) {
        setMeshPreviewVtk(meshData.vtk_data as VtkFieldPayload);
      }
      setMeshPreviewStats(meshData as MeshPreviewSummary);
      if (Array.isArray(meshData.patches)) {
        setCadPatches(meshData.patches);
      }
      setSolverLogs((prev) => [
        ...prev,
        `[${new Date().toISOString()}] Gmsh complete: ${meshData.elements_count} elements, ${meshData.nodes_count} nodes (minSICN=${meshData.min_quality}).`,
      ]);
      setSaveToast(`Gmsh 3D mesh ready: ${Number(meshData.elements_count).toLocaleString()} elements`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Gmsh mesh generation failed';
      recordIssue(msg);
      setConsoleTab('errors');
      setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] ERROR: ${msg}`]);
    } finally {
      setMeshGenerating(false);
    }
  };

  const handleBoundaryAdded = (marker: BoundaryMarker) => {
    if (!currentProject) return;
    const bcType =
      marker.type === 'Inlet'
        ? 'Velocity Inlet'
        : marker.type === 'Outlet'
        ? 'Pressure Outlet'
        : marker.type === 'HeatSource'
        ? 'Heat Flux Wall'
        : marker.type === 'Load'
        ? 'Force Load'
        : marker.type === 'Fixed'
        ? 'Fixed Support'
        : 'No-slip Wall';
    const bcValue =
      marker.value !== undefined
        ? String(marker.value)
        : marker.type === 'Inlet'
        ? simulationInputs.velocity
        : '0.0';
    const bcUnit =
      marker.unit || (marker.type === 'Inlet' ? 'm/s' : marker.type === 'HeatSource' ? 'W/m²' : 'Pa');
    const newBc: BoundaryCondition = {
      id: `bc_${Date.now()}`,
      markerId: marker.id,
      patchName: marker.patchName,
      name: marker.patchName
        ? `${marker.type} (${marker.patchName})`
        : `${marker.type} [${marker.point.map((p) => p.toFixed(1)).join(', ')}]`,
      type: bcType,
      value: bcValue,
      unit: bcUnit,
      description: marker.patchName
        ? `CAD Patch ${marker.patchName} · Normal n=(${marker.normal.map((n) => n.toFixed(2)).join(', ')})`
        : `Normal n=(${marker.normal.map((n) => n.toFixed(2)).join(', ')})`,
      location: marker.patchName ? `CAD Patch: ${marker.patchName}` : undefined,
      status: 'Defined',
    };
    const nextBcs = [...(currentProject.boundaryConditions || []), newBc];
    setCurrentProject({
      ...currentProject,
      boundaryConditions: nextBcs,
    });
    setSelectedBoundaryIndex(nextBcs.length - 1);
    setSaveToast(`Assigned ${bcType} (${newBc.name}) to Simulation Tree.`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleUpdateBoundaryCondition = (idx: number, patch: Partial<BoundaryCondition>) => {
    if (!currentProject) return;
    const list = [...(currentProject.boundaryConditions || [])];
    if (!list[idx]) return;
    const updatedBc = { ...list[idx], ...patch };
    list[idx] = updatedBc;
    setCurrentProject({ ...currentProject, boundaryConditions: list });
    if (updatedBc.markerId && patch.value !== undefined) {
      const numericVal = parseFloat(patch.value);
      if (Number.isFinite(numericVal)) {
        setViewportBoundaryMarkers((prev) =>
          prev.map((m) => (m.id === updatedBc.markerId ? { ...m, value: numericVal, unit: updatedBc.unit } : m))
        );
      }
    }
  };

  const handleDeleteBoundaryCondition = (idx: number) => {
    if (!currentProject) return;
    const list = [...(currentProject.boundaryConditions || [])];
    const removed = list[idx];
    list.splice(idx, 1);
    setCurrentProject({ ...currentProject, boundaryConditions: list });
    if (removed?.markerId) {
      setViewportBoundaryMarkers((prev) => prev.filter((m) => m.id !== removed.markerId));
    }
    setSelectedBoundaryIndex((curr) => (curr === idx ? null : curr !== null && curr > idx ? curr - 1 : curr));
  };

  const handleAddBoundaryCondition = (bc: BoundaryCondition) => {
    if (!currentProject) return;
    setCurrentProject({
      ...currentProject,
      boundaryConditions: [...(currentProject.boundaryConditions || []), bc],
    });
  };

  const openDocument = (doc: PanelDocument | 'wizard') => {
    setActiveTab(doc);
    setDocumentOpen(true);
  };

  const handlePrint = () => {
    if (!documentOpen || activeTab !== 'report') {
      openDocument('report');
      setTimeout(() => {
        window.print();
      }, 350);
    } else {
      window.print();
    }
  };

  const selectStep = (step: WorkflowStep) => {
    setActiveStep(step);
    setDocumentOpen(false);
  };

  const hasProject = currentProject !== null;
  const hasCompletedRun = hasRealSimulationRun(currentProject);
  const activeSolverTaskId = currentProject?.simulationRun?.taskId ?? null;

  const handleDownloadSolverCase = async (taskId: string) => {
    try {
      setSaveToast(`Packaging solver deck & VTK archive (${taskId.slice(0, 8)})…`);
      const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/export-case`, {
        headers: withEnterpriseAuthHeaders(),
      });
      if (!res.ok) {
        const errBody = await readJson(res);
        throw new Error(extractApiError(errBody, `Case export failed (${res.status})`));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `naseer-case-${taskId.slice(0, 12)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveToast(`Downloaded solver case archive (naseer-case-${taskId.slice(0, 8)}.zip)`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to export solver case archive';
      recordIssue(msg, 'warning');
      setConsoleTab('errors');
      setSolverLogs((prev) => [...prev, `[${new Date().toISOString()}] ERROR: ${msg}`]);
    }
  };

  const handleDownloadImplementationChecklist = async () => {
    try {
      const res = await fetch('/api/implementation-checklist');
      if (!res.ok) throw new Error(`Failed to fetch checklist (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'NASEER_IMPLEMENTATION_PLAN_AND_VERIFICATION_CHECKLIST.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveToast('تم تنزيل ملف خطة التطوير المنفذة وقائمة التشييك (.md)');
      setTimeout(() => setSaveToast(null), 3500);
    } catch (error) {
      recordIssue(error instanceof Error ? error.message : 'Checklist download failed', 'warning');
      setConsoleTab('errors');
    }
  };

  const runExport = async (action: () => unknown) => {
    try {
      await action();
    } catch (error) {
      recordIssue(error instanceof Error ? error.message : 'Report export failed', 'warning');
      setConsoleTab('errors');
    }
  };

  const stepActions: Record<WorkflowStep, TreeAction[]> = {
    geometry: [
      { id: 'import', label: 'Import Model', icon: <Upload className="h-3.5 w-3.5" />, onClick: () => setIsUploadModalOpen(true) },
    ],
    mesh: [
      { id: 'generator', label: 'Mesh Generator', icon: <Grid3X3 className="h-3.5 w-3.5" />, onClick: () => setIsMeshGeneratorOpen(true) },
      { id: 'study', label: 'Mesh Study (GCI)', icon: <Layers className="h-3.5 w-3.5" />, onClick: () => openDocument('mesh') },
    ],
    physics: [
      { id: 'wizard', label: 'Duct & Nanofluid Wizard', icon: <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />, onClick: () => openDocument('wizard') },
      { id: 'setup', label: 'Solver Setup', icon: <Cpu className="h-3.5 w-3.5" />, onClick: () => openDocument('overview') },
      { id: 'materials', label: 'Materials Database', icon: <Database className="h-3.5 w-3.5" />, onClick: () => setIsMaterialsModalOpen(true) },
      { id: 'sweep', label: 'Parametric Sweep', icon: <Sliders className="h-3.5 w-3.5" />, onClick: () => setIsParametricSweepOpen(true) },
    ],
    boundaries: [],
    contacts: [
      { id: 'setup', label: 'Interface Overview', icon: <Cpu className="h-3.5 w-3.5" />, onClick: () => openDocument('overview') },
    ],
    solution: [
      { id: 'setup', label: 'Solver Setup', icon: <Cpu className="h-3.5 w-3.5" />, onClick: () => openDocument('overview') },
    ],
    post: [
      { id: 'contours', label: 'Contours & Vectors', icon: <Palette className="h-3.5 w-3.5" />, onClick: () => openDocument('contours') },
      { id: 'validation', label: 'Validation', icon: <ShieldCheck className="h-3.5 w-3.5" />, onClick: () => openDocument('validation') },
      { id: 'tables', label: 'Data Tables', icon: <TableIcon className="h-3.5 w-3.5" />, onClick: () => openDocument('tables') },
      { id: 'report', label: 'Certified Report', icon: <FileText className="h-3.5 w-3.5" />, onClick: () => openDocument('report') },
    ],
  };

  const menuGroups: HeaderMenuGroup[] = [
    {
      id: 'project',
      label: 'Project',
      items: [
        { id: 'new', label: 'New Project…', icon: <PlusCircle className="h-3.5 w-3.5" />, onClick: () => setIsNewProjectModalOpen(true), title: 'إنشاء مشروع هندسي جديد ومخصص من الصفر' },
        { id: 'library', label: 'Projects Library', icon: <FolderOpen className="h-3.5 w-3.5 text-sky-400" />, onClick: () => setIsProjectsLibraryOpen(true), title: 'فتح مكتبة المشاريع الهندسية المحفوظة' },
        { id: 'import', label: 'Import Files…', icon: <Upload className="h-3.5 w-3.5" />, onClick: () => setIsUploadModalOpen(true), title: 'استيراد ورفع ملفات CAD أو شبيكة Mesh أو ملفات الحالات' },
        { id: 'save', label: 'Save to Library', icon: <Save className="h-3.5 w-3.5" />, onClick: handleSaveCurrentProject, disabled: !hasProject, title: hasProject ? 'حفظ التعديلات في مكتبة المشاريع' : 'يتطلب فتح أو إنشاء مشروع أولاً ليتم حفظه' },
        {
          id: 'workflow',
          label: 'Workflow Guide (دورة العمل)',
          icon: <Layers className="h-3.5 w-3.5 text-sky-400" />,
          onClick: () => setCurrentProject(null),
          title: 'عرض الصفحة التعليمية لدورة حياة المشروع وترتيب استخدام الأزرار',
        },
        {
          id: 'close',
          label: 'Close Project',
          icon: <RotateCcw className="h-3.5 w-3.5" />,
          onClick: () => setCurrentProject(null),
          disabled: !hasProject,
          title: hasProject ? 'إغلاق المشروع الحالي والرجوع لصفحة العمل الرئيسية' : 'لا يوجد مشروع مفتوح حالياً لإغلاقه',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { id: 'wizard', label: 'Duct & Nanofluid Wizard', icon: <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />, onClick: () => openDocument('wizard'), disabled: !hasProject, title: 'معالج قنوات التبريد والموائع النانوية والدراسة البارامترية' },
        { id: 'mesh', label: 'Mesh Generator', icon: <Grid3X3 className="h-3.5 w-3.5" />, onClick: () => setIsMeshGeneratorOpen(true), title: 'مولد الشبيكات وتدقيق جودة التعامد' },
        { id: 'materials', label: 'Materials Database', icon: <Database className="h-3.5 w-3.5" />, onClick: () => setIsMaterialsModalOpen(true), disabled: !hasProject, title: hasProject ? 'فتح مكتبة المواد المعيارية' : 'يتطلب فتح أو اختيار مشروع لتخصيص خواص المواد' },
        { id: 'sweep', label: 'Parametric Sweep', icon: <Sliders className="h-3.5 w-3.5" />, onClick: () => setIsParametricSweepOpen(true), disabled: !hasProject, title: hasProject ? 'مسح المتغيرات وحساب سطوح الاستجابة' : 'يتطلب فتح مشروع لتحديد متغيرات المسح' },
      ],
    },
    {
      id: 'export',
      label: 'Export',
      items: [
        { id: 'plan-md', label: 'Implementation Plan & Checklist (.md)', icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />, onClick: handleDownloadImplementationChecklist, disabled: false, title: 'تنزيل ملف خطة التطوير المنفذة وقائمة التشييك الشاملة (IMPLEMENTATION_PLAN_AND_VERIFICATION_CHECKLIST.md)' },
        { id: 'solver-zip', label: 'Solver Deck & VTK (.zip)', icon: <Download className="h-3.5 w-3.5 text-sky-400" />, onClick: () => activeSolverTaskId && handleDownloadSolverCase(activeSolverTaskId), disabled: !activeSolverTaskId, title: activeSolverTaskId ? 'تصدير حزمة ملفات المحلل الحقيقية (OpenFOAM / CalculiX / Elmer / VTK / solver.log) بصيغة ZIP' : 'يتطلب تنفيذ محاكاة عبر Celery لتصدير مجلد الحالة الفعلي' },
        { id: 'word', label: 'Word Document', icon: <FileText className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToWordDocument(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير أطروحة Word كاملة بالرسوم والكونتورات' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل من المكتبة لتوليد التقرير' },
        { id: 'html', label: 'Report HTML', icon: <Globe className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToJournalHTML(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير ورقة بحثية لمجلة عالمية (Journal HTML)' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل' },
        { id: 'latex', label: 'LaTeX', icon: <FileCode className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToLatex(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير شفرة LaTeX للأطروحة' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل' },
        { id: 'csv', label: 'CSV Data', icon: <FileSpreadsheet className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToCSV(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير مصفوفات البيانات والنتائج (.csv)' : 'يتطلب توفر نتائج محاكاة لتصدير البيانات' },
        { id: 'print', label: 'Print Report', icon: <Printer className="h-3.5 w-3.5" />, onClick: handlePrint, disabled: !hasCompletedRun, title: hasCompletedRun ? 'طباعة التقرير الهندسي الشامل' : 'يتطلب توفر نتائج المحاكاة لطباعة التقرير' },
      ],
    },
    {
      id: 'settings',
      label: 'Infrastructure',
      items: [
        { id: 'cloud', label: 'HPC Cluster & Multi-Worker Gateway', icon: <Cloud className="h-3.5 w-3.5" />, onClick: () => setIsCloudModalOpen(true), title: 'إدارة عنقود الحوسبة المتوازية وخوادم Docker / HPC' },
        { id: 'enterprise', label: 'Enterprise Security, S3 & K8s', icon: <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />, onClick: () => setIsEnterpriseModalOpen(true), title: 'مصادقة فرق العمل (RBAC) وتخزين S3/MinIO وحزم Kubernetes وSlurm وسجل التدقيق' },
      ],
    },
  ];

  const documentTitles: Record<TabType, string> = {
    overview: 'Solver Setup Workbench',
    wizard: 'Internal Duct, Nanofluid & Parametric Wizard',
    contours: 'Contours & Vectors',
    mesh: 'Mesh Study (GCI)',
    validation: 'Validation (ASME V&V 20)',
    tables: 'Data Tables',
    report: 'Certified Engineering Report',
  };

  const viewportTitles: Record<WorkflowStep, string> = {
    geometry: 'Geometry',
    mesh: 'Mesh & Sizing Preview',
    physics: 'Physics & Materials',
    boundaries: 'Boundary Conditions',
    contacts: 'Contacts & Interfaces',
    solution: 'Solution Controls',
    post: 'Results & Post-Processing',
  };

  const realTemperatureMatrix = toRealTemperatureMatrix(results?.temperature_matrix);

  return (
    <div
      dir="ltr"
      className="studio-root flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-['Inter','Cairo',sans-serif] text-slate-100 selection:bg-sky-500/30 selection:text-sky-100"
    >
      <StudioHeader
        projectTitle={currentProject?.title}
        status={solverJobStatus}
        progress={solverProgress}
        canRun={hasProject && getMissingSimulationInputs(simulationInputs).length === 0}
        runDisabledReason={
          !hasProject
            ? 'Open or create a project to run a simulation'
            : getMissingSimulationInputs(simulationInputs).length > 0
            ? `Missing required inputs: ${getMissingSimulationInputs(simulationInputs).join(', ')}`
            : undefined
        }
        engineLabel="Solvers: OpenFOAM · CalculiX · Gmsh · ElmerFEM"
        menuGroups={menuGroups}
        onRun={() => { runSimulation().catch(() => {}); }}
        onCancel={cancelSimulation}
        onHome={() => setCurrentProject(null)}
        onOpenClusterMonitor={() => setIsCloudModalOpen(true)}
      />

      <div className="print-reset flex min-h-0 flex-1">
        <SimulationTree
          activeStep={activeStep}
          hasProject={hasProject}
          jobStatus={solverJobStatus}
          inputs={simulationInputs}
          materialName={currentProject?.material?.name}
          cadName={uploadedCadStl?.name}
          meshElementCount={meshPreviewStats?.elements_count ?? currentProject?.meshStudy?.meshLevels?.[2]?.elements}
          boundaryConditions={currentProject?.boundaryConditions}
          selectedBoundaryIndex={selectedBoundaryIndex}
          onSelectBoundary={setSelectedBoundaryIndex}
          actions={stepActions}
          onSelectStep={selectStep}
        />

        <main className="print-reset flex min-w-0 flex-1 flex-col">
        {!currentProject ? (
          <div dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-slate-950 px-6 py-6">
          <CleanWorkspaceHome
            onStartProject={handleStartProject}
            onOpenNewProjectWizard={() => setIsNewProjectModalOpen(true)}
            onOpenProjectsLibrary={() => setIsProjectsLibraryOpen(true)}
            onOpenUploadModal={() => setIsUploadModalOpen(true)}
            onOpenCloudSettings={() => setIsCloudModalOpen(true)}
            onOpenAuditModal={() => setIsAuditModalOpen(true)}
            onOpenMeshGenerator={() => setIsMeshGeneratorOpen(true)}
            onOpenMaterialsModal={() => setIsMaterialsModalOpen(true)}
            onOpenParametricSweep={() => setIsParametricSweepOpen(true)}
            savedProjectsCount={allAvailableProjects.length}
            onResetWorkspace={() => {
              setCurrentProject(null);
              setSaveToast('تمت تهيئة وفورمات مساحة العمل بنجاح (Pristine Clean Workspace).');
              setTimeout(() => setSaveToast(null), 3000);
            }}
          />
          </div>
        ) : (
          <>
            <ViewportCanvas
              title={viewportTitles[activeStep]}
              subtitle={`${currentProject.title} · ${currentProject.field}`}
              field={currentProject.field}
              showMeshOverlay={activeStep === 'mesh'}
              vtkData={currentProject.normalizedSolverResult?.vtkData ?? null}
              meshPreviewVtk={meshPreviewVtk}
              integrals={currentProject.normalizedSolverResult?.integrals ?? null}
              cadLoading={cadPreviewLoading}
              selectedMarkerId={
                selectedBoundaryIndex !== null
                  ? currentProject.boundaryConditions?.[selectedBoundaryIndex]?.markerId ?? null
                  : null
              }
              highlightedPatchName={
                selectedBoundaryIndex !== null
                  ? currentProject.boundaryConditions?.[selectedBoundaryIndex]?.patchName ?? null
                  : null
              }
              hasSolvedResults={hasCompletedRun}
              jobStatus={solverJobStatus}
              activeTaskId={activeTaskId}
              solverProgress={solverProgress}
              currentIteration={solverCurrentIteration}
              liveJobTelemetry={liveJobTelemetry}
              jobWallClockSec={jobWallClockSec}
              lastCompletedDurationSec={lastCompletedDurationSec}
              solverLabel={simulationInputs.simulationType}
              onCadLoaded={handleCadLoaded}
              onCadStlUploaded={({ name, base64 }) => setUploadedCadStl({ name, base64 })}
              onCadFileUploaded={handleCadFileUploaded}
              onBoundaryAdded={handleBoundaryAdded}
              onBoundaryMarkersChange={setViewportBoundaryMarkers}
              onRegionChange={setViewportRegionBox}
              overlay={
                <>
                  {activeStep === 'post' && solverJobStatus === 'completed' && !realTemperatureMatrix && (
                    <div className="pointer-events-none absolute bottom-9 left-1/2 z-10 -translate-x-1/2 rounded border border-emerald-500/30 bg-slate-900/90 px-3 py-1.5 text-[11px] text-emerald-200 shadow-lg">
                      Solve completed — no 2D scalar field was returned. See the Results Summary and Result Views.
                    </div>
                  )}
                  {documentOpen && (
                    <div className="print-reset absolute inset-0 z-20 flex flex-col bg-slate-950">
                      <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 print:hidden">
                        <span className="text-[12px] font-semibold text-slate-200">{documentTitles[activeTab]}</span>
                        <button
                          onClick={() => setDocumentOpen(false)}
                          className="flex h-6 items-center gap-1 rounded border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                          Back to viewport
                        </button>
                      </div>
                      <div dir="rtl" className="print-reset min-h-0 flex-1 overflow-y-auto p-5">
                        {activeTab === 'wizard' && (
  <PhysicsSetupStudio
    projectName={currentProject.title}
    boundaryConditions={currentProject.boundaryConditions}
    onAutoFixBoundaries={() => {
      setCurrentProject((prev) =>
        prev
          ? {
              ...prev,
              boundaryConditions: [
                ...(prev.boundaryConditions || []),
                {
                  name: 'Duct Inlet',
                  type: 'Velocity Inlet',
                  value: simulationInputs.velocity || '0.25',
                  unit: 'm/s',
                  description: 'Uniform / Parabolic velocity inlet',
                },
                {
                  name: 'Duct Outlet',
                  type: 'Pressure Outlet',
                  value: '0',
                  unit: 'Pa (gauge)',
                  description: 'Zero gauge pressure outlet',
                },
              ],
            }
          : prev
      );
    }}
    onApplyToProject={handleApplyWizardCaseToProject}
    onRunRealBatch={handleRunRealWizardBatch}
  />
)}

                        {activeTab === 'report' && (
                          <ThesisReportTab project={currentProject} onPrint={handlePrint} />
                        )}

                        {activeTab === 'contours' && (
                          <ContoursTab project={currentProject} />
                        )}

                        {activeTab === 'mesh' && (
                          <MeshStudyTab
                            project={currentProject}
                            simulationType={simulationInputs.simulationType}
                            onRunMeshStudy={runMeshStudy}
                            meshStudyRunning={meshStudyRunning}
                            meshStudyError={meshStudyError}
                          />
                        )}

                        {activeTab === 'validation' && (
                          <ValidationTab
                            project={currentProject}
                            onSetReferenceData={setReferenceData}
                            onSetProfile={setValidationProfile}
                          />
                        )}

                        {activeTab === 'tables' && (
                          <TablesTab project={currentProject} />
                        )}

                        {activeTab === 'overview' && (
                          <OverviewTab
                            project={currentProject}
                            onRunSolver={runSimulation}
                            solverJobStatus={solverJobStatus}
                            solverLogs={solverLogs}
                            onSolverFailed={() => setSolverJobStatus(status => (status === 'cancelled' ? status : 'failed'))}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              }
            >
              {activeStep === 'post' && realTemperatureMatrix ? (
                <HeatmapCanvas matrix={realTemperatureMatrix} />
              ) : undefined}
            </ViewportCanvas>

            <SolverConsole
              tab={consoleTab}
              onTabChange={setConsoleTab}
              logs={solverLogs}
              status={solverJobStatus}
              progress={solverProgress}
              currentIteration={solverCurrentIteration}
              issues={consoleIssues}
              residualSeries={solverResidualSeries}
              onClearIssues={() => setConsoleIssues([])}
            />
          </>
        )}
        </main>

        <PropertiesPanel
          step={activeStep}
          project={currentProject}
          inputs={simulationInputs}
          inputsLocked={isSolverRunning}
          results={results}
          onInputsChange={(patch) => setSimulationInputs(previous => ({ ...previous, ...patch }))}
          selectedBoundaryIndex={selectedBoundaryIndex}
          onSelectBoundary={setSelectedBoundaryIndex}
          onUpdateBoundaryCondition={handleUpdateBoundaryCondition}
          onDeleteBoundaryCondition={handleDeleteBoundaryCondition}
          onAddBoundaryCondition={handleAddBoundaryCondition}
          meshPreviewStats={meshPreviewStats}
          meshGenerating={meshGenerating}
          onGenerateMeshPreview={handleGenerateMeshPreview}
          cadPatches={cadPatches}
          lastTaskId={activeSolverTaskId}
          onDownloadCaseArchive={handleDownloadSolverCase}
          actions={{
            importModel: () => setIsUploadModalOpen(true),
            openMeshGenerator: () => setIsMeshGeneratorOpen(true),
            openMaterials: () => setIsMaterialsModalOpen(true),
            openParametricSweep: () => setIsParametricSweepOpen(true),
            openDocument,
            print: handlePrint,
          }}
        />
      </div>

      <ScriptUploaderModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onAnalysisComplete={handleStartProject}
        simulationInputs={simulationInputs}
      />

      <CloudServerSettingsModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        config={cloudConfig}
        onSaveConfig={(newConfig) => {
          setCloudConfig(newConfig);
          if (newConfig.parallelCores && Number.isFinite(newConfig.parallelCores)) {
            setSimulationInputs((prev) => ({ ...prev, parallelCores: String(newConfig.parallelCores) }));
          }
          setSaveToast(`تم حفظ إعدادات العنقود ومزامنة الأنوية المتوازية (${newConfig.parallelCores} Cores) بنجاح`);
          setTimeout(() => setSaveToast(null), 3000);
        }}
      />

      <ProjectsLibraryModal
        isOpen={isProjectsLibraryOpen}
        onClose={() => setIsProjectsLibraryOpen(false)}
        projects={allAvailableProjects}
        currentProjectId={currentProject?.id}
        onSelectProject={(proj) => {
          setCurrentProject(proj);
          setActiveTab('overview');
        }}
        onSelectBenchmarkTemplate={(tpl: VVBenchmarkTemplate) => {
          const freshProject: ThesisProject = {
            ...tpl.project,
            id: `${tpl.id}-${Date.now()}`,
            referenceData: tpl.project.referenceData
              ? {
                  ...tpl.project.referenceData,
                  points: tpl.project.referenceData.points.map((pt) => ({ ...pt })),
                  recordedAt: new Date().toISOString(),
                }
              : undefined,
            validationProfile: tpl.project.validationProfile ? { ...tpl.project.validationProfile } : undefined,
            lastModified: new Date().toISOString(),
          };
          setCustomProjects((prev) => [freshProject, ...prev]);
          setCurrentProject(freshProject);
          setSimulationInputs({
            ...DEFAULT_SIMULATION_INPUTS,
            parallelCores: String(cloudConfig.parallelCores || 1),
            ...tpl.recommendedInputs,
          });
          setUploadedCadStl(null);
          setViewportBoundaryMarkers([]);
          setCadPatches([]);
          setMeshPreviewStats(null);
          setActiveStep('physics');
          setActiveTab('validation');
          setSaveToast(
            `تم تحميل قالب التحقق القياسي (${tpl.code}) وتعبئة المدخلات الفيزيائية — اضغط Run Simulation لتشغيل المحرك الحقيقي وحساب نسبة الخطأ`,
          );
          setTimeout(() => setSaveToast(null), 5000);
        }}
        onStartBlankProject={() => setCurrentProject(null)}
        onOpenNewProjectWizard={() => setIsNewProjectModalOpen(true)}
        onDeleteProject={handleDeleteCustomProject}
        onClearCustomProjects={handleFactoryReset}
        onImportProject={handleImportProject}
        onOpenVVCertification={() => setIsAuditModalOpen(true)}
      />

      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreateProject={handleCreateNewProject}
        onOpenMeshGenerator={() => setIsMeshGeneratorOpen(true)}
      />

      <MeshGenerativeTool
        isOpen={isMeshGeneratorOpen}
        onClose={() => setIsMeshGeneratorOpen(false)}
        currentProject={currentProject}
        simulationInputs={simulationInputs}
        uploadedCadStl={uploadedCadStl}
        onApplyMeshToStudy={handleApplyMeshToStudy}
      />

      <MaterialsDatabaseModal
        isOpen={isMaterialsModalOpen}
        onClose={() => setIsMaterialsModalOpen(false)}
        onSelectMaterial={handleSelectMaterialFromDatabase}
        currentMaterialName={currentProject?.material?.name}
      />

      <ParametricSweepTool
        isOpen={isParametricSweepOpen}
        onClose={() => setIsParametricSweepOpen(false)}
        currentProject={currentProject}
        simulationInputs={simulationInputs}
        uploadedCadStl={uploadedCadStl}
        viewportBoundaryMarkers={viewportBoundaryMarkers}
        onSweepComplete={(cases) => {
          setCurrentProject((prev) => (prev ? { ...prev, casesMatrix: cases } : prev));
          setSaveToast(`تم ترحيل ${cases.length} نقاط تصميم مكتملة إلى مصفوفة الحالات والتقرير`);
          setTimeout(() => setSaveToast(null), 3500);
        }}
      />

      <AuditReportModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />

      <EnterpriseAdminModal
        isOpen={isEnterpriseModalOpen}
        onClose={() => setIsEnterpriseModalOpen(false)}
        authToken={enterpriseAuthToken}
        onAuthTokenChange={(token) => {
          syncEnterpriseAuthToken(token);
          setEnterpriseAuthToken(token);
        }}
        lastTaskId={activeSolverTaskId}
      />

      {saveToast && (
        <div className="fixed bottom-6 left-6 z-50 bg-emerald-950 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs animate-in slide-in-from-bottom duration-300">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}
    </div>
  );
}