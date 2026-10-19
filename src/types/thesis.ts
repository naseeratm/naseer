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
  field: 'velocity' | 'pressure' | 'temperature' | 'turbulent_ke' | 'stress' | 'deformation';
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
  // Professional CAE attributes
  projectType?: 'Industrial Simulation' | 'R&D Verification' | 'Certified CAE Report' | 'Failure Analysis';
  standardsCompliance?: string[];
  directivesApplied?: string;
  attachedFilesCount?: number;
  extractedSummary?: string;
  fileSummary?: string;
  ingestedFilesInfo?: { name: string; category: string; summary: string }[];
  scriptExecutionLog?: string[];
  residualsHistory?: { iteration: number; continuity: number; xVelocity: number; yVelocity: number; energy: number }[];
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
