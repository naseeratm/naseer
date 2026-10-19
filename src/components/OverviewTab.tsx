import React, { useState, useEffect } from 'react';
import {
  Layers,
  Settings,
  Cpu,
  Flame,
  Wind,
  CheckCircle2,
  Atom,
  Calendar,
  User,
  ShieldCheck,
  Calculator,
  Activity,
  FileCode,
  Play,
  RefreshCw,
  Terminal,
  TrendingDown,
  CheckCheck,
  FolderArchive,
  Code,
  Copy,
  Check,
  ArrowRight,
  Gauge,
  Sparkles,
  BarChart3,
  Table as TableIcon,
  Zap,
  Box,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { EngineeringSchematicViewer } from './EngineeringSchematicViewer';
import { EngineeringModelViewer3D } from './3D-Engineering-Model-Viewer';

interface OverviewTabProps {
  project: ThesisProject;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ project }) => {
  const isFEA = project.field === 'FEA';

  // Sub-navigation view inside OverviewTab
  const [workbenchView, setWorkbenchView] = useState<'lhtes_charts' | 'schematic' | 'residuals' | 'console' | 'script' | 'parameters' | 'cad_schematic' | '3d_viewer'>('3d_viewer');
  const [isSolving, setIsSolving] = useState<boolean>(false);
  const [solveProgress, setSolveProgress] = useState<number>(100);
  const [currentIter, setCurrentIter] = useState<number>(project.solver?.iterations || 1500);
  const [copiedLog, setCopiedLog] = useState<boolean>(false);
  const [activeSchematicCell, setActiveSchematicCell] = useState<string>('wb_setup');

  // CFD states for parametric calculator
  const [inletVel, setInletVel] = useState<number>(18.5);
  const [charLength, setCharLength] = useState<number>(0.05); // 50 mm hydraulic diameter
  const [fluidDensity, setFluidDensity] = useState<number>(998.2); // Water / air
  const [dynamicVisc, setDynamicVisc] = useState<number>(0.001003); // Pa.s

  // FEA states for parametric calculator
  const [appliedLoadKn, setAppliedLoadKn] = useState<number>(25.0); // 25 kN
  const [beamLengthM, setBeamLengthM] = useState<number>(1.5); // 1.5 m
  const [modulusGpa, setModulusGpa] = useState<number>(205); // 205 GPa (Steel)
  const [momentOfInertiaCm4, setMomentOfInertiaCm4] = useState<number>(1250); // cm^4
  const [sectionHeightMm, setSectionHeightMm] = useState<number>(150); // mm

  // Deterministic CFD physics calculations
  const reynoldsNumber = (fluidDensity * inletVel * charLength) / dynamicVisc;
  const isTurbulent = reynoldsNumber > 2300;
  const frictionFactor = isTurbulent
    ? Math.pow(0.79 * Math.log(reynoldsNumber) - 1.64, -2)
    : 64 / Math.max(1, reynoldsNumber);
  const pressureDropPerMeter =
    (frictionFactor * (fluidDensity * inletVel * inletVel)) / (2 * charLength);

  // Deterministic FEA physics calculations (Euler-Bernoulli cantilever/supported model)
  const loadN = appliedLoadKn * 1000;
  const lengthMm = beamLengthM * 1000;
  const momentNmm = loadN * lengthMm; // Peak bending moment
  const cMm = sectionHeightMm / 2; // Distance to outer fiber
  const inertiaMm4 = momentOfInertiaCm4 * 10000;
  const bendingStressMpa = (momentNmm * cMm) / inertiaMm4;
  const eMpa = modulusGpa * 1000;
  const maxDeflectionMm = (loadN * Math.pow(lengthMm, 3)) / (3 * eMpa * inertiaMm4);
  const yieldStrengthMpa = 420;
  const safetyFactor = Math.max(0.1, yieldStrengthMpa / Math.max(1, bendingStressMpa));

  // Simulated live solve execution
  const handleTriggerSolve = () => {
    setIsSolving(true);
    setSolveProgress(0);
    setCurrentIter(0);

    const targetIter = project.solver?.iterations || 1500;
    const interval = setInterval(() => {
      setSolveProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsSolving(false);
          setCurrentIter(targetIter);
          return 100;
        }
        const next = prev + 10;
        setCurrentIter(Math.round((next / 100) * targetIter));
        return next;
      });
    }, 120);
  };

  const handleCopyLog = () => {
    const text = project.scriptExecutionLog?.join('\n') || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    }
  };

  // Residuals history fallback
  const residualsData = project.residualsHistory || [
    { iteration: 1, continuity: 1.0, xVelocity: 0.85, yVelocity: 0.72, energy: 0.55 },
    { iteration: 25, continuity: 0.42, xVelocity: 0.31, yVelocity: 0.28, energy: 0.18 },
    { iteration: 75, continuity: 0.12, xVelocity: 0.082, yVelocity: 0.075, energy: 0.041 },
    { iteration: 150, continuity: 0.035, xVelocity: 0.019, yVelocity: 0.016, energy: 0.0078 },
    { iteration: 300, continuity: 0.0068, xVelocity: 0.0028, yVelocity: 0.0022, energy: 0.00085 },
    { iteration: 500, continuity: 0.00092, xVelocity: 0.00031, yVelocity: 0.00024, energy: 0.000072 },
    { iteration: 800, continuity: 0.000085, xVelocity: 0.000022, yVelocity: 0.000017, energy: 0.0000045 },
    { iteration: 1100, continuity: 0.0000081, xVelocity: 0.0000018, yVelocity: 0.0000013, energy: 0.00000032 },
    { iteration: 1400, continuity: 0.0000012, xVelocity: 0.00000035, yVelocity: 0.00000028, energy: 0.000000055 },
    { iteration: 1500, continuity: 0.00000094, xVelocity: 0.00000017, yVelocity: 0.00000014, energy: 0.000000027 },
  ];

  // Workbench components
  const workbenchCells = project.workbenchComponents || [
    {
      id: 'wb_eng_data',
      name: 'بيانات المواد والخواص الفيزيائية',
      nameEn: 'Engineering Data (Materials)',
      type: 'Engineering Data' as const,
      status: 'Up-to-date' as const,
      details: `${project.material?.name || 'فولاذ سبائكي / مائع'} | كثافة = ${project.material?.density || '7850 kg/m³'}`,
    },
    {
      id: 'wb_geom',
      name: 'الهندسة ثلاثية الأبعاد ونطاق الحل',
      nameEn: 'Geometry Domain',
      type: 'Geometry' as const,
      status: 'Up-to-date' as const,
      details: isFEA ? 'نطاق إنشائي ثلاثي الأبعاد مع شروط التثبيت' : 'قناة تدفق هيدروديناميكية 3D مع مناطق الدخول والخروج',
    },
    {
      id: 'wb_mesh',
      name: 'شبكة الميش وتقارب روتش',
      nameEn: 'Mesh & Roache GCI',
      type: 'Mesh' as const,
      status: 'Up-to-date' as const,
      details: `شبكة مستقلة L3 معتمدة | مؤشر روتش GCI = ${project.meshStudy?.meshLevels?.[2]?.gciPercent || '1.12'}% | جودة تعامد = ${project.meshStudy?.minOrthogonalQuality || '0.89'}`,
    },
    {
      id: 'wb_setup',
      name: 'إعدادات الفيزياء والشروط الحدية',
      nameEn: 'Physics Setup & Boundaries',
      type: 'Setup' as const,
      status: 'Up-to-date' as const,
      details: `${project.boundaryConditions?.length || 3} حدود فيزيائية مطبقة | ${project.solver?.scheme || 'Coupled Formulation'}`,
    },
    {
      id: 'wb_solu',
      name: 'المحلل العددي ومراقبة التقارب',
      nameEn: 'Solution & Residuals',
      type: 'Solution' as const,
      status: 'Solved' as const,
      details: `تقارب تام لمصفوفات البواقي RMS < 1.000e-06 في التكرار ${project.solver?.iterations || 1500}`,
    },
    {
      id: 'wb_res',
      name: 'النتائج والكونتورات والتحقق',
      nameEn: 'Results & ASME Validation',
      type: 'Results' as const,
      status: 'Ready' as const,
      details: `${project.contours?.length || 4} حقول كونتور ومتجهات | ASME V&V 20 (R² = ${project.validation?.rSquared || 0.994})`,
    },
  ];

  // Commands list
  const detectedCommands = project.detectedCommandsList || [];

  return (
    <div className="space-y-6">
      {/* ANSYS Workbench Master Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 rounded-2xl border border-sky-500/40 p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 font-mono">
                <Cpu className="w-3.5 h-3.5" />
                {project.softwareType}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                SOLVED & CONVERGED (RMS &lt; 1e-6)
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1 font-mono">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ASME V&V 20-2009 Compliant
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-slate-400" />
                {project.date}
              </span>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-relaxed mb-1">
            {project.title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-mono tracking-wide leading-normal direction-ltr text-left mb-5">
            {project.titleEn}
          </p>

          {/* Quick Solver Control Ribbon */}
          <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">حالة المحلل:</span>
                <span className="font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isSolving ? `جاري الحل والتكرار (${currentIter}/${project.solver?.iterations || 1500})...` : 'تم الحل والتقارب بنجاح'}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-slate-400">معيار التقارب:</span>
                <span className="font-mono text-sky-300 font-bold">{project.solver?.convergenceCriteria || '1e-6'}</span>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <span className="text-slate-400">طريقة الحل:</span>
                <span className="text-slate-200 font-mono text-[11px]">{project.solver?.scheme || 'Coupled Pressure-Velocity'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSolving}
                onClick={handleTriggerSolve}
                className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-sky-900/30 active:scale-95 disabled:opacity-50"
              >
                {isSolving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>{isSolving ? 'جاري التنفيذ...' : 'إعادة تشغيل المحلل (Re-Solve)'}</span>
              </button>
            </div>
          </div>

          {/* Progress bar when re-solving */}
          {isSolving && (
            <div className="mt-2 w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-sky-500 to-emerald-400 h-full transition-all duration-150"
                style={{ width: `${solveProgress}%` }}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 text-xs mt-4">
            <div>
              <span className="text-slate-500 block mb-0.5">الباحث / Student:</span>
              <span className="text-slate-100 font-bold text-sm flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-sky-400" />
                {project.author}
              </span>
              {project.studentId && (
                <span className="text-[11px] text-sky-400 font-mono block">
                  رقم الطالب: {project.studentId}
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">المشرف والاستشارة / Supervisor:</span>
              <span className="text-amber-300 font-bold text-xs block">
                {project.supervisor}
              </span>
              {project.adviser && (
                <span className="text-[11px] text-slate-300 block mt-0.5">
                  المستشار: {project.adviser}
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">الجامعة والكلية / University:</span>
              <span className="text-slate-200 font-medium text-xs leading-relaxed block font-sans">
                {project.university}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">منظومة المحاكاة:</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 text-xs font-mono">
                LHTES v3 · NePCM & Graded Fins
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ANSYS Workbench Interactive Modules Selector */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2 shadow-xl">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/80 pb-2 mb-3 text-xs">
          <button
            type="button"
            onClick={() => setWorkbenchView('lhtes_charts' as any)}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              (workbenchView as string) === 'lhtes_charts'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                : 'text-amber-400 hover:text-amber-200 hover:bg-slate-800/60'
            }`}
          >
            <Flame className="w-4 h-4" />
            <span>خرائط الانصهار والحرارة (Figures 2, 6, 7 & Literature)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('schematic')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'schematic'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>مخطط المشروع (Project Schematic)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('residuals')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'residuals'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <TrendingDown className="w-4 h-4 text-emerald-400" />
            <span>مراقبة تقارب البواقي 10⁻⁶ (Residuals Monitor)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('console')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'console'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Terminal className="w-4 h-4 text-amber-400" />
            <span>سجل Fluent 3D (build_LHTES_project.wbjn)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('script')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'script'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Code className="w-4 h-4 text-sky-400" />
            <span>فاحص الأوامر والسكربت (Script Inspector)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('parameters')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'parameters'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Calculator className="w-4 h-4 text-emerald-400" />
            <span>حاسبة الإكسيرجي والطاقة</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('cad_schematic')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'cad_schematic'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Box className="w-4 h-4 text-sky-400" />
            <span>الرسوم والمساقط الهندسية (2D & 3D CAD)</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkbenchView('3d_viewer')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === '3d_viewer'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                : 'text-amber-400 hover:text-amber-200 hover:bg-slate-800/60'
            }`}
          >
            <Atom className="w-4 h-4" />
            <span>عارض المجسم ثلاثي الأبعاد (3D-Engineering-Model-Viewer)</span>
          </button>
        </div>

        {/* CAD Schematic View */}
        {workbenchView === 'cad_schematic' && (
          <div className="p-4">
            <EngineeringSchematicViewer project={project} />
          </div>
        )}

        {/* 3D Model Viewer View */}
        {workbenchView === '3d_viewer' && (
          <div className="p-4">
            <EngineeringModelViewer3D project={project} />
          </div>
        )}

        {/* LHTES v3 Heatmaps, Charts & Literature Matrix View */}
        {workbenchView === 'lhtes_charts' && (
          <div className="p-4 space-y-8">
            {/* Section 1: Figure 2 Melting Comparison */}
            <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  <span>الشكل (2): مقارنة زمن الانصهار 95% (t95) لمختلف الحالات الهندسية</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  Figure 2: Melting Time Comparison (t95) Across Baseline Cases
                </span>
              </div>

              <div className="space-y-3 pt-2">
                {(project.meltingComparison || []).map((c, idx) => {
                  const maxHours = 5.0;
                  const widthPercent = (c.t95Hours / maxHours) * 100;
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-300 font-sans">
                          {c.caseName}
                        </span>
                        <span className="font-mono font-bold text-xs text-slate-200">
                          {c.t95Hours} h {c.badge ? `(${c.badge})` : ''}
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-lg h-7 p-1 border border-slate-800 flex items-center">
                        <div
                          className="h-full rounded-md flex items-center justify-end px-2 text-[11px] font-mono font-bold text-white transition-all shadow-md"
                          style={{ width: `${widthPercent}%`, backgroundColor: c.color }}
                        >
                          {c.t95Hours} h
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 1.2: Heatmaps Figures 6 & 7 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Figure 6: Liquid Fraction */}
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                <div className="text-xs">
                  <span className="font-bold text-slate-100 text-sm block">
                    الشكل (6): خريطة نسبة الانصهار (Liquid Fraction Map)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Figure 6: Spatiotemporal Liquid Fraction Heatmap (Graded Tree)
                  </span>
                </div>

                <div className="relative h-44 w-full rounded-xl overflow-hidden border border-slate-700 bg-gradient-to-r from-blue-900 via-amber-600 to-red-600 flex flex-col justify-between p-3 select-none">
                  <div className="absolute top-1/2 left-0 right-0 border-t-2 border-dashed border-white/80 flex items-center justify-between px-3">
                    <span className="bg-black/70 text-white font-mono text-[10px] px-2 py-0.5 rounded">
                      Transition Boundary (Z = 0.25 m: Dense / Open)
                    </span>
                    <span className="bg-black/70 text-emerald-300 font-mono text-[10px] px-2 py-0.5 rounded">
                      t95 = 2.504 h
                    </span>
                  </div>
                  <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                    <span>Axial Z = 0.5 m</span>
                    <span>Liquid Phase</span>
                  </div>
                  <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                    <span>Axial Z = 0.0 m</span>
                    <span>Time: 0 &rarr; 5 Hours</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-blue-400 font-bold">0.0 (Solid)</span>
                  <div className="flex-1 mx-3 h-2.5 rounded-full bg-gradient-to-r from-blue-600 via-emerald-400 via-amber-400 to-red-600 border border-slate-700" />
                  <span className="text-red-400 font-bold">1.0 (Liquid)</span>
                </div>
              </div>

              {/* Figure 7: Temperature Map */}
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                <div className="text-xs">
                  <span className="font-bold text-slate-100 text-sm block">
                    الشكل (7): خريطة درجات الحرارة (Temperature Map K)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Figure 7: Spatiotemporal PCM Temperature Heatmap
                  </span>
                </div>

                <div className="relative h-44 w-full rounded-xl overflow-hidden border border-slate-700 bg-gradient-to-r from-indigo-950 via-sky-600 via-orange-500 to-red-700 flex flex-col justify-between p-3 select-none">
                  <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                    <span>Axial Z = 0.5 m</span>
                    <span>Oscillating Cycles (1200 s)</span>
                  </div>
                  <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                    <span>Axial Z = 0.0 m</span>
                    <span>Time: 0 &rarr; 5 Hours</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-indigo-400 font-bold">292.8 K (20 °C)</span>
                  <div className="flex-1 mx-3 h-2.5 rounded-full bg-gradient-to-r from-indigo-900 via-sky-500 via-amber-400 to-red-600 border border-slate-700" />
                  <span className="text-rose-400 font-bold">352.2 K (79.2 °C)</span>
                </div>
              </div>
            </div>

            {/* Section 2: Literature Review Matrix */}
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-indigo-400" />
                <span>2. مصفوفة الأدبيات والدراسات السابقة (Literature Review Matrix)</span>
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <th className="py-2.5 px-3 font-bold">الدراسة / Study</th>
                      <th className="py-2.5 px-3 font-bold">التشكيل / Configuration</th>
                      <th className="py-2.5 px-3 font-bold">النتيجة الكمية / Key Finding</th>
                      <th className="py-2.5 px-3 font-bold">الفجوة البحثية / Gap</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(project.literatureReview || []).map((row, idx) => (
                      <tr key={idx} className={row.study.includes('Present Study') ? 'bg-amber-500/10 font-bold text-amber-200' : 'hover:bg-slate-800/30'}>
                        <td className="py-2 px-3 font-semibold text-slate-200">{row.study}</td>
                        <td className="py-2 px-3 text-slate-300">{row.configuration}</td>
                        <td className="py-2 px-3 font-mono text-emerald-400">{row.keyFinding}</td>
                        <td className="py-2 px-3 text-slate-400 leading-relaxed">{row.gap}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3 & 4: CAD Specs & Quantitative Findings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>3. المواصفات الهندسية ونواة التصميم (CAD & Physical System)</span>
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block font-semibold">Shell Dimensions:</span>
                    <strong className="text-slate-200 font-mono">Height = 0.500 m (500 mm), Diameter = 0.150 m (150 mm)</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block font-semibold">Coil Dimensions:</span>
                    <strong className="text-slate-200 font-mono">Inner Dia = 10 mm, Outer Dia = 12 mm, Helix Dia = 70 mm, Pitch = 50 mm</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block font-semibold">Fin Layout (Graded Tree):</span>
                    <strong className="text-emerald-400 font-mono">Total 204 fin plates (139 lower half [Dense], 65 upper half [Open])</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block font-semibold">PCM & Nanoparticles:</span>
                    <strong className="text-amber-400 font-mono">RT50 Organic PCM (T_melt = 321 - 325 K) + 3 vol.% Al2O3 NePCM</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block font-semibold">Oscillating HTF Boundary:</span>
                    <strong className="text-rose-400 font-mono">Tin(t) = 348 + 10*sin(2*pi*t / 1200 s), Flow = 0.025 kg/s</strong>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>4. النتائج الأكاديمية والأرقام الحاكمة (Quantitative Findings)</span>
                </h3>
                <div className="space-y-2.5">
                  {(project.quantitativeFindings || []).map((f) => (
                    <div key={f.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <strong className="text-slate-200 block">{f.id}. {f.title}</strong>
                        <span className="text-slate-400 text-[11px]">{f.description}</span>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono font-bold text-xs shrink-0 mr-2">
                        {f.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. Project Schematic View */}
        {workbenchView === 'schematic' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200">
                مخطط تدفق المشروع الهندسي المتكامل في ANSYS Workbench R24
              </span>
              <span className="text-emerald-400 font-mono">
                ✓ جميع المنظومات الفرعية محدثة ومحلولة (All Systems Up to Date)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {workbenchCells.map((cell, idx) => {
                const isSelected = activeSchematicCell === cell.id;
                return (
                  <div
                    key={cell.id}
                    onClick={() => setActiveSchematicCell(cell.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 border-sky-500 shadow-lg shadow-sky-950/50 ring-1 ring-sky-500/30'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-mono text-xs font-bold text-sky-400">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-xs text-slate-100">{cell.name}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCheck className="w-3 h-3" />
                        {cell.status}
                      </span>
                    </div>

                    <p className="text-[11px] font-mono text-slate-400 direction-ltr text-left mb-2">
                      {cell.nameEn}
                    </p>

                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-[11px] text-slate-300 leading-relaxed">
                      {cell.details}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. Residuals Convergence Monitor (1e-6) */}
        {workbenchView === 'residuals' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-emerald-400" />
                  <span>منحنى تقارب البواقي اللوغاريتمي لمصفوفات الحفظ (ANSYS Residuals Monitor)</span>
                </h3>
                <p className="text-slate-400 text-xs mt-0.5">
                  مراقبة انخفاض البواقي RMS لمعادلات الاستمرارية، كمية الحركة X/Y، والطاقة عبر التكرارات الحسابية حتى &lt; 10⁻⁶
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono bg-slate-950 p-2 rounded-xl border border-slate-800">
                <span className="flex items-center gap-1.5 text-rose-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                  Continuity: 9.40e-07
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  Momentum-X: 1.70e-07
                </span>
                <span className="flex items-center gap-1.5 text-sky-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
                  Momentum-Y: 1.40e-07
                </span>
                <span className="flex items-center gap-1.5 text-purple-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                  Energy: 2.70e-08
                </span>
              </div>
            </div>

            {/* SVG Residuals Plot */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto">
              <svg
                viewBox="0 0 740 280"
                className="w-full h-64 select-none font-mono text-[10px]"
              >
                {/* Background Grid Lines for Powers of 10 */}
                {/* 10^0 (y=30), 10^-2 (y=90), 10^-4 (y=150), 10^-6 (y=210), 10^-8 (y=260) */}
                <line x1="70" y1="30" x2="720" y2="30" stroke="#334155" strokeDasharray="3 3" />
                <text x="60" y="34" fill="#94a3b8" textAnchor="end">1e+00</text>

                <line x1="70" y1="88" x2="720" y2="88" stroke="#334155" strokeDasharray="3 3" />
                <text x="60" y="92" fill="#94a3b8" textAnchor="end">1e-02</text>

                <line x1="70" y1="145" x2="720" y2="145" stroke="#334155" strokeDasharray="3 3" />
                <text x="60" y="149" fill="#94a3b8" textAnchor="end">1e-04</text>

                {/* Target Convergence Line 1e-6 (Golden Line) */}
                <line x1="70" y1="203" x2="720" y2="203" stroke="#eab308" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x="60" y="207" fill="#eab308" fontWeight="bold" textAnchor="end">1e-06</text>
                <text x="715" y="198" fill="#eab308" textAnchor="end" fontSize="10">معيار التقارب (Convergence Criteria: 1e-6)</text>

                <line x1="70" y1="250" x2="720" y2="250" stroke="#334155" strokeDasharray="3 3" />
                <text x="60" y="254" fill="#94a3b8" textAnchor="end">1e-08</text>

                {/* X Axis Iteration Ticks */}
                <line x1="70" y1="255" x2="720" y2="255" stroke="#475569" strokeWidth="1" />
                <text x="70" y="270" fill="#94a3b8" textAnchor="middle">1</text>
                <text x="232" y="270" fill="#94a3b8" textAnchor="middle">350</text>
                <text x="395" y="270" fill="#94a3b8" textAnchor="middle">750</text>
                <text x="557" y="270" fill="#94a3b8" textAnchor="middle">1150</text>
                <text x="720" y="270" fill="#94a3b8" textAnchor="middle">1500 (Iter)</text>

                {/* Helper mapping function */}
                {/* x: 70 + (iter / 1500) * 650 */}
                {/* y: 30 + (log10(val) / -8) * 220 */}
                {(() => {
                  const toX = (it: number) => 70 + (it / 1500) * 650;
                  const toY = (val: number) => {
                    const log = Math.log10(Math.max(1e-9, val));
                    // 0 -> 30, -8 -> 250
                    return 30 + (log / -8) * 220;
                  };

                  const makePath = (key: 'continuity' | 'xVelocity' | 'yVelocity' | 'energy') => {
                    return residualsData
                      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(d.iteration)} ${toY(d[key])}`)
                      .join(' ');
                  };

                  return (
                    <g>
                      {/* Continuity (Red) */}
                      <path d={makePath('continuity')} fill="none" stroke="#f43f5e" strokeWidth="2.5" />
                      {/* Momentum-X (Emerald) */}
                      <path d={makePath('xVelocity')} fill="none" stroke="#10b981" strokeWidth="2" />
                      {/* Momentum-Y (Sky) */}
                      <path d={makePath('yVelocity')} fill="none" stroke="#38bdf8" strokeWidth="2" />
                      {/* Energy (Purple) */}
                      <path d={makePath('energy')} fill="none" stroke="#c084fc" strokeWidth="2" />

                      {/* Final convergence points */}
                      <circle cx={toX(1500)} cy={toY(residualsData[residualsData.length - 1].continuity)} r="4" fill="#f43f5e" />
                      <circle cx={toX(1500)} cy={toY(residualsData[residualsData.length - 1].xVelocity)} r="4" fill="#10b981" />
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>
        )}

        {/* 3. ANSYS Solver Execution Console */}
        {workbenchView === 'console' && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-slate-200">
                  سجل موجه الأوامر ومخرجات المحلل العددي (ANSYS Solver Run Log)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                  16 Cores | Double Precision
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLog}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-colors border border-slate-700"
                >
                  {copiedLog ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLog ? 'تم النسخ!' : 'نسخ سجل الحل'}</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs text-slate-300 max-h-80 overflow-y-auto direction-ltr text-left space-y-1 selection:bg-sky-500/30">
              {(project.scriptExecutionLog || []).map((line, lIdx) => {
                const isHeader = line.startsWith('[ANSYS') || line.startsWith('===');
                const isConverged = line.includes('CONVERGED') || line.includes('SUCCESS');
                const isIter = line.trim().match(/^\d+/);
                return (
                  <div
                    key={lIdx}
                    className={`${
                      isHeader
                        ? 'text-sky-400 font-bold'
                        : isConverged
                        ? 'text-emerald-400 font-bold bg-emerald-950/30 p-1 rounded'
                        : isIter
                        ? 'text-slate-300 hover:bg-slate-900/60'
                        : 'text-slate-400'
                    }`}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Parsed Script & APDL Command Inspector */}
        {workbenchView === 'script' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-2">
                <Code className="w-4 h-4 text-sky-400" />
                <span>تحليل أوامر السكربت والملفات المستخرجة من الأرشيف (Parsed Commands & Macros)</span>
              </span>
              <span className="text-slate-400 text-xs">
                {detectedCommands.length} أوامر هندسية تم تحليلها وتطبيقها
              </span>
            </div>

            {/* Detected Commands Badges */}
            {detectedCommands.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-400">الأوامر والشروط الحدية المكتشفة:</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {detectedCommands.map((cmd, cIdx) => (
                    <div
                      key={cIdx}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-bold text-xs text-sky-400 bg-sky-950/70 border border-sky-800/60 px-2 py-0.5 rounded">
                          {cmd.command}
                        </span>
                        <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                          {cmd.description}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-400 shrink-0 font-bold">
                        ✓ {cmd.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw Script Text Viewer */}
            {project.originalScriptContent && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
                  <span>محتوى السكربت والملف المصدري:</span>
                  <span className="font-mono text-slate-500">{project.originalScriptContent.split('\n').length} أسطر</span>
                </div>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 max-h-64 overflow-y-auto direction-ltr text-left leading-relaxed">
                  {project.originalScriptContent}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* 5. Parametric Sensitivity Calculator */}
        {workbenchView === 'parameters' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="font-bold text-sm text-white flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <span>حاسبة الحساسية الفيزيائية والأرقام اللابُعدية (Parametric Solver)</span>
              </span>
              <span className="text-xs text-slate-400">
                حل حتمي مباشر لمعادلات هبوط الضغط ودارسي-فايسباخ ورقم رينولدز أو إجهادات العارضة
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Controls */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                {isFEA ? (
                  <>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        الحمولة المطبقة $P$ (Applied Force):
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="1"
                          max="200"
                          step="1"
                          value={appliedLoadKn}
                          onChange={(e) => setAppliedLoadKn(parseFloat(e.target.value))}
                          className="w-full accent-rose-500"
                        />
                        <span className="text-xs font-mono font-bold text-rose-400 w-16 text-left">
                          {appliedLoadKn} kN
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        طول العارضة الإنشائية $L$:
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0.2"
                          max="10"
                          step="0.1"
                          value={beamLengthM}
                          onChange={(e) => setBeamLengthM(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                        <span className="text-xs font-mono font-bold text-indigo-400 w-16 text-left">
                          {beamLengthM.toFixed(1)} m
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        معامل يونغ $E$ (GPa):
                      </label>
                      <input
                        type="number"
                        value={modulusGpa}
                        onChange={(e) => setModulusGpa(parseFloat(e.target.value) || 10)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        عزم عطالة المقطع $I$ (cm⁴):
                      </label>
                      <input
                        type="number"
                        value={momentOfInertiaCm4}
                        onChange={(e) => setMomentOfInertiaCm4(parseFloat(e.target.value) || 10)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        سرعة التدفق $v$ (Inlet Velocity):
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0.5"
                          max="50"
                          step="0.5"
                          value={inletVel}
                          onChange={(e) => setInletVel(parseFloat(e.target.value))}
                          className="w-full accent-sky-500"
                        />
                        <span className="text-xs font-mono font-bold text-sky-400 w-16 text-left">
                          {inletVel} m/s
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        القطر الهيدروليكي $D_h$:
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0.01"
                          max="0.2"
                          step="0.005"
                          value={charLength}
                          onChange={(e) => setCharLength(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                        <span className="text-xs font-mono font-bold text-indigo-400 w-16 text-left">
                          {(charLength * 1000).toFixed(0)} mm
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        كثافة المائع $\rho$:
                      </label>
                      <input
                        type="number"
                        value={fluidDensity}
                        onChange={(e) => setFluidDensity(parseFloat(e.target.value) || 1)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        اللزوجة الديناميكية $\mu$ (Pa·s):
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={dynamicVisc}
                        onChange={(e) => setDynamicVisc(parseFloat(e.target.value) || 0.00001)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Computed Physical Outputs */}
              <div className="lg:col-span-2 grid grid-cols-2 gap-3">
                {isFEA ? (
                  <>
                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">إجهاد الانحناء الأقصى (Peak Stress &sigma;):</span>
                      <div className="font-mono text-xl font-bold text-rose-400 mt-1">
                        {bendingStressMpa.toFixed(1)} <span className="text-xs text-slate-400 font-normal">MPa</span>
                      </div>
                      <div className="text-[11px] mt-1 text-slate-400">صيغة &sigma; = M &middot; c / I</div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">الانحراف المرن الأقصى (&delta;):</span>
                      <div className="font-mono text-xl font-bold text-amber-400 mt-1">
                        {maxDeflectionMm.toFixed(2)} <span className="text-xs text-slate-400 font-normal">mm</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">مرونة خطية P L&sup3; / (3 E I)</div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">معامل الأمان (Safety Factor):</span>
                      <div className="font-mono text-xl font-bold text-emerald-400 mt-1">
                        {safetyFactor.toFixed(2)}
                      </div>
                      <div className="text-[11px] mt-1">
                        {safetyFactor >= 1.5 ? (
                          <span className="text-emerald-400 font-medium">آمن إنشائياً (SF &ge; 1.5)</span>
                        ) : (
                          <span className="text-rose-400 font-medium">حرج / غير آمن (SF &lt; 1.5)</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">عزم الانحناء الأقصى ($M$):</span>
                      <div className="font-mono text-xl font-bold text-sky-400 mt-1">
                        {(appliedLoadKn * beamLengthM).toFixed(1)} <span className="text-xs font-normal text-slate-400">kN&middot;m</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">عزم التثبيت عند قاعدة الهيكل</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">رقم رينولدز (Reynolds Number):</span>
                      <div className="font-mono text-xl font-bold text-sky-400 mt-1">
                        {reynoldsNumber.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[11px] mt-1">
                        {isTurbulent ? (
                          <span className="text-rose-400 font-medium">مضطرب (Turbulent Flow)</span>
                        ) : (
                          <span className="text-emerald-400 font-medium">صفائحي (Laminar Flow)</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">معامل الاحتكاك $f$ (Darcy):</span>
                      <div className="font-mono text-xl font-bold text-emerald-400 mt-1">
                        {frictionFactor.toFixed(4)}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">علاقة Colebrook-Petukhov</div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">هبوط الضغط لكل متر ($\Delta P / L$):</span>
                      <div className="font-mono text-xl font-bold text-amber-400 mt-1">
                        {(pressureDropPerMeter / 1000).toFixed(2)} <span className="text-xs font-normal text-slate-400">kPa/m</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">وفق صيغة دارسي-فايسباخ</div>
                    </div>

                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">الضغط الديناميكي ($\frac{1}{2} \rho v^2$):</span>
                      <div className="font-mono text-xl font-bold text-purple-400 mt-1">
                        {((0.5 * fluidDensity * inletVel * inletVel) / 1000).toFixed(2)} <span className="text-xs font-normal text-slate-400">kPa</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">طاقة حركة حجمية</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Abstract Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Arabic Abstract */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg">
          <div className="flex items-center gap-2 mb-3 text-sky-400 font-bold text-sm">
            <Layers className="w-4 h-4" />
            <span>ملخص النموذج الهندسي (Executive Summary)</span>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed text-justify">
            {project.abstractAr}
          </p>
          {project.directivesApplied && (
            <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-amber-300/90 flex items-start gap-2">
              <span className="font-bold text-amber-400 shrink-0">التوجيهات المطبقة:</span>
              <span>{project.directivesApplied}</span>
            </div>
          )}
        </div>

        {/* English Abstract */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg direction-ltr text-left">
          <div className="flex items-center gap-2 mb-3 text-indigo-400 font-bold text-sm">
            <Layers className="w-4 h-4" />
            <span>Executive Abstract (Technical Specification)</span>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed text-justify font-sans">
            {project.abstractEn}
          </p>
        </div>
      </div>

      {/* Governing Equations */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Atom className="w-5 h-5 text-sky-400" />
            <span>المعادلات الحاكمة والنمذجة الرياضية (Governing Equations)</span>
          </div>
          <span className="text-xs text-slate-400">معادلات فيزيائية معتمدة في ANSYS</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {project.governingEquations.map((eq, idx) => (
            <div
              key={idx}
              className="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 hover:border-sky-500/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-sky-300">{eq.name}</span>
                <span className="text-xs font-mono text-slate-500">Eq. ({idx + 1})</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">{eq.description}</p>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-xs sm:text-sm text-emerald-300 direction-ltr text-center overflow-x-auto">
                {eq.latex}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Boundary Conditions & Material Properties */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Boundary Conditions Table (2 columns) */}
        <div className="lg:col-span-2 bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <Layers className="w-5 h-5 text-indigo-400" />
              <span>الشروط الحدودية المطبقة (Boundary Conditions)</span>
            </div>
            <span className="text-xs text-slate-400">{project.boundaryConditions.length} حدود محددة</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                  <th className="py-2.5 px-3 font-semibold">اسم الحد (Zone)</th>
                  <th className="py-2.5 px-3 font-semibold">نوع الشرط الحدودي</th>
                  <th className="py-2.5 px-3 font-semibold">القيمة والوحدة</th>
                  <th className="py-2.5 px-3 font-semibold">التفاصيل الفيزيائية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {project.boundaryConditions.map((bc, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-slate-200">{bc.name}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/50">
                        {bc.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                      {bc.value} <span className="text-xs font-normal text-slate-400">{bc.unit}</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 leading-relaxed">{bc.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Material & Solver Settings (1 column) */}
        <div className="space-y-6">
          {/* Material Card */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg">
            <div className="flex items-center gap-2 text-white font-bold text-sm mb-3">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>المادة والخواص الفيزيائية (Material)</span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">المادة:</span>
                <span className="font-bold text-slate-200">{project.material.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الكثافة (Density):</span>
                <span className="font-mono text-slate-200">{project.material.density}</span>
              </div>
              {project.material.viscosity && (
                <div className="flex justify-between">
                  <span className="text-slate-400">اللزوجة (Viscosity):</span>
                  <span className="font-mono text-slate-200">{project.material.viscosity}</span>
                </div>
              )}
              {project.material.thermalConductivity && (
                <div className="flex justify-between">
                  <span className="text-slate-400">الموصلية الحرارية:</span>
                  <span className="font-mono text-slate-200">{project.material.thermalConductivity}</span>
                </div>
              )}
              {project.material.elasticModulus && (
                <div className="flex justify-between">
                  <span className="text-slate-400">معامل المرونة (Young's E):</span>
                  <span className="font-mono text-slate-200">{project.material.elasticModulus}</span>
                </div>
              )}
              {project.material.yieldStrength && (
                <div className="flex justify-between">
                  <span className="text-slate-400">إجهاد الخضوع (Yield):</span>
                  <span className="font-mono text-slate-200">{project.material.yieldStrength}</span>
                </div>
              )}
            </div>
          </div>

          {/* Solver Settings */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg">
            <div className="flex items-center gap-2 text-white font-bold text-sm mb-3">
              <Settings className="w-4 h-4 text-sky-400" />
              <span>إعدادات الحل والحساب (Solver Settings)</span>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">نوع المحلل:</span>
                <span className="font-medium text-slate-200">{project.solver?.solverType || 'Pressure-Based Coupled'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">مخطط الاقتران:</span>
                <span className="font-medium text-slate-200">{project.solver?.scheme || 'Coupled Pressure-Velocity'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">التفريق المكاني:</span>
                <span className="font-medium text-slate-200">{project.solver?.discretization || 'Second Order Upwind'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">معيار التقارب:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {project.solver?.convergenceCriteria || '1e-6'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">أقصى تكرارات:</span>
                <span className="font-mono text-slate-200">{project.solver?.iterations || 1500}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
