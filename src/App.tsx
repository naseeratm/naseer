import React, { useState, useEffect, useRef } from 'react';
import { HeatmapCanvas } from './HeatmapCanvas';
import {
  Layers,
  Grid3X3,
  Palette,
  ShieldCheck,
  Table as TableIcon,
  FileText,
  Sparkles,
  Cpu,
  Key,
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
  Shield,
  Truck,
} from 'lucide-react';
import {
  ThesisProject,
  BoundaryCondition,
  ApiKeyItem,
  EngineMode,
  CloudServerConfig,
  SimulationRunRecord,
  MeshStudyResult,
  ProfileSpec,
  ReferenceDataSet,
  isCurrentMeshStudy,
} from './types/thesis';
import { StudioHeader, HeaderMenuGroup } from './components/StudioHeader';
import { SimulationTree, TreeAction } from './components/SimulationTree';
import { ViewportCanvas } from './components/ViewportCanvas';
import { CadModelStats, BoundaryMarker } from './components/Interactive3DViewport';
import { PropertiesPanel, PanelDocument } from './components/PropertiesPanel';
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
import { generateLocalEngineeringProject } from './utils/physicsEngine';
import { CleanWorkspaceHome } from './components/CleanWorkspaceHome';
import { OverviewTab } from './components/OverviewTab';
import { MeshStudyTab } from './components/MeshStudyTab';
import { ContoursTab } from './components/ContoursTab';
import { ValidationTab } from './components/ValidationTab';
import { TablesTab } from './components/TablesTab';
import { ThesisReportTab } from './components/ThesisReportTab';
import { ScriptUploaderModal } from './components/ScriptUploaderModal';
import { SupervisorAssistantDrawer } from './components/SupervisorAssistantDrawer';
import { KeyPoolModal } from './components/KeyPoolModal';
import { ProjectsLibraryModal } from './components/ProjectsLibraryModal';
import { CloudServerSettingsModal } from './components/CloudServerSettingsModal';
import { AuditReportModal } from './components/AuditReportModal';
import { MeshGenerativeTool } from './components/MeshGenerativeTool';
import { NewProjectModal } from './components/NewProjectModal';
import { MaterialsDatabaseModal } from './components/MaterialsDatabaseModal';
import { ParametricSweepTool } from './components/ParametricSweepTool';
import { PipelineTrackerModal } from './components/PipelineTrackerModal';
import { normalizeSolverResponse } from './utils/normalizedSolverResults';
import { defaultPresets } from './data/defaultPresets';



export type TabType = 'report' | 'contours' | 'mesh' | 'validation' | 'tables' | 'overview';

interface SimulationResults {
  temperature_matrix?: number[][];
  physics_type?: string;
  classified_type?: string;
  recommended_solver?: string;
  solver_engine?: string;
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

// Accepts only a genuine 2-D solver field: non-empty rows, a consistent column
// count, and at least one finite value. Anything else keeps the CAD placeholder.
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
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [isKeyPoolModalOpen, setIsKeyPoolModalOpen] = useState<boolean>(false);
  const [isProjectsLibraryOpen, setIsProjectsLibraryOpen] = useState<boolean>(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState<boolean>(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [isMeshGeneratorOpen, setIsMeshGeneratorOpen] = useState<boolean>(false);
  const [isPipelineTrackerOpen, setIsPipelineTrackerOpen] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [solverJobStatus, setSolverJobStatus] = useState<JobStatus>('idle');
  const [solverLogs, setSolverLogs] = useState<string[]>([]);
  const [solverProgress, setSolverProgress] = useState<number | null>(null);
  const [meshStudyRunning, setMeshStudyRunning] = useState<boolean>(false);
  const [meshStudyError, setMeshStudyError] = useState<string | null>(null);
  const [solverResidualSeries, setSolverResidualSeries] = useState<ResidualSeries[]>([]);
  const [simulationInputs, setSimulationInputs] = useState<SimulationInputs>(DEFAULT_SIMULATION_INPUTS);
  const [activeStep, setActiveStep] = useState<WorkflowStep>('geometry');
  const [documentOpen, setDocumentOpen] = useState<boolean>(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('logs');
  const [consoleIssues, setConsoleIssues] = useState<ConsoleIssue[]>([]);

  // Every run (and every cancel) bumps this id; a polling loop stops as soon as its own id is stale.
  const runIdRef = useRef(0);
  const issueIdRef = useRef(0);
  const isSolverRunning = solverJobStatus === 'queued' || solverJobStatus === 'running';

  // Builds a readable message from the unified FastAPI error shapes:
  // { success:false, code, error }, { detail: { code, error } } and { code:'INVALID_REQUEST', details:[...] }.
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

    // Validate the form before touching any state so malformed input never leaves a stale job status.
    const requestBody = buildSimulationRequest(simulationInputs);
    const simulationType = String(requestBody.simulation_type);
    const isDirect = requestBody.execution_mode === 'direct';

    setSolverJobStatus('queued');
    setSolverProgress(null);
    // A new run must not present a previous job's results while it executes.
    setResults(null);
    setSolverResidualSeries([]);
    setCurrentProject(project => project ? { ...project, simulationRun: undefined, normalizedSolverResult: undefined } : project);
    let latestLogs = [`[${new Date().toISOString()}] Submitting ${currentProject.field} simulation (${simulationType}, ${String(requestBody.execution_mode)})`];
    setSolverLogs(latestLogs);

    const submitResponse = await fetch('/api/run-simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const submitPayload = await readJson(submitResponse);
    assertActive();
    if (!submitResponse.ok || submitPayload?.success === false) {
      throw new Error(extractApiError(submitPayload, `Simulation request failed (${submitResponse.status})`));
    }

    let job: any;
    if (isDirect) {
      // Direct execution answers synchronously with { success, result } and has no task to poll.
      job = { status: 'COMPLETED', result: submitPayload?.result, logs: [] };
      latestLogs = [...latestLogs, `[${new Date().toISOString()}] Direct execution completed`];
      setSolverLogs(latestLogs);
    } else {
      const taskId = submitPayload?.task_id as string | undefined;
      if (!taskId) throw new Error('Simulation backend did not return a task_id');

      for (;;) {
        const statusResponse = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`);
        const statusPayload = await readJson(statusResponse);
        assertActive();
        if (!statusResponse.ok) {
          throw new Error(extractApiError(statusPayload, `Unable to read job ${taskId} (${statusResponse.status})`));
        }
        job = statusPayload;
        const jobStatus = String(job?.status ?? 'QUEUED').toUpperCase();
        setSolverJobStatus(
          jobStatus === 'RUNNING' ? 'running' :
          jobStatus === 'COMPLETED' ? 'completed' :
          jobStatus === 'FAILED' ? 'failed' :
          jobStatus === 'CANCELLED' ? 'cancelled' :
          'queued'
        );
        if (typeof job?.progress === 'number') setSolverProgress(job.progress);
        if (Array.isArray(job?.logs)) {
          latestLogs = job.logs.map(String);
          setSolverLogs(latestLogs);
        }
        if (jobStatus === 'COMPLETED') break;
        if (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') {
          // Print the backend's exact error string to the terminal before surfacing it.
          const backendError = typeof job?.error === 'string' && job.error.trim() !== '' ? job.error : undefined;
          if (backendError && !latestLogs.includes(backendError)) {
            latestLogs = [...latestLogs, backendError];
            setSolverLogs(latestLogs);
          }
          throw new Error(extractApiError(job, `Solver job ${jobStatus.toLowerCase()}`));
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        assertActive();
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
      taskId: optionalText(job?.task_id),
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

  const recordIssue = (message: string, severity: ConsoleIssue['severity'] = 'error') => {
    issueIdRef.current += 1;
    const issue: ConsoleIssue = {
      id: issueIdRef.current,
      time: new Date().toLocaleTimeString([], { hour12: false }),
      severity,
      message,
    };
    setConsoleIssues(previous => [...previous, issue]);
  };

  // Shared entry point for the header button and the legacy solver workbench: tracks UI state and re-throws.
  const runSimulation = async (): Promise<unknown> => {
    if (isSolverRunning) return undefined;
    setConsoleTab('logs');
    try {
      const payload = await handleRunSimulation();
      setActiveStep('post');
      return payload;
    } catch (error) {
      if (error instanceof SimulationCancelledError) throw error;
      const message = error instanceof Error ? error.message : 'Solver execution failed';
      setSolverJobStatus('failed');
      setSolverLogs(previous => [...previous, `[${new Date().toISOString()}] ERROR: ${message}`]);
      recordIssue(message);
      setConsoleTab('errors');
      throw error;
    }
  };

  const cancelSimulation = () => {
    if (!isSolverRunning) return;
    runIdRef.current += 1;
    setSolverJobStatus('cancelled');
    setSolverLogs(previous => [...previous, `[${new Date().toISOString()}] Polling stopped: simulation cancelled by user`]);
    recordIssue('Simulation cancelled by user. The backend job may still finish; its result is ignored.', 'warning');
  };

  // Run a real mesh-independence study: the backend solves on three meshes and returns the GCI of a key result.
  const runMeshStudy = async (keyResultId: string): Promise<void> => {
    if (!currentProject || meshStudyRunning) return;
    const studiedProjectId = currentProject.id;
    setMeshStudyRunning(true);
    setMeshStudyError(null);
    setConsoleTab('logs');
    setSolverLogs(previous => [...previous, `[${new Date().toISOString()}] Starting mesh independence study (${keyResultId}, 3 grid levels)`]);
    try {
      const requestBody = { ...buildSimulationRequest(simulationInputs), key_result: keyResultId };
      const response = await fetch('/api/mesh-study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const payload = await readJson(response);
      if (!response.ok || payload?.success === false) {
        throw new Error(extractApiError(payload, `Mesh study failed (${response.status})`));
      }
      if (!isCurrentMeshStudy(payload?.study)) {
        throw new Error('The mesh study backend returned an unrecognised response (expected schema version 2).');
      }
      const study = payload.study;
      const meshStudyResult: MeshStudyResult = { ...study, recordedAt: new Date().toISOString() };
      // The study may outlive the project it was started from; never attach it to a different one.
      setCurrentProject(project => (project && project.id === studiedProjectId ? { ...project, meshStudyResult } : project));
      const outcome = study.gci_fine_percent !== null
        ? `GCI (fine) = ${study.gci_fine_percent}%`
        : `no GCI (${study.convergence_type})`;
      setSolverLogs(previous => [
        ...previous,
        `[${new Date().toISOString()}] Mesh study complete: ${study.key_result.label}, ${study.convergence_type}, ${outcome}` +
          (study.observed_order !== null ? `, observed order p = ${study.observed_order}` : ''),
      ]);
      setSaveToast(`Mesh independence study complete — ${outcome}`);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mesh study failed';
      setMeshStudyError(message);
      setSolverLogs(previous => [...previous, `[${new Date().toISOString()}] ERROR: ${message}`]);
      recordIssue(message);
      setConsoleTab('errors');
    } finally {
      setMeshStudyRunning(false);
    }
  };

  const setReferenceData = (referenceData: ReferenceDataSet | undefined) => {
    setCurrentProject(project => (project ? { ...project, referenceData } : project));
  };

  const setValidationProfile = (validationProfile: ProfileSpec) => {
    setCurrentProject(project => (project ? { ...project, validationProfile } : project));
  };

  // Stop any active polling loop when the app unmounts.
  useEffect(() => () => { runIdRef.current += 1; }, []);

  useEffect(() => {
    // Switching projects invalidates any in-flight polling loop and every solver
    // artifact of the previous project; the viewport falls back to the CAD model.
    runIdRef.current += 1;
    setDocumentOpen(false);
    setActiveStep('geometry');
    setResults(null);
    setSolverResidualSeries([]);
    setSolverLogs([]);
    setSolverProgress(null);
    setSolverJobStatus('idle');
    setMeshStudyError(null);
    setSimulationInputs(previous => ({ ...previous, simulationType: defaultSimulationTypeForField(currentProject?.field) }));
  }, [currentProject?.id]);

  // Cloud 400GB & ANSYS License Server Configuration
  const [cloudConfig, setCloudConfig] = useState<CloudServerConfig>(() => {
    try {
      const saved = localStorage.getItem('workbench_cloud_config');
      return saved
        ? JSON.parse(saved)
        : {
            backendUrl: 'http://127.0.0.1:8001',
            workingDirectory: '/data/ansys_workspace',
            parallelCores: 8,
            storageCapacityGb: 400,
            solverBackend: 'scipy_deterministic',
            licenseServerHost: '127.0.0.1',
            licenseFlexNetPort: 1055,
            licenseAnsysLiPort: 2325,
            licenseType: 'academic',
            autoFallbackToOpenSource: true,
            status: 'unconfigured',
          };
    } catch {
      return {
        backendUrl: 'http://127.0.0.1:8001',
        workingDirectory: '/data/ansys_workspace',
        parallelCores: 8,
        storageCapacityGb: 400,
        solverBackend: 'scipy_deterministic',
        licenseServerHost: '127.0.0.1',
        licenseFlexNetPort: 1055,
        licenseAnsysLiPort: 2325,
        licenseType: 'academic',
        autoFallbackToOpenSource: true,
        status: 'unconfigured',
      };
    }
  });

  // Custom User Projects persistent in localStorage with integrity sanitation
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

  // Persistent API Keys Pool & Engine Mode
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem('workbench_api_keys');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [engineMode, setEngineMode] = useState<EngineMode>(() => {
    try {
      const saved = localStorage.getItem('workbench_engine_mode');
      return (saved as EngineMode) || 'hybrid';
    } catch {
      return 'hybrid';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('workbench_api_keys', JSON.stringify(apiKeys));
    } catch (e) {
      console.error('Error saving keys:', e);
    }
  }, [apiKeys]);

  useEffect(() => {
    try {
      localStorage.setItem('workbench_cloud_config', JSON.stringify(cloudConfig));
      // Sync with server backend
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
    
    // Clear state
    setCustomProjects([]);
    setCurrentProject(null);
    setApiKeys([]);
    setEngineMode('hybrid');
    
    // Reload to ensure all components reset to pristine state
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
    setSaveToast(`تم تطبيق مادة (${mat.name}) على المشروع النشط بنجاح!`);
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
  }) => {
    if (!currentProject) return;
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
        recommendation: `${applied.description} - تم التحقق من استقرار معادلات Navier-Stokes وجودة التعامد وفق معايير تقارب روتش (Roache GCI).`,
        meshLevels: updatedLevels,
      },
    };
    setCurrentProject(updatedProj);
    setSaveToast(`تم اعتماد الشبكة الحسابية الجديدة (${applied.elementCount} عنصر) وتحديث مشروع المحاكاة بنجاح`);
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
    }));
    setSaveToast(`تم استيراد النموذج الهندسي ${stats.name} (${stats.triangles.toLocaleString()} مثلث/وجه) وتحديث أبعاد النطاق.`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleBoundaryAdded = (marker: BoundaryMarker) => {
    if (!currentProject) return;
    const bcType =
      marker.type === 'Inlet'
        ? 'Velocity Inlet'
        : marker.type === 'Outlet'
        ? 'Pressure Outlet'
        : 'No-slip Wall';
    const bcValue = marker.type === 'Inlet' ? simulationInputs.velocity : '0.0';
    const bcUnit = marker.type === 'Inlet' ? 'm/s' : 'Pa (gauge)';
    const newBc: BoundaryCondition = {
      name: `${marker.type} Face [${marker.point.map((p) => p.toFixed(1)).join(', ')}]`,
      type: bcType,
      value: bcValue,
      unit: bcUnit,
      description: `Normal n=(${marker.normal.map((n) => n.toFixed(2)).join(', ')})`,
    };
    const updated: ThesisProject = {
      ...currentProject,
      boundaryConditions: [...(currentProject.boundaryConditions || []), newBc],
    };
    setCurrentProject(updated);
    setSaveToast(`تم تعيين شرط حدي سطحي (${newBc.name}) وإضافته إلى شجرة المحاكاة.`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  const openDocument = (doc: PanelDocument) => {
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
    if (step === 'copilot') {
      setIsAssistantOpen(true);
    }
    setDocumentOpen(false);
  };

  const showToast = (message: string, duration = 3000) => {
    setSaveToast(message);
    setTimeout(() => setSaveToast(null), duration);
  };

  const hasProject = currentProject !== null;
  const hasCompletedRun = hasRealSimulationRun(currentProject);

  // Reports contain real solver output only; failures surface in the console instead of a silent no-op.
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
      { id: 'setup', label: 'Solver Setup', icon: <Cpu className="h-3.5 w-3.5" />, onClick: () => openDocument('overview') },
      { id: 'materials', label: 'Materials Database', icon: <Database className="h-3.5 w-3.5" />, onClick: () => setIsMaterialsModalOpen(true) },
      { id: 'sweep', label: 'Parametric Sweep', icon: <Sliders className="h-3.5 w-3.5" />, onClick: () => setIsParametricSweepOpen(true) },
    ],
    copilot: [
      { id: 'consultant', label: 'Open OmniSolve AI', icon: <Sparkles className="h-3.5 w-3.5" />, onClick: () => setIsAssistantOpen(true) },
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
        { id: 'mesh', label: 'Mesh Generator', icon: <Grid3X3 className="h-3.5 w-3.5" />, onClick: () => setIsMeshGeneratorOpen(true), title: 'مولد الشبيكات وتدقيق جودة التعامد' },
        { id: 'pipeline', label: 'Pipeline & Container Tracker (DHL/FedEx Map)', icon: <Truck className="h-3.5 w-3.5" />, onClick: () => setIsPipelineTrackerOpen(true), title: 'خريطة تتبع سريان الحسابات والحاويات الحسابية' },
        { id: 'materials', label: 'Materials Database', icon: <Database className="h-3.5 w-3.5" />, onClick: () => setIsMaterialsModalOpen(true), disabled: !hasProject, title: hasProject ? 'فتح مكتبة المواد المعيارية' : 'يتطلب فتح أو اختيار مشروع لتخصيص خواص المواد' },
        { id: 'sweep', label: 'Parametric Sweep', icon: <Sliders className="h-3.5 w-3.5" />, onClick: () => setIsParametricSweepOpen(true), disabled: !hasProject, title: hasProject ? 'مسح المتغيرات وحساب سطوح الاستجابة' : 'يتطلب فتح مشروع لتحديد متغيرات المسح' },
        { id: 'assistant', label: 'OmniSolve AI (Copilot)', icon: <Sparkles className="h-3.5 w-3.5" />, onClick: () => setIsAssistantOpen(true), disabled: !hasProject, title: hasProject ? 'فتح مستشار المحاكاة والتحليل الفيزيائي' : 'يتطلب فتح مشروع لمناقشة الحالة' },
      ],
    },
    {
      id: 'export',
      label: 'Export',
      items: [
        { id: 'word', label: 'Word Document', icon: <FileText className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToWordDocument(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير أطروحة Word كاملة بالرسوم والكونتورات' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل من المكتبة لتوليد التقرير' },
        { id: 'html', label: 'Report HTML', icon: <Globe className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToJournalHTML(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير ورقة بحثية لمجلة عالمية (Journal HTML)' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل' },
        { id: 'latex', label: 'LaTeX', icon: <FileCode className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToLatex(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير شفرة LaTeX للأطروحة' : 'يتطلب تنفيذ المحاكاة أو اختيار دراسة مكتملة الحل' },
        { id: 'csv', label: 'CSV Data', icon: <FileSpreadsheet className="h-3.5 w-3.5" />, onClick: () => runExport(() => currentProject && exportToCSV(currentProject)), disabled: !hasCompletedRun, title: hasCompletedRun ? 'تصدير مصفوفات البيانات والنتائج (.csv)' : 'يتطلب توفر نتائج محاكاة لتصدير البيانات' },
        { id: 'print', label: 'Print Report', icon: <Printer className="h-3.5 w-3.5" />, onClick: handlePrint, disabled: !hasCompletedRun, title: hasCompletedRun ? 'طباعة التقرير الهندسي الشامل' : 'يتطلب توفر نتائج المحاكاة لطباعة التقرير' },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        { id: 'keys', label: 'API Keys & Engine Mode', icon: <Key className="h-3.5 w-3.5" />, onClick: () => setIsKeyPoolModalOpen(true), title: 'إدارة مفاتيح وأنماط المحرك' },
        { id: 'cloud', label: 'Cloud Server & Licensing', icon: <Cloud className="h-3.5 w-3.5" />, onClick: () => setIsCloudModalOpen(true), title: 'إعدادات خوادم الحوسبة السحابية وعناقيد المعالجة' },
        { id: 'audit', label: 'Technical Audit Report', icon: <Shield className="h-3.5 w-3.5" />, onClick: () => setIsAuditModalOpen(true), title: 'شهادة الاعتماد والتدقيق الفني' },
        { id: 'deck', label: 'Executive Catalog & 4K Pitch Deck', icon: <Sparkles className="h-3.5 w-3.5 text-amber-400" />, onClick: () => { const a = document.createElement('a'); a.href = '/naseer_cae_master_catalog.html'; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); }, title: 'الكتالوج الاستثماري الرسمي وسلايدات العرض التفاعلية للشاشات الكبيرة' },
      ],
    },
  ];

  const documentTitles: Record<TabType, string> = {
    overview: 'Solver Setup Workbench',
    contours: 'Contours & Vectors',
    mesh: 'Mesh Study (GCI)',
    validation: 'Validation (ASME V&V 20)',
    tables: 'Data Tables',
    report: 'Certified Engineering Report',
  };

  const viewportTitles: Record<WorkflowStep, string> = {
    geometry: 'Geometry',
    mesh: 'Mesh preview',
    physics: 'Physics setup',
    copilot: 'OmniSolve AI (Copilot)',
    post: 'Results',
  };

  // The heatmap mounts only for a real solver-returned matrix; never a fallback.
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
        engineLabel={`Engine: ${engineMode === 'pure_local' ? 'Local' : engineMode === 'turbo_offline' ? 'Turbo offline' : 'Hybrid'} · ${apiKeys.filter((key) => key.status === 'active').length} keys`}
        menuGroups={menuGroups}
        onRun={() => { runSimulation().catch(() => {}); }}
        onCancel={cancelSimulation}
        onHome={() => setCurrentProject(null)}
      />

      <div className="print-reset flex min-h-0 flex-1">
        <SimulationTree
          activeStep={activeStep}
          hasProject={hasProject}
          jobStatus={solverJobStatus}
          actions={stepActions}
          onSelectStep={selectStep}
        />

        <main className="print-reset flex min-w-0 flex-1 flex-col">
        {!currentProject ? (
          <div dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-slate-950 px-6 py-6">
          <CleanWorkspaceHome
            onStartProject={handleStartProject}
            apiKeys={apiKeys}
            engineMode={engineMode}
            onOpenKeyPool={() => setIsKeyPoolModalOpen(true)}
            onOpenNewProjectWizard={() => setIsNewProjectModalOpen(true)}
            onOpenProjectsLibrary={() => setIsProjectsLibraryOpen(true)}
            onOpenCloudSettings={() => setIsCloudModalOpen(true)}
            onOpenAuditModal={() => setIsAuditModalOpen(true)}
            onOpenMeshGenerator={() => setIsMeshGeneratorOpen(true)}
            onOpenMaterialsModal={() => setIsMaterialsModalOpen(true)}
            onOpenParametricSweep={() => setIsParametricSweepOpen(true)}
            onOpenPipelineTracker={() => setIsPipelineTrackerOpen(true)}
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
              onCadLoaded={handleCadLoaded}
              onBoundaryAdded={handleBoundaryAdded}
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
          actions={{
            importModel: () => setIsUploadModalOpen(true),
            openMeshGenerator: () => setIsMeshGeneratorOpen(true),
            openMaterials: () => setIsMaterialsModalOpen(true),
            openParametricSweep: () => setIsParametricSweepOpen(true),
            openAssistant: () => setIsAssistantOpen(true),
            openDocument,
            print: handlePrint,
          }}
        />
      </div>

      {/* Universal Multi-Format Ingestion Modal */}
      <ScriptUploaderModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onAnalysisComplete={handleStartProject}
        apiKeys={apiKeys}
        engineMode={engineMode}
      />

      {/* Senior Simulation Consultant Drawer */}
      {currentProject && (
        <SupervisorAssistantDrawer
          isOpen={isAssistantOpen}
          onClose={() => setIsAssistantOpen(false)}
          project={currentProject}
          apiKeys={apiKeys}
          engineMode={engineMode}
        />
      )}

      {/* Multi-Key Pool & Engine Console Modal */}
      <KeyPoolModal
        isOpen={isKeyPoolModalOpen}
        onClose={() => setIsKeyPoolModalOpen(false)}
        apiKeys={apiKeys}
        onUpdateKeys={setApiKeys}
        engineMode={engineMode}
        onUpdateEngineMode={setEngineMode}
      />

      {/* 400GB Cloud Server & OpenFOAM / CalculiX HPC Cluster Configuration Modal */}
      <CloudServerSettingsModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        config={cloudConfig}
        onSaveConfig={(newConfig) => {
          setCloudConfig(newConfig);
          setSaveToast('تم حفظ إعدادات الخادم السحابي والترخيص بنجاح');
          setTimeout(() => setSaveToast(null), 3000);
        }}
      />


      {/* Dedicated Projects Hub & Recall Window */}
      <ProjectsLibraryModal
        isOpen={isProjectsLibraryOpen}
        onClose={() => setIsProjectsLibraryOpen(false)}
        projects={allAvailableProjects}
        currentProjectId={currentProject?.id}
        onSelectProject={(proj) => {
          setCurrentProject(proj);
          setActiveTab('overview');
        }}
        onStartBlankProject={() => setCurrentProject(null)}
        onOpenNewProjectWizard={() => setIsNewProjectModalOpen(true)}
        onDeleteProject={handleDeleteCustomProject}
        onClearCustomProjects={handleFactoryReset}
        onImportProject={handleImportProject}
      />

      {/* New Project Wizard Modal */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreateProject={handleCreateNewProject}
        onOpenMeshGenerator={() => setIsMeshGeneratorOpen(true)}
      />

      {/* Technical Audit & 100% Completeness Report Modal */}
      <AuditReportModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
      />

      {/* Interactive Computational Mesh Generator & Orthogonal Quality Studio */}
      <MeshGenerativeTool
        isOpen={isMeshGeneratorOpen}
        onClose={() => setIsMeshGeneratorOpen(false)}
        currentProject={currentProject}
        onApplyMeshToStudy={handleApplyMeshToStudy}
      />

      {/* Standard Materials Database Modal */}
      <MaterialsDatabaseModal
        isOpen={isMaterialsModalOpen}
        onClose={() => setIsMaterialsModalOpen(false)}
        onSelectMaterial={handleSelectMaterialFromDatabase}
        currentMaterialName={currentProject?.material?.name}
      />

      {/* Parametric Sweep & Response Surface Analysis Tool */}
      <ParametricSweepTool
        isOpen={isParametricSweepOpen}
        onClose={() => setIsParametricSweepOpen(false)}
        currentProject={currentProject}
      />

      {/* DHL/FedEx Style Interactive Pipeline & Container Tracking Modal */}
      <PipelineTrackerModal
        isOpen={isPipelineTrackerOpen}
        onClose={() => setIsPipelineTrackerOpen(false)}
        jobId={currentProject?.simulationRun?.taskId || 'sim_1794155318309_soyqt'}
        field={currentProject?.field || 'CFD'}
        solverType={currentProject?.solver?.solverType || 'OpenFOAM v2406 (SIMPLE)'}
        solverJobStatus={solverJobStatus}
        solverProgress={solverProgress}
        solverLogs={solverLogs}
        onTriggerRun={() => { runSimulation().catch(() => {}); }}
      />

      {/* Floating Save Toast Notification */}
      {saveToast && (
        <div className="fixed bottom-6 left-6 z-50 bg-emerald-950 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs animate-in slide-in-from-bottom duration-300">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}
    </div>
  );
}
