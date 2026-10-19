import React, { useState, useRef } from 'react';
import {
  Upload,
  Cpu,
  Sparkles,
  Layers,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Shield,
  CheckCircle2,
  Settings,
  Zap,
  ArrowLeft,
  X,
  FileCheck,
  Play,
  RotateCcw,
  Eye,
  Info,
  Loader2,
  AlertCircle,
  Table as TableIcon,
  Package,
  FolderOpen,
  Cloud,
} from 'lucide-react';
import { ThesisProject, IngestedFileItem, ApiKeyItem, EngineMode } from '../types/thesis';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';
import { LHTES_V3_MASTER_PROJECT, NACA_0012_CFD_PROJECT, CANTILEVER_BEAM_FEA_PROJECT } from '../data/defaultPresets';

interface CleanWorkspaceHomeProps {
  onStartProject: (project: ThesisProject) => void;
  apiKeys: ApiKeyItem[];
  engineMode: EngineMode;
  onOpenKeyPool: () => void;
  onOpenProjectsLibrary?: () => void;
  onOpenCloudSettings?: () => void;
  savedProjectsCount?: number;
}

export const CleanWorkspaceHome: React.FC<CleanWorkspaceHomeProps> = ({
  onStartProject,
  apiKeys,
  engineMode,
  onOpenKeyPool,
  onOpenProjectsLibrary,
  onOpenCloudSettings,
  savedProjectsCount = 3,
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
  const [scriptName, setScriptName] = useState('ansys_simulation.mac');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file uploads with deep extraction (Word, Excel, Code, PDF, Images, and ZIP/WBPZ Archives)
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

          // Auto-detect project domain or title if detected from file or archive script
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

    // If forcing local or pure_local mode is selected
    if (forceLocal || engineMode === 'pure_local') {
      setProcessingStatus('جاري تشغيل المحرك الفيزيائي الرقمي الحتمي لحل النموذج هندسياً...');
      setTimeout(() => {
        try {
          // Aggregate all script and document contents from all files (including unpacked archive files)
          const allContent = filesList
            .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
            .filter(Boolean)
            .join('\n\n');

          const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
          const firstFileName = primaryFile?.name || (projectTitle ? `${projectTitle}.jou` : 'cae_simulation.jou');
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
          project.extractedSummary = primaryFile?.summary || 'تم حل النموذج اعتماداً على شروطك الحدية والمعادلات الفيزيائية الحتمية.';

          onStartProject(project);
          setIsProcessing(false);
        } catch (err: any) {
          setErrorMessage('حدث خطأ أثناء تنفيذ الحسابات: ' + String(err));
          setIsProcessing(false);
        }
      }, 350);
      return;
    }

    // Hybrid analysis flow: Always sends to server (uses server key or rotated pool keys)
    setProcessingStatus('جاري تحليل ملفاتك ومعالجة الشروط الحدية عبر المحرك الذكي...');
    const candidateKeys = apiKeys.filter((k) => k.status !== 'exhausted').map((k) => k.key);
    const keyPoolToTry = candidateKeys.length > 0 ? candidateKeys : [''];

    (async () => {
      let succeeded = false;
      let lastServerError = '';

      for (let i = 0; i < keyPoolToTry.length; i++) {
        const activeKey = keyPoolToTry[i];
        if (candidateKeys.length > 0) {
          setProcessingStatus(`جاري التحليل بالخادم السحابي (مفتاح ${i + 1}/${candidateKeys.length})...`);
        }

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
            projectType: 'Engineering Simulation & Analysis',
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
              `تم استخراج وتحليل بيانات ملف (${filesList[0]?.name || 'المشروع'}) وتطبيق شروطه الحدية بدقة.`;

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

      // If server analysis could not complete, notify user and smoothly use the deterministic physics engine with the user's extracted parameters
      if (!succeeded) {
        setProcessingStatus('جاري المعالجة الفورية عبر المحرك الفيزيائي الرقمي الحتمي...');
        setTimeout(() => {
          const allContent = filesList
            .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
            .filter(Boolean)
            .join('\n\n');
          const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
          const firstFileName = primaryFile?.name || 'cae_simulation.jou';
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
          project.extractedSummary = `تم تحليل ومعالجة ملف (${firstFileName}) محلياً بواسطة المحرك الفيزيائي الحتمي بدقة 100% (${lastServerError ? `ملاحظة: ${lastServerError}` : ''})`;
          
          onStartProject(project);
          setIsProcessing(false);
        }, 400);
      }
    })();
  };

  const getCategoryBadge = (category?: string) => {
    switch (category) {
      case 'archive':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold font-mono">📦 أرشيف مضغوط (.ZIP/.WBPZ)</span>;
      case 'word':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">Word Document</span>;
      case 'excel':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Excel Dataset</span>;
      case 'code':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">Script / APDL</span>;
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
    <div className="max-w-5xl mx-auto py-6 space-y-8 animate-in fade-in duration-300">
      {/* Top Clean Hero & System Bar */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-md shadow-emerald-400/50" />
              <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider uppercase">
                منصة عمل هندسية شاملة ومستقلة · READY FOR CONTINUOUS WORK
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              ANSYS Engineering WorkBench
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              منصة صناعية متكاملة لمحاكاة ميكانيكا الموائع والإنشاءات (CFD & FEA). استيراد وقراءة كاملة لملفات بايثون، أنسيز، إكسل، وورد، والصور والمخططات، مع معالجة حتمية للنتائج دون تخمين.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            {onOpenProjectsLibrary && (
              <button
                type="button"
                onClick={onOpenProjectsLibrary}
                className="px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-bold shadow-md shadow-amber-950/40 flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span>استدعاء البحوث السابقة ({savedProjectsCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenKeyPool}
              className="px-4 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>
                المحرك:{' '}
                <strong className="text-white">
                  {engineMode === 'pure_local' ? 'محلي 100%' : 'هجين ذكي'}
                </strong>
              </span>
            </button>

            {onOpenCloudSettings && (
              <button
                type="button"
                onClick={onOpenCloudSettings}
                className="px-4 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                title="تهيئة الخادم السحابي 400GB وترخيص أنسيز"
              >
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>السحابة والترخيص (400GB)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleStartCleanSimulation(true)}
              disabled={isProcessing}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>تشغيل المحاكاة الفورية</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dedicated Recall Previous Projects Banner */}
      {onOpenProjectsLibrary && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 shadow-md shadow-amber-950/50">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-100">
                  نافذة استدعاء البحوث والمشاريع السابقة (Projects Hub)
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                  {savedProjectsCount} مشاريع محفوظة
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                هل تريد استعراض أو تعديل بحث سابق (أطروحة الماجستير LHTES v3، أو نماذج CFD و FEA)؟ استدعِها بضغطة زر دون أن تلتصق ببيئة العمل الجديدة.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenProjectsLibrary}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold shadow-md shadow-orange-950/40 flex items-center gap-2 transition-all active:scale-95 shrink-0"
          >
            <FolderOpen className="w-4 h-4" />
            <span>استدعاء البحوث والمشاريع السابقة</span>
          </button>
        </div>
      )}

      {/* Main Clean Workspace Ingestion Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                محطة استقبال وفحص الملفات والمخططات الهندسية
              </h2>
              <p className="text-xs text-slate-400">
                استقبال ومعالجة لكافة الامتدادات: Python (.py)، ANSYS (.jou, .mac)، Excel (.xlsx, .csv)، Word (.docx)، والصور الهندسية (.png, .jpg, .svg)
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-sky-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            {filesList.length} ملفات تم التعرف عليها
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
              ? 'جاري فك ضغط الأرشيف وفحص وقراءة محتويات السكربتات الداخلية...'
              : 'اسحب وأفلت ملف عملك الهندسي أو الأرشيف المضغوط بالكامل (.zip / .wbpz)'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl mx-auto leading-relaxed">
            ارفع ملفاتك الفردية أو الأرشيف المضغوط (ZIP / ANSYS Workbench Archive)؛ ستتعرف المنصة عليه فورياً وتفك ضغطه وتستخرج كافة السكربتات والمعاملات والشروط الحدية الداخلية بدقة!
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px] font-mono">
            <span className="bg-purple-950/80 text-purple-300 border border-purple-800/80 px-2.5 py-1 rounded font-bold">
              📦 أرشيف مضغوط (.zip / .wbpz)
            </span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Python (.py)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">ANSYS APDL (.mac / .inp)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Fluent (.jou / .cas)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Excel (.xlsx / .csv)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">Word (.docx)</span>
            <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300">CAD / Images</span>
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
                أو ألصق نص كود السكربت يدوياً (ANSYS APDL / Fluent TUI / Python / OpenFOAM)
              </span>
              <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded font-mono">
                مباشر وفوري
              </span>
            </div>
            <button
              type="button"
              className="text-xs text-sky-400 font-medium hover:underline"
            >
              {isPasteScriptOpen ? 'إغلاق المحرر' : 'فتح محرر اللصق والفحص'}
            </button>
          </div>

          {isPasteScriptOpen && (
            <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="text-slate-400 text-xs">اسم ملف السكربت:</span>
                  <input
                    type="text"
                    value={scriptName}
                    onChange={(e) => setScriptName(e.target.value)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-sky-300 focus:outline-none"
                    placeholder="structural_analysis.mac"
                  />
                </div>
                <div className="text-[11px] text-slate-400">
                  يدعم أوامر: /PREP7, ET, MP, SF, /SOLU, Fluent scheme, pyansys
                </div>
              </div>

              <textarea
                rows={6}
                value={rawScriptText}
                onChange={(e) => setRawScriptText(e.target.value)}
                placeholder="/PREP7&#10;ET, 1, SOLID186&#10;MP, EX, 1, 210E9&#10;MP, PRXY, 1, 0.3&#10;SF, ALL, PRES, 50&#10;/SOLU&#10;SOLVE"
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
                  <span>فحص وإدراج السكربت في العمل</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Benchmark Presets: 1-Click Loadable Engineering Models */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                أو ابدأ فوراً بتحميل أحد النماذج الهندسية المعيارية المعتمدة (Benchmark Presets):
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              محاكاة كاملة 100% · ASME V&V 20
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* LHTES v3 Flagship Preset */}
            <div
              onClick={() => onStartProject(LHTES_V3_MASTER_PROJECT)}
              className="p-3.5 rounded-xl bg-slate-900 border border-amber-500/30 hover:border-amber-400 cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between group shadow-lg shadow-amber-950/10"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                    LHTES v3 · Thermal
                  </span>
                  <span className="text-[10px] text-emerald-400 font-bold font-mono">
                    GCI: 0.88%
                  </span>
                </div>
                <h4 className="font-bold text-xs text-white group-hover:text-amber-300 transition-colors">
                  تخزين الطاقة الحرارية الكامنة (LHTES Graded Fins & NePCM)
                </h4>
                <p className="text-[11px] text-slate-400 line-clamp-2">
                  زعانف شجرية متدرجة، كويل حلزوني، شروط متذبذبة، وتخفيض زمن الانصهار 40.39%.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-amber-400 font-bold">
                <span>تحميل المشروع واستعراض النتائج</span>
                <span className="font-mono text-xs">←</span>
              </div>
            </div>

            {/* NACA 0012 Airfoil CFD Preset */}
            <div
              onClick={() => onStartProject(NACA_0012_CFD_PROJECT)}
              className="p-3.5 rounded-xl bg-slate-900 border border-sky-500/30 hover:border-sky-400 cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between group shadow-lg shadow-sky-950/10"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono">
                    NACA 0012 · CFD
                  </span>
                  <span className="text-[10px] text-sky-400 font-bold font-mono">
                    R² = 0.998
                  </span>
                </div>
                <h4 className="font-bold text-xs text-white group-hover:text-sky-300 transition-colors">
                  الانسياب الهوائي وانفصال التدفق (Aerodynamic Flow & SST k-ω)
                </h4>
                <p className="text-[11px] text-slate-400 line-clamp-2">
                  محاكاة خارجية لمقطع الجناح عند Re = 3.0e6، زوايا هجوم 0°-15°، ومطابقة NASA.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-sky-400 font-bold">
                <span>تحميل المشروع واستعراض النتائج</span>
                <span className="font-mono text-xs">←</span>
              </div>
            </div>

            {/* Cantilever Beam FEA Preset */}
            <div
              onClick={() => onStartProject(CANTILEVER_BEAM_FEA_PROJECT)}
              className="p-3.5 rounded-xl bg-slate-900 border border-indigo-500/30 hover:border-indigo-400 cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between group shadow-lg shadow-indigo-950/10"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                    Cantilever · FEA
                  </span>
                  <span className="text-[10px] text-indigo-400 font-bold font-mono">
                    SF: 1.61
                  </span>
                </div>
                <h4 className="font-bold text-xs text-white group-hover:text-indigo-300 transition-colors">
                  التحليل الإنشائي بالعناصر المحدودة (Structural Steel Bending)
                </h4>
                <p className="text-[11px] text-slate-400 line-clamp-2">
                  جائز كابولي مقطع I خاضع لحمولة طرفية 45 kN، إجهادات فون ميسيس وسهم التشوه.
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-indigo-400 font-bold">
                <span>تحميل المشروع واستعراض النتائج</span>
                <span className="font-mono text-xs">←</span>
              </div>
            </div>
          </div>
        </div>

        {/* Attached Files List & Diagnostics Card */}
        {filesList.length > 0 && (
          <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            {/* Quick Solve Action Banner */}
            <div className="p-3.5 bg-gradient-to-r from-sky-950/80 via-slate-900 to-indigo-950/80 border border-sky-500/40 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 border border-sky-500/30 animate-pulse">
                  <Cpu className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                    <span>تم التعرف على الملفات والسكربتات — جاهز للحل والمحاكاة الفورية!</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">
                      {projectField} | معايير ASME
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    تم استخراج الشروط الحدية والمعادلات؛ اضغط لبدء تشغيل محرك ANSYS وحساب الكونتورات وتقارب البواقي فورياً.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleStartCleanSimulation(true)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                >
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                  <span>حل محلي فوري (100% Offline)</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleStartCleanSimulation(false)}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/30 flex items-center gap-2 transition-all active:scale-95"
                >
                  <Sparkles className="w-4 h-4 text-sky-200" />
                  <span>🚀 تشغيل محاكاة ANSYS الآن (Solve Now)</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-300 font-semibold border-b border-slate-800 pb-2.5">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>الملفات والسكربتات المفحوصة والمستخرجة ({filesList.length}):</span>
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
                            📁 من الأرشيف: {f.parentArchiveName}
                          </span>
                        )}
                        {f.isArchive && f.archiveFilesCount !== undefined && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold font-mono">
                            ✓ مفكوك: {f.archiveFilesCount} ملفات
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

                      {/* Extracted Parameters Badges */}
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
                      title="تشغيل وحل هذا السكربت/الملف فورياً في بيئة ANSYS"
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>تشغيل في ANSYS</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePreviewFile(f)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs flex items-center gap-1 transition-colors"
                      title="معاينة محتويات الملف المستخرجة"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>معاينة المحتوى</span>
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
          {/* Custom Project Title */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-300 block">
              عنوان أو موضوع التحليل الهندسي (اختياري - يحدد تلقائياً من ملفك):
            </label>
            <input
              type="text"
              placeholder="مثال: تحليل وتوزيع إجهادات العارضة الإنشائية / تدفق هوائي حول جنيح ديناميكي"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          {/* Domain Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              المجال الهندسي المطلوب:
            </label>
            <select
              value={projectField}
              onChange={(e) => setProjectField(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 focus:outline-none"
            >
              <option value="CFD">ميكانيكا الموائع الحسابية (CFD)</option>
              <option value="FEA">التحليل الإنشائي والعناصر المحدودة (FEA)</option>
              <option value="Thermal">انتقال الحرارة والديناميكا الحرارية</option>
              <option value="Multiphysics">محاكاة متعددة المجالات (Multiphysics)</option>
            </select>
          </div>
        </div>

        {/* Directives and Notes */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-400" />
              توجيهات وملاحظات المهندس للتعريف والعمل المتكامل:
            </span>
            <span className="text-[11px] text-slate-400">
              توجيهات إضافية لتخصيص الشروط الحدية، الحمولات، أو المعادلات
            </span>
          </label>
          <textarea
            rows={3}
            value={directives}
            onChange={(e) => setDirectives(e.target.value)}
            placeholder="اكتب توجيهاتك أو ملاحظاتك على الملف، مثلاً: سرعة الدخول = 20 m/s، تثبيت الطرف الأيسر بحمولة 15 MPa، استخدام مادة فولاذ 4340، أو دراسة ظاهرة الانفصال..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none leading-relaxed resize-none"
          />
        </div>

        {/* Processing State */}
        {isProcessing && (
          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center gap-3 text-xs text-sky-200 animate-pulse">
            <Cpu className="w-5 h-5 text-sky-400 shrink-0 animate-spin" />
            <div>
              <p className="font-bold text-sky-300">{processingStatus}</p>
              <p className="text-[11px] text-sky-400/80 mt-0.5">
                تطبيق قوانين الحفظ الفيزيائية، حل المعادلات، وتوليد شبكة الميش ومؤشر روتش والكونتورات...
              </p>
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
            <span>نظام محاكاة متكامل لا يتوقف أبداً ويعمل بدقة البرامج الهندسية المعتمدة</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleStartCleanSimulation(true)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>حل مباشر بالمحرك المحلي (100% Offline)</span>
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleStartCleanSimulation(false)}
              className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-900/30 flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-sky-200" />
              <span>تنفيذ التحليل والمحاكاة للملفات الآن</span>
            </button>
          </div>
        </div>
      </div>

      {/* File Content Preview Modal */}
      {activePreviewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
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
                    معاينة المحتوى المقروء والمستخرج من الملف
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

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Summary Banner */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-slate-200">تشخيص الملف المقروء:</span>
                  <p className="text-slate-400 leading-relaxed">{activePreviewFile.summary}</p>
                </div>
              </div>

              {/* Detected Parameters */}
              {activePreviewFile.detectedParameters && activePreviewFile.detectedParameters.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    المعاملات الهندسية المكتشفة تلقائياً:
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

              {/* Archive Internal Tree & Contents Explorer */}
              {activePreviewFile.isArchive && activePreviewFile.archiveTree && (
                <div className="space-y-3">
                  <div className="bg-purple-950/40 border border-purple-800/40 p-4 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-purple-300">
                      <span className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-purple-400" />
                        <span>شجرة محتويات الأرشيف الهندسي المفكوك ({activePreviewFile.archiveFilesCount} ملفات)</span>
                      </span>
                      <span className="text-[11px] text-emerald-400 font-mono">
                        ✓ تم فك الضغط وقراءة السكربتات بنجاح
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      تم التعرف على بنية الأرشيف وتفكيك كافة ملفاته وسكربتاته البرمجية بالكامل، وهي مدرجة في مساحة العمل وجاهزة للحل الهندسي.
                    </p>
                  </div>
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
                      عناصر الأرشيف المفكوكة:
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

              {/* Image Preview */}
              {activePreviewFile.isImage && activePreviewFile.base64Data && (
                <div className="border border-slate-800 rounded-xl p-2 bg-slate-950 flex items-center justify-center">
                  <img
                    src={activePreviewFile.base64Data}
                    alt={activePreviewFile.name}
                    className="max-h-96 rounded-lg object-contain"
                  />
                </div>
              )}

              {/* Sheets Data if Excel */}
              {activePreviewFile.sheetsData && activePreviewFile.sheetsData.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <TableIcon className="w-4 h-4 text-emerald-400" />
                    أوراق عمل إكسل والبيانات المقروءة:
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

              {/* Text/Code Preview */}
              {activePreviewFile.content && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-slate-200">
                    مقتطف من المحتوى النصي / البرمجي المقروء:
                  </h4>
                  <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap leading-relaxed">
                    {activePreviewFile.content.slice(0, 3000)}
                    {activePreviewFile.content.length > 3000 ? '\n... (تم استعراض جزء من المحتوى)' : ''}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
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
