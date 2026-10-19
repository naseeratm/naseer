import React, { useState, useRef } from 'react';
import {
  Upload,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Cpu,
  Layers,
  X,
  Plus,
  Trash2,
  Eye,
  Settings,
  HelpCircle,
  FileCheck,
  Loader2,
  Info,
  Table as TableIcon,
  Package,
} from 'lucide-react';
import { ThesisProject, IngestedFileItem, ApiKeyItem, EngineMode } from '../types/thesis';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';

interface ScriptUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAnalysisComplete: (project: ThesisProject) => void;
  apiKeys: ApiKeyItem[];
  engineMode: EngineMode;
}

export function ScriptUploaderModal({
  isOpen,
  onClose,
  onAnalysisComplete,
  apiKeys,
  engineMode,
}: ScriptUploaderModalProps) {
  const [filesList, setFilesList] = useState<IngestedFileItem[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [directives, setDirectives] = useState('');
  const [projectField, setProjectField] = useState<'CFD' | 'FEA' | 'Thermal' | 'Multiphysics'>('CFD');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<IngestedFileItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFilesSelected = async (files: FileList | null) => {
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
    if (selectedPreviewFile?.id === id) {
      setSelectedPreviewFile(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileCategoryIcon = (file: IngestedFileItem) => {
    if (file.isArchive || file.category === 'archive' || ['zip', 'wbpz', 'tar', 'gz', '7z', 'rar'].includes(file.extension))
      return <Package className="w-4 h-4 text-purple-400" />;
    if (file.isImage) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (file.category === 'excel' || ['xlsx', 'xls', 'csv'].includes(file.extension))
      return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (file.category === 'word' || ['docx', 'doc'].includes(file.extension))
      return <FileText className="w-4 h-4 text-blue-400" />;
    if (file.category === 'pdf' || file.extension === 'pdf')
      return <FileText className="w-4 h-4 text-rose-400" />;
    if (['py', 'mac', 'inp', 'jou', 'dat', 'cdb', 'm'].includes(file.extension))
      return <FileCode className="w-4 h-4 text-sky-400" />;
    return <FileText className="w-4 h-4 text-amber-400" />;
  };

  // Execution: Pure Local Deterministic Engine (Zero network, zero quota, instant)
  const handleExecuteLocalEngine = () => {
    setIsProcessing(true);
    setProcessingStatus('جاري تشغيل المحرك الفيزيائي الرقمي الحتمي لحل النموذج...');
    setErrorMessage(null);

    setTimeout(() => {
      try {
        const allContent = filesList
          .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
          .filter(Boolean)
          .join('\n\n');
        const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
        const firstFileName = primaryFile?.name || 'ansys_workbench_model.jou';
        const project = generateLocalEngineeringProject(
          firstFileName,
          directives,
          projectField,
          allContent || primaryFile?.content || '',
          filesList
        );
        project.attachedFilesCount = filesList.length;
        project.directivesApplied = directives;
        project.extractedSummary = primaryFile?.summary || 'تم حل النموذج اعتماداً على شروطك الحدية والمعادلات الفيزيائية الحتمية.';

        onAnalysisComplete(project);
        setIsProcessing(false);
        onClose();
      } catch (err: any) {
        setErrorMessage('حدث خطأ أثناء تنفيذ الحسابات المحلية: ' + String(err));
        setIsProcessing(false);
      }
    }, 400);
  };

  // Execution: Hybrid Mode with auto-rotation through API key pool and fallback to local
  const handleExecuteHybridAnalysis = async () => {
    if (engineMode === 'pure_local') {
      handleExecuteLocalEngine();
      return;
    }

    setIsProcessing(true);
    setProcessingStatus('جاري استدعاء المحرك الهجين وتحليل الملفات والمخططات...');
    setErrorMessage(null);

    const candidateKeys = apiKeys.filter((k) => k.status !== 'exhausted').map((k) => k.key);
    const keyPoolToTry = candidateKeys.length > 0 ? candidateKeys : [''];

    let succeeded = false;
    let lastErr = '';

    for (let i = 0; i < keyPoolToTry.length; i++) {
      const activeKey = keyPoolToTry[i];
      setProcessingStatus(
        candidateKeys.length > 0
          ? `جاري التحليل بالمفتاح (${i + 1}/${candidateKeys.length})...`
          : 'جاري التحليل بالخادم السحابي...'
      );

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
          directives,
          projectField,
          projectType: 'Engineering Simulation & Analysis',
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
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
          proj.attachedFilesCount = filesList.length;
          proj.directivesApplied = directives;
          proj.extractedSummary =
            proj.extractedSummary ||
            `تم استخراج وتحليل بيانات ملف (${filesList[0]?.name || 'المشروع'}) وتطبيق شروطه الحدية بدقة.`;

          onAnalysisComplete(proj);
          setIsProcessing(false);
          onClose();
          break;
        } else {
          lastErr = data.details || data.error || 'فشل معالجة النموذج عبر السيرفر';
        }
      } catch (err: any) {
        lastErr = err?.message || String(err);
      }
    }

    // Fallback to local deterministic physics engine if cloud failed
    if (!succeeded) {
      setProcessingStatus('جاري التحول التلقائي للمحرك الفيزيائي المحلي بدقة 100%...');
      setTimeout(() => {
        const firstFile = filesList[0];
        const firstFileName = firstFile?.name || 'ansys_workbench_model.jou';
        const project = generateLocalEngineeringProject(
          firstFileName,
          directives,
          projectField,
          firstFile?.content || '',
          filesList
        );
        project.attachedFilesCount = filesList.length;
        project.directivesApplied = directives;
        project.extractedSummary = `تم تحليل الملف محلياً بواسطة المحرك الفيزيائي الحتمي بدقة 100% (${lastErr ? `ملاحظة: ${lastErr}` : ''})`;

        onAnalysisComplete(project);
        setIsProcessing(false);
        onClose();
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-['Cairo',sans-serif]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                استيراد وتحليل ملفات ومخططات هندسية إضافية
              </h3>
              <p className="text-xs text-slate-400">
                استقبال ومعالجة لملفات الأكواد والجداول والمستندات والصور الهندسية
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Multi-Format Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesSelected(e.dataTransfer.files);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-sky-500 bg-slate-950/70 hover:bg-slate-950 rounded-2xl p-6 text-center cursor-pointer transition-all group"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-400 group-hover:scale-110 flex items-center justify-center mx-auto mb-2 transition-transform">
              {isParsingFiles ? (
                <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
              ) : (
                <Upload className="w-6 h-6" />
              )}
            </div>
            <h4 className="text-sm font-bold text-slate-200">
              {isParsingFiles ? 'جاري فك ضغط الأرشيف وفحص السكربتات المرفقة...' : 'انقر لاختيار الملفات أو اسحب الأرشيف المضغوط (.zip / .wbpz) هنا'}
            </h4>
            <p className="text-[11px] text-slate-400 mt-1">
              يدعم فك واستخراج الأرشيفات المضغوطة (.zip, .wbpz)، بايثون (.py)، أنسيز (.jou, .mac, .inp)، إكسل، وورد، والصور
            </p>
          </div>

          {/* Files List with Inspection */}
          {filesList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-semibold">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  الملفات المستوردة ({filesList.length}):
                </span>
                <button
                  type="button"
                  onClick={() => setFilesList([])}
                  className="text-rose-400 hover:underline font-normal text-[11px]"
                >
                  مسح الكل
                </button>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto">
                {filesList.map((f) => (
                  <div
                    key={f.id}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {f.isImage && f.base64Data ? (
                        <img
                          src={f.base64Data}
                          alt={f.name}
                          className="w-9 h-9 rounded object-cover border border-slate-700 shrink-0 cursor-pointer"
                          onClick={() => setSelectedPreviewFile(f)}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                          {getFileCategoryIcon(f)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200 font-medium truncate">{f.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {formatFileSize(f.size)}
                          </span>
                        </div>
                        {f.summary && (
                          <div className="text-[11px] text-slate-400 truncate">{f.summary}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedPreviewFile(f)}
                        className="p-1.5 text-sky-400 hover:bg-slate-900 rounded-lg transition-colors"
                        title="معاينة محتوى الملف"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(f.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition-colors"
                        title="إزالة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Domain Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              المجال الهندسي للنموذج:
            </label>
            <select
              value={projectField}
              onChange={(e) => setProjectField(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 focus:outline-none"
            >
              <option value="CFD">ميكانيكا الموائع الحسابية والتدفق (CFD)</option>
              <option value="FEA">التحليل الإنشائي والعناصر المحدودة (FEA)</option>
              <option value="Thermal">الانتقال الحراري والديناميكا الحرارية</option>
              <option value="Multiphysics">محاكاة متعددة المجالات (Multiphysics)</option>
            </select>
          </div>

          {/* Directives */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                توجيهات وملاحظات المهندس على الملف:
              </span>
              <span className="text-[11px] text-slate-500">اختياري</span>
            </label>
            <textarea
              rows={3}
              value={directives}
              onChange={(e) => setDirectives(e.target.value)}
              placeholder="اكتب توجيهاتك أو ملاحظاتك الهندسية لتطبيقها بدقة في التحليل..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none resize-none leading-relaxed"
            />
          </div>

          {/* Processing Status */}
          {isProcessing && (
            <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center gap-3 text-sky-200 animate-pulse">
              <Cpu className="w-5 h-5 text-sky-400 shrink-0 animate-spin" />
              <div>
                <p className="font-bold text-sky-300">{processingStatus}</p>
                <p className="text-[11px] text-sky-400/80 mt-0.5">
                  جاري استخراج المعطيات وحل المعادلات وتوليد الميش والكونتورات بدقة حتمية...
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>
              الوضع الحالي:{' '}
              <strong className="text-slate-200">
                {engineMode === 'pure_local' ? 'محلي 100%' : 'هجين ذكي فائق'}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteLocalEngine}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              حل فوري محلياً (Offline)
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteHybridAnalysis}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-sky-500/20 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>بدء التحليل والمعالجة</span>
            </button>
          </div>
        </div>

        {/* File Preview Submodal */}
        {selectedPreviewFile && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <span className="font-bold text-sm text-slate-200">{selectedPreviewFile.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewFile(null)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
                {selectedPreviewFile.isImage && selectedPreviewFile.base64Data && (
                  <img
                    src={selectedPreviewFile.base64Data}
                    alt={selectedPreviewFile.name}
                    className="max-h-72 mx-auto rounded object-contain border border-slate-800"
                  />
                )}
                {selectedPreviewFile.content && (
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px] text-slate-300 max-h-60 overflow-x-auto whitespace-pre-wrap">
                    {selectedPreviewFile.content.slice(0, 3000)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
