import React, { useState, useRef } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Building2,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Flame,
  FlaskConical,
  FolderOpen,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { VV_BENCHMARK_TEMPLATES, VVBenchmarkTemplate } from '../data/vvBenchmarks';
import { exportToJournalHTML, exportToWordDocument, hasRealSimulationRun } from '../utils/exporter';

interface ProjectsLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ThesisProject[];
  currentProjectId?: string;
  onSelectProject: (project: ThesisProject) => void;
  onSelectBenchmarkTemplate?: (template: VVBenchmarkTemplate) => void;
  onStartBlankProject: () => void;
  onOpenNewProjectWizard?: () => void;
  onDeleteProject?: (projectId: string) => void;
  onClearCustomProjects?: () => void;
  onImportProject?: (project: ThesisProject) => void;
  onOpenVVCertification?: () => void;
}

type LibraryTab = 'saved' | 'benchmarks';

export const ProjectsLibraryModal: React.FC<ProjectsLibraryModalProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onSelectBenchmarkTemplate,
  onStartBlankProject,
  onOpenNewProjectWizard,
  onDeleteProject,
  onClearCustomProjects,
  onImportProject,
  onOpenVVCertification,
}) => {
  const [activeTab, setActiveTab] = useState<LibraryTab>('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedField, setSelectedField] = useState<string>('all');
  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      p.title.toLowerCase().includes(q) ||
      (p.titleEn && p.titleEn.toLowerCase().includes(q)) ||
      (p.author && p.author.toLowerCase().includes(q)) ||
      (p.university && p.university.toLowerCase().includes(q)) ||
      (p.softwareType && p.softwareType.toLowerCase().includes(q));

    const matchesField =
      selectedField === 'all' ||
      p.field.toLowerCase() === selectedField.toLowerCase();

    return matchesSearch && matchesField;
  });

  const getDomainIcon = (field: string) => {
    switch (field) {
      case 'Thermal':
        return <Flame className="w-5 h-5 text-amber-400" />;
      case 'CFD':
        return <Wind className="w-5 h-5 text-sky-400" />;
      case 'FEA':
        return <Cpu className="w-5 h-5 text-emerald-400" />;
      case 'Electromagnetic':
        return <Zap className="w-5 h-5 text-violet-400" />;
      default:
        return <Layers className="w-5 h-5 text-indigo-400" />;
    }
  };

  const getDomainBadge = (field: string) => {
    switch (field) {
      case 'Thermal':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
            Thermal · Heat Transfer
          </span>
        );
      case 'CFD':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
            CFD · Fluid Dynamics
          </span>
        );
      case 'FEA':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            FEA · Structural Mechanics
          </span>
        );
      case 'Electromagnetic':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-violet-500/15 text-violet-300 border border-violet-500/30">
            EM · Electromagnetics
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            Multiphysics CAE
          </span>
        );
    }
  };

  const handleExportJSON = () => {
    if (projects.length === 0) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(projects, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `naseer_cae_projects_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const importedList: ThesisProject[] = Array.isArray(parsed) ? parsed : [parsed];
        if (importedList.length === 0 || !importedList[0]?.title) {
          setImportError('الملف لا يحتوي على بنية مشروع CAE صالحة.');
          return;
        }
        onImportProject?.(importedList[0]);
      } catch {
        setImportError('تعذر قراءة ملف JSON: يرجى التأكد من سلامة تنسيق الملف.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center shadow-lg shadow-sky-950/50">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                  إدارة المشاريع وقوالب التحقق القياسية (Projects &amp; V&amp;V Hub)
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  {projects.length} مشروع محفوظ
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {VV_BENCHMARK_TEMPLATES.length} قوالب V&amp;V حية
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                إدارة مشاريعك المحفوظة أو تحميل القوالب الـ 6 القياسية الموحّدة (صفر نتائج مسبقة) لاختبار OpenFOAM و CalculiX و ElmerFEM حياً
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Mode Tabs */}
        <div className="px-6 pt-3 bg-slate-950/80 border-b border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'saved'
                ? 'border-sky-500 text-sky-300 bg-sky-500/5 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            <span>مشاريعي المحفوظة ({projects.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('benchmarks')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'benchmarks'
                ? 'border-emerald-500 text-emerald-300 bg-emerald-500/5 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>قوالب التحقق القياسية V&amp;V — تشغيل حي ({VV_BENCHMARK_TEMPLATES.length})</span>
          </button>
        </div>

        {/* Inline Import Error Banner (No window.alert) */}
        {importError && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{importError}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportError(null)}
              className="text-rose-300 hover:text-white"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TAB 1: SAVED PROJECTS */}
        {activeTab === 'saved' && (
          <>
            {/* Search, Filter & Actions Toolbar */}
            <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث باسم المشروع أو المحرك أو المهندس..."
                  className="w-full pr-10 pl-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 transition-colors"
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'all', label: 'الكل' },
                  { id: 'CFD', label: 'CFD' },
                  { id: 'FEA', label: 'FEA' },
                  { id: 'Thermal', label: 'Thermal' },
                  { id: 'Electromagnetic', label: 'EM' },
                  { id: 'Multiphysics', label: 'Multiphysics' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedField(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      selectedField === f.id
                        ? 'bg-sky-600 text-white shadow-sm font-bold'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {onOpenNewProjectWizard && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenNewProjectWizard();
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>مشروع جديد</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleExportJSON}
                  disabled={projects.length === 0}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="تصدير نسخة احتياطية من المشاريع المحفوظة (JSON)"
                >
                  <Download className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">تصدير JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                  title="استيراد مشروع من ملف JSON"
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">استيراد JSON</span>
                </button>

                {onClearCustomProjects &&
                  (confirmReset ? (
                    <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-500/60 px-2 py-1 rounded-xl">
                      <span className="text-[11px] text-rose-200 font-bold">حذف كافة المشاريع المحفوظة؟</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClearCustomProjects();
                          setConfirmReset(false);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px]"
                      >
                        تأكيد الحذف
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReset(false)}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmReset(true)}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                      <span>تصفير المنصة</span>
                    </button>
                  ))}
              </div>
            </div>

            {/* Saved Projects List */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {filteredProjects.length === 0 ? (
                <div className="text-center py-12 text-slate-400 space-y-3">
                  <FolderOpen className="w-12 h-12 text-slate-600 mx-auto" />
                  <p className="text-sm font-semibold text-slate-300">
                    {projects.length === 0
                      ? 'لا توجد مشاريع محفوظة بعد'
                      : 'لم يتم العثور على مشروع يطابق معايير البحث'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {projects.length === 0
                      ? 'يمكنك إنشاء مشروع جديد، استيراد ملف JSON، أو الانتقال إلى تبويب «قوالب التحقق القياسية V&V» لاختبار المحركات الحقيقية فوراً.'
                      : 'جرّب تعديل نص البحث أو إزالة التصفية.'}
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    {projects.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setActiveTab('benchmarks')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>استعراض قوالب التحقق V&amp;V الحية</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedField('all');
                        }}
                        className="text-xs text-sky-400 hover:underline font-mono"
                      >
                        إلغاء التصفية وإظهار كافة المشاريع
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredProjects.map((proj) => {
                  const isCurrent = proj.id === currentProjectId;
                  const solved = hasRealSimulationRun(proj);
                  return (
                    <div
                      key={proj.id}
                      className={`rounded-2xl border p-5 transition-all space-y-4 relative overflow-hidden ${
                        isCurrent
                          ? 'bg-slate-800/60 border-sky-500/60 shadow-lg shadow-sky-950/40'
                          : 'bg-slate-950/70 hover:bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                            {getDomainIcon(proj.field)}
                          </div>
                          {getDomainBadge(proj.field)}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                              solved
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {solved ? 'Solved · نتائج حقيقية محفوظة' : 'Draft · بانتظار التشغيل'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          {isCurrent && (
                            <span className="flex items-center gap-1 text-emerald-400 font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 font-mono text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>المشروع النشط</span>
                            </span>
                          )}
                          <span className="text-slate-400 font-mono text-[11px]">{proj.date || '2026'}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-base sm:text-lg font-bold text-white">{proj.title}</h3>
                        {proj.titleEn && (
                          <p className="text-xs text-slate-400 font-sans direction-ltr text-right line-clamp-1">
                            {proj.titleEn}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 text-slate-300">
                        <div className="flex items-center gap-1.5 truncate">
                          <User className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="text-slate-400">المهندس:</span>
                          <strong className="text-slate-200 truncate">{proj.author || 'CAE Engineer'}</strong>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="text-slate-400">الجهة:</span>
                          <strong className="text-slate-200 truncate">{proj.university || 'Engineering Workspace'}</strong>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-slate-400">المحرك:</span>
                          <strong className="text-emerald-300 truncate">{proj.softwareType}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => exportToJournalHTML(proj)}
                            disabled={!solved}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            title={solved ? 'تصدير تقرير المحاكاة الحقيقي بصيغة HTML' : 'يتطلب تشغيل المحاكاة أولاً'}
                          >
                            <ExternalLink className="w-3 h-3 text-cyan-400" />
                            <span>HTML Report</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => exportToWordDocument(proj)}
                            disabled={!solved}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            title={solved ? 'تصدير تقرير المحاكاة الحقيقي بصيغة Word' : 'يتطلب تشغيل المحاكاة أولاً'}
                          >
                            <Download className="w-3 h-3 text-sky-400" />
                            <span>Word (.doc)</span>
                          </button>

                          {onDeleteProject && (
                            <button
                              type="button"
                              onClick={() => onDeleteProject(proj.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] flex items-center gap-1 transition-colors"
                              title="حذف هذا المشروع نهائياً"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>حذف</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onSelectProject(proj);
                            onClose();
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all active:scale-95 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white"
                        >
                          <span>{isCurrent ? 'الاستمرار في العمل' : 'فتح المشروع'}</span>
                          <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* TAB 2: LIVE V&V BENCHMARK TEMPLATES (ZERO PRE-BAKED RESULTS) */}
        {activeTab === 'benchmarks' && (
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs text-emerald-100 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 font-bold text-emerald-300">
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    الحزمة الدولية الموحّدة — 6 معايير معتمدة (ASME V&amp;V 20 / NAFEMS / NASA TMR / ElmerFEM · Zero Pre-Baked Results)
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  هذه القوالب الستة متطابقة حرفياً 1-إلى-1 مع <strong>مركز شهادة التحقق الآلية V&amp;V</strong>: يمكنك تحميل أي قالب منفرد لدراسته داخل العارض ثلاثي الأبعاد ورسم منحنى التطابق في <strong>Validation</strong>، أو تشغيل الحزمة الكاملة دفعة واحدة لإصدار شهادة تحقق موقّعة ببصمة <code>SHA-256</code>.
                </p>
              </div>
              {onOpenVVCertification && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenVVCertification();
                  }}
                  className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-colors shrink-0"
                >
                  <Award className="w-4 h-4" />
                  <span>فتح مركز شهادة التحقق الآلية (تشغيل الـ 6 معاً)</span>
                </button>
              )}
            </div>

            {VV_BENCHMARK_TEMPLATES.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/75 hover:border-emerald-500/40 p-5 space-y-3.5 transition-all"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                      {getDomainIcon(tpl.project.field)}
                    </div>
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-slate-800 text-sky-300 border border-slate-700">
                      {tpl.code}
                    </span>
                    {getDomainBadge(tpl.project.field)}
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      صفر نتائج مسبقة · تشغيل حي مطلوب
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">{tpl.standardRef}</span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">{tpl.project.title}</h3>
                  <p className="text-xs text-slate-400">{tpl.formulaSummaryAr}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-slate-900/90 p-3 rounded-xl border border-slate-800/80">
                  <div className="truncate">
                    <span className="text-slate-500">المحرك الحقيقي: </span>
                    <strong className="text-emerald-300 font-mono">{tpl.engineLabel}</strong>
                  </div>
                  <div className="truncate">
                    <span className="text-slate-500">النقاط المرجعية: </span>
                    <strong className="text-sky-300 font-mono">
                      {tpl.project.referenceData?.points.length ?? 0} analytical pts
                    </strong>
                  </div>
                  <div className="truncate">
                    <span className="text-slate-500">مقطع المقارنة: </span>
                    <strong className="text-slate-200 font-mono">
                      {tpl.project.validationProfile?.kind} @ {tpl.project.validationProfile?.position}
                    </strong>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                  <code className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                    {tpl.formulaLatex}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectBenchmarkTemplate) {
                        onSelectBenchmarkTemplate(tpl);
                      } else {
                        onSelectProject(tpl.project);
                      }
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md transition-all active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>تحميل القالب وتهيئة المدخلات للتشغيل الحي</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>الحفظ المحلي آمن ومنعزل لكل مشروع بدون أي نتائج مفبركة أو بيانات افتراضية.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onStartBlankProject();
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
            >
              بدء مشروع فارغ
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
