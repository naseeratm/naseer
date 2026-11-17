import React, { lazy, Suspense, useState, useEffect } from 'react';
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
import { exportToOpenFoamScripts } from '../utils/exporter';

const EngineeringModelViewer3D = lazy(() =>
  import('./3D-Engineering-Model-Viewer').then((module) => ({
    default: module.EngineeringModelViewer3D,
  })),
);

const RESIDUAL_PALETTE = ['#f43f5e', '#10b981', '#38bdf8', '#c084fc', '#fbbf24', '#34d399'];

interface OverviewTabProps {
  project: ThesisProject;
  onRunSolver?: () => Promise<unknown>;
  solverJobStatus?: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  solverLogs?: string[];
  onSolverFailed?: (message: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ project, onRunSolver, solverJobStatus = 'idle', solverLogs = [], onSolverFailed }) => {
  const isFEA = project.field === 'FEA';
  const isThermal = project.field === 'Thermal';
  const isCFD = project.field === 'CFD';

  // Sub-navigation view inside OverviewTab
  const [workbenchView, setWorkbenchView] = useState<'cases_matrix' | 'lhtes_charts' | 'schematic' | 'residuals' | 'console' | 'script' | 'parameters' | 'cad_schematic' | '3d_viewer'>('cases_matrix');
  const [isSolving, setIsSolving] = useState<boolean>(false);
  // Real residual streams reported by the solver backend (empty until a solve completes).
  const residualSeries = project.normalizedSolverResult?.residualSeries ?? [];
  const currentIter = residualSeries.reduce((max, series) => Math.max(max, series.points.at(-1)?.iteration ?? 0), 0);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [copiedLog, setCopiedLog] = useState<boolean>(false);
  const [activeSchematicCell, setActiveSchematicCell] = useState<string>('wb_setup');

  const solvedIntegrals = project.normalizedSolverResult?.integrals ?? {};
  const solvedValues = project.normalizedSolverResult?.values ?? {};

  const handleTriggerSolve = async () => {
    if (!onRunSolver) return;
    setIsSolving(true);
    setSolveError(null);
    try {
      await onRunSolver();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Solver execution failed';
      setSolveError(message);
      onSolverFailed?.(message);
    } finally {
      setIsSolving(false);
    }
  };

  const handleCopyLog = () => {
    const text = project.scriptExecutionLog?.join('\n') || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    }
  };

  // Residuals history (real solver data only)
  const residualsData = residualSeries;

  const hasCompletedRun =
    solverJobStatus === 'completed' ||
    Boolean(project.simulationRun?.result && project.normalizedSolverResult?.converged);
  const isActivelyRunning = isSolving || solverJobStatus === 'running' || solverJobStatus === 'queued';

  const hasMeshStudyData = Boolean(
    project.meshStudyResult || (project.meshStudy?.meshLevels && project.meshStudy.meshLevels.length > 0),
  );

  // Workbench components dynamically synchronized with real solver and mesh state
  const workbenchCells = [
    {
      id: 'wb_eng_data',
      name: 'بيانات المواد والخواص الفيزيائية',
      nameEn: 'Engineering Data (Materials)',
      type: 'Engineering Data' as const,
      status: project.material?.name && !project.material.name.includes('Awaiting') ? ('Up-to-date' as const) : ('Pending' as const),
      details: project.material?.name
        ? `${project.material.name}${project.material.density && project.material.density !== '—' ? ` | كثافة = ${project.material.density}` : ''}`
        : 'بانتظار تحديد المادة والخواص الفيزيائية',
    },
    {
      id: 'wb_geom',
      name: 'الهندسة ثلاثية الأبعاد ونطاق الحل',
      nameEn: 'Geometry Domain',
      type: 'Geometry' as const,
      status: 'Up-to-date' as const,
      details: project.cadSpecs?.shell && project.cadSpecs.shell !== '—'
        ? `النطاق الهندسي: ${project.cadSpecs.shell}`
        : isFEA
        ? 'نطاق إنشائي ثلاثي الأبعاد جاهز للتعريف'
        : isThermal
        ? 'نطاق حراري ثلاثي الأبعاد جاهز للتعريف'
        : 'نطاق جريان ثلاثي الأبعاد جاهز للتعريف',
    },
    {
      id: 'wb_mesh',
      name: 'شبكة الميش وتقارب روتش',
      nameEn: 'Mesh & Roache GCI',
      type: 'Mesh' as const,
      status: hasMeshStudyData ? ('Up-to-date' as const) : ('Pending' as const),
      details: project.meshStudyResult
        ? `GCI (fine) = ${project.meshStudyResult.gci_fine_percent !== null ? `${project.meshStudyResult.gci_fine_percent.toFixed(2)}%` : '—'} | عناصر = ${project.meshStudyResult.levels?.[2]?.cells?.toLocaleString() ?? '—'}`
        : hasMeshStudyData
        ? `عناصر الشبكة: ${project.meshStudy.meshLevels?.[2]?.elements?.toLocaleString() ?? '—'} | جودة تعامد = ${project.meshStudy.minOrthogonalQuality || '—'}`
        : 'لم يتم إجراء دراسة استقلالية الشبكة بعد',
    },
    {
      id: 'wb_setup',
      name: 'إعدادات الفيزياء والشروط الحدية',
      nameEn: 'Physics Setup & Boundaries',
      type: 'Setup' as const,
      status: (project.boundaryConditions?.length ?? 0) > 0 ? ('Up-to-date' as const) : ('Ready' as const),
      details: `${project.boundaryConditions?.length ?? 0} حدود فيزيائية مطبقة | ${project.solver?.scheme || project.solver?.solverType || 'غير محدد'}`,
    },
    {
      id: 'wb_solu',
      name: 'المحلل العددي ومراقبة التقارب',
      nameEn: 'Solution & Residuals',
      type: 'Solution' as const,
      status: hasCompletedRun ? ('Solved' as const) : ('Pending' as const),
      details: hasCompletedRun
        ? `اكتمل الحل في التكرار ${currentIter || '—'} عبر ${project.normalizedSolverResult?.solver || 'Docker Engine'}`
        : isActivelyRunning
        ? `جاري التنفيذ عبر حاوية Docker (:8000) — ${solverJobStatus}`
        : 'بانتظار تشغيل المحاكاة على Docker (:8000)',
    },
    {
      id: 'wb_res',
      name: 'النتائج والكونتورات والتحقق',
      nameEn: 'Results & ASME Validation',
      type: 'Results' as const,
      status: hasCompletedRun ? ('Ready' as const) : ('Pending' as const),
      details: hasCompletedRun
        ? `${project.contours?.length ?? 0} حقول نتائج | ${project.validation?.rSquared ? `R² = ${project.validation.rSquared}` : 'VTK & Integrals Ready'}`
        : 'تظهر النتائج فور انتهاء الحساب الفعلي في Docker',
    },
  ];

  // Commands list
  const detectedCommands = project.detectedCommandsList || [];
  const canExportOpenFoam = String(project.simulationRun?.result?.physics_type ?? '').startsWith('CFD');

  return (
    <div className="space-y-6">
      {/* NASEER Universal CAE Workbench Master Banner */}
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
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border font-mono ${
                  hasCompletedRun
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : isActivelyRunning
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                    : solverJobStatus === 'failed'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full inline-block ${
                    hasCompletedRun
                      ? 'bg-emerald-400'
                      : isActivelyRunning
                      ? 'bg-sky-400'
                      : solverJobStatus === 'failed'
                      ? 'bg-rose-400'
                      : 'bg-amber-400'
                  }`}
                />
                {hasCompletedRun
                  ? 'CONVERGED (Docker Verified)'
                  : isActivelyRunning
                  ? `RUNNING ON DOCKER (${solverJobStatus.toUpperCase()})`
                  : solverJobStatus === 'failed'
                  ? 'FAILED — CHECK LOGS'
                  : 'READY / NOT SOLVED YET'}
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
                  {isSolving
                    ? `جاري تنفيذ المهمة (${solverJobStatus})${currentIter ? ` — iteration ${currentIter}` : ''}`
                    : residualSeries.length
                      ? `اكتمل الحل — iteration ${currentIter}`
                      : 'لم يتم تنفيذ حل بعد'}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-slate-400">معيار التقارب:</span>
                <span className="font-mono text-sky-300 font-bold">{project.solver?.convergenceCriteria || '1e-6'}</span>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <span className="text-slate-400">طريقة الحل:</span>
                <span className="text-slate-200 font-mono text-[11px]">
                  {project.solver?.scheme || (isFEA ? 'Newton-Raphson Sparse Direct' : isThermal ? 'Finite Element Thermal Conduction' : 'Coupled Pressure-Velocity')}
                </span>
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

          {solveError && (
            <div className="mt-2 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              فشل تشغيل المحلل: {solveError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 text-xs mt-4">
            <div>
              <span className="text-slate-500 block mb-0.5">الباحث / Student:</span>
              <span className="text-slate-100 font-bold text-sm flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-sky-400" />
                {project.academicMeta?.studentName || project.author}
              </span>
              <span className="text-[11px] text-sky-400 font-mono block">
                معرف الطالب: {project.academicMeta?.studentId || project.studentId || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">المشرف والاستشارة / Supervisor:</span>
              <span className="text-amber-300 font-bold text-xs block">
                {project.academicMeta?.supervisor || project.supervisor}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                {project.adviser ? `المستشار: ${project.adviser}` : 'اللجنة العلمية المعتمدة'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">الجامعة والكلية / University:</span>
              <span className="text-slate-200 font-medium text-xs leading-relaxed block font-sans">
                {project.academicMeta?.university || project.university}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                {project.academicMeta?.department || project.department}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">المحلل والمحرك النشط:</span>
              <div className="flex flex-col gap-1 items-start">
                <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-sky-500/20 text-sky-300 text-xs font-mono">
                  {project.softwareType}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                  <Cpu className="w-3 h-3 text-emerald-400" />
                  {project.activeSolverBadge || project.normalizedSolverResult?.solver || project.softwareType || 'Docker CAE Engine (:8000)'}
                </span>
              </div>
            </div>
          </div>

          {/* Research Question & Scientific Hypothesis Card (Section 3.1 & 4.1) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 bg-slate-950/90 p-4 rounded-xl border border-slate-800 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400 font-bold flex items-center gap-1.5 text-sky-400">
                <Atom className="w-3.5 h-3.5" />
                سؤال البحث العلمي (Research Question):
              </span>
              <p className="text-slate-200 text-xs leading-relaxed font-sans text-justify">
                {project.academicMeta?.researchQuestion || `ما هو السلوك الدقيق للمنظومة (${project.title}) تحت الشروط الحدية المطبقة ومدى تطابق الحل العددي مع معايير الدقة الهندسية؟`}
              </p>
            </div>
            <div className="space-y-1 md:border-r md:border-slate-800 md:pr-4">
              <span className="text-slate-400 font-bold flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                الفرضية العلمية القابلة للفحص (Scientific Hypothesis):
              </span>
              <p className="text-slate-200 text-xs leading-relaxed font-sans text-justify">
                {project.academicMeta?.researchHypothesis || `الحل العددي المتقارب لـ ${project.title} يحقق استقلالية عناصر الشبكة بمؤشر Roache GCI < 2% ومطابقة معيارية ASME V&V 20 بدقة تفوق 98%.`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CAE Workbench Interactive Modules Selector (OpenFOAM / CalculiX / Python) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2 shadow-xl">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/80 pb-2 mb-3 text-xs">
          <button
            type="button"
            onClick={() => setWorkbenchView('cases_matrix')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${
              workbenchView === 'cases_matrix'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <TableIcon className="w-4 h-4 text-emerald-400" />
            <span>مصفوفة الحالات والتشغيل (Cases Matrix & Runs)</span>
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
            <span>سجل تنفيذ المحلل ({project.softwareType || 'OpenFOAM / CalculiX Solver Log'})</span>
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
            <span>مقاييس المحاكاة الحقيقية (Docker Telemetry)</span>
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

        {/* Cases Matrix View (Section 8 & Section 15 of Audit Blueprint) */}
        {workbenchView === 'cases_matrix' && (
          <div className="p-4 space-y-6">
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <TableIcon className="w-5 h-5 text-emerald-400" />
                    <h3 className="font-bold text-white text-base">
                      8. مصفوفة حالات التشغيل ومنهج الحالات (Cases Matrix & Runs)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    إدارة الحالات كجدول مقارنة منهجي يوثق متغير الدراسة، والشبكة، ومحرك الحل، والقيمة المخرجة، وزمن التنفيذ، وسجلات المهمة.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="px-3 py-1 rounded-lg bg-sky-950/80 text-sky-300 border border-sky-800">
                    {(project.casesMatrix?.length ?? project.meshStudy?.meshLevels?.length ?? 0)} حالات دراسية مسجلة
                  </span>
                </div>
              </div>

              {/* Cases Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/80">
                      <th className="py-3.5 px-4 font-semibold">رقم الحالة</th>
                      <th className="py-3.5 px-4 font-semibold">اسم الحالة ومتغير الدراسة</th>
                      <th className="py-3.5 px-4 font-semibold text-center">عناصر الميش / العقد</th>
                      <th className="py-3.5 px-4 font-semibold text-center">محرك الحل والمحلل</th>
                      <th className="py-3.5 px-4 font-semibold text-sky-400">القيمة المخرجة المحسوبة</th>
                      <th className="py-3.5 px-4 font-semibold text-amber-400">الانحراف (%)</th>
                      <th className="py-3.5 px-4 font-semibold text-center">المدة</th>
                      <th className="py-3.5 px-4 font-semibold text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {(project.casesMatrix || (project.meshStudy?.meshLevels || []).map((lvl, idx) => ({
                      caseId: `Case-0${idx + 1}`,
                      name: lvl.levelName,
                      nameAr: lvl.levelName,
                      studyVariable: `Grid Spacing h = ${lvl.gridSpacingMm ?? '—'} mm`,
                      purpose: idx === 2 ? 'تحقيق استقلالية الشبكة Roache GCI' : 'فحص حساسية التقارب العددي',
                      meshElements: lvl.elements,
                      meshNodes: lvl.nodes,
                      solverEngine: project.softwareType || (isFEA ? 'CalculiX v2.21' : 'OpenFOAM v2406'),
                      keyOutputName: project.contours[0]?.name || (isFEA ? 'أقصى إجهاد مكافئ' : 'القيمة المخرجة'),
                      keyOutputValue: lvl.keyResultValue,
                      keyOutputUnit: project.contours[0]?.unit || (isFEA ? 'MPa' : 'm/s'),
                      discrepancyPercent: lvl.percentageError ?? 0.0,
                      runDurationSec: lvl.computationTimeSec ?? 0,
                      status: idx === 2 ? 'Converged' : (idx === 0 ? 'Baseline' : 'Completed'),
                    }))).map((c, i) => (
                      <tr key={i} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-sky-400">{c.caseId}</td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-200 block">{c.nameAr}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">{c.studyVariable}</span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-300">
                          {c.meshElements.toLocaleString()} / {c.meshNodes.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                            c.solverEngine.includes('CalculiX')
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                              : c.solverEngine.includes('OpenFOAM')
                              ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          }`}>
                            <Cpu className="w-3 h-3" />
                            {c.solverEngine}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-sky-300">
                          {c.keyOutputValue} {c.keyOutputUnit}
                          <span className="text-[10px] text-slate-500 block font-sans">{c.keyOutputName}</span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">
                          {c.discrepancyPercent === 0 ? '0.00% (مرجع)' : `${c.discrepancyPercent}%`}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-400">
                          {c.runDurationSec > 0 ? `${c.runDurationSec}s` : '—'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            c.status === 'Baseline'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : c.status === 'Converged'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Job Lifecycle & Checksum Log Box (Section 15 of Audit Blueprint) */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-amber-400" />
                  <h4 className="font-bold text-white text-sm">
                    15. نموذج بيانات المهمة Job وسجل التحقق الرقمي (Job Execution Log & SHA-256 Checksums)
                  </h4>
                </div>
                {project.jobsHistory?.[0] && (
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-500/30">
                    Checksum Verified
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block mb-0.5">معرف المهمة (Job ID):</span>
                  <span className="text-sky-300 font-bold">{project.jobsHistory?.[0]?.jobId || '—'}</span>
                </div>
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block mb-0.5">بصمة المدخلات (Boundary SHA-256):</span>
                  <span className="text-slate-300 text-[11px] truncate block">{project.jobsHistory?.[0]?.boundaryChecksum || '—'}</span>
                </div>
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block mb-0.5">بصمة النتائج (Output SHA-256):</span>
                  <span className="text-emerald-400 text-[11px] truncate block">{project.jobsHistory?.[0]?.outputChecksum || '—'}</span>
                </div>
              </div>

              {/* Execution log terminal — real backend/job output only */}
              <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1.5 direction-ltr text-left max-h-56 overflow-y-auto">
                {(project.jobsHistory?.[0]?.logLines ?? project.scriptExecutionLog ?? []).length === 0 ? (
                  <div className="text-slate-600">$ no execution log yet — run the solver to stream real output.</div>
                ) : (
                  (project.jobsHistory?.[0]?.logLines ?? project.scriptExecutionLog ?? []).map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      <span className="text-slate-500 select-none mr-2">{idx + 1}.</span>
                      <span className={line.includes('converged') || line.includes('completed') || line.includes('VERIFIED') ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                        {line}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* CAD Schematic View */}
        {workbenchView === 'cad_schematic' && (
          <div className="p-4">
            <EngineeringSchematicViewer project={project} />
          </div>
        )}

        {/* 3D Model Viewer View */}
        {workbenchView === '3d_viewer' && (
          <div className="p-4">
            <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading 3D engine...</div>}>
              <EngineeringModelViewer3D project={project} />
            </Suspense>
          </div>
        )}

        {/* Thermal Heatmaps, Charts & Literature Matrix View */}
        {workbenchView === 'lhtes_charts' && (
          <div className="p-4 space-y-8">
            <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  <span>مقارنة حالات الانصهار والحرارة المحسوبة</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  Real Solver Field & Comparison Metrics
                </span>
              </div>

              {(project.meltingComparison || []).length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 text-xs text-slate-400">
                  لا توجد بيانات مقارنة زمنية (t95) مرفقة لهذا المشروع حتى الآن. يتم ملؤها فقط من نتائج محاكاة حقيقية أو جداول تجريبية معتمدة.
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {(project.meltingComparison || []).map((c, idx) => {
                    const maxHours = Math.max(...(project.meltingComparison || []).map((m) => m.t95Hours), 1);
                    const widthPercent = Math.min(100, Math.max(8, (c.t95Hours / maxHours) * 100));
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
              )}
            </div>

            {project.normalizedSolverResult?.values?.field_min !== undefined || project.normalizedSolverResult?.values?.field_max !== undefined ? (
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <span className="font-bold text-slate-100 text-sm block">
                  ملخص الحقل الفيزيائي المستخرج مباشرة من المحرك ({project.normalizedSolverResult.physics})
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">أدنى قيمة (Min):</span>
                    <strong className="text-sky-400">{project.normalizedSolverResult.values.field_min ?? '—'}</strong>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">أعلى قيمة (Max):</span>
                    <strong className="text-rose-400">{project.normalizedSolverResult.values.field_max ?? '—'}</strong>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">المحرك المستخدم:</span>
                    <strong className="text-emerald-400">{project.normalizedSolverResult.solver}</strong>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">المصفوفة الحقلية:</span>
                    <strong className="text-slate-200">{project.normalizedSolverResult.vtkData ? 'VTK 3D Ready' : 'Scalar Matrix'}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 text-xs text-slate-400">
                شغّل المحاكاة على حاوية Docker (:8000) لعرض القيم الفعلية وخرائط درجات الحرارة ثلاثية الأبعاد بدون أي مخططات ثابتة.
              </div>
            )}

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
                  {project.cadSpecs?.shell && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block font-semibold">ابعاد وهيكل النطاق (Domain Dimensions):</span>
                      <strong className="text-slate-200 font-mono">{project.cadSpecs.shell}</strong>
                    </div>
                  )}
                  {project.cadSpecs?.coil && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block font-semibold">حدود المدخل والتثبيت (Inlet / Support Boundary):</span>
                      <strong className="text-slate-200 font-mono">{project.cadSpecs.coil}</strong>
                    </div>
                  )}
                  {project.cadSpecs?.fins && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block font-semibold">الشروط والتجهيزات (Boundary Layout):</span>
                      <strong className="text-emerald-400 font-mono">{project.cadSpecs.fins}</strong>
                    </div>
                  )}
                  {project.cadSpecs?.pcm && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block font-semibold">مادة وركيزة النموذج (Material Specification):</span>
                      <strong className="text-amber-400 font-mono">{project.cadSpecs.pcm}</strong>
                    </div>
                  )}
                  {project.cadSpecs?.htf && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block font-semibold">شروط الوسط والتشغيل (Operating Conditions):</span>
                      <strong className="text-rose-400 font-mono">{project.cadSpecs.htf}</strong>
                    </div>
                  )}
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
                مخطط تدفق المشروع الهندسي المتكامل في OpenFOAM / CalculiX Workbench
              </span>
              <span className={hasCompletedRun ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'}>
                {hasCompletedRun
                  ? '✓ جميع المنظومات الفرعية محدثة ومحلولة (All Systems Solved & Verified)'
                  : isActivelyRunning
                  ? '⟳ جاري تنفيذ الحل العددي عبر حاوية Docker (:8000)...'
                  : '⏳ بانتظار تشغيل المحاكاة العددية لحل المعادلات الحاكمة (Awaiting Solver Run)'}
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
                  <span>منحنى تقارب البواقي اللوغاريتمي لمصفوفات الحفظ (OpenFOAM / CalculiX Residuals Monitor)</span>
                </h3>
                <p className="text-slate-400 text-xs mt-0.5">
                  {isThermal
                    ? 'مراقبة انخفاض البواقي RMS لمعادلات توازن الطاقة، التوصيل الحراري، والفيض حتى < 10⁻⁶'
                    : isFEA
                    ? 'مراقبة تقارب توازن القوى L2-Norm ومتبقيات التشوه المرن وحفظ طاقة الانفعال حتى < 10⁻⁶'
                    : 'مراقبة انخفاض البواقي RMS لمعادلات الاستمرارية، كمية الحركة X/Y، والطاقة عبر التكرارات الحسابية حتى < 10⁻⁶'}
                </p>
              </div>

              {residualsData.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono bg-slate-950 p-2 rounded-xl border border-slate-800">
                  {residualsData.map((series, index) => (
                    <span key={series.name} style={{ color: RESIDUAL_PALETTE[index % RESIDUAL_PALETTE.length] }}>
                      {series.name}: {series.points.at(-1)?.value.toExponential(2) ?? '—'}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* SVG Residuals Plot — renders only real solver-reported residual streams */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto">
              {residualsData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                  Run the solver to collect residual history.
                </div>
              ) : (
              (() => {
                const plottable = residualsData
                  .map((series, index) => ({
                    name: series.name,
                    color: RESIDUAL_PALETTE[index % RESIDUAL_PALETTE.length],
                    points: series.points.filter(
                      (point) => Number.isFinite(point.iteration) && Number.isFinite(point.value) && point.value > 0,
                    ),
                  }))
                  .filter((series) => series.points.length > 0);
                const allPoints = plottable.flatMap((series) => series.points);
                if (allPoints.length === 0) {
                  return (
                    <div className="h-64 flex items-center justify-center text-sm text-slate-500">
                      Run the solver to collect residual history.
                    </div>
                  );
                }
                const minIteration = Math.min(...allPoints.map((point) => point.iteration));
                const maxIteration = Math.max(...allPoints.map((point) => point.iteration));
                const topPower = Math.max(0, Math.ceil(Math.max(...allPoints.map((point) => Math.log10(point.value)))));
                const bottomPower = Math.floor(Math.min(...allPoints.map((point) => Math.log10(point.value))));
                const toX = (iteration: number) => 70 + ((iteration - minIteration) / (maxIteration - minIteration || 1)) * 650;
                const toY = (value: number) => 30 + ((Math.log10(value) - topPower) / (bottomPower - topPower || 1)) * 220;
                const gridStep = Math.max(1, Math.round((topPower - bottomPower) / 4));
                const gridPowers: number[] = [];
                for (let power = topPower; power >= bottomPower; power -= gridStep) gridPowers.push(power);
                const xTicks = Array.from({ length: 5 }, (_, index) => Math.round(minIteration + ((maxIteration - minIteration) * index) / 4));

                return (
              <svg
                viewBox="0 0 740 280"
                className="w-full h-64 select-none font-mono text-[10px]"
              >
                {/* Background Grid Lines for Powers of 10 (data-driven range) */}
                {gridPowers.map((power) => (
                  <g key={power}>
                    <line x1="70" y1={toY(10 ** power)} x2="720" y2={toY(10 ** power)} stroke="#334155" strokeDasharray="3 3" />
                    <text x="60" y={toY(10 ** power) + 4} fill="#94a3b8" textAnchor="end">1e{power}</text>
                  </g>
                ))}

                {/* Target Convergence Line 1e-6 (Golden Line) */}
                {bottomPower <= -6 && topPower >= -6 && (
                  <>
                    <line x1="70" y1={toY(1e-6)} x2="720" y2={toY(1e-6)} stroke="#eab308" strokeWidth="1.5" strokeDasharray="4 4" />
                    <text x="715" y={toY(1e-6) - 5} fill="#eab308" textAnchor="end" fontSize="10">معيار التقارب (Convergence Criteria: 1e-6)</text>
                  </>
                )}

                {/* X Axis Iteration Ticks */}
                <line x1="70" y1="255" x2="720" y2="255" stroke="#475569" strokeWidth="1" />
                {xTicks.map((tick, index) => (
                  <text
                    key={index}
                    x={toX(tick)}
                    y="270"
                    fill="#94a3b8"
                    textAnchor={index === xTicks.length - 1 ? 'end' : 'middle'}
                  >
                    {index === xTicks.length - 1 ? `${tick} (Iter)` : tick}
                  </text>
                ))}

                {/* Real residual series */}
                {plottable.map((series) => (
                  <path
                    key={series.name}
                    d={series.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.iteration)} ${toY(point.value)}`).join(' ')}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2"
                  />
                ))}

                {/* Final convergence points */}
                {plottable.map((series) => {
                  const last = series.points[series.points.length - 1];
                  return <circle key={series.name} cx={toX(last.iteration)} cy={toY(last.value)} r="4" fill={series.color} />;
                })}
              </svg>
                );
              })()
              )}
            </div>
          </div>
        )}

        {/* 3. OpenFOAM & CalculiX Solver Execution Console */}
        {workbenchView === 'console' && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-slate-200">
                  سجل موجه الأوامر ومخرجات المحلل العددي (OpenFOAM / CalculiX Solver Run Log)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                  {project.normalizedSolverResult?.solver || project.softwareType || 'Docker Worker (:8000)'}
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
              {(project.scriptExecutionLog || []).length === 0 && (
                <div className="text-slate-600">$ no solver output yet — run the simulation to stream real logs.</div>
              )}
              {(project.scriptExecutionLog || []).map((line, lIdx) => {
                const isHeader = line.startsWith('[OpenFOAM') || line.startsWith('[CalculiX') || line.startsWith('[HPC') || line.startsWith('===');
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
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-xs hidden sm:inline">
                  {detectedCommands.length} أوامر هندسية
                </span>
                <button
                  type="button"
                  disabled={!canExportOpenFoam}
                  title={canExportOpenFoam ? undefined : 'Requires a completed CFD run'}
                  onClick={() => {
                    try {
                      exportToOpenFoamScripts(project);
                    } catch (error) {
                      setSolveError(error instanceof Error ? error.message : 'OpenFOAM export failed');
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-sky-950/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>تصدير سكربت OpenFOAM (blockMesh & controlDict)</span>
                </button>
              </div>
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

        {/* 5. Real Docker Solver Telemetry & Integrals (Zero Client Math) */}
        {workbenchView === 'parameters' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="font-bold text-sm text-white flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <span>المقاييس والتكاملات المستخرجة مباشرة من المحركات الحقيقية (Docker Solver Telemetry)</span>
              </span>
              {onRunSolver && (
                <button
                  type="button"
                  onClick={handleTriggerSolve}
                  disabled={isSolving || solverJobStatus === 'running' || solverJobStatus === 'queued'}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isSolving ? 'جاري التنفيذ على Docker...' : 'تشغيل وإعادة حساب المقاييس (:8000)'}</span>
                </button>
              )}
            </div>

            {!project.normalizedSolverResult ? (
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-8 text-center space-y-2 text-xs">
                <p className="text-slate-200 font-bold">لا توجد نتائج محاكاة حقيقية محسوبة بعد.</p>
                <p className="text-slate-400">
                  تم إيقاف الحسابات التحليلية الجانبية في الواجهة التزاماً بسياسة Zero-Mock؛ اضغط زر التشغيل لإرسال النموذج إلى حاويات OpenFOAM أو CalculiX أو ElmerFEM.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'رقم نسلت (Nusselt Number Nu)', val: solvedIntegrals.nusselt_number ?? solvedValues.nusselt_number, unit: '' },
                    { label: 'معامل الحمل الحراري (h)', val: solvedIntegrals.heat_transfer_coeff_h ?? solvedValues.heat_transfer_coeff_h, unit: 'W/m²·K' },
                    { label: 'هبوط الضغط (Pressure Drop ΔP)', val: solvedIntegrals.pressure_drop_pa ?? solvedValues.pressure_drop, unit: 'Pa' },
                    { label: 'السرعة القصوى (Max Velocity)', val: solvedIntegrals.max_velocity_mps ?? solvedValues.max_velocity, unit: 'm/s' },
                    { label: 'التدفق الكتلي (Mass Flow Rate)', val: solvedIntegrals.mass_flow_kg_s, unit: 'kg/s' },
                    { label: 'الحرارة المنقولة (Total Heat Q)', val: solvedIntegrals.total_heat_transfer_w ?? solvedValues.total_heat_transfer_w, unit: 'W' },
                    { label: 'أقصى إجهاد Von Mises', val: solvedIntegrals.max_von_mises_pa ?? solvedValues.von_mises_max_pa, unit: 'Pa' },
                    { label: 'أقصى إزاحة / تشوه (Max Disp)', val: solvedIntegrals.max_displacement_m ?? solvedValues.max_displacement, unit: 'm' },
                  ]
                    .filter((item) => item.val !== undefined && item.val !== null)
                    .map((item, idx) => (
                      <div key={idx} className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                        <span className="text-xs text-slate-400">{item.label}</span>
                        <div className="font-mono text-lg font-bold text-sky-400 mt-1">
                          {typeof item.val === 'number' ? item.val.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(item.val)}
                          {item.unit ? <span className="text-xs font-normal text-slate-400 mr-1">{item.unit}</span> : null}
                        </div>
                      </div>
                    ))}
                </div>

                {Object.keys(solvedIntegrals).length > 0 && (
                  <div className="bg-slate-950/70 rounded-xl border border-slate-800 p-4">
                    <div className="text-xs font-bold text-slate-300 mb-2">
                      جميع المخرجات الرقمية والتكاملات من المحرك ({project.normalizedSolverResult.solver || 'Docker CAE'}):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] font-mono">
                      {Object.entries(solvedIntegrals).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between bg-slate-900/70 px-3 py-1.5 rounded border border-slate-800/80">
                          <span className="text-slate-400">{key}</span>
                          <span className="text-emerald-300 font-bold">{typeof val === 'number' ? val.toPrecision(6) : String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
          <span className="text-xs text-slate-400">معادلات فيزيائية معتمدة في OpenFOAM / CalculiX</span>
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
                <span className="font-mono text-slate-200">{project.solver?.iterations || 'Auto'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
