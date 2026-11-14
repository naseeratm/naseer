import { ContourField, ThesisProject, IngestedFileItem, MaterialProperties } from '../types/thesis';

export type ColormapType = 'jet' | 'turbo' | 'viridis' | 'coolwarm' | 'inferno';

function interpolateRGB(c1: [number, number, number], c2: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.round(c1[0] + factor * (c2[0] - c1[0])),
    Math.round(c1[1] + factor * (c2[1] - c1[1])),
    Math.round(c1[2] + factor * (c2[2] - c1[2])),
  ];
}

function sampleColorStops(stops: { pos: number; rgb: [number, number, number] }[], t: number): [number, number, number] {
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (t >= s1.pos && t <= s2.pos) {
      const factor = (t - s1.pos) / (s2.pos - s1.pos);
      return interpolateRGB(s1.rgb, s2.rgb, factor);
    }
  }
  return stops[stops.length - 1].rgb;
}

export function getColorFromColormap(valNorm: number, colormap: ColormapType = 'jet'): [number, number, number] {
  const t = Math.max(0, Math.min(1, valNorm));

  if (colormap === 'jet') {
    return sampleColorStops([
      { pos: 0.0, rgb: [0, 0, 143] },
      { pos: 0.15, rgb: [0, 0, 255] },
      { pos: 0.35, rgb: [0, 255, 255] },
      { pos: 0.55, rgb: [0, 255, 0] },
      { pos: 0.75, rgb: [255, 255, 0] },
      { pos: 0.90, rgb: [255, 60, 0] },
      { pos: 1.0, rgb: [143, 0, 0] },
    ], t);
  }

  if (colormap === 'turbo') {
    return sampleColorStops([
      { pos: 0.0, rgb: [48, 18, 59] },
      { pos: 0.2, rgb: [70, 134, 251] },
      { pos: 0.4, rgb: [27, 229, 181] },
      { pos: 0.6, rgb: [164, 252, 60] },
      { pos: 0.8, rgb: [251, 155, 38] },
      { pos: 1.0, rgb: [122, 4, 3] },
    ], t);
  }

  if (colormap === 'viridis') {
    return sampleColorStops([
      { pos: 0.0, rgb: [68, 1, 84] },
      { pos: 0.25, rgb: [59, 82, 139] },
      { pos: 0.5, rgb: [33, 145, 140] },
      { pos: 0.75, rgb: [94, 201, 98] },
      { pos: 1.0, rgb: [253, 231, 37] },
    ], t);
  }

  if (colormap === 'coolwarm') {
    return sampleColorStops([
      { pos: 0.0, rgb: [59, 76, 192] },
      { pos: 0.5, rgb: [221, 221, 221] },
      { pos: 1.0, rgb: [180, 4, 38] },
    ], t);
  }

  return sampleColorStops([
    { pos: 0.0, rgb: [0, 0, 4] },
    { pos: 0.25, rgb: [87, 16, 110] },
    { pos: 0.5, rgb: [187, 55, 84] },
    { pos: 0.75, rgb: [249, 142, 9] },
    { pos: 1.0, rgb: [252, 255, 164] },
  ], t);
}

// تم إلغاء توليد الحقول الرياضية الاصطناعية؛ تُعرض فقط المصفوفات الحقيقية القادمة من الخادم
export function generatePhysicalField2D(
  _contour: ContourField,
  nx: number = 60,
  ny: number = 30
): { grid: number[][]; minVal: number; maxVal: number } {
  const grid = Array.from({ length: ny }, () => Array(nx).fill(0));
  return { grid, minVal: 0, maxVal: 0 };
}

export function generateLocalEngineeringProject(
  filename: string,
  directives: string = '',
  detectedField: 'CFD' | 'FEA' | 'Thermal' | 'Multiphysics' = 'CFD',
  rawContent: string = '',
  attachedFiles: IngestedFileItem[] = []
): ThesisProject {
  const combinedContent = [rawContent, ...attachedFiles.map((f) => f.content || '')].filter(Boolean).join('\n\n');
  const field = detectedField || 'CFD';
  const isFEA = field === 'FEA';
  const isThermal = field === 'Thermal';

  const cleanName = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim() || 'New Engineering Case';
  const title =
    directives.trim().length > 5 && directives.trim().length < 80
      ? directives.trim()
      : isFEA
      ? `تحليل إنشائي بالعناصر المحدودة: ${cleanName}`
      : isThermal
      ? `تحليل انتقال الحرارة: ${cleanName}`
      : `محاكاة ديناميكا الموائع: ${cleanName}`;

  const titleEn = isFEA
    ? 'Finite Element Structural Analysis Project'
    : isThermal
    ? 'Thermal Conduction & Heat Transfer Project'
    : 'Computational Fluid Dynamics (CFD) Project';

  const solverName = isFEA
    ? 'CalculiX v2.21 (Spooles Direct FEA)'
    : isThermal
    ? 'OpenFOAM v2406 (chtMultiRegionSimpleFoam)'
    : 'OpenFOAM v2406 (simpleFoam)';

  const material: MaterialProperties = isFEA
    ? { name: 'Awaiting Material Selection', phaseOrType: 'Solid', density: '—' }
    : isThermal
    ? { name: 'Awaiting Material Selection', phaseOrType: 'Solid', density: '—' }
    : { name: 'Awaiting Fluid Selection', phaseOrType: 'Fluid', density: '—' };

  return {
    id: `eng_proj_${Date.now()}`,
    title,
    titleEn,
    author: 'Simulation Engineer',
    supervisor: 'Technical Review',
    university: 'NASEER Universal CAE Studio',
    department: isFEA ? 'Structural Mechanics' : isThermal ? 'Thermal Engineering' : 'Fluid Dynamics',
    date: new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
    field,
    softwareType: solverName,
    projectType: 'Industrial Simulation',
    standardsCompliance: ['ASME V&V 20-2009'],
    directivesApplied: directives || 'بانتظار إدخال المعاملات الفيزيائية وتشغيل المحاكاة',
    attachedFilesCount: attachedFiles.length,
    originalScriptContent: combinedContent || rawContent || undefined,
    workbenchComponents: [
      { id: 'wb_eng_data', name: 'بيانات المواد', nameEn: 'Engineering Data', type: 'Engineering Data', status: 'Ready', details: 'بانتظار تحديد خواص المادة' },
      { id: 'wb_geom', name: 'النموذج الهندسي', nameEn: 'CAD Geometry', type: 'Geometry', status: 'Ready', details: filename || 'بانتظار استيراد ملف CAD' },
      { id: 'wb_mesh', name: 'شبكة العناصر', nameEn: 'Computational Mesh', type: 'Mesh', status: 'Ready', details: 'بانتظار تحديد حجم الشبكة' },
      { id: 'wb_setup', name: 'الشروط الحدية', nameEn: 'Physics & Boundary Setup', type: 'Setup', status: 'Ready', details: 'بانتظار إدخال المدخلات الفيزيائية' },
      { id: 'wb_solu', name: 'المحلل العددي', nameEn: 'Solver Execution', type: 'Solution', status: 'Ready', details: `جاهز للتنفيذ عبر ${solverName}` },
      { id: 'wb_res', name: 'النتائج والتقارير', nameEn: 'Post-Processing Results', type: 'Results', status: 'Ready', details: 'لا توجد نتائج محاكاة منفذة بعد' },
    ],
    detectedCommandsList: [],
    abstractAr: `مشروع محاكاة هندسية جديد (${cleanName}). لم يتم تنفيذ المحاكاة العددية بعد؛ يرجى استكمال المدخلات الفيزيائية في اللوحة الجانبية والضغط على تشغيل المحاكاة.`,
    abstractEn: `New engineering simulation workspace (${cleanName}). Awaiting physical boundary inputs and real solver execution.`,
    governingEquations: isFEA
      ? [
          { name: 'معادلة التوازن الإنشائي', latex: '\\nabla \\cdot \\boldsymbol{\\sigma} + \\mathbf{b} = 0', description: 'توازن الإجهادات الداخلية مع الأحمال الخارجية.' },
          { name: 'قانون هوك للمرونة', latex: '\\boldsymbol{\\sigma} = \\mathbf{C} : \\boldsymbol{\\varepsilon}', description: 'العلاقة الخطية بين الإجهاد والانفعال المرن.' },
        ]
      : isThermal
      ? [
          { name: 'قانون فورييه للتوصيل الحراري', latex: "\\mathbf{q}'' = -k \\nabla T", description: 'انتقال الحرارة بالتوصيل عبر الوسط.' },
          { name: 'معادلة حفظ الطاقة', latex: '\\nabla \\cdot (k \\nabla T) + \\dot{q} = \\rho c_p \\frac{\\partial T}{\\partial t}', description: 'توازن الطاقة الحرارية داخل النطاق.' },
        ]
      : [
          { name: 'معادلة الاستمرارية', latex: '\\nabla \\cdot (\\rho \\vec{V}) = 0', description: 'حفظ الكتلة في مجال الجريان.' },
          { name: 'معادلات نافييه-ستوكس', latex: '\\rho (\\vec{V} \\cdot \\nabla) \\vec{V} = -\\nabla p + \\mu \\nabla^2 \\vec{V}', description: 'حفظ كمية الحركة للمائع.' },
        ],
    boundaryConditions: [],
    material,
    contours: [],
    solver: {
      solverType: solverName,
      scheme: 'Standard Numerical Discretization',
      discretization: 'Second-Order',
      convergenceCriteria: '1e-6 (RMS)',
      iterations: 0,
    },
    meshStudy: {
      description: 'لم يتم تنفيذ دراسة استقلالية الشبكة (Mesh Independence Study) بعد.',
      minOrthogonalQuality: 0,
      maxSkewness: 0,
      maxAspectRatio: 0,
      averageEquisizeSkew: 0,
      recommendation: 'يرجى تشغيل دراسة الشبكة من تبويب Mesh Study لحساب مؤشر Roache GCI الفعلي.',
      meshLevels: [],
    },
    validation: {
      benchmarkSource: 'No reference dataset loaded',
      independentVarName: 'Parameter',
      independentVarUnit: '-',
      dependentVarName: 'Output',
      dependentVarUnit: '-',
      rSquared: 0,
      rmse: 0,
      meanAbsoluteErrorPercent: 0,
      scientificDiscussion: 'لم يتم تنفيذ المحاكاة أو تحميل بيانات مرجعية للتحقق بعد.',
      points: [],
    },
    thesisTables: [],
    supervisorDefensePoints: [],
    academicMeta: {
      studentName: 'Simulation Analyst',
      studentId: 'CAE-2026',
      supervisor: 'Engineering Review',
      university: 'NASEER Universal CAE Studio',
      department: field,
      academicYear: '2026',
      keywords: [field, 'OpenFOAM', 'CalculiX', 'ASME V&V 20'],
      platformVersion: 'Enterprise Clean',
      ansysVersion: 'OpenFOAM v2406 / CalculiX v2.21',
      pythonVersion: 'Python 3.12 (FastAPI + Celery)',
      modelRevision: 'Rev-1.0',
      researchQuestion: 'بانتظار تعريف هدف الدراسة الفيزيائية.',
      researchHypothesis: 'بانتظار تنفيذ المحاكاة الفعلية.',
    },
    activeSolverBadge: solverName,
    casesMatrix: [],
    verificationDossier: {
      theoryName: 'Awaiting Solver Verification',
      exactFormula: '-',
      analyticalValue: 0,
      simulatedValue: 0,
      unit: '-',
      relativeErrorPercent: 0,
      apparentOrderOfConvergenceP: 0,
      isVerified: false,
      residualsConvergence: [],
      energyBalanceErrorPercent: 0,
      scientificVerificationNote: 'لم يتم تنفيذ المحاكاة بعد.',
    },
    roacheGciDetails: {
      gridRefinementRatioR: 0,
      apparentOrderP: 0,
      gci12Percent: 0,
      gci23Percent: 0,
      safetyFactorFs: 1.25,
      asymptoticRangeRatio: 0,
      isGridIndependent: false,
      qualityMetrics: {
        minOrthogonalQuality: 0,
        maxSkewness: 0,
        maxAspectRatio: 0,
        qualityAssessment: 'بانتظار توليد الشبكة',
      },
    },
    jobsHistory: [],
    cadSpecs: {
      shell: filename || 'Awaiting CAD',
      coil: '—',
      fins: '—',
      pcm: '—',
      nano: '—',
      htf: '—',
      initial: '—',
    },
    literatureReview: [],
    quantitativeFindings: [],
  };
}