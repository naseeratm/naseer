import React, { useState, useRef } from 'react';
import {
  Upload,
  Cpu,
  Sparkles,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Shield,
  CheckCircle2,
  Settings,
  X,
  Info,
  Loader2,
  Table as TableIcon,
  Package,
  FolderOpen,
  Cloud,
  Grid3X3,
  Plus,
  Database,
  Sliders,
} from 'lucide-react';
import { ThesisProject, IngestedFileItem, ApiKeyItem, EngineMode } from '../types/thesis';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';

interface CleanWorkspaceHomeProps {
  onStartProject: (project: ThesisProject) => void;
  apiKeys: ApiKeyItem[];
  engineMode: EngineMode;
  onOpenKeyPool: () => void;
  onOpenNewProjectWizard?: () => void;
  onOpenProjectsLibrary?: () => void;
  onOpenCloudSettings?: () => void;
  onOpenAuditModal?: () => void;
  onOpenMeshGenerator?: () => void;
  onOpenMaterialsModal?: () => void;
  onOpenParametricSweep?: () => void;
  onOpenPipelineTracker?: () => void;
  savedProjectsCount?: number;
  onResetWorkspace?: () => void;
}

export const CleanWorkspaceHome: React.FC<CleanWorkspaceHomeProps> = ({
  onStartProject,
  apiKeys,
  engineMode,
  onOpenNewProjectWizard,
  onOpenProjectsLibrary,
  onOpenCloudSettings,
  onOpenMeshGenerator,
  onOpenMaterialsModal,
  onOpenParametricSweep,
  savedProjectsCount = 0,
}) => {
  const [filesList, setFilesList] = useState<IngestedFileItem[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [directives, setDirectives] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [projectField, setProjectField] = useState<'CFD' | 'FEA' | 'Thermal' | 'Multiphysics'>('CFD');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activePreviewFile, setActivePreviewFile] = useState<IngestedFileItem | null>(null);
  const [isPasteScriptOpen, setIsPasteScriptOpen] = useState(false);
  const [rawScriptText, setRawScriptText] = useState('');
  const [scriptName, setScriptName] = useState('simulation_setup.mac');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    setIsParsingFiles(true);
    setErrorMessage(null);

    const parsedItems: IngestedFileItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const results = await parseEngineeringFilesOrArchive(file);
        for (const parsed of results) {
          const item: IngestedFileItem = {
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
          };

          parsedItems.push(item);

          if (parsed.detectedParameters && parsed.detectedParameters.length > 0) {
            const hasStress = parsed.detectedParameters.some((p) => p.key.includes('إجهاد') || p.key.includes('حمولة') || p.key.includes('APDL'));
            const hasVelocity = parsed.detectedParameters.some((p) => p.key.includes('سرعة') || p.key.includes('Fluent'));
            if (hasStress && !hasVelocity) {
              setProjectField('FEA');
            } else if (hasVelocity) {
              setProjectField('CFD');
            }
          }
        }
      } catch (err: any) {
        console.error('Failed to parse file:', file.name, err);
      }
    }

    setFilesList((prev) => [...prev, ...parsedItems]);
    setIsParsingFiles(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (id: string) => {
    setFilesList((prev) => prev.filter((f) => f.id !== id));
    if (activePreviewFile?.id === id) {
      setActivePreviewFile(null);
    }
  };

  const handleAddPastedScript = async () => {
    if (!rawScriptText.trim()) return;
    const name = scriptName.trim() || 'simulation_script.mac';
    const blob = new Blob([rawScriptText], { type: 'text/plain' });
    const file = new File([blob], name, { type: 'text/plain' });
    await handleFilesSelected([file]);
    setRawScriptText('');
    setIsPasteScriptOpen(false);
  };

  const handleStartCleanSimulation = (forceLocal: boolean = false) => {
    setIsProcessing(true);
    setErrorMessage(null);

    if (forceLocal || engineMode === 'pure_local') {
      setProcessingStatus('جاري تجهيز مساحة العمل الهندسية وربط المعاملات المستخرجة...');
      setTimeout(() => {
        try {
          const allContent = filesList
            .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
            .filter(Boolean)
            .join('\n\n');

          const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
          const firstFileName = primaryFile?.name || (projectTitle ? `${projectTitle}.stl` : 'new_case.stl');
          const project = generateLocalEngineeringProject(
            firstFileName,
            directives,
            projectField,
            allContent || primaryFile?.content || '',
            filesList
          );
          if (projectTitle.trim()) {
            project.title = projectTitle.trim();
          }
          project.attachedFilesCount = filesList.length;
          project.directivesApplied = directives;
          project.extractedSummary = primaryFile?.summary || 'تم تجهيز مساحة المشروع وبانتظار إدخال الشروط الحدية وتشغيل المحاكاة.';

          onStartProject(project);
          setIsProcessing(false);
        } catch (err: any) {
          setErrorMessage('حدث خطأ أثناء تجهيز المشروع: ' + String(err));
          setIsProcessing(false);
        }
      }, 250);
      return;
    }

    setProcessingStatus('جاري تحليل ملفاتك واستخراج المعاملات عبر الخادم...');
    const candidateKeys = apiKeys.filter((k) => k.status !== 'exhausted').map((k) => k.key);
    const keyPoolToTry = candidateKeys.length > 0 ? candidateKeys : [''];

    (async () => {
      let succeeded = false;
      let lastServerError = '';

      for (let i = 0; i < keyPoolToTry.length; i++) {
        const activeKey = keyPoolToTry[i];
        try {
          const payload = {
            files: filesList.map((f) => ({
              name: f.name,
              extension: f.extension,
              category: f.category,
              content: f.content,
              base64Data: f.base64Data,
              mimeType: f.mimeType,
              isImage: f.isImage,
            })),
            directives: directives || (projectTitle ? `مشروع بعنوان: ${projectTitle}` : ''),
            projectField,
            projectType: 'Industrial Simulation',
            userTitle: projectTitle,
          };

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (activeKey) {
            headers['x-gemini-api-key'] = activeKey;
          }

          const res = await fetch('/api/analyze-multiphysics', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });

          const data = await res.json();
          if (res.ok && data.success && data.data) {
            succeeded = true;
            const proj: ThesisProject = data.data;
            if (projectTitle.trim()) {
              proj.title = projectTitle.trim();
            }
            proj.attachedFilesCount = filesList.length;
            proj.directivesApplied = directives;
            proj.extractedSummary =
              proj.extractedSummary ||
              `تم استخراج بيانات (${filesList[0]?.name || 'المشروع'}) وتجهيز مساحة العمل.`;

            onStartProject(proj);
            setIsProcessing(false);
            break;
          } else {
            lastServerError = data.details || data.error || 'استجابة غير متوقعة من السيرفر';
          }
        } catch (err: any) {
          lastServerError = err?.message || 'تعذر الاتصال بالخادم';
        }
      }

      if (!succeeded) {
        setProcessingStatus('جاري تجهيز مساحة المشروع...');
        setTimeout(() => {
          const allContent = filesList
            .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
            .filter(Boolean)
            .join('\n\n');
          const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
          const firstFileName = primaryFile?.name || 'new_case.stl';
          const project = generateLocalEngineeringProject(
            firstFileName,
            directives,
            projectField,
            allContent || primaryFile?.content || '',
            filesList
          );
          if (projectTitle.trim()) {
            project.title = projectTitle.trim();
          }
          project.attachedFilesCount = filesList.length;
          project.directivesApplied = directives;
          project.extractedSummary = `تم تجهيز المشروع (${firstFileName}). ${lastServerError ? `(${lastServerError})` : ''}`;

          onStartProject(project);
          setIsProcessing(false);
        }, 300);
      }
    })();
  };

  const getCategoryBadge = (category?: string) => {
    switch (category) {
      case 'archive':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold font-mono">أرشيف (.ZIP/.WBPZ)</span>;
      case 'word':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">Word Document</span>;
      case 'excel':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Excel Dataset</span>;
      case 'code':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">Script / Solver Deck</span>;
      case 'image':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">CAD / Diagram</span>;
      case 'pdf':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">PDF Document</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] bg-slate-500/10 text-slate-400 border border-slate-500/20 font-mono">Text / Data</span>;
    }
  };

  const getFileCategoryIcon = (file: IngestedFileItem) => {
    if (file.isArchive || file.category === 'archive' || ['zip', 'wbpz', 'tar', 'gz', '7z', 'rar'].includes(file.extension))
      return <Package className="w-5 h-5 text-purple-400" />;
    if (file.isImage) return <ImageIcon className="w-5 h-5 text-purple-400" />;
    if (file.category === 'excel' || ['xlsx', 'xls', 'csv'].includes(file.extension))
      return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
    if (file.category === 'word' || ['docx', 'doc'].includes(file.extension))
      return <FileText className="w-5 h-5 text-blue-400" />;
    if (file.category === 'pdf' || file.extension === 'pdf')
      return <FileText className="w-5 h-5 text-rose-400" />;
    if (['py', 'mac', 'inp', 'jou', 'dat', 'cas'].includes(file.extension))
      return <FileCode className="w-5 h-5 text-amber-400" />;
    return <FileText className="w-5 h-5 text-slate-400" />;
  };

  return (
    <div className="max-w-5xl mx-auto py-6 space-y-6 animate-in fade-in duration-300">
      {/* Top Clean Hero & System Header Bar */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-5">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-sky-400 font-mono">
                <span className="font-bold">NASEER Universal CAE Studio</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-indigo-300 font-semibold">CFD, FEA & Thermal Simulation Workspace</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-emerald-400 font-semibold">ASME V&V 20 Standard</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                منصة المحاكاة الهندسية السحابية (CAE Workbench)
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
                بيئة عمل هندسية موحدة لنمذجة وحل مسائل ديناميكا الموائع (OpenFOAM)، التحليل الإنشائي بالعناصر المحدودة (CalculiX)، وانتقال الحرارة، مع التحقق العددي عبر مؤشر تقارب الشبكة (Roache GCI).
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800 shrink-0">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>المحرك: <strong className="text-slate-100">{engineMode === 'pure_local' ? 'محلي' : 'سحابي هجين'}</strong></span>
            </div>
          </div>

          {/* Unboxed Micro Metadata Banner */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400 font-mono pt-1">
            <span className="text-slate-300">OpenFOAM v2406</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className="text-slate-300">CalculiX v2.21</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className="text-slate-300">Celery HPC Worker</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className="text-emerald-400 font-semibold">ASME V&V 20</span>
          </div>

          {/* Clean Engineering Tools Toolbar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2">
            {onOpenNewProjectWizard && (
              <button
                type="button"
                onClick={onOpenNewProjectWizard}
                className="p-3 rounded-2xl bg-gradient-to-br from-emerald-600/25 to-sky-600/25 hover:from-emerald-600/35 hover:to-sky-600/35 border border-emerald-500/40 text-right transition-all group shadow-md"
                title="إنشاء مشروع هندسي جديد من الصفر"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Plus className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">New</span>
                </div>
                <div className="text-xs font-bold text-white">+ مشروع جديد</div>
                <div className="text-[10px] text-slate-400 mt-0.5">CFD / FEA / Thermal</div>
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 text-right transition-all group shadow-md"
              title="استيراد ملفات هندسية أو CAD أو سكربتات"
            >
              <div className="flex items-center justify-between mb-1.5">
                <Upload className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-mono text-sky-300 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">Import</span>
              </div>
              <div className="text-xs font-bold text-white">استيراد ملفات</div>
              <div className="text-[10px] text-slate-400 mt-0.5">CAD / Scripts / ZIP</div>
            </button>

            {onOpenMeshGenerator && (
              <button
                type="button"
                onClick={onOpenMeshGenerator}
                className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 text-right transition-all group shadow-md"
                title="أداة إعداد الشبكة وحساب مؤشر تقارب الشبكة Roache GCI"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Grid3X3 className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-sky-300 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">Mesh</span>
                </div>
                <div className="text-xs font-bold text-white">مولد الشبكات</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Roache GCI & Quality</div>
              </button>
            )}

            {onOpenMaterialsModal && (
              <button
                type="button"
                onClick={onOpenMaterialsModal}
                className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-right transition-all group shadow-md"
                title="قاعدة البيانات القياسية لخواص المواد والموائع"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Database className="w-5 h-5 text-amber-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-amber-300 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-800">Materials</span>
                </div>
                <div className="text-xs font-bold text-white">مكتبة المواد</div>
                <div className="text-[10px] text-slate-400 mt-0.5">موائع ومعادن قياسية</div>
              </button>
            )}

            {onOpenParametricSweep && (
              <button
                type="button"
                onClick={onOpenParametricSweep}
                className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 text-right transition-all group shadow-md"
                title="دراسة تغير الشروط الحدية وتوليد مصفوفة الحالات"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Sliders className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">Sweep</span>
                </div>
                <div className="text-xs font-bold text-white">مسح المتغيرات</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Parametric Study</div>
              </button>
            )}

            {onOpenProjectsLibrary && (
              <button
                type="button"
                onClick={onOpenProjectsLibrary}
                className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 text-right transition-all group shadow-md"
                title="فتح المشاريع المحفوظة"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <FolderOpen className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-sky-300 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">{savedProjectsCount}</span>
                </div>
                <div className="text-xs font-bold text-white">مكتبة المشاريع</div>
                <div className="text-[10px] text-slate-400 mt-0.5">المشاريع المحفوظة</div>
              </button>
            )}

            {onOpenCloudSettings && (
              <button
                type="button"
                onClick={onOpenCloudSettings}
                className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 text-right transition-all group shadow-md"
                title="إعدادات الخادم السحابي وموارد الحوسبة"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Cloud className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-sky-300 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">Server</span>
                </div>
                <div className="text-xs font-bold text-white">إعدادات الخادم</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Docker & HPC Cores</div>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Clean Workspace Ingestion Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                استيراد الملفات الهندسية والنماذج ثلاثية الأبعاد
              </h2>
              <p className="text-xs text-slate-400">
                يدعم صيغ الهندسة والسكربتات والبيانات: STL, STEP, IGES, Python (.py), Solver Decks (.jou, .mac, .inp), Excel (.xlsx, .csv), Word (.docx)
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-sky-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            {filesList.length} ملفات مرفقة
          </span>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-slate-700 hover:border-sky-500 bg-slate-950/70 hover:bg-slate-950 rounded-2xl p-8 text-center cursor-pointer transition-all group"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".stl,.step,.stp,.iges,.igs,.obj,.docx,.doc,.docm,.rtf,.pdf,.txt,.py,.jou,.mac,.inp,.cas,.dat,.cdb,.m,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.svg,.webp,.zip,.wbpz"
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <div className="w-14 h-14 rounded-2xl bg-sky-500/10 text-sky-400 group-hover:scale-110 flex items-center justify-center mx-auto mb-3 transition-transform">
            {isParsingFiles ? (
              <Loader2 className="w-7 h-7 animate-spin text-sky-400" />
            ) : (
              <Upload className="w-7 h-7" />
            )}
          </div>
          <h3 className="text-sm font-bold text-slate-200">
            {isParsingFiles
              ? 'جاري فحص وقراءة محتويات الملفات...'
              : 'اسحب وأفلت ملف النموذج الهندسي (.stl / .step) أو الأرشيف (.zip)'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl mx-auto leading-relaxed">
            ارفع ملف المجسم ثلاثي الأبعاد أو ملفات الإعدادات ليتم فحصها وتجهيز مساحة المحاكاة وإدخال الشروط الحدية.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px] font-mono">
            <span className="bg-sky-950/80 text-sky-300 border border-sky-800/80 px-2.5 py-1 rounded font-bold">
              CAD (.stl / .step / .iges)
            </span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">OpenFOAM / CalculiX (.inp)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Python (.py)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Excel (.xlsx / .csv)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Archive (.zip)</span>
          </div>
        </div>

        {/* Direct Script Paste Toggle & Box */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden">
          <div
            onClick={() => setIsPasteScriptOpen(!isPasteScriptOpen)}
            className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-slate-900/60 transition-colors"
          >
            <div className="flex items-center gap-2.5 text-xs">
              <FileCode className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-slate-200">
                أو ألصق نص كود السكربت يدوياً (CalculiX INP / OpenFOAM Dict / Python)
              </span>
            </div>
            <button
              type="button"
              className="text-xs text-sky-400 font-medium hover:underline"
            >
              {isPasteScriptOpen ? 'إغلاق المحرر' : 'فتح محرر اللصق'}
            </button>
          </div>

          {isPasteScriptOpen && (
            <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="text-slate-400 text-xs">اسم الملف:</span>
                  <input
                    type="text"
                    value={scriptName}
                    onChange={(e) => setScriptName(e.target.value)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-sky-300 focus:outline-none"
                    placeholder="structural_analysis.inp"
                  />
                </div>
              </div>

              <textarea
                rows={6}
                value={rawScriptText}
                onChange={(e) => setRawScriptText(e.target.value)}
                placeholder="*HEADING&#10;CalculiX Structural Input Deck&#10;*MATERIAL, NAME=STEEL&#10;*ELASTIC&#10;210000., 0.3"
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none direction-ltr text-left leading-relaxed resize-y"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPasteScriptOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleAddPastedScript}
                  disabled={!rawScriptText.trim()}
                  className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md shadow-sky-900/30 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>إدراج السكربت</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Attached Files List & Diagnostics Card */}
        {filesList.length > 0 && (
          <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            <div className="p-3.5 bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-500/40 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 border border-sky-500/30">
                  <Cpu className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                    <span>الملفات جاهزة لفتح مساحة المحاكاة</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">
                      {projectField} | ASME V&V 20
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    افتح مساحة العمل لاستكمال الشروط الحدية وإرسال المهمة إلى المحلل العددي.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleStartCleanSimulation(true)}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/30 flex items-center gap-2 transition-all active:scale-95"
                >
                  <Sparkles className="w-4 h-4 text-sky-200" />
                  <span>فتح مساحة العمل الهندسية</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-300 font-semibold border-b border-slate-800 pb-2.5">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>الملفات المرفقة ({filesList.length}):</span>
              </span>
              <button
                type="button"
                onClick={() => setFilesList([])}
                className="text-rose-400 hover:underline font-normal text-xs"
              >
                مسح الكل
              </button>
            </div>

            <div className="space-y-2.5 max-h-72 overflow-y-auto p-1">
              {filesList.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {f.isImage && f.base64Data ? (
                      <img
                        src={f.base64Data}
                        alt={f.name}
                        className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0 cursor-pointer hover:opacity-90"
                        onClick={() => setActivePreviewFile(f)}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        {getFileCategoryIcon(f)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-100 font-bold truncate">{f.name}</span>
                        {getCategoryBadge(f.category)}
                        {f.parentArchiveName && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                            من الأرشيف: {f.parentArchiveName}
                          </span>
                        )}
                        {f.isArchive && f.archiveFilesCount !== undefined && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold font-mono">
                            {f.archiveFilesCount} ملفات
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400 font-mono">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </div>

                      {f.summary && (
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {f.summary}
                        </p>
                      )}

                      {f.detectedParameters && f.detectedParameters.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {f.detectedParameters.map((param, pIdx) => (
                            <span
                              key={pIdx}
                              className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px] font-mono"
                            >
                              {param.key}: <strong>{param.value} {param.unit || ''}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => {
                        const project = generateLocalEngineeringProject(
                          f.name,
                          directives,
                          projectField,
                          f.content || '',
                          [f]
                        );
                        if (projectTitle.trim()) {
                          project.title = projectTitle.trim();
                        }
                        onStartProject(project);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1 transition-colors"
                      title="فتح هذا الملف في مساحة المحاكاة"
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>فتح في الاستوديو</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePreviewFile(f)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs flex items-center gap-1 transition-colors"
                      title="معاينة محتويات الملف"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span>معاينة</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveFile(f.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="حذف الملف"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project Setup Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-300 block">
              عنوان المشروع الهندسي:
            </label>
            <input
              type="text"
              placeholder="مثال: تحليل الجريان الداخلي في أنبوب / حساب إجهادات دعامة معدنية"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              نوع الفيزياء والمحلل:
            </label>
            <select
              value={projectField}
              onChange={(e) => setProjectField(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 focus:outline-none"
            >
              <option value="CFD">ديناميكا الموائع الحسابية (CFD - OpenFOAM)</option>
              <option value="FEA">التحليل الإنشائي (FEA - CalculiX)</option>
              <option value="Thermal">انتقال الحرارة (Thermal - OpenFOAM)</option>
              <option value="Multiphysics">محاكاة متعددة الفيزياء (Multiphysics)</option>
            </select>
          </div>
        </div>

        {/* Directives and Notes */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-400" />
              ملاحظات الدراسة الهندسية (اختياري):
            </span>
          </label>
          <textarea
            rows={2}
            value={directives}
            onChange={(e) => setDirectives(e.target.value)}
            placeholder="أدخل وصفاً مختصراً لهدف المحاكاة أو الشروط الحدية المرجعية..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none leading-relaxed resize-none"
          />
        </div>

        {/* Processing State */}
        {isProcessing && (
          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center gap-3 text-xs text-sky-200 animate-pulse">
            <Cpu className="w-5 h-5 text-sky-400 shrink-0 animate-spin" />
            <div>
              <p className="font-bold text-sky-300">{processingStatus}</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Bottom Trigger Actions */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>تجهيز مساحة العمل الفيزيائية للاتصال المباشر بمحللات OpenFOAM و CalculiX</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleStartCleanSimulation(true)}
              className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-900/30 flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-sky-200" />
              <span>إنشاء وفتح مساحة المشروع</span>
            </button>
          </div>
        </div>
      </div>

      {/* File Content Preview Modal */}
      {activePreviewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                  {getFileCategoryIcon(activePreviewFile)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-100 truncate">
                    {activePreviewFile.name}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    معاينة المحتوى المستخرج من الملف
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActivePreviewFile(null)}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-slate-200">تشخيص الملف:</span>
                  <p className="text-slate-400 leading-relaxed">{activePreviewFile.summary}</p>
                </div>
              </div>

              {activePreviewFile.detectedParameters && activePreviewFile.detectedParameters.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    المعاملات المكتشفة:
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activePreviewFile.detectedParameters.map((param, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between"
                      >
                        <span className="text-slate-400">{param.key}</span>
                        <span className="font-mono font-bold text-sky-400">
                          {param.value} {param.unit || ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activePreviewFile.isArchive && activePreviewFile.archiveTree && (
                <div className="space-y-3">
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
                      محتويات الأرشيف ({activePreviewFile.archiveFilesCount} ملفات):
                    </div>
                    <div className="divide-y divide-slate-800/60 max-h-56 overflow-y-auto">
                      {activePreviewFile.archiveTree.map((item, idx) => (
                        <div key={idx} className="px-3 py-2 flex items-center justify-between text-xs hover:bg-slate-900/40 font-mono">
                          <span className="text-slate-200 truncate">{item.path}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-slate-400">
                              {item.size > 0 ? (item.size / 1024).toFixed(1) + ' KB' : 'binary/cad'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 uppercase">
                              {item.category}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activePreviewFile.isImage && activePreviewFile.base64Data && (
                <div className="border border-slate-800 rounded-xl p-2 bg-slate-950 flex items-center justify-center">
                  <img
                    src={activePreviewFile.base64Data}
                    alt={activePreviewFile.name}
                    className="max-h-96 rounded-lg object-contain"
                  />
                </div>
              )}

              {activePreviewFile.sheetsData && activePreviewFile.sheetsData.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <TableIcon className="w-4 h-4 text-emerald-400" />
                    جداول البيانات المقروءة:
                  </h4>
                  {activePreviewFile.sheetsData.map((sheet, sIdx) => (
                    <div key={sIdx} className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                      <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-200">ورقة: {sheet.sheetName}</span>
                        <span className="text-slate-400 font-mono">
                          {sheet.rows} صف × {sheet.columns} عمود
                        </span>
                      </div>
                      <div className="overflow-x-auto p-2">
                        <table className="w-full text-[11px] text-right">
                          <tbody>
                            {sheet.preview.map((r, rIdx) => (
                              <tr key={rIdx} className="border-b border-slate-800/50 hover:bg-slate-900/40">
                                {r.map((c, cIdx) => (
                                  <td key={cIdx} className="p-1.5 text-slate-300 font-mono truncate max-w-xs">
                                    {String(c)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activePreviewFile.content && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-slate-200">
                    المحتوى النصي / البرمجي:
                  </h4>
                  <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap leading-relaxed">
                    {activePreviewFile.content.slice(0, 3000)}
                    {activePreviewFile.content.length > 3000 ? '\n... (تم استعراض جزء من المحتوى)' : ''}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-900/90 flex justify-end">
              <button
                type="button"
                onClick={() => setActivePreviewFile(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                إغلاق المعاينة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};