import { SimulationInputs } from '../types/studio';
import { ThesisProject } from '../types/thesis';

export interface VVBenchmarkTemplate {
  id: string;
  code: string;
  standardRef: string;
  engineLabel: string;
  formulaLatex: string;
  formulaSummaryAr: string;
  recommendedInputs: Partial<SimulationInputs>;
  project: ThesisProject;
}

const nowIso = () => new Date().toISOString();

// 1. ASME-VV20-CFD-01: Exact analytical Hagen-Poiseuille velocity profile:
// u(y/H) = 6 * U_avg * (y/H) * (1 - y/H)
// U_avg = 0.01 m/s, H = 0.1 m, rho = 1000 kg/m3, mu = 0.01 Pa.s -> Re_H = 100, U_max = 0.015 m/s
const POISEUILLE_POINTS = Array.from({ length: 11 }, (_, i) => {
  const eta = Number((i / 10).toFixed(2));
  const u = Number((6 * 0.01 * eta * (1 - eta)).toFixed(6));
  return { x: eta, y: u };
});

// 2. NASA-TMR-CFD-02: Turbulent channel reference velocity profile (Dean 1978 / 1/7th power law, Re_H ~ 20,300):
// U_avg = 1.5 m/s, U_max ~ 1.18 * U_avg = 1.77 m/s, u(eta) = U_max * (1 - |2*eta - 1|)^(1/7)
const TURBULENT_CHANNEL_POINTS = Array.from({ length: 11 }, (_, i) => {
  const eta = Number((i / 10).toFixed(2));
  const distFromCenter = Math.abs(2 * eta - 1);
  const wallFactor = Math.max(0, 1 - distFromCenter);
  const u = Number((1.18 * 1.5 * Math.pow(wallFactor, 1 / 7)).toFixed(5));
  return { x: eta, y: u };
});

// 3. ASME-VV20-THM-01: Exact 1D/2D steady heat conduction (Fourier's law, adiabatic top/bottom):
// T(x/Lx) = 100 - 80 * (x/Lx) [°C], T_center = 60 °C, q'' = 4000 W/m²
const CONDUCTION_POINTS = Array.from({ length: 11 }, (_, i) => {
  const xi = Number((i / 10).toFixed(2));
  const tempC = Number((100 - 80 * xi).toFixed(4));
  return { x: xi, y: tempC };
});

// 4. NAFEMS-FEA-01: Exact Euler-Bernoulli cantilever beam under uniform top load q = F/L = 10000 N/m:
// L = 1.0 m, h = 0.08 m, b = 0.05 m, E = 200 GPa -> I = b*h^3/12 = 2.1333333e-6 m^4
// |w(x)| = q * x^2 * (6 L^2 - 4 L x + x^2) / (24 E I), w_max = 0.00292969 m
const CANTILEVER_POINTS = Array.from({ length: 11 }, (_, i) => {
  const xi = Number((i / 10).toFixed(2));
  const L = 1.0;
  const h = 0.08;
  const b = 0.05;
  const E = 200e9;
  const q = 10000 / L;
  const I = (b * Math.pow(h, 3)) / 12;
  const x = xi * L;
  const w = (q * x * x * (6 * L * L - 4 * L * x + x * x)) / (24 * E * I);
  return { x: xi, y: Number(w.toFixed(8)) };
});

// 5. NAFEMS-FEA-02: Exact Euler-Bernoulli 1st cantilever bending eigenmode shape (normalized to 1.0 at tip):
// beta1*L = 1.87510407, f1 = 65.2304 Hz for L=1.0, h=b=0.08, E=200 GPa, rho=7850 kg/m3
const BETA1 = 1.875104068711961;
const SIGMA1 = (Math.cos(BETA1) + Math.cosh(BETA1)) / (Math.sin(BETA1) + Math.sinh(BETA1));
const modeShapeRaw = (xi: number) => {
  const bx = BETA1 * xi;
  return Math.cosh(bx) - Math.cos(bx) - SIGMA1 * (Math.sinh(bx) - Math.sin(bx));
};
const MODE1_TIP = modeShapeRaw(1.0);
const MODAL_MODE1_POINTS = Array.from({ length: 11 }, (_, i) => {
  const xi = Number((i / 10).toFixed(2));
  return { x: xi, y: Number((modeShapeRaw(xi) / MODE1_TIP).toFixed(5)) };
});

// 6. ASME-EM-01: Exact 1D Laplace electrostatic potential between parallel plates (100 V -> 0 V):
// phi(x/Lx) = 100 * (1 - x/Lx) [V], phi_avg = 50.0 V, |E| = 100 V/m
const ELECTROSTATIC_POINTS = Array.from({ length: 11 }, (_, i) => {
  const xi = Number((i / 10).toFixed(2));
  const phi = Number((100 * (1 - xi)).toFixed(4));
  return { x: xi, y: phi };
});

export const VV_BENCHMARK_TEMPLATES: VVBenchmarkTemplate[] = [
  {
    id: 'ASME-VV20-CFD-01',
    code: 'ASME-VV20-CFD-01',
    standardRef: 'ASME V&V 20-2009 · Analytical Hagen-Poiseuille Flow',
    engineLabel: 'OpenFOAM v2406 (simpleFoam)',
    formulaLatex: 'u(y) = 6 U_{\\text{avg}} \\frac{y}{H}\\left(1 - \\frac{y}{H}\\right), \\quad U_{\\max} = 0.015\\text{ m/s}',
    formulaSummaryAr:
      'جريان صفائحي مكتمل النمو داخل قناة (L=1.0m, H=0.1m, Re=100) مع مقارنة المقطع الرأسي للسرعة |U| عند x/L=0.85 بالحل التحليلي الدقيق.',
    recommendedInputs: {
      simulationType: 'CFD_Incompressible',
      executionMode: 'celery',
      widthX: '1.0',
      heightY: '0.1',
      depthZ: '0.02',
      meshSize: '0.008',
      velocity: '0.01',
      turbulenceModel: 'laminar',
      fluidDensity: '1000',
      dynamicViscosity: '0.01',
      temperature: '293.15',
      temperatureUnit: 'K',
      pressure: '0',
      timeMode: 'steady',
      solverIterations: '300',
      residualTarget: '1e-5',
      discretizationScheme: 'second_order',
    },
    project: {
      id: 'ASME-VV20-CFD-01',
      title: 'قالب التحقق القياسي: جريان هاغن-بوازوي الصفائحي (Hagen-Poiseuille)',
      titleEn: 'ASME-VV20-CFD-01: Laminar Hagen-Poiseuille Channel Flow (OpenFOAM)',
      author: 'NASEER V&V Suite',
      supervisor: 'ASME V&V 20-2009 Analytical Reference',
      university: 'Industrial CAE Verification Lab',
      department: 'CFD Verification',
      date: '2026',
      field: 'CFD',
      softwareType: 'OpenFOAM v2406 (Live Run Required)',
      abstractAr:
        'قالب تحقق فيزيائي بدون نتائج مسبقة متطابق مع معيار ASME-VV20-CFD-01 في شهادة التحقق الآلية. عند التشغيل يقوم OpenFOAM بحل القناة بالكامل وتقارن نافذة Validation المقطع الرأسي للسرعة |U| مع المعادلة التحليلية الدقيقة.',
      abstractEn:
        'Zero pre-baked results benchmark matching ASME-VV20-CFD-01 in the automated V&V certification suite. Clicking Run Simulation executes OpenFOAM live and compares the velocity profile against Hagen-Poiseuille theory.',
      governingEquations: [
        {
          name: 'Incompressible Steady Navier-Stokes',
          latex: '\\nabla \\cdot \\mathbf{u} = 0, \\quad (\\mathbf{u} \\cdot \\nabla)\\mathbf{u} = -\\frac{1}{\\rho}\\nabla p + \\nu \\nabla^2 \\mathbf{u}',
          description: 'Laminar steady incompressible momentum and continuity equations solved in OpenFOAM.',
        },
        {
          name: 'Hagen-Poiseuille Analytical Profile',
          latex: 'u(y) = 6 U_{\\text{avg}} \\frac{y}{H}\\left(1 - \\frac{y}{H}\\right)',
          description: 'Exact fully-developed parabolic velocity distribution between parallel no-slip plates (U_max = 0.015 m/s).',
        },
      ],
      boundaryConditions: [
        { name: 'Inlet (x = 0)', type: 'Velocity Inlet', value: '0.01', unit: 'm/s', description: 'Uniform laminar inlet velocity (Re_H = 100).' },
        { name: 'Outlet (x = 1.0 m)', type: 'Pressure Outlet', value: '0', unit: 'Pa', description: 'Zero relative static pressure outlet.' },
        { name: 'Top & Bottom Walls', type: 'No-slip Wall', value: '0', unit: 'm/s', description: 'Stationary no-slip parallel plates.' },
      ],
      material: {
        name: 'Reference Laminar Fluid (Re_H = 100)',
        phaseOrType: 'Fluid',
        density: '1000 kg/m³',
        viscosity: '0.01 Pa·s',
      },
      solver: {
        solverType: 'OpenFOAM Incompressible Laminar',
        scheme: 'SIMPLE',
        discretization: 'Second Order Upwind',
        convergenceCriteria: '1e-5',
        iterations: 300,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) after executing baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'ASME V&V 20-2009 Analytical Hagen-Poiseuille (U_max = 0.015 m/s, tol <= 5%)',
        independentVarName: 'y / H',
        independentVarUnit: '-',
        dependentVarName: 'Velocity |U|',
        dependentVarUnit: 'm/s',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live OpenFOAM execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'ASME-VV20-CFD-01 Analytical Hagen-Poiseuille (U_avg = 0.01 m/s)',
        xLabel: 'y / Ly',
        yLabel: 'Velocity magnitude |U| (m/s)',
        points: POISEUILLE_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'vertical',
        fieldKey: 'vtk_U_mag',
        units: 'fraction',
        position: 0.85,
        x0: 0.85,
        y0: 0,
        x1: 0.85,
        y1: 1,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
  {
    id: 'NASA-TMR-CFD-02',
    code: 'NASA-TMR-CFD-02',
    standardRef: 'NASA TMR (2DC) / Dean 1978 · Turbulent Channel Flow',
    engineLabel: 'OpenFOAM v2406 (simpleFoam + kOmegaSST)',
    formulaLatex: '1.05 \\le \\frac{U_{\\max}}{U_{\\text{avg}}} \\le 1.38 \\;(\\approx 1.18), \\quad \\tau_w > 0, \\; y^+ > 0',
    formulaSummaryAr:
      'جريان هوائي مضطرب داخل قناة (L=2.0m, H=0.2m, Re_H≈20,300) بنموذج k-omega SST مع فحص المقطع العرضي للسرعة وإجهاد القص الجداري و y+.',
    recommendedInputs: {
      simulationType: 'CFD_Incompressible',
      executionMode: 'celery',
      widthX: '2.0',
      heightY: '0.2',
      depthZ: '0.04',
      meshSize: '0.015',
      velocity: '1.5',
      turbulenceModel: 'kOmegaSST',
      fluidDensity: '1.225',
      dynamicViscosity: '0.0000181',
      temperature: '293.15',
      temperatureUnit: 'K',
      pressure: '0',
      timeMode: 'steady',
      solverIterations: '250',
      residualTarget: '1e-4',
      discretizationScheme: 'second_order',
    },
    project: {
      id: 'NASA-TMR-CFD-02',
      title: 'قالب التحقق القياسي: جريان القناة المضطرب (NASA TMR k-omega SST)',
      titleEn: 'NASA-TMR-CFD-02: Turbulent 2D Channel Flow (OpenFOAM kOmegaSST)',
      author: 'NASEER V&V Suite',
      supervisor: 'NASA Turbulence Modeling Resource (2DC)',
      university: 'Industrial CAE Verification Lab',
      department: 'CFD Turbulence Verification',
      date: '2026',
      field: 'CFD',
      softwareType: 'OpenFOAM v2406 (Live Run Required)',
      abstractAr:
        'قالب تحقق لاضطراب الموائع بدون نتائج مسبقة متطابق مع معيار NASA-TMR-CFD-02 في شهادة التحقق الآلية. يتحقق من تفلطح مقطع السرعة المضطرب (U_max/U_avg ≈ 1.18) وحساب إجهاد القص الجداري و y+.',
      abstractEn:
        'Zero pre-baked results RANS turbulence benchmark matching NASA-TMR-CFD-02. Executes OpenFOAM kOmegaSST live and validates the turbulent velocity profile, yPlus, and wallShearStress.',
      governingEquations: [
        {
          name: 'RANS Momentum + Menter k-omega SST',
          latex: '(\\bar{\\mathbf{u}} \\cdot \\nabla)\\bar{\\mathbf{u}} = -\\frac{1}{\\rho}\\nabla \\bar{p} + \\nabla \\cdot \\left[(\\nu + \\nu_t)\\nabla \\bar{\\mathbf{u}}\\right]',
          description: 'Steady RANS incompressible flow with Menter k-omega SST eddy viscosity closure.',
        },
        {
          name: 'Turbulent Peak-to-Bulk Ratio (Dean 1978)',
          latex: '\\frac{U_{\\max}}{U_{\\text{avg}}} \\approx 1.18 \\in [1.05, 1.38], \\quad Re_H \\approx 20{,}300',
          description: 'Canonical turbulent channel centerline ratio contrasted against laminar 1.50.',
        },
      ],
      boundaryConditions: [
        { name: 'Inlet (x = 0)', type: 'Velocity Inlet', value: '1.5', unit: 'm/s', description: 'Uniform air inlet velocity (Re_H ~ 20,300).' },
        { name: 'Outlet (x = 2.0 m)', type: 'Pressure Outlet', value: '0', unit: 'Pa', description: 'Zero gauge pressure outlet.' },
        { name: 'Top & Bottom Walls', type: 'No-slip Wall + Wall Functions', value: '0', unit: 'm/s', description: 'kqRWallFunction / omegaWallFunction / nutkWallFunction.' },
      ],
      material: {
        name: 'Air (20 °C, Standard Atmospheric)',
        phaseOrType: 'Fluid',
        density: '1.225 kg/m³',
        viscosity: '1.81e-5 Pa·s',
      },
      solver: {
        solverType: 'OpenFOAM RANS k-omega SST',
        scheme: 'SIMPLE',
        discretization: 'Second Order Upwind',
        convergenceCriteria: '1e-4',
        iterations: 250,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) and inspect y+ after executing baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'NASA TMR (2DC) / Dean 1978 Turbulent Channel Flow (U_max/U_avg ~ 1.18)',
        independentVarName: 'y / H',
        independentVarUnit: '-',
        dependentVarName: 'Velocity |U|',
        dependentVarUnit: 'm/s',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live OpenFOAM kOmegaSST execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'NASA-TMR-CFD-02 Reference Turbulent Profile (U_avg = 1.5 m/s)',
        xLabel: 'y / Ly',
        yLabel: 'Velocity magnitude |U| (m/s)',
        points: TURBULENT_CHANNEL_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'vertical',
        fieldKey: 'vtk_U_mag',
        units: 'fraction',
        position: 0.85,
        x0: 0.85,
        y0: 0,
        x1: 0.85,
        y1: 1,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
  {
    id: 'ASME-VV20-THM-01',
    code: 'ASME-VV20-THM-01',
    standardRef: 'ASME V&V 20 / NAFEMS T1 · Fourier Steady Conduction',
    engineLabel: 'CalculiX v2.21 (ccx *HEAT TRANSFER)',
    formulaLatex: 'T(x) = 100 - 80\\frac{x}{L_x}\\;[^\\circ\\text{C}], \\quad T_{\\text{center}} = 60.0^\\circ\\text{C}, \\; q^{\\prime\\prime} = 4000\\text{ W/m}^2',
    formulaSummaryAr:
      'انتقال حرارة بالتوصيل المستقر عبر صفيحة مربعة (100°C يساراً إلى 20°C يميناً، k=50 W/m·K) مع مقارنة خط المركز بالحل التحليلي لقانون فورييه.',
    recommendedInputs: {
      simulationType: 'Thermal_Steady',
      executionMode: 'celery',
      widthX: '1.0',
      heightY: '1.0',
      depthZ: '0.05',
      meshSize: '0.1',
      temperature: '293.15',
      temperatureUnit: 'K',
      thermalConductivity: '50',
      specificHeat: '460',
      density: '7850',
      bcLeft: '373.15',
      bcRight: '293.15',
      bcTop: '333.15',
      bcBottom: '333.15',
    },
    project: {
      id: 'ASME-VV20-THM-01',
      title: 'قالب التحقق القياسي: التوصيل الحراري المستقر (Fourier Plate)',
      titleEn: 'ASME-VV20-THM-01: Steady-State Heat Conduction Plate (CalculiX)',
      author: 'NASEER V&V Suite',
      supervisor: 'ASME V&V 20 / NAFEMS T1 Analytical Reference',
      university: 'Industrial CAE Verification Lab',
      department: 'Thermal Verification',
      date: '2026',
      field: 'Thermal',
      softwareType: 'CalculiX v2.21 (Live Run Required)',
      abstractAr:
        'قالب تحقق حراري بدون نتائج مسبقة متطابق مع معيار ASME-VV20-THM-01 في شهادة التحقق الآلية. عند التشغيل الحقيقي يقوم CalculiX بحل معادلة فورييه وتتحقق نافذة Validation من توزيع الحرارة والتدفق الحراري.',
      abstractEn:
        'Zero pre-baked results thermal verification template matching ASME-VV20-THM-01. Executes CalculiX *HEAT TRANSFER live and checks centerline temperature and heat flux against Fourier law.',
      governingEquations: [
        {
          name: 'Steady Heat Diffusion Equation',
          latex: '\\nabla \\cdot (k \\nabla T) = 0',
          description: 'Steady-state thermal conduction with constant isotropic conductivity k = 50 W/(m·K).',
        },
        {
          name: 'Exact Linear Profile',
          latex: 'T(x) = 100 - 80\\left(\\frac{x}{L_x}\\right)\\;[^\\circ\\text{C}], \\quad q^{\\prime\\prime} = 4000\\text{ W/m}^2',
          description: 'Analytical solution for T_left = 100 °C, T_right = 20 °C, adiabatic top/bottom.',
        },
      ],
      boundaryConditions: [
        { name: 'Left Face (x = 0)', type: 'Fixed Temperature', value: '373.15', unit: 'K', description: 'Hot boundary at 100 °C (373.15 K).' },
        { name: 'Right Face (x = 1.0 m)', type: 'Fixed Temperature', value: '293.15', unit: 'K', description: 'Cold boundary at 20 °C (293.15 K).' },
        { name: 'Top & Bottom Faces', type: 'Adiabatic Wall', value: '0', unit: 'W/m²', description: 'Insulated boundaries (zero normal heat flux).' },
      ],
      material: {
        name: 'Carbon Steel Plate (k = 50 W/m·K)',
        phaseOrType: 'Solid',
        density: '7850 kg/m³',
        thermalConductivity: '50 W/(m·K)',
        specificHeat: '460 J/(kg·K)',
      },
      solver: {
        solverType: 'CalculiX Steady Heat Transfer',
        scheme: 'Direct Sparse (Spooles)',
        discretization: 'Finite Element DC3D8',
        convergenceCriteria: '1e-8',
        iterations: 100,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) after executing baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'ASME V&V 20 / NAFEMS T1 Exact Fourier Solution (T_center = 60.0 °C, tol <= 0.5%)',
        independentVarName: 'x / Lx',
        independentVarUnit: '-',
        dependentVarName: 'Temperature',
        dependentVarUnit: '°C',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live CalculiX execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'ASME-VV20-THM-01 Exact Fourier Conduction (100 °C -> 20 °C)',
        xLabel: 'x / Lx',
        yLabel: 'Temperature (°C)',
        points: CONDUCTION_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'horizontal',
        fieldKey: 'temperature_matrix',
        units: 'fraction',
        position: 0.5,
        x0: 0,
        y0: 0.5,
        x1: 1,
        y1: 0.5,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
  {
    id: 'NAFEMS-FEA-01',
    code: 'NAFEMS-FEA-01',
    standardRef: 'NAFEMS LE / ASME V&V 10 · Euler-Bernoulli Cantilever',
    engineLabel: 'CalculiX v2.21 (ccx Quadratic C3D20R)',
    formulaLatex: '|w(x)| = \\frac{q x^2 (6L^2 - 4Lx + x^2)}{24 E I}, \\quad w_{\\max} = 0.00292969\\text{ m}',
    formulaSummaryAr:
      'عارضة كابولية فولاذية (L=1.0m, h=0.08m, b=0.05m, E=200 GPa) تحت حمل موزع F=10 kN بعناصر تربيعية C3D20R مع مقارنة منحنى الإزاحة بالمعادلة التحليلية.',
    recommendedInputs: {
      simulationType: 'Structural_Static',
      executionMode: 'celery',
      widthX: '1.0',
      heightY: '0.08',
      depthZ: '0.05',
      meshSize: '0.04',
      elementOrder: '2',
      supportType: 'cantilever',
      contactType: 'Bonded',
      youngModulus: '200000000000',
      poissonRatio: '0.3',
      density: '7850',
      forceN: '10000',
      displacement: '0',
      nonlinear: false,
    },
    project: {
      id: 'NAFEMS-FEA-01',
      title: 'قالب التحقق القياسي: انحناء العارضة الكابولية (Euler-Bernoulli Beam)',
      titleEn: 'NAFEMS-FEA-01: Uniformly Loaded 3D Cantilever Beam (CalculiX C3D20R)',
      author: 'NASEER V&V Suite',
      supervisor: 'NAFEMS / Euler-Bernoulli Exact Analytical Reference',
      university: 'Industrial CAE Verification Lab',
      department: 'Structural FEA Verification',
      date: '2026',
      field: 'FEA',
      softwareType: 'CalculiX v2.21 (Live Run Required)',
      abstractAr:
        'قالب تحقق إنشائي بدون نتائج مسبقة متطابق مع معيار NAFEMS-FEA-01 في شهادة التحقق الآلية. يقوم CalculiX بحل العارضة بعناصر رباعية الرتبة الثانية (C3D20R) ومقارنة منحنى الإزاحة مع معادلة أويلر-برنولي الدقيقة.',
      abstractEn:
        'Zero pre-baked results structural FEA benchmark matching NAFEMS-FEA-01. Executes CalculiX with quadratic C3D20R elements and validates deflection along the neutral axis against Euler-Bernoulli theory.',
      governingEquations: [
        {
          name: 'Linear Elastostatics Equilibrium',
          latex: '\\nabla \\cdot \\boldsymbol{\\sigma} + \\mathbf{b} = \\mathbf{0}, \\quad \\boldsymbol{\\sigma} = \\mathbf{C} : \\boldsymbol{\\varepsilon}',
          description: '3D isotropic linear elasticity solved by CalculiX ccx using quadratic C3D20R elements.',
        },
        {
          name: 'Euler-Bernoulli Uniformly Loaded Cantilever',
          latex: '|w(x)| = \\frac{q x^2 (6L^2 - 4Lx + x^2)}{24 E I}, \\quad w_{\\max} = 2.9297\\text{ mm}',
          description: 'Analytical centerline deflection for L=1.0 m, h=0.08 m, b=0.05 m, E=200 GPa, q=10 kN/m.',
        },
      ],
      boundaryConditions: [
        { name: 'Left End (x = 0)', type: 'Fixed Support', value: '0', unit: 'm', description: 'Clamped cantilever root (Ux = Uy = Uz = 0).' },
        { name: 'Top Face', type: 'Force Load', value: '10000', unit: 'N', description: 'Total downward distributed load F = 10 kN (q = 10 kN/m).' },
      ],
      material: {
        name: 'Structural Steel (E = 200 GPa, ν = 0.3)',
        phaseOrType: 'Solid',
        density: '7850 kg/m³',
        elasticModulus: '200 GPa',
        poissonRatio: '0.3',
        yieldStrength: '250 MPa',
      },
      solver: {
        solverType: 'CalculiX Static Structural FEA',
        scheme: 'Direct Sparse (Spooles)',
        discretization: 'Quadratic Hexahedral (C3D20R)',
        convergenceCriteria: '1e-8',
        iterations: 1,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) after executing baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'NAFEMS-FEA-01 Euler-Bernoulli Cantilever Beam (w_max = 0.00292969 m, tol <= 5%)',
        independentVarName: 'x / L',
        independentVarUnit: '-',
        dependentVarName: 'Deflection |w|',
        dependentVarUnit: 'm',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live CalculiX execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'NAFEMS-FEA-01 Euler-Bernoulli Deflection (q = 10 kN/m)',
        xLabel: 'x / Lx',
        yLabel: 'Displacement magnitude |u| (m)',
        points: CANTILEVER_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'horizontal',
        fieldKey: 'vtk_displacement',
        units: 'fraction',
        position: 0.5,
        x0: 0,
        y0: 0.5,
        x1: 1,
        y1: 0.5,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
  {
    id: 'NAFEMS-FEA-02',
    code: 'NAFEMS-FEA-02',
    standardRef: 'NAFEMS FV12 · Free Vibration Cantilever Modal Frequency',
    engineLabel: 'CalculiX v2.21 (ccx C3D20R *FREQUENCY)',
    formulaLatex: 'f_1 = \\frac{1.8751^2}{2\\pi L^2}\\sqrt{\\frac{E I}{\\rho A}} = 65.2304\\text{ Hz}',
    formulaSummaryAr:
      'التحليل الديناميكي المودالي لعارضة كابولية مربعة المقطع (L=1.0m, h=b=0.08m, E=200 GPa, ρ=7850) للتحقق من التردد الطبيعي الأساسي f1=65.23 Hz وشكل النمط الأول.',
    recommendedInputs: {
      simulationType: 'Structural_Dynamic',
      executionMode: 'celery',
      widthX: '1.0',
      heightY: '0.08',
      depthZ: '0.08',
      meshSize: '0.04',
      elementOrder: '2',
      supportType: 'cantilever',
      contactType: 'Bonded',
      youngModulus: '200000000000',
      poissonRatio: '0.3',
      density: '7850',
      modesCount: '5',
      forceN: '0',
      displacement: '0',
      nonlinear: false,
    },
    project: {
      id: 'NAFEMS-FEA-02',
      title: 'قالب التحقق القياسي: التردد الطبيعي للعارضة الكابولية (Modal Frequency)',
      titleEn: 'NAFEMS-FEA-02: Cantilever Beam Fundamental Natural Frequency (CalculiX *FREQUENCY)',
      author: 'NASEER V&V Suite',
      supervisor: 'NAFEMS FV12 Free Vibration Analytical Reference',
      university: 'Industrial CAE Verification Lab',
      department: 'Structural Dynamics Verification',
      date: '2026',
      field: 'FEA',
      softwareType: 'CalculiX v2.21 (Live Run Required)',
      abstractAr:
        'قالب تحقق ديناميكي بدون نتائج مسبقة متطابق مع معيار NAFEMS-FEA-02 في شهادة التحقق الآلية. يحسب CalculiX *FREQUENCY أول 5 أنماط اهتزاز طبيعية ويقارن التردد الأساسي f1 بالمرجع التحليلي 65.2304 Hz.',
      abstractEn:
        'Zero pre-baked results modal analysis benchmark matching NAFEMS-FEA-02. Executes CalculiX *FREQUENCY live and validates the fundamental natural frequency against 65.2304 Hz and the normalized first bending mode shape.',
      governingEquations: [
        {
          name: 'Undamped Structural Eigenvalue Problem',
          latex: '(\\mathbf{K} - \\omega_n^2 \\mathbf{M})\\boldsymbol{\\phi}_n = \\mathbf{0}, \\quad f_n = \\frac{\\omega_n}{2\\pi}',
          description: 'Generalized structural eigenproblem solved by CalculiX ARPACK/Lanczos eigensolver.',
        },
        {
          name: 'Euler-Bernoulli 1st Cantilever Natural Frequency',
          latex: 'f_1 = \\frac{(1.875104)^2}{2\\pi L^2}\\sqrt{\\frac{E h^2}{12 \\rho}} = 65.2304\\text{ Hz}',
          description: 'Exact fundamental bending frequency for L=1.0 m, h=b=0.08 m, E=200 GPa, rho=7850 kg/m³.',
        },
      ],
      boundaryConditions: [
        { name: 'Left End (x = 0)', type: 'Fixed Support', value: '0', unit: 'm', description: 'Clamped cantilever root (Ux = Uy = Uz = 0).' },
        { name: 'Free End (x = 1.0 m)', type: 'Free Boundary', value: '0', unit: 'N', description: 'Unconstrained vibrating cantilever tip.' },
      ],
      material: {
        name: 'Structural Steel (E = 200 GPa, ρ = 7850 kg/m³)',
        phaseOrType: 'Solid',
        density: '7850 kg/m³',
        elasticModulus: '200 GPa',
        poissonRatio: '0.3',
      },
      solver: {
        solverType: 'CalculiX Modal (*FREQUENCY)',
        scheme: 'ARPACK / Spooles Eigenvalue',
        discretization: 'Quadratic Hexahedral (C3D20R)',
        convergenceCriteria: '1e-8',
        iterations: 5,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) on Mode 1 frequency after baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'NAFEMS FV12 Cantilever Fundamental Frequency (f_1 = 65.2304 Hz, tol <= 5%)',
        independentVarName: 'x / L',
        independentVarUnit: '-',
        dependentVarName: 'Normalized Mode 1 Shape |phi_1|',
        dependentVarUnit: '-',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live CalculiX *FREQUENCY execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'NAFEMS-FEA-02 Mode 1 Shape (f_1 = 65.2304 Hz)',
        xLabel: 'x / Lx',
        yLabel: 'Normalized Mode Shape |phi_1(x)|',
        points: MODAL_MODE1_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'horizontal',
        fieldKey: 'vtk_displacement',
        units: 'fraction',
        position: 0.5,
        x0: 0,
        y0: 0.5,
        x1: 1,
        y1: 0.5,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
  {
    id: 'ASME-EM-01',
    code: 'ASME-EM-01',
    standardRef: 'ASME / ElmerFEM · Parallel-Plate Electrostatic Laplace Field',
    engineLabel: 'ElmerFEM (StatElecSolve)',
    formulaLatex: '\\nabla^2 \\phi = 0 \\implies \\phi(x) = 100\\left(1 - \\frac{x}{L_x}\\right)\\;[\\text{V}], \\quad \\bar{\\phi} = 50.0\\text{ V}',
    formulaSummaryAr:
      'مجال كهروستاتيكي بين لوحين متوازيين (100V يساراً إلى 0V يميناً، εr=1) في ElmerFEM مع مقارنة توزيع الجهد الكهربائي عبر المحور X بالحل التحليلي لمعادلة لابلاس.',
    recommendedInputs: {
      simulationType: 'Electromagnetic',
      executionMode: 'celery',
      widthX: '1.0',
      heightY: '0.5',
      depthZ: '0.1',
      meshSize: '0.1',
      emSubmode: 'Electrostatic',
      bcLeft: '100',
      bcRight: '0',
      relativePermittivity: '1',
      electricalConductivity: '1',
      relativePermeability: '1',
    },
    project: {
      id: 'ASME-EM-01',
      title: 'قالب التحقق القياسي: المجال الكهروستاتيكي بين لوحين متوازيين (ElmerFEM)',
      titleEn: 'ASME-EM-01: Parallel-Plate Electrostatic Laplace Field (ElmerFEM StatElecSolve)',
      author: 'NASEER V&V Suite',
      supervisor: 'Classical Electrodynamics / ElmerFEM Verification',
      university: 'Industrial CAE Verification Lab',
      department: 'Electromagnetics Verification',
      date: '2026',
      field: 'Electromagnetic',
      softwareType: 'ElmerFEM (Live Run Required)',
      abstractAr:
        'قالب تحقق كهرومغناطيسي بدون نتائج مسبقة متطابق مع معيار ASME-EM-01 في شهادة التحقق الآلية. يحل ElmerFEM (StatElecSolve) معادلة لابلاس ثلاثية الأبعاد ويقارن توزيع الجهد الكهربائي φ(x) بالحل الخطي الدقيق.',
      abstractEn:
        'Zero pre-baked results electrostatic benchmark matching ASME-EM-01. Executes ElmerFEM StatElecSolve live and validates the potential distribution phi(x) = 100*(1 - x/L) across the dielectric gap.',
      governingEquations: [
        {
          name: 'Electrostatic Laplace Equation',
          latex: '-\\nabla \\cdot (\\varepsilon_0 \\varepsilon_r \\nabla \\phi) = 0, \\quad \\mathbf{E} = -\\nabla \\phi',
          description: 'Steady-state electrostatic potential equation solved in ElmerFEM StatElecSolve.',
        },
        {
          name: 'Exact Parallel-Plate Potential Profile',
          latex: '\\phi(x) = 100\\left(1 - \\frac{x}{L_x}\\right)\\;[\\text{V}], \\quad |\\mathbf{E}| = 100\\text{ V/m}',
          description: 'Exact 1D potential drop between 100 V anode (x=0) and 0 V grounded cathode (x=1 m).',
        },
      ],
      boundaryConditions: [
        { name: 'Left Electrode (x = 0)', type: 'Fixed Potential', value: '100', unit: 'V', description: 'High-voltage Dirichlet electrode (+100 V).' },
        { name: 'Right Electrode (x = 1.0 m)', type: 'Ground Reference', value: '0', unit: 'V', description: 'Grounded Dirichlet cathode (0 V).' },
        { name: 'Side Boundaries', type: 'Zero Normal Flux', value: '0', unit: 'C/m²', description: 'Natural Neumann zero-flux walls.' },
      ],
      material: {
        name: 'Vacuum / Free Space Dielectric (ε_r = 1.0)',
        phaseOrType: 'Gas',
        density: '1.225 kg/m³',
      },
      solver: {
        solverType: 'ElmerFEM StatElecSolve',
        scheme: 'BiCGStab + ILU1 Preconditioner',
        discretization: '3D Tetrahedral FEM',
        convergenceCriteria: '1e-8',
        iterations: 1000,
      },
      meshStudy: {
        description: 'Run live Mesh Independence (GCI) on electrostatic potential after baseline solve.',
        minOrthogonalQuality: 1,
        maxSkewness: 0,
        maxAspectRatio: 1,
        averageEquisizeSkew: 0,
        meshLevels: [],
        recommendation: 'Pending live solver execution.',
      },
      validation: {
        benchmarkSource: 'ASME-EM-01 Parallel-Plate Laplace Analytical Potential (phi_avg = 50.0 V, tol <= 3%)',
        independentVarName: 'x / Lx',
        independentVarUnit: '-',
        dependentVarName: 'Electric Potential phi',
        dependentVarUnit: 'V',
        points: [],
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: 'Pending live ElmerFEM execution.',
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      projectType: 'International ASME Benchmark',
      referenceData: {
        label: 'ASME-EM-01 Exact Laplace Potential (100 V -> 0 V)',
        xLabel: 'x / Lx',
        yLabel: 'Electric Potential phi (V)',
        points: ELECTROSTATIC_POINTS,
        recordedAt: nowIso(),
      },
      validationProfile: {
        kind: 'horizontal',
        fieldKey: 'vtk_potential',
        units: 'fraction',
        position: 0.5,
        x0: 0,
        y0: 0.5,
        x1: 1,
        y1: 0.5,
        normalizeAbscissa: true,
      },
      isCustom: true,
    },
  },
];
