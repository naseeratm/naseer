import React from 'react';
import {
  FileText,
  Upload,
  Download,
  FileSpreadsheet,
  Printer,
  Sparkles,
  Key,
  Cpu,
  Layers,
  ChevronDown,
  Shield,
  PlusCircle,
  RotateCcw,
  Globe,
  FolderOpen,
  Cloud,
} from 'lucide-react';
import { ThesisProject, EngineMode, ApiKeyItem, CloudServerConfig } from '../types/thesis';
import { exportToWordDocument, exportToCSV, exportToLatex, exportToJournalHTML } from '../utils/exporter';

interface NavbarProps {
  currentProject: ThesisProject | null;
  onResetToCleanWorkspace: () => void;
  onOpenProjectsLibrary: () => void;
  onOpenUploadModal: () => void;
  onOpenAssistant: () => void;
  onOpenKeyPoolModal: () => void;
  onOpenCloudModal: () => void;
  onPrintReport: () => void;
  engineMode: EngineMode;
  apiKeys: ApiKeyItem[];
  cloudConfig?: CloudServerConfig;
  savedProjectsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentProject,
  onResetToCleanWorkspace,
  onOpenProjectsLibrary,
  onOpenUploadModal,
  onOpenAssistant,
  onOpenKeyPoolModal,
  onOpenCloudModal,
  onPrintReport,
  engineMode,
  apiKeys,
  cloudConfig,
  savedProjectsCount = 0,
}) => {
  const [isExportOpen, setIsExportOpen] = React.useState(false);
  const activeKeysCount = apiKeys.filter((k) => k.status === 'active').length;

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white shadow-xl print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">
        {/* Brand & Pure Engineering Platform Identity */}
        <div
          onClick={onResetToCleanWorkspace}
          className="flex items-center gap-3 min-w-0 cursor-pointer select-none group"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-amber-400 p-[2px] shadow-lg shadow-sky-500/20 shrink-0 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <span className="font-extrabold text-xs tracking-wider bg-gradient-to-r from-sky-400 to-amber-300 bg-clip-text text-transparent font-mono">
                ANSYS
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base sm:text-lg text-slate-100 truncate">
                ANSYS Engineering WorkBench
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sky-950/80 text-sky-400 border border-sky-800/60 font-mono">
                Multiphysics CAE
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate hidden md:block">
              منصة التحليل والمحاكاة الهندسية الشاملة · ميكانيكا الموائع والإنشاءات
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Recall Previous Projects Button */}
          <button
            onClick={onOpenProjectsLibrary}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all active:scale-95 shadow-sm"
            title="استدعاء أو فتح البحوث والمشاريع السابقة للتعديل"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">استدعاء البحوث</span>
            <span className="sm:hidden">البحوث</span>
            {savedProjectsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 font-mono text-[10px] font-bold">
                {savedProjectsCount}
              </span>
            )}
          </button>

          {/* New Clean Session / Reset Button */}
          <button
            onClick={onResetToCleanWorkspace}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all active:scale-95"
            title="بدء جلسة عمل جديدة ونظيفة دون المشروع القديم"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">جلسة جديدة</span>
          </button>

          {/* Engine & Key Pool Manager Button */}
          <button
            onClick={onOpenKeyPoolModal}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
              engineMode === 'pure_local'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:bg-slate-800 hover:border-sky-500'
            }`}
            title="إدارة مجمّع المفاتيح والمحرك الرقمي لمنع التوقف"
          >
            {engineMode === 'pure_local' ? (
              <>
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">المحرك:</span>
                <span className="text-emerald-400 font-mono">محلي 100%</span>
              </>
            ) : (
              <>
                <Key className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">المفاتيح:</span>
                <span className="text-amber-300 font-mono">
                  {activeKeysCount > 0 ? `${activeKeysCount} متاح` : 'النظام'}
                </span>
              </>
            )}
          </button>

          {/* 400GB Cloud Server & ANSYS Licensing Button */}
          <button
            onClick={onOpenCloudModal}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
              cloudConfig?.status === 'connected'
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20'
                : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:border-amber-500/60'
            }`}
            title="إعدادات الخادم السحابي (400GB) وخادم ترخيص أنسيز FlexNet"
          >
            <Cloud className={`w-4 h-4 ${cloudConfig?.status === 'connected' ? 'text-sky-400' : 'text-amber-400'}`} />
            <span className="hidden md:inline">السحابة والترخيص:</span>
            <span className="font-mono text-xs text-sky-300 font-bold">400GB</span>
            {cloudConfig?.status === 'connected' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse hidden sm:inline-block" />
            )}
          </button>

          {/* Universal Ingestion Button */}
          <button
            onClick={onOpenUploadModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-md shadow-sky-500/20 active:scale-95 transition-all"
          >
            <Upload className="w-4 h-4" />
            <span>رفع وتحليل ملفات</span>
          </button>

          {/* Senior Engineering Consultant Assistant Button */}
          <button
            onClick={onOpenAssistant}
            disabled={!currentProject}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>مستشار المحاكاة</span>
          </button>

          {/* Export Dropdown (Only when a project is active) */}
          {currentProject && (
            <div className="relative">
              <button
                onClick={() => setIsExportOpen(!isExportOpen)}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span className="hidden md:inline">تصدير</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isExportOpen && (
                <div
                  className="absolute left-0 mt-2 w-48 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1 z-40 text-xs"
                  onClick={() => setIsExportOpen(false)}
                >
                  <button
                    onClick={() => exportToWordDocument(currentProject)}
                    className="w-full text-right px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span>تصدير أطروحة Word كاملة بالرسوم والكونتورات (.doc)</span>
                  </button>
                  <button
                    onClick={() => exportToJournalHTML(currentProject)}
                    className="w-full text-right px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                  >
                    <Globe className="w-4 h-4 text-emerald-400" />
                    <span>تصدير ورقة بحثية لمجلة عالمية (Journal HTML)</span>
                  </button>
                  <button
                    onClick={() => exportToLatex(currentProject)}
                    className="w-full text-right px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                  >
                    <FileCodeIcon className="w-4 h-4 text-amber-400" />
                    <span>تصدير كود LaTeX (.tex)</span>
                  </button>
                  <button
                    onClick={() => exportToCSV(currentProject)}
                    className="w-full text-right px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    <span>تصدير البيانات (.csv)</span>
                  </button>
                  <div className="border-t border-slate-800 my-1"></div>
                  <button
                    onClick={onPrintReport}
                    className="w-full text-right px-4 py-2 hover:bg-slate-800 text-slate-200 flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4 text-indigo-400" />
                    <span>طباعة التقرير الهندسي</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

function FileCodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13l-2 2 2 2" />
      <path d="M14 17l2-2-2-2" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
    </svg>
  );
}
