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
import { ThesisProject, IngestedFileItem } from '../types/thesis';
import { SimulationInputs } from '../types/studio';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';
import { normalizeSolverResponse } from '../utils/normalizedSolverResults';

interface ScriptUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAnalysisComplete: (project: ThesisProject) => void;
  simulationInputs?: SimulationInputs;
}

export function ScriptUploaderModal({
  isOpen,
  onClose,
  onAnalysisComplete,
  simulationInputs,
}: ScriptUploaderModalProps) {
  const [filesList, setFilesList] = useState<IngestedFileItem[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [directives, setDirectives] = useState('');
  const [projectField, setProjectField] = useState<'CFD' | 'FEA' | 'Thermal' | 'Multiphysics'>('CFD');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<IngestedFileItem | null>(null);
  const [isPasteTextOpen, setIsPasteTextOpen] = useState(false);
  const [pastedDocText, setPastedDocText] = useState('');
  const [pastedDocTitle, setPastedDocTitle] = useState('thesis_specifications.docx');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

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

  const handleAddPastedDoc = async () => {
    if (!pastedDocText.trim()) return;
    const name = pastedDocTitle.trim() || 'thesis_specifications.docx';
    const blob = new Blob([pastedDocText], { type: 'text/plain' });
    const file = new File([blob], name, { type: 'text/plain' });
    await handleFilesSelected([file]);
    setPastedDocText('');
    setIsPasteTextOpen(false);
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

  const toRawFile = (item: IngestedFileItem): File | null => {
    if (item.base64Data && item.base64Data.includes('base64,')) {
      const b64 = item.base64Data.split('base64,')[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], item.name, { type: item.mimeType || 'application/octet-stream' });
    }
    if (item.content !== undefined) {
      return new File([item.content], item.name, { type: item.mimeType || 'text/plain' });
    }
    return null;
  };

  // Open workspace setup without pretending equations were solved
  const handleOpenWorkspaceOnly = () => {
    setIsProcessing(true);
    setProcessingStatus('جاري تجهيز مساحة العمل واستخلاص الشروط الحدية من الملفات...');
    setErrorMessage(null);

    try {
      const allContent = filesList
        .map((f) => (f.content ? `=== [ملف: ${f.name}] (${f.category}) ===\n${f.content}` : ''))
        .filter(Boolean)
        .join('\n\n');
      const primaryFile = filesList.find((f) => !f.isArchive && f.content) || filesList[0];
      const firstFileName = primaryFile?.name || 'imported_model';
      const project = generateLocalEngineeringProject(
        firstFileName,
        directives,
        projectField,
        allContent || primaryFile?.content || '',
        filesList,
      );
      project.attachedFilesCount = filesList.length;
      project.directivesApplied = directives;
      project.extractedSummary =
        primaryFile?.summary || 'تم استيراد الملفات وإعداد مساحة العمل — اضغط تشغيل المحاكاة لحل المعادلات في Docker (:8000).';

      onAnalysisComplete(project);
      setIsProcessing(false);
      onClose();
    } catch (err: any) {
      setErrorMessage('تعذر قراءة الملفات وتجهيز مساحة العمل: ' + String(err));
      setIsProcessing(false);
    }
  };

  // Upload to Docker (:8000) /api/upload-model and run genuine solver via Celery
  const handleExecuteOnDocker = async () => {
    if (filesList.length === 0) {
      setErrorMessage('يرجى إرفاق ملف هندسي أولاً (.stl, .step, .inp, .zip, .jou, ...).');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setProcessingStatus('جاري رفع النموذج إلى حاوية Docker (:8000) وفحصه...');

    try {
      const primaryItem = filesList[0];
      const rawFile = toRawFile(primaryItem);
      if (!rawFile) {
        throw new Error(`تعذر قراءة المحتوى الثنائي أو النصي للملف: ${primaryItem.name}`);
      }

      const form = new FormData();
      form.append('file', rawFile);
      form.append('directives', directives || '');

      const uploadRes = await fetch('/api/upload-model', {
        method: 'POST',
        body: form,
      });
      const uploaded = await uploadRes.json();
      if (!uploadRes.ok || !uploaded.success) {
        throw new Error(uploaded?.error || uploaded?.detail || `فشل رفع الملف (${uploadRes.status})`);
      }

      const allContent = filesList
        .map((f) => (f.content ? `=== [ملف: ${f.name}] ===\n${f.content}` : ''))
        .filter(Boolean)
        .join('\n\n');

      const project = generateLocalEngineeringProject(
        uploaded.filename || primaryItem.name,
        directives,
        projectField,
        allContent || primaryItem.content || '',
        filesList,
      );
      project.attachedFilesCount = filesList.length;
      project.directivesApplied = directives;
      project.extractedSummary = `تم رفع ${uploaded.filename} إلى Docker (${uploaded.parsed_type || primaryItem.extension}).`;

      const simType =
        simulationInputs?.simulationType ||
        (projectField === 'FEA'
          ? 'Structural_Static'
          : projectField === 'Thermal'
          ? 'Thermal_Steady'
          : projectField === 'Multiphysics'
          ? 'CHT_Coupled'
          : 'CFD_Incompressible');

      const numFromStr = (raw: string | undefined, fallback: number): number => {
        if (!raw || raw.trim() === '') return fallback;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const ext = primaryItem.extension.toLowerCase();
      const simPayload: Record<string, any> = {
        simulation_type: simType,
        execution_mode: 'celery',
        width_x: numFromStr(simulationInputs?.widthX, 1.0),
        height_y: numFromStr(simulationInputs?.heightY, 0.4),
        depth_z: numFromStr(simulationInputs?.depthZ, 0.1),
        mesh_size: numFromStr(simulationInputs?.meshSize, 0.08),
        velocity: numFromStr(simulationInputs?.velocity, 1.0),
        pressure: numFromStr(simulationInputs?.pressure, 101325.0),
        temperature: numFromStr(simulationInputs?.temperature, 300.0),
        temperature_unit: simulationInputs?.temperatureUnit || 'K',
        parallel_cores: Math.max(1, Math.round(numFromStr(simulationInputs?.parallelCores, 1))),
        uploaded_file_path: uploaded.uploaded_file_path,
      };
      const kCond = numFromStr(simulationInputs?.thermalConductivity, NaN);
      const youngs = numFromStr(simulationInputs?.youngModulus, NaN);
      const nu = numFromStr(simulationInputs?.poissonRatio, NaN);
      const rho = numFromStr(simulationInputs?.fluidDensity ?? simulationInputs?.density, NaN);
      const mu = numFromStr(simulationInputs?.dynamicViscosity, NaN);
      const hFlux = numFromStr(simulationInputs?.heatFlux, NaN);
      if (Number.isFinite(kCond)) simPayload.thermal_conductivity_k = kCond;
      if (Number.isFinite(youngs)) simPayload.young_modulus = youngs;
      if (Number.isFinite(nu)) simPayload.poisson_ratio = nu;
      if (Number.isFinite(rho)) simPayload.density = rho;
      if (Number.isFinite(mu)) simPayload.dynamic_viscosity = mu;
      if (Number.isFinite(hFlux)) simPayload.heat_flux = hFlux;
      if (simulationInputs?.turbulenceModel) simPayload.turbulence_model = simulationInputs.turbulenceModel;
      if (simulationInputs?.timeMode) simPayload.time_mode = simulationInputs.timeMode;
      const tStep = numFromStr(simulationInputs?.timeStep, NaN);
      const tEnd = numFromStr(simulationInputs?.endTime, NaN);
      if (Number.isFinite(tStep)) simPayload.time_step = tStep;
      if (Number.isFinite(tEnd)) simPayload.end_time = tEnd;
      if (simulationInputs?.nonlinear !== undefined) simPayload.nonlinear = Boolean(simulationInputs.nonlinear);
      if (simulationInputs?.contactType) simPayload.contact_type = simulationInputs.contactType;
      if (simulationInputs?.materialModel) simPayload.material_model = simulationInputs.materialModel;
      const syMpa = numFromStr(simulationInputs?.yieldStressMpa, NaN);
      const etMpa = numFromStr(simulationInputs?.tangentModulusMpa, NaN);
      const c10Mpa = numFromStr(simulationInputs?.hyperC10Mpa, NaN);
      const d1Val = numFromStr(simulationInputs?.hyperD1, NaN);
      const muFric = numFromStr(simulationInputs?.frictionCoeff, NaN);
      const mrfRpm = numFromStr(simulationInputs?.mrfOmegaRpm, NaN);
      const mrfRad = numFromStr(simulationInputs?.mrfRadius, NaN);
      if (Number.isFinite(syMpa) && syMpa > 0) simPayload.yield_stress_pa = syMpa * 1e6;
      if (Number.isFinite(etMpa) && etMpa > 0) simPayload.tangent_modulus_pa = etMpa * 1e6;
      if (Number.isFinite(c10Mpa) && c10Mpa > 0) simPayload.hyper_c10_pa = c10Mpa * 1e6;
      if (Number.isFinite(d1Val) && d1Val >= 0) simPayload.hyper_d1_inv_pa = d1Val;
      if (Number.isFinite(muFric) && muFric >= 0) simPayload.friction_coeff = muFric;
      if (simulationInputs?.mrfEnabled && Number.isFinite(mrfRpm) && mrfRpm !== 0) {
        simPayload.mrf_enabled = true;
        simPayload.mrf_omega_rad_s = mrfRpm * ((2 * Math.PI) / 60);
        simPayload.mrf_axis = simulationInputs.mrfAxis || 'z';
        if (Number.isFinite(mrfRad) && mrfRad > 0) simPayload.mrf_radius = mrfRad;
      }

      // Apply any numeric parameters extracted from the uploaded file content
      if (Array.isArray(primaryItem.detectedParameters)) {
        for (const paramEntry of primaryItem.detectedParameters) {
          const kLower = String(paramEntry.key || '').toLowerCase();
          const numVal = Number(paramEntry.value);
          if (!Number.isFinite(numVal)) continue;
          if (kLower.includes('vel')) simPayload.velocity = numVal;
          else if (kLower.includes('temp')) simPayload.temperature = numVal;
          else if (kLower.includes('press')) simPayload.pressure = numVal;
        }
      }

      if (uploaded.cad_stl_b64) {
        simPayload.cad_stl_b64 = uploaded.cad_stl_b64;
        simPayload.cad_filename = uploaded.filename;
      }
      if (ext === 'inp' && primaryItem.content) {
        simPayload.inp_deck = primaryItem.content;
      }

      setProcessingStatus('جاري تشغيل المحاكاة الفعلية عبر Docker (:8000)...');
      const runRes = await fetch('/api/run-simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simPayload),
      });
      const runData = await runRes.json();
      if (!runRes.ok) {
        throw new Error(runData?.error || runData?.message || `فشل إرسال المهمة (${runRes.status})`);
      }

      let finalJobResult = runData.result;
      const taskId = runData.task_id;
      if (taskId) {
        const started = Date.now();
        while (Date.now() - started < 180_000) {
          await new Promise((r) => setTimeout(r, 1200));
          const jobRes = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`);
          if (!jobRes.ok) continue;
          const job = await jobRes.json();
          const st = String(job.status || '').toUpperCase();
          setProcessingStatus(`جاري التنفيذ في Celery (${st}${job.progress ? ` - ${job.progress}%` : ''})...`);
          if (st === 'COMPLETED') {
            finalJobResult = job.result;
            break;
          }
          if (st === 'FAILED' || st === 'CANCELLED') {
            throw new Error(job.error || 'فشلت المحاكاة داخل حاوية Docker.');
          }
        }
      }

      if (finalJobResult) {
        const normalized = normalizeSolverResponse(finalJobResult, project);
        project.simulationRun = {
          taskId: taskId || `docker_${Date.now()}`,
          executionMode: 'celery',
          submittedRequest: simPayload,
          result: finalJobResult,
          logs: Array.isArray(finalJobResult?.logs) ? finalJobResult.logs.map(String) : [],
          recordedAt: new Date().toISOString(),
        };
        project.normalizedSolverResult = normalized;
        project.solver = {
          ...project.solver,
          solverType: normalized.solver,
        };
      }

      onAnalysisComplete(project);
      setIsProcessing(false);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر الاتصال ببوابة Docker (:8000). تأكد من تشغيل docker compose.');
      setIsProcessing(false);
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
              accept=".stl,.step,.stp,.iges,.igs,.msh,.obj,.inp,.cas,.dat,.cdb,.zip,.wbpz,.docx,.doc,.docm,.rtf,.pdf,.txt,.py,.jou,.mac,.m,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.svg,.webp"
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
              {isParsingFiles ? 'جاري فحص وقراءة محتويات المستند والملفات المرفقة...' : 'انقر لاختيار ملف CAD (.stl/.step) أو (.inp/.zip/.msh) أو المستندات'}
            </h4>
            <p className="text-[11px] text-slate-400 mt-1">
              يدعم الهندسة ثلاثية الأبعاد (.stl, .step)، ملفات CalculiX/OpenFOAM (.inp, .msh, .zip)، بايثون (.py)، والمستندات (.docx, .pdf, .xlsx)
            </p>
          </div>

          {/* Alternative: Direct Word / Document Text Paste */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-semibold text-slate-300">
                  هل تفضل لصق نص مستند وورد / الأطروحة مباشرة؟
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsPasteTextOpen(!isPasteTextOpen)}
                className="text-xs text-sky-400 font-bold hover:underline"
              >
                {isPasteTextOpen ? 'إغلاق المحرر' : 'فتح محرر اللصق المباشر'}
              </button>
            </div>

            {isPasteTextOpen && (
              <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-950">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <span className="text-slate-400">عنوان المستند:</span>
                    <input
                      type="text"
                      value={pastedDocTitle}
                      onChange={(e) => setPastedDocTitle(e.target.value)}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-sky-300 focus:outline-none"
                      placeholder="thesis_specs.docx"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400">
                    انسخ محتوى ملف الوورد (Ctrl+A ثم Ctrl+C) والصقه هنا مباشرة
                  </span>
                </div>

                <textarea
                  rows={5}
                  value={pastedDocText}
                  onChange={(e) => setPastedDocText(e.target.value)}
                  placeholder="الصق نصوص ومواصفات الأطروحة أو الشروط الحدية هنا..."
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 font-sans text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none leading-relaxed resize-y"
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPasteTextOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleAddPastedDoc}
                    disabled={!pastedDocText.trim()}
                    className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md shadow-sky-900/30 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <FileCheck className="w-3.5 h-3.5" />
                    <span>إدراج نص الوورد في التحليل</span>
                  </button>
                </div>
              </div>
            )}
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
            <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center gap-3 text-sky-200">
              <Cpu className="w-5 h-5 text-sky-400 shrink-0 animate-spin" />
              <div>
                <p className="font-bold text-sky-300">{processingStatus}</p>
                <p className="text-[11px] text-sky-400/80 mt-0.5">
                  يتم إرسال الملفات مباشرة إلى خادم Docker (:8000) ومحركات OpenFOAM / CalculiX / Gmsh
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
              التوجيه الفعلي:{' '}
              <strong className="text-slate-200">
                Docker Engine (:8000)
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleOpenWorkspaceOnly}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              فتح في مساحة العمل (بدون تشغيل المحاكي)
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteOnDocker}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              رفع وتشغيل عبر Docker (:8000)
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
