export interface BoundaryCondition {
  name: string;
  type: string; // e.g. Velocity Inlet, Pressure Outlet, No-slip Wall, Fixed Support, Pressure Load
  value: string;
  unit: string;
  description: string;
}

export interface MaterialProperties {
  name: string;
  phaseOrType: 'Fluid' | 'Solid' | 'Gas' | 'Composite';
  density: string; // e.g. "998.2 kg/m³" or "7850 kg/m³"
  viscosity?: string; // e.g. "0.001003 Pa·s"
  thermalConductivity?: string; // e.g. "0.6 W/(m·K)"
  specificHeat?: string; // e.g. "4182 J/(kg·K)"
  elasticModulus?: string; // e.g. "200 GPa"
  poissonRatio?: string; // e.g. "0.3"
  yieldStrength?: string; // e.g. "250 MPa"
}

export interface SolverSettings {
  solverType: string; // e.g. Pressure-Based, Density-Based, Static Structural
  scheme: string; // e.g. SIMPLE, Coupled, Direct Sparse
  discretization: string; // e.g. Second Order Upwind, QUICK
  convergenceCriteria: string; // e.g. 10^-6 residuals
  iterations: number;
}

export interface MeshLevel {
  levelName: string; // Coarse, Medium, Fine, Extra-Fine
  elements: number;
  nodes: number;
  gridSpacingMm: number;
  keyResultValue: number; // e.g. Nu or Max Stress
  percentageError: number;
  gciPercent: number; // Roache GCI
  computationTimeSec: number;
}

export interface MeshStudyData {
  description: string;
  minOrthogonalQuality: number;
  maxSkewness: number;
  maxAspectRatio: number;
  averageEquisizeSkew: number;
  meshLevels: MeshLevel[];
  recommendation: string;
}

export interface ValidationPoint {
  independentVar: number; // e.g. Re or Angle or Load
  independentLabel: string;
  experimentalVal: number;
  numericalCfdVal: number;
  empiricalVal: number;
  errorPercent: number;
}

export interface ValidationData {
  benchmarkSource: string;
  independentVarName: string;
  independentVarUnit: string;
  dependentVarName: string;
  dependentVarUnit: string;
  points: ValidationPoint[];
  rSquared: number;
  rmse: number;
  meanAbsoluteErrorPercent: number;
  scientificDiscussion: string;
}

export interface ContourPointOfInterest {
  label: string;
  xPercent: number; // 0 to 100
  yPercent: number; // 0 to 100
  value: number;
  note: string;
}

export interface ContourField {
  id: string;
  name: string;
  nameEn: string;
  field: 'velocity' | 'pressure' | 'temperature' | 'turbulent_ke' | 'stress' | 'deformation' | 'heat_flux' | 'gradient';
  unit: string;
  minVal: number;
  maxVal: number;
  physicalDescription: string;
  pointsOfInterest: ContourPointOfInterest[];
  distributionFormula?: string;
  gradientStyle: 'channel_flow' | 'airfoil_separation' | 'pressure_vessel' | 'solar_tube' | 'vortex';
}

export interface ThesisTable {
  tableName: string;
  tableNameEn: string;
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface SupervisorDefensePoint {
  question: string;
  answer: string;
  scientificJustification: string;
}

export interface AcademicMeta {
  studentName: string;
  studentId: string;
  supervisor: string;
  coSupervisor?: string;
  university: string;
  department: string;
  academicYear: string;
  keywords: string[];
  platformVersion: string;
  ansysVersion: string;
  pythonVersion: string;
  modelRevision: string;
  researchQuestion: string;
  researchHypothesis: string;
}

export interface CaseStudyItem {
  caseId: string; // Case-01, Case-02, ...
  name: string;
  nameAr: string;
  studyVariable: string;
  purpose: string;
  meshElements: number;
  meshNodes: number;
  solverEngine: 'ANSYS Mechanical APDL' | 'Python SciPy Benchmark' | 'Fluent' | 'PyMAPDL';
  keyOutputName: string;
  keyOutputValue: number;
  keyOutputUnit: string;
  discrepancyPercent: number;
  runDurationSec: number;
  status: 'Baseline' | 'Converged' | 'Completed' | 'Pending';
}

export interface AnalyticalVerificationDossier {
  theoryName: string;
  exactFormula: string;
  analyticalValue: number;
  simulatedValue: number;
  unit: string;
  relativeErrorPercent: number;
  apparentOrderOfConvergenceP: number;
  isVerified: boolean;
  residualsConvergence: { equation: string; finalResidual: number; criterion: number; isConverged: boolean }[];
  energyBalanceErrorPercent: number;
  scientificVerificationNote: string;
}

export interface RoacheGciCalculation {
  gridRefinementRatioR: number; // e.g. 1.33
  apparentOrderP: number; // e.g. 1.94
  gci12Percent: number; // Fine to Medium (e.g. 1.12%)
  gci23Percent: number; // Medium to Coarse (e.g. 2.85%)
  safetyFactorFs: number; // 1.25 for 3+ grids
  asymptoticRangeRatio: number; // GCI23 / (r^p * GCI12) ~ 1.0
  isGridIndependent: boolean;
  qualityMetrics: {
    minOrthogonalQuality: number;
    maxSkewness: number;
    maxAspectRatio: number;
    qualityAssessment: string;
  };
}

export interface SimulationJobManifest {
  jobId: string;
  projectId: string;
  caseId: string;
  solver: 'ANSYS Mechanical APDL' | 'Python SciPy Benchmark' | 'Fluent' | 'PyMAPDL';
  solverVersion: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'diverged';
  startTime: string;
  endTime?: string;
  executionDurationSec: number;
  boundaryChecksum: string;
  outputChecksum: string;
  logLines: string[];
  logs?: string[];
  artifacts?: Array<Record<string, unknown>>;
  errorCode?: string;
  resultsSummary?: string;
}

export interface NormalizedSolverResult {
  status: 'success';
  physics: 'CFD' | 'FEA' | 'Thermal' | string;
  solver: string;
  simulationType?: string;
  processTimeMs?: number;
  converged?: boolean;
  values: Record<string, number>;
  fields: Record<string, unknown>;
  residuals: { iteration: number; residual: number }[];
  // Named residual streams exactly as reported by the solver backend (e.g. OpenFOAM p/Ux/Uy/h).
  residualSeries?: { name: string; points: { iteration: number; value: number }[] }[];
  temperatureMatrix?: number[][];
  stressMatrix?: number[][];
  velocityMatrix?: number[][];
  displacementMatrix?: number[][];
  logs: string[];
}

// The verbatim record of one completed backend execution. Every exported report is built from this
// record only, so it must hold exactly what the API returned (no derived or invented values).
export interface SimulationRunRecord {
  // GET /api/jobs/{task_id}.task_id; absent for synchronous `direct` executions.
  taskId?: string;
  executionMode: 'celery' | 'direct';
  // Body POSTed to /api/run-simulation (temperatures in the unit the user typed).
  submittedRequest: Record<string, unknown>;
  // Payload persisted by the backend job (GET /api/jobs/{task_id}.payload); celery mode only.
  backendPayload?: Record<string, unknown>;
  // The solver result envelope exactly as returned by the backend.
  result: Record<string, unknown>;
  logs: string[];
  progress?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  // Client clock time at which the completed result was received.
  recordedAt: string;
}

// --- Verification & Validation (real, computed from backend runs) -----------------------------

// One physics-specific scalar the mesh study can compare across grids (GET /api/mesh-study/key-results).
export interface MeshStudyKeyResult {
  id: string;
  label: string;
  unit: string;
  description: string;
  // Why the GCI of this quantity may be unreliable (e.g. singular peak stresses); shown next to the verdict.
  caveat: string | null;
  default: boolean;
}

export interface MeshStudyLevel {
  level: 'coarse' | 'medium' | 'fine';
  // Nominal size for thermal/CFD; structural models are refined through divisions instead.
  mesh_size: number | null;
  divisions: { x: number; y: number; z: number } | null;
  // Cells (elements) that govern accuracy; the refinement ratio is computed from these counts.
  cells: number;
  nodes: number | null;
  // Cell size relative to the finest level (fine = 1), derived from the cell counts.
  relative_size: number | null;
  key_result: number;
}

export type ConvergenceType = 'monotonic' | 'oscillatory' | 'divergent' | 'converged' | 'indeterminate';

// Grid Convergence Index study (Celik et al. 2008) returned by POST /api/mesh-study.
export interface MeshStudyResult {
  schema_version: 2;
  physics_type: string;
  solver: string | null;
  key_result: MeshStudyKeyResult;
  levels: MeshStudyLevel[];
  // Present when relative errors were formed on a shifted scale (temperature in K).
  basis_note: string | null;
  // The solver payload the three levels were derived from.
  parameters: Record<string, unknown>;
  dimension: number;
  r21: number | null;
  r32: number | null;
  convergence_type: ConvergenceType | null;
  observed_order: number | null;
  extrapolated_value: number | null;
  extrapolated_error_percent: number | null;
  gci_fine_percent: number | null;
  gci_medium_percent: number | null;
  asymptotic_ratio: number | null;
  // Absolute uncertainty of the fine-grid value, in the unit of the key result.
  uncertainty_fine: number | null;
  // null when the convergence type does not allow a verdict.
  grid_independent: boolean | null;
  safety_factor: number;
  gci_threshold_percent: number;
  warnings: string[];
  // Client clock time when the study completed.
  recordedAt: string;
}

// Studies saved by an earlier version have a different shape and must not be rendered.
export const isCurrentMeshStudy = (value: unknown): value is MeshStudyResult =>
  typeof value === 'object' && value !== null && (value as { schema_version?: unknown }).schema_version === 2;

// A single user-ingested reference point (experimental / base-paper).
export interface ReferencePoint {
  x: number;
  y: number;
}

// User-supplied reference data for validation overlay.
export interface ReferenceDataSet {
  label: string;
  xLabel: string;
  yLabel: string;
  points: ReferencePoint[];
  recordedAt: string;
}

export type ProfileKind = 'horizontal' | 'vertical' | 'diagonal' | 'line';

// Where on a 2-D result field the simulation profile is cut for comparison with reference data.
export interface ProfileSpec {
  kind: ProfileKind;
  // Which returned field to cut, e.g. 'temperature_matrix'.
  fieldKey: string;
  // Coordinate system of the numbers below: meters, or fractions (0-1) of the domain size.
  units: 'm' | 'fraction';
  // horizontal: y of the cut line; vertical: x of the cut line.
  position: number;
  // 'line' only: cut-line end points.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // When true the reference X values are s/L (0-1 along the cut) instead of physical coordinates.
  normalizeAbscissa: boolean;
}

export interface EngineeringAudit {
  auditId: string;
  timestamp: string;
  version: string;
  reviewer: string;
  complianceChecks: { check: string; status: 'Pass' | 'Fail' | 'Not Applicable'; comment?: string }[];
  parameterConsistency: boolean;
  numericalStability: boolean;
  verificationSource: string;
  engineeringSignature: string;
}

export interface ThesisProject {
  id: string;
  title: string;
  titleEn: string;
  author: string; // مهندس التحليل والمحاكاة
  supervisor: string; // الجهة الاستشارية / المعتمدة
  university: string; // المنشأة الهندسية أو المنصة
  department: string;
  date: string;
  field: 'CFD' | 'FEA' | 'Thermal' | 'Multiphysics';
  softwareType: string; // e.g. ANSYS Fluent 2024 R2, ANSYS APDL, ANSYS Mechanical
  abstractAr: string;
  abstractEn: string;
  governingEquations: {
    name: string;
    latex: string;
    description: string;
  }[];
  boundaryConditions: BoundaryCondition[];
  material: MaterialProperties;
  solver: SolverSettings;
  meshStudy: MeshStudyData;
  validation: ValidationData;
  contours: ContourField[];
  thesisTables: ThesisTable[];
  supervisorDefensePoints: SupervisorDefensePoint[];
  originalScriptContent?: string;

  // Rigorous Audit & Professional CAE attributes
  academicMeta?: AcademicMeta;
  casesMatrix?: CaseStudyItem[];
  verificationDossier?: AnalyticalVerificationDossier;
  roacheGciDetails?: RoacheGciCalculation;
  jobsHistory?: SimulationJobManifest[];
  activeSolverBadge?: 'ANSYS Mechanical APDL' | 'Python SciPy Benchmark';
  engineeringAudit?: EngineeringAudit; // NEW: Rigorous Audit Addition
  projectType?: 'Industrial Simulation' | 'R&D Verification' | 'Certified CAE Report' | 'Failure Analysis';
  standardsCompliance?: string[];
  directivesApplied?: string;
  attachedFilesCount?: number;
  extractedSummary?: string;
  fileSummary?: string;
  ingestedFilesInfo?: { name: string; category: string; summary: string }[];
  scriptExecutionLog?: string[];
  normalizedSolverResult?: NormalizedSolverResult;
  simulationRun?: SimulationRunRecord;
  meshStudyResult?: MeshStudyResult;
  referenceData?: ReferenceDataSet;
  validationProfile?: ProfileSpec;
  detectedCommandsList?: { command: string; description: string; status: 'executed' | 'converged' }[];
  workbenchComponents?: {
    id: string;
    name: string;
    nameEn: string;
    type: 'Engineering Data' | 'Geometry' | 'Mesh' | 'Setup' | 'Solution' | 'Results';
    status: 'Up-to-date' | 'Solved' | 'Ready';
    details: string;
  }[];
  // LHTES v3 Specific Academic & Physical Attributes
  studentId?: string;
  adviser?: string;
  meltingComparison?: {
    caseName: string;
    caseNameAr: string;
    t95Hours: number;
    color: string;
    badge?: string;
  }[];
  literatureReview?: {
    study: string;
    configuration: string;
    keyFinding: string;
    gap: string;
  }[];
  cadSpecs?: {
    shell: string;
    coil: string;
    fins: string;
    pcm: string;
    nano: string;
    htf: string;
    initial: string;
  };
  quantitativeFindings?: {
    id: number;
    title: string;
    value: string;
    description: string;
  }[];
  lastModified?: string;
  isCustom?: boolean;
}

export type EngineeringProject = ThesisProject;
export type EngineeringTable = ThesisTable;
export type TechnicalVerificationPoint = SupervisorDefensePoint;

// Multi-Key Pool & Simulation Engine Types
export type EngineMode = 'hybrid' | 'pure_local' | 'turbo_offline';

export interface ApiKeyItem {
  id: string;
  key: string;
  label: string;
  status: 'active' | 'exhausted' | 'cooling' | 'testing';
  lastUsed?: number;
  errorCount?: number;
  requestsCount?: number;
}

export interface IngestedFileItem {
  id: string;
  name: string;
  size: number;
  extension: string;
  mimeType?: string;
  category?: 'word' | 'excel' | 'image' | 'code' | 'pdf' | 'text' | 'archive';
  content?: string;
  base64Data?: string;
  isImage?: boolean;
  isArchive?: boolean;
  parentArchiveName?: string;
  archiveFilesCount?: number;
  archiveTree?: { path: string; size: number; category: string }[];
  parsedLines?: number;
  sheetCount?: number;
  sheetsData?: { sheetName: string; rows: number; columns: number; preview: (string | number)[][] }[];
  summary?: string;
  detectedParameters?: { key: string; value: string; unit?: string }[];
  detectedDomain?: 'AI/ML' | 'CFD' | 'FEA' | 'Thermal' | 'Control' | 'Multiphysics' | 'Data';
  compactedContent?: string;
  tokenSavingsPercent?: number;
  estimatedTokensSaved?: number;
  status: 'ready' | 'parsed' | 'error';
  errorMessage?: string;
}

export interface EngineeringDirective {
  boundaryConstraints?: string;
  targetAccuracy?: string;
  customEquations?: string;
  notes?: string;
  meshPreference?: 'structured' | 'unstructured' | 'polyhedral' | 'boundary_layer_inflation';
}

export interface CloudServerConfig {
  backendUrl: string;
  workingDirectory: string;
  parallelCores: number;
  storageCapacityGb: number;
  solverBackend: 'pymapdl' | 'pyfluent' | 'openfoam' | 'scipy_deterministic' | 'ansys_batch';
  licenseServerHost: string;
  licenseFlexNetPort: number;
  licenseAnsysLiPort: number;
  licenseType: 'academic' | 'commercial' | 'open_source_unlicensed';
  autoFallbackToOpenSource: boolean;
  lastTestedAt?: string;
  status: 'connected' | 'disconnected' | 'testing' | 'unconfigured';
}
