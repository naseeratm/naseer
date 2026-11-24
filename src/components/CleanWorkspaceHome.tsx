import React, { useState, useRef } from 'react';
import {
  Upload,
  Plus,
  FolderOpen,
  Box,
  Grid3X3,
  Sliders,
  Cpu,
  FileText,
  ShieldCheck,
  Loader2,
  ChevronLeft,
  ArrowLeft,
  Server,
} from 'lucide-react';
import { ThesisProject, IngestedFileItem } from '../types/thesis';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';

interface CleanWorkspaceHomeProps {
  onStartProject: (project: ThesisProject) => void;
  onOpenNewProjectWizard?: () => void;
  onOpenProjectsLibrary?: () => void;
  onOpenUploadModal?: () => void;
  onOpenCloudSettings?: () => void;
  onOpenAuditModal?: () => void;
  onOpenMeshGenerator?: () => void;
  onOpenMaterialsModal?: () => void;
  onOpenParametricSweep?: () => void;
  savedProjectsCount?: number;
  onResetWorkspace?: () => void;
}

type WorkflowStageId = 'geometry' | 'mesh' | 'physics' | 'solver' | 'report';

interface WorkflowStageSpec {
  id: WorkflowStageId;
  order: string;
  titleAr: string;
  titleEn: string;
  shortDescAr: string;
  roleAr: string;
  uiPathAr: string;
  engineLabel: string;
  sizingRuleAr: string;
  ctaLabelAr: string;
  icon: React.FC<{ className?: string }>;
}

const WORKFLOW_STAGES: WorkflowStageSpec[] = [
  {
    id: 'geometry',
    order: '01',
    titleAr: 'النموذج والهندسة',
    titleEn: 'Geometry & CAD',
    shortDescAr: 'رفع ملفات CAD ثلاثية الأبعاد أو تحديد أبعاد النطاق',
    roleAr:
      'تبدأ أي محاكاة هندسية بتعريف الشكل الفيزيائي للمسألة: إما باستيراد ملف CAD حقيقي (.STEP / .IGES / .STL / .INP) لتقطيع أسطحه وتسميتها تلقائياً، أو بإنشاء مشروع جديد وتحديد أبعاد الصندوق الهندسي (Width × Height × Depth) بوحدة المتر (SI).',
    uiPathAr: 'Project ← New Project  أو  1. Geometry ← Import Model',
    engineLabel: 'Gmsh OpenCASCADE · STL/INP Parser',
    sizingRuleAr:
      'تأكد دائماً من وحدة الأبعاد بالمتر (m) قبل الانتقال للشبكة؛ فمثلاً أنبوب بقطر 20 ملم يُدخل 0.02 m وليس 20.',
    ctaLabelAr: 'رفع نموذج CAD / إنشاء مشروع',
    icon: Box,
  },
  {
    id: 'mesh',
    order: '02',
    titleAr: 'توليد الشبكة',
    titleEn: 'Mesh Generation',
    shortDescAr: 'تحديد حجم الخلية h ورتبة العنصر والطبقات الحدية',
    roleAr:
      'يقوم مولّد Gmsh 3D بفحص جودة العناصر الهندسية (minSICN و Skewness) وتوليد شبكات CalculiX و ElmerFEM ومعاينة أسطح الـ CAD، بينما يستخدم OpenFOAM قيمة حجم الخلية المعتمدة لبناء الشبكة الحجمية (blockMesh أو snappyHexMesh للنفق الهوائي). بعد المعاينة اضغط «اعتماد شبكة Gmsh بالمشروع» لنقل الإعدادات تلقائياً.',
    uiPathAr: '2. Mesh ← Mesh Generator (Gmsh) ← اعتماد شبكة Gmsh بالمشروع',
    engineLabel: 'Gmsh 4.15 3D · OpenFOAM blockMesh / snappyHexMesh',
    sizingRuleAr:
      'قاعدة البداية: اجعل حجم الخلية الابتدائي h بين 1/10 إلى 1/20 من أصغر بُعد مؤثر. استخدم 1st Order مع 3–8 طبقات Inflation في الموائع المضطربة (CFD)، و 2nd Order مع Inflation = 0 في التحليل الإنشائي (FEA).',
    ctaLabelAr: 'فتح مولّد الشبيكات (Gmsh)',
    icon: Grid3X3,
  },
  {
    id: 'physics',
    order: '03',
    titleAr: 'الفيزياء والشروط الحدية',
    titleEn: 'Physics & Boundaries',
    shortDescAr: 'اختيار المادة ونموذج الاضطراب أو اللدونة والسرعات والأحمال',
    roleAr:
      'تُحدَّد هنا الخواص الفيزيائية الحقيقية للمادة أو المائع (الكثافة، اللزوجة، التوصيل الحراري، معامل يونغ، إجهاد الخضوع) من قاعدة البيانات أو معالج القنوات النانوية، ثم تُعيَّن الشروط الحدية (المدخل، المخرج، الجدار الحراري، التثبيت، والأحمال) مباشرةً في لوحة الخصائص أو بالنقر على الأسطح ثلاثية الأبعاد.',
    uiPathAr: '3. Physics ← Materials Database / Duct Wizard ثم 4. Boundaries',
    engineLabel: 'OpenFOAM · CalculiX · ElmerFEM Dictionaries',
    sizingRuleAr:
      'استخدم نموذج k-ω SST للجريان المضطرب قرب الجدران، واللدونة أو التلامس غير الخطي في CalculiX عند تجاوز إجهاد الخضوع.',
    ctaLabelAr: 'بدء إعداد مشروع فيزيائي جديد',
    icon: Sliders,
  },
  {
    id: 'solver',
    order: '04',
    titleAr: 'الحل المتوازي و GCI',
    titleEn: 'Solver & GCI Study',
    shortDescAr: 'تشغيل محركات Docker الحية ومراقبة التقارب واستقلالية الشبكة',
    roleAr:
      'يُرسَل ملف الحالة الحقيقي إلى عنقود Docker عبر Celery/Redis ليُحلّ بالتوازي على الأنوية المتاحة (MPI)، مع بثّ فوري لسجل المحلل ومنحنيات بواقي التقارب (Residuals). بعد نجاح التشغيل الأول، شغّل دراسة استقلالية الشبكة (Mesh Study — GCI) على 3 شبكات متدرجة لإثبات عدم اعتماد الحل على حجم الخلية.',
    uiPathAr: 'الشريط العلوي ← Run Simulation  ثم  2. Mesh ← Mesh Study (GCI)',
    engineLabel: 'OpenFOAM v2406 · CalculiX · ElmerSolver (MPI)',
    sizingRuleAr:
      'تكون الشبكة معتمدة علمياً وفق معيار ASME V&V 20 عند تحقق GCI_fine ≤ 2% ونسبة تنعيم r ≥ 1.3 ونسبة نطاق مقارب قريبة من 1.0.',
    ctaLabelAr: 'فحص عنقود Docker والمحركات',
    icon: Cpu,
  },
  {
    id: 'report',
    order: '05',
    titleAr: 'النتائج والتقرير المعتمد',
    titleEn: 'Post-Processing & Report',
    shortDescAr: 'الكونتورات 3D، المطابقة المرجعية، وتقرير توافق الميش التلقائي',
    roleAr:
      'تُعرض حقول السرعة والضغط والحرارة وإجهاد فون ميسيس ثلاثية الأبعاد، وتُقارَن المقاطع بالبيانات المرجعية (Validation). عند التصدير إلى Word أو HTML أو LaTeX، تُدرج المنصة تلقائياً جدول «توافق جودة الشبكة (Mesh Quality Compliance)» مع التوصية الهندسية النهائية وحساب حجم الخلية المستهدف h_target عند الحاجة، إضافةً لحزمة ملفات المحلل (.zip).',
    uiPathAr: '7. Post-Processing ← Certified Report  أو  Export ← Word / LaTeX / ZIP',
    engineLabel: 'VTK 3D Renderer · ASME V&V 20 Compliance Engine',
    sizingRuleAr:
      'يمكنك أيضاً تشغيل شهادات التحقق القياسية الستة (V&V Certification) لتوثيق دقة المحركات ببصمة SHA-256 قبل تسليم التقرير.',
    ctaLabelAr: 'فتح مكتبة المشاريع والتقارير',
    icon: FileText,
  },
];

export const CleanWorkspaceHome: React.FC<CleanWorkspaceHomeProps> = ({
  onStartProject,
  onOpenNewProjectWizard,
  onOpenProjectsLibrary,
  onOpenUploadModal,
  onOpenCloudSettings,
  onOpenAuditModal,
  onOpenMeshGenerator,
  savedProjectsCount = 0,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const [activeStageId, setActiveStageId] = useState<WorkflowStageId>('geometry');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeStage = WORKFLOW_STAGES.find((stage) => stage.id === activeStageId) ?? WORKFLOW_STAGES[0];
  const activeIndex = WORKFLOW_STAGES.findIndex((stage) => stage.id === activeStage.id);

  const handleCadImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);

    try {
      const file = files[0];
      const results = await parseEngineeringFilesOrArchive(file);
      const parsedItems: IngestedFileItem[] = results.map((parsed) => ({
        id: parsed.id,
        name: parsed.name,
        size: parsed.size,
        extension: parsed.extension,
        mimeType: parsed.mimeType,
        category: parsed.category,
        content: parsed.content,
        base64Data: parsed.base64Data,
        isImage: parsed.isImage,
        isArchive: parsed.isArchive,
        parentArchiveName: parsed.parentArchiveName,
        archiveFilesCount: parsed.archiveFilesCount,
        archiveTree: parsed.archiveTree,
        parsedLines: parsed.parsedLines,
        sheetCount: parsed.sheetCount,
        sheetsData: parsed.sheetsData,
        summary: parsed.summary,
        detectedParameters: parsed.detectedParameters,
        status: parsed.status,
        errorMessage: parsed.errorMessage,
      }));

      const project = generateLocalEngineeringProject(
        file.name,
        '',
        'CFD',
        parsedItems[0]?.content || '',
        parsedItems,
      );
      onStartProject(project);
    } catch (err) {
      console.error('CAD Import Error:', err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const triggerStageAction = (stageId: WorkflowStageId) => {
    switch (stageId) {
      case 'geometry':
        if (onOpenUploadModal) {
          onOpenUploadModal();
        } else {
          fileInputRef.current?.click();
        }
        break;
      case 'mesh':
        if (onOpenMeshGenerator) {
          onOpenMeshGenerator();
        } else if (onOpenNewProjectWizard) {
          onOpenNewProjectWizard();
        }
        break;
      case 'physics':
        if (onOpenNewProjectWizard) {
          onOpenNewProjectWizard();
        } else {
          onStartProject(generateLocalEngineeringProject('untitled_case.stl', '', 'CFD'));
        }
        break;
      case 'solver':
        if (onOpenCloudSettings) {
          onOpenCloudSettings();
        } else if (onOpenAuditModal) {
          onOpenAuditModal();
        }
        break;
      case 'report':
        if (onOpenProjectsLibrary) {
          onOpenProjectsLibrary();
        }
        break;
    }
  };

  return (
    <div dir="rtl" className="mx-auto w-full max-w-6xl py-2 space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.step,.stp,.iges,.igs,.obj,.inp,.msh,.zip"
        className="hidden"
        onChange={(e) => handleCadImport(e.target.files)}
      />

      {/* Top Launchpad Header & Primary Actions */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-sky-400">NASEER Universal CAE Workbench</span>
              <span aria-hidden="true">·</span>
              <span>OpenFOAM · CalculiX · Gmsh · ElmerFEM</span>
              <span aria-hidden="true">·</span>
              <span>SI Units (m, kg, s, K, Pa)</span>
            </div>
            <h1 className="text-xl font-bold text-slate-50 tracking-tight text-balance">
              بدء محاكاة هندسية جديدة ودليل دورة حياة المشروع
            </h1>
            <p className="text-xs leading-relaxed text-slate-400">
              أنشئ دراسة متعددة الفيزياء، استورد نموذج CAD ثلاثي الأبعاد، أو اتبع الخريطة التفاعلية أدناه لتنفيذ مراحل المحاكاة بالترتيب القياسي من الهندسة حتى تقرير توافق الشبكة المعتمد.
            </p>
          </div>

          {onOpenAuditModal && (
            <button
              type="button"
              onClick={onOpenAuditModal}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-200 whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>شهادات التحقق ASME V&V 20</span>
            </button>
          )}
        </div>

        {/* 3 Primary Launch Actions */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              if (onOpenNewProjectWizard) {
                onOpenNewProjectWizard();
              } else {
                onStartProject(generateLocalEngineeringProject('untitled_case.stl', '', 'CFD'));
              }
            }}
            className="flex items-center justify-between gap-4 rounded-lg bg-sky-600 px-4 py-3.5 text-right text-white transition-colors hover:bg-sky-500"
          >
            <div className="space-y-0.5">
              <div className="text-sm font-semibold">مشروع جديد (New Project)</div>
              <div className="text-[11.5px] text-sky-100/85">CFD · FEA · Thermal · Multiphysics</div>
            </div>
            <Plus className="h-5 w-5 shrink-0" />
          </button>

          <button
            type="button"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3.5 text-right transition-colors hover:border-sky-500/50 hover:bg-slate-900"
          >
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-100">رفع نموذج (Import CAD / Deck)</div>
              <div className="text-[11.5px] font-mono text-slate-400">.STL · .STEP · .IGES · .INP · .ZIP</div>
            </div>
            {isImporting ? (
              <Loader2 className="h-5 w-5 animate-spin text-sky-400 shrink-0" />
            ) : (
              <Upload className="h-5 w-5 text-sky-400 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenProjectsLibrary?.()}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3.5 text-right transition-colors hover:border-slate-700 hover:bg-slate-900"
          >
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-100">مكتبة المشاريع (Open Project)</div>
              <div className="text-[11.5px] text-slate-400 tabular-nums">
                {savedProjectsCount} حالة محفوظة في مساحة العمل
              </div>
            </div>
            <FolderOpen className="h-5 w-5 text-slate-300 shrink-0" />
          </button>
        </div>
      </section>

      {/* Interactive Visual Project Lifecycle (Workflow Guide) */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-6 space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-100">
              دورة حياة المشروع الهندسي — ترتيب استخدام أزرار المنصة
            </h2>
            <p className="text-xs text-slate-400">
              انقر على أي مرحلة من المراحل الخمس لاستعراض دورها العلمي، الزر الدقيق في المنصة، المحرك الفعلي المسؤول، وقاعدة ضبط الإعدادات.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-400">
            المرحلة {activeIndex + 1} / {WORKFLOW_STAGES.length} · {activeStage.titleEn}
          </div>
        </div>

        {/* Visual 5-Step Pipeline Bar */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5" role="tablist" aria-label="دورة حياة المشروع الهندسي">
          {WORKFLOW_STAGES.map((stage, idx) => {
            const StageIcon = stage.icon;
            const isActive = stage.id === activeStage.id;
            return (
              <div key={stage.id} className="relative flex items-stretch">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveStageId(stage.id)}
                  className={`flex w-full flex-col justify-between gap-3 rounded-lg border p-4 text-right transition-colors ${
                    isActive
                      ? 'border-sky-500 bg-sky-950/35 text-slate-50'
                      : 'border-slate-800 bg-slate-950/75 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        isActive ? 'text-sky-400' : 'text-slate-500'
                      }`}
                    >
                      {stage.order}
                    </span>
                    <StageIcon className={`h-4 w-4 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[13px] font-semibold leading-snug">{stage.titleAr}</div>
                    <div className="text-[11px] font-mono text-slate-400">{stage.titleEn}</div>
                    <p className="pt-1 text-[11.5px] leading-relaxed text-slate-400">{stage.shortDescAr}</p>
                  </div>
                </button>
                {idx < WORKFLOW_STAGES.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="hidden lg:flex items-center justify-center -ml-2.5 mr-0.5 z-10 text-slate-600 pointer-events-none"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Active Stage Detailed Engineering Breakdown */}
        <div className="border-t border-slate-800 pt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono font-semibold text-sky-400">المرحلة {activeStage.order}</span>
              <span aria-hidden="true">·</span>
              <span>{activeStage.titleEn}</span>
            </div>
            <h3 className="text-base font-semibold text-slate-100">{activeStage.titleAr}</h3>
            <p className="text-[13px] leading-7 text-slate-300">{activeStage.roleAr}</p>

            <div className="pt-2 space-y-1.5 border-t border-slate-800/80">
              <div className="text-[11.5px] font-semibold text-amber-300">قاعدة الضبط الهندسي السريعة</div>
              <p className="text-[12.5px] leading-relaxed text-slate-300">{activeStage.sizingRuleAr}</p>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between gap-4 border-t border-slate-800 pt-4 lg:border-t-0 lg:border-r lg:border-slate-800 lg:pt-0 lg:pr-6">
            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <div className="text-slate-500">مسار الزر داخل المنصة</div>
                <div dir="ltr" className="font-mono text-[12px] text-slate-100 text-right">
                  {activeStage.uiPathAr}
                </div>
              </div>
              <div className="space-y-1 border-t border-slate-800/80 pt-3">
                <div className="text-slate-500">المحرك الفعلي المسؤول (Docker :8000)</div>
                <div dir="ltr" className="font-mono text-[12px] text-sky-300 text-right">
                  {activeStage.engineLabel}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => triggerStageAction(activeStage.id)}
                className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 whitespace-nowrap"
              >
                <span>{activeStage.ctaLabelAr}</span>
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={activeIndex === 0}
                  onClick={() => setActiveStageId(WORKFLOW_STAGES[activeIndex - 1].id)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                >
                  السابق
                </button>
                <button
                  type="button"
                  disabled={activeIndex === WORKFLOW_STAGES.length - 1}
                  onClick={() => setActiveStageId(WORKFLOW_STAGES[activeIndex + 1].id)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                >
                  المرحلة التالية
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Compact Quick Reference Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          <span>التسلسل القياسي: Geometry ← Mesh (Gmsh / OpenFOAM) ← Physics & Boundaries ← Solver & GCI ← Certified Report</span>
        </div>
        {onOpenCloudSettings && (
          <button
            type="button"
            onClick={onOpenCloudSettings}
            className="text-sky-400 hover:text-sky-300 transition-colors whitespace-nowrap"
          >
            إعدادات عنقود Docker وعدد الأنوية
          </button>
        )}
      </footer>
    </div>
  );
};