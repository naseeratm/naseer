import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Download,
  Copy,
  Printer,
  Check,
  Server,
  Cpu,
  Code2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Boxes,
} from 'lucide-react';

interface AuditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LiveCloudStatus {
  pythonConnected: boolean;
  config?: { backendUrl?: string; workingDirectory?: string; parallelCores?: number };
  pythonDetails?: {
    status?: string;
    redis?: boolean;
    workers_online?: number;
    worker_names?: string[];
    solvers?: Record<string, boolean | { available?: boolean; path?: string | null; version?: string | null }>;
  } | null;
}

const isSolverAvailable = (
  entry: boolean | { available?: boolean; version?: string | null } | undefined,
): boolean => (typeof entry === 'boolean' ? entry : Boolean(entry?.available));

const solverVersionTag = (
  entry: boolean | { available?: boolean; version?: string | null } | undefined,
): string => {
  if (!isSolverAvailable(entry)) return 'N/A';
  if (typeof entry === 'object' && entry?.version) return `READY (${entry.version})`;
  return 'READY';
};

export const SIMSCALE_AUDIT_REPORT_TEXT = `# تقرير التدقيق الهندسي الشامل: التوجيه الصارم نحو حاويات المحاكاة Docker (:8000)

**المشروع:** منصة NASEER Universal CAE Studio  
**الحالة:** موجهة بالكامل نحو حاويات Docker (:8000) مع سياسة Zero-Mock

---

## 1. ملخص البنية التحتية المعتمدة

1. **الفيو-بورت المركزي (Interactive3DViewport):**
   * محرك Three.js WebGL تفاعلي كامل يعرض هندسة المجسم والشبكة والبيانات الحقلية الثلاثية الأبعاد (vtk_data) وأسهم المتجهات ومجس فحص القيم عند النقر على النماذج الحقيقية.

2. **بوابة التوجيه الصارم (Port 3000 -> Docker Port 8000):**
   * جميع مهام المحاكاة والتشبيك والمسح البارامتري تُوجَّه من بوابة Express (:3000) مباشرة إلى FastAPI / Celery / Redis على المنفذ :8000 بدون أي محرك احتياطي صامت أو أرقام عشوائية.

3. **حزمة المحركات الفيزيائية الحقيقية داخل Docker:**
   * **OpenFOAM v2406**: الموائع غير القابلة والانضغاطية (simpleFoam / rhoSimpleFoam) والاقتران الحراري (chtMultiRegionFoam) وتعدد الأطوار (interFoam).
   * **CalculiX v2.21**: التحليل الإنشائي الساكن والديناميكي والانبعاج والإجهاد الحراري (C3D8 / C3D8T / SPOOLES).
   * **Gmsh + meshio**: التشبيك الثلاثي الأبعاد التلقائي لملفات STL / STEP والنطاقات البارامترية.
   * **ElmerFEM**: المجالات الكهرومغناطيسية والصوتية.
`;

export const AUDIT_REPORT_TEXT = `# وثيقة التدقيق المعماري والنزاهة العددية (Zero-Mock Architecture)
## System Architecture & Solver Routing Verification
معرف البنية: NASEER-CAE-DOCKER-PORT8000  

### ركائز التحقق والنزاهة:
1. عدم وجود أي محاكاة صامتة أو قيم محاكاة مولدة بـ Math.random() عند انقطاع حاوية Docker.
2. فحص جاهزية المحركات الحي عبر المسار GET /api/health (OpenFOAM, CalculiX, Gmsh, ElmerFEM, Redis, Celery Workers) مع تعطيل كل محللات البايثون البديلة.
3. استقلالية الشبكة Roache GCI (ASME V&V 20) محسوبة فعلياً من ثلاث جولات تشغيل للمحرك عبر POST /api/mesh-study مع دعم تشبيك STEP/STL.
4. استيفاء الحقول الثلاثية الأبعاد (vtk_data) لملفات OpenFOAM و CalculiX (.inp و CAD) و ElmerFEM وعرضها مباشرة على شبكات WebGL في الواجهة.
`;

export const AuditReportModal: React.FC<AuditReportModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'simscale' | 'system'>('simscale');
  const [copied, setCopied] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveCloudStatus | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/cloud/status')
      .then((res) => res.json())
      .then((data) => setLiveStatus(data))
      .catch(() => setLiveStatus(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const currentText = activeTab === 'simscale' ? SIMSCALE_AUDIT_REPORT_TEXT : AUDIT_REPORT_TEXT;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const filename =
      activeTab === 'simscale' ? 'simscale_cae_platform_audit.md' : 'technical_audit_and_completeness_report.md';
    const blob = new Blob([currentText], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const solvers = liveStatus?.pythonDetails?.solvers;
  const workersOnline = liveStatus?.pythonDetails?.workers_online;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/90">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  مركز التدقيق المعماري وفحص الجاهزية الحي (Live Docker Audit)
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                  Zero-Mock Strict Mode
                </span>
              </div>
              <p className="text-xs text-slate-400">
                فحص حي لربط المنفذ :3000 بحاويات المحاكاة على المنفذ :8000 وتوثيق بنية المحركات
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copied ? 'تم النسخ' : 'نسخ التقرير'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل التقرير (.md)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('simscale')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'simscale'
                ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-sky-400" />
            <span>بنية المنصة وربط المحركات (:8000)</span>
          </button>

          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'system'
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>وثيقة النزاهة العددية (Zero-Mock Policy)</span>
          </button>
        </div>

        {/* Live Telemetry Highlights Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-2.5 bg-slate-950/40 border-b border-slate-800/80 text-[11px] font-mono">
          <div className="flex items-center gap-2 text-slate-300">
            {liveStatus?.pythonConnected ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
            <span>Docker (:8000): {liveStatus?.pythonConnected ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Code2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Workers: {workersOnline !== undefined ? workersOnline : '—'} | Redis:{' '}
              {liveStatus?.pythonDetails?.redis ? 'UP' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate" title={solverVersionTag(solvers?.openfoam)}>
              OpenFOAM: {isSolverAvailable(solvers?.openfoam) ? 'READY' : 'N/A'} | CCX: {isSolverAvailable(solvers?.calculix) ? 'READY' : 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Server className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="truncate">
              Gmsh: {isSolverAvailable(solvers?.gmsh) ? 'READY' : 'N/A'} | Elmer: {isSolverAvailable(solvers?.elmer) ? 'READY' : 'N/A'}
            </span>
          </div>
        </div>

        {/* Document Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-200 leading-relaxed font-sans select-text">
          <div className="space-y-4 bg-slate-950/70 p-6 rounded-xl border border-slate-800 text-slate-200 whitespace-pre-wrap font-sans text-xs sm:text-sm shadow-inner">
            {currentText}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80">
          <span className="text-xs text-slate-400 font-mono">
            Endpoint: <code className="text-sky-400">{liveStatus?.config?.backendUrl || 'http://127.0.0.1:8000'}</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة الوثيقة</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
