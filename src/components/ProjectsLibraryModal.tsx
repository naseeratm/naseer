import React, { useState, useRef } from 'react';
import {
  FolderOpen,
  Search,
  Calendar,
  User,
  GraduationCap,
  Layers,
  ArrowRight,
  Trash2,
  PlusCircle,
  Plus,
  X,
  FileText,
  Flame,
  Wind,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  Download,
  Upload,
  RotateCcw,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { exportToJournalHTML, exportToWordDocument } from '../utils/exporter';

interface ProjectsLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ThesisProject[];
  currentProjectId?: string;
  onSelectProject: (project: ThesisProject) => void;
  onStartBlankProject: () => void;
  onOpenNewProjectWizard?: () => void;
  onDeleteProject?: (projectId: string) => void;
  onClearCustomProjects?: () => void;
  onImportProject?: (project: ThesisProject) => void;
}

export const ProjectsLibraryModal: React.FC<ProjectsLibraryModalProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onStartBlankProject,
  onOpenNewProjectWizard,
  onDeleteProject,
  onClearCustomProjects,
  onImportProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedField, setSelectedField] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.titleEn && p.titleEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.author && p.author.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.supervisor && p.supervisor.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.university && p.university.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesField =
      selectedField === 'all' ||
      p.field.toLowerCase() === selectedField.toLowerCase() ||
      (selectedField === 'custom' && p.isCustom);

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
      default:
        return <Layers className="w-5 h-5 text-indigo-400" />;
    }
  };

  const getDomainBadge = (field: string) => {
    switch (field) {
      case 'Thermal':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
            Thermal · LHTES Phase Change
          </span>
        );
      case 'CFD':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
            CFD · Aerodynamics & Fluid Dynamics
          </span>
        );
      case 'FEA':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            FEA · Structural Mechanics & Stress
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
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(projects, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cae_projects_library_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const importedList: ThesisProject[] = Array.isArray(parsed) ? parsed : [parsed];
        if (importedList.length > 0 && onImportProject) {
          onImportProject(importedList[0]);
        }
      } catch (err) {
        alert('تعذر استيراد الملف: تأكد من صحة تنسيق JSON');
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
            <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shadow-lg shadow-sky-950/50">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                  مكتبة واستدعاء المشاريع الهندسية (CAE Projects Hub)
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-slate-800 text-sky-400 border border-slate-700">
                  {projects.length} مشاريع متاحة
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                استدعاء وتعديل أي مشروع سابق أو قالب قياسي، مع إمكانية التصدير والاستيراد وتصفير المنصة للمزامنة النظيفة مع GitHub
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

        {/* Search, Filter & Actions Toolbar */}
        <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الباحث أو الجامعة أو المجال..."
              className="w-full pr-10 pl-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Domain Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'all', label: 'كافة المشاريع' },
              { id: 'custom', label: 'المشاريع المخصصة' },
              { id: 'CFD', label: 'ميكانيكا الموائع' },
              { id: 'FEA', label: 'التحليل الإنشائي' },
              { id: 'Thermal', label: 'الحرارة' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedField(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  selectedField === f.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-750 text-slate-400 hover:text-slate-200 border border-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Action Buttons: New Project Wizard, Export, Import, Reset */}
          <div className="flex items-center gap-2 flex-wrap">
            {onOpenNewProjectWizard && (
              <button
                onClick={() => {
                  onClose();
                  onOpenNewProjectWizard();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all active:scale-95"
                title="إنشاء مشروع هندسي جديد ومخصص من الصفر"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ مشروع جديد مخصص</span>
              </button>
            )}

            <button
              onClick={handleExportJSON}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
              title="تصدير نسخة احتياطية من مكتبة المشاريع كملف JSON"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">تصدير JSON</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors"
              title="استيراد مشروع من ملف JSON خارجي"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">استيراد JSON</span>
            </button>

            {onClearCustomProjects && (
              <button
                onClick={() => {
                  if (window.confirm('هل تود تصفير وحذف كافة المشاريع المخصصة للتهيئة النظيفة قبل الرفع إلى GitHub؟')) {
                    onClearCustomProjects();
                  }
                }}
                className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1 transition-colors"
                title="تصفير المشاريع المخصصة لتهيئة الرفع النظيف إلى GitHub"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">تصفير المنصة</span>
              </button>
            )}
          </div>
        </div>

        {/* Projects List Container */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {filteredProjects.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-3">
              <FolderOpen className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">لم يتم العثور على أي مشروع يطابق البحث</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedField('all');
                }}
                className="text-xs text-sky-400 hover:underline font-mono"
              >
                إلغاء التصفية وإظهار كافة المشاريع
              </button>
            </div>
          ) : (
            filteredProjects.map((proj) => {
              const isCurrent = proj.id === currentProjectId;
              return (
                <div
                  key={proj.id}
                  className={`rounded-2xl border p-5 transition-all space-y-4 relative overflow-hidden ${
                    isCurrent
                      ? 'bg-slate-850 border-sky-500/60 shadow-lg shadow-sky-950/40'
                      : 'bg-slate-950/70 hover:bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Top Row: Domain Badge & Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                        {getDomainIcon(proj.field)}
                      </div>
                      {getDomainBadge(proj.field)}
                      {proj.isCustom && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          مشروع مخصص (Saved)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-emerald-400 font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 font-mono text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>المشروع النشط حالياً</span>
                        </span>
                      )}
                      <span className="text-slate-400 font-mono text-[11px]">
                        {proj.date || '2026'}
                      </span>
                    </div>
                  </div>

                  {/* Project Title & Academic Details */}
                  <div className="space-y-1.5">
                    <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-sky-300 transition-colors">
                      {proj.title}
                    </h3>
                    {proj.titleEn && (
                      <p className="text-xs text-slate-400 font-sans direction-ltr text-right line-clamp-1">
                        {proj.titleEn}
                      </p>
                    )}
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 text-slate-300">
                    <div className="flex items-center gap-1.5 truncate">
                      <User className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-slate-400">الباحث:</span>
                      <strong className="text-slate-200 truncate">{proj.author}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <GraduationCap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-slate-400">المشرف:</span>
                      <strong className="text-amber-300 truncate">{proj.supervisor}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-slate-400">المحلل:</span>
                      <strong className="text-emerald-300 truncate">{proj.softwareType}</strong>
                    </div>
                  </div>

                  {/* Summary / Physical Specs snippet */}
                  {proj.cadSpecs && (
                    <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800/60 pt-2">
                      <span>الأبعاد: <strong className="text-slate-300">{proj.cadSpecs.shell}</strong></span>
                      <span>الملف: <strong className="text-slate-300">{proj.cadSpecs.coil}</strong></span>
                      <span>الزعانف: <strong className="text-emerald-300">{proj.cadSpecs.fins}</strong></span>
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => exportToJournalHTML(proj)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 transition-colors"
                        title="تصدير ورقة بحثية لمجلة عالمية HTML"
                      >
                        <ExternalLink className="w-3 h-3 text-cyan-400" />
                        <span>بحث المجلة (.html)</span>
                      </button>

                      <button
                        onClick={() => exportToWordDocument(proj)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 transition-colors"
                        title="تصدير وثيقة أطروحة Word كاملة"
                      >
                        <Download className="w-3 h-3 text-sky-400" />
                        <span>Word (.doc)</span>
                      </button>

                      {proj.isCustom && onDeleteProject && (
                        <button
                          onClick={() => onDeleteProject(proj.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] flex items-center gap-1 transition-colors"
                          title="حذف هذا المشروع من الذاكرة المحلية"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>حذف</span>
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        onSelectProject(proj);
                        onClose();
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all active:scale-95 ${
                        isCurrent
                          ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/20'
                          : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-sky-500/20'
                      }`}
                    >
                      <span>{isCurrent ? 'الاستمرار في العمل على هذا المشروع' : 'استدعاء وفتح المشروع للعمل'}</span>
                      <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>يتم حفظ المشاريع والتعديلات محلياً بشكل آمن دون الكتابة فوق المشاريع الأخرى.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onStartBlankProject();
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
            >
              بدء مشروع جديد فارغ
            </button>
            <button
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
