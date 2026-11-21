import React, { useState, useEffect, useCallback } from 'react';
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
  Play,
  RefreshCw,
  Award,
  Loader2,
  XCircle,
  MinusCircle,
  FileJson,
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

interface VVBenchmarkSpec {
  id: string;
  standard: string;
  domain: string;
  title: string;
  title_ar: string;
  required_solver_key: string;
  solver_name: string;
  solver_available: boolean;
  solver_version?: string | null;
  quantity: string;
  formula: string;
  reference_value: number;
  unit: string;
  tolerance_percent: number;
  reference_citation: string;
}

interface VVBenchmarkResult {
  benchmark_id: string;
  standard: string;
  title: string;
  title_ar: string;
  solver: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED_NO_BINARY';
  simulated_value: number | null;
  reference_value: number;
  unit: string;
  relative_error_percent: number | null;
  tolerance_percent: number;
  runtime_sec: number | null;
  details: string;
}

interface VVSuiteReport {
  certificate_standard: string;
  generated_at_utc: string;
  overall_status: string;
  sha256_integrity_hash: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    total_runtime_sec: number;
  };
  results: VVBenchmarkResult[];
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
   * جميع مهام المحاكاة والتشبيك والمسح البارامتري وحزمة التحقق الدولية V&V تُوجَّه من بوابة Express (:3000) مباشرة إلى FastAPI / Celery / Redis على المنفذ :8000 بدون أي محرك احتياطي صامت أو أرقام عشوائية.

3. **حزمة المحركات الفيزيائية الحقيقية داخل Docker:**
   * **OpenFOAM v2406**: الموائع غير القابلة والانضغاطية (simpleFoam / rhoSimpleFoam) والديناميكا الهوائية الخارجية (snappyHexMesh) والاقتران الحراري (chtMultiRegionFoam) وتعدد الأطوار (interFoam).
   * **CalculiX v2.21**: التحليل الإنشائي الساكن والديناميكي والانبعاج والإجهاد الحراري (C3D8 / C3D20R / C3D8T / SPOOLES).
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
4. حزمة الاختبارات القياسية الدولية V&V (ASME V&V 20 / NAFEMS / NASA TMR / ElmerFEM) عبر GET /api/vv/benchmarks و POST /api/vv/run لإصدار شهادة تحقق موقّعة ببصمة SHA-256 من المخرجات الفعلية فقط.
`;

export const AuditReportModal: React.FC<AuditReportModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'vv' | 'simscale' | 'system'>('vv');
  const [copied, setCopied] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveCloudStatus | null>(null);

  // Live V&V Certification state
  const [vvBenchmarks, setVvBenchmarks] = useState<VVBenchmarkSpec[]>([]);
  const [vvLoadingCatalog, setVvLoadingCatalog] = useState(false);
  const [vvRunningId, setVvRunningId] = useState<string | null>(null);
  const [vvError, setVvError] = useState<string | null>(null);
  const [vvResultsById, setVvResultsById] = useState<Record<string, VVBenchmarkResult>>({});
  const [vvLatestReport, setVvLatestReport] = useState<VVSuiteReport | null>(null);
  const [vvCertificateMd, setVvCertificateMd] = useState<string>('');

  const fetchLiveAuditData = useCallback(() => {
    fetch('/api/cloud/status')
      .then((res) => res.json())
      .then((data) => setLiveStatus(data))
      .catch(() => setLiveStatus(null));

    setVvLoadingCatalog(true);
    setVvError(null);
    fetch('/api/vv/benchmarks')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setVvBenchmarks(Array.isArray(data.benchmarks) ? data.benchmarks : []);
      })
      .catch((err: any) => {
        setVvBenchmarks([]);
        setVvError(
          `تعذر تحميل قائمة اختبارات V&V من حاوية Docker (:8000): ${err?.message || String(err)} — شغّل Docker Compose للتحقق الحي.`,
        );
      })
      .finally(() => setVvLoadingCatalog(false));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchLiveAuditData();
  }, [isOpen, fetchLiveAuditData]);

  if (!isOpen) return null;

  const handleRunVV = async (benchmarkId: string) => {
    setVvRunningId(benchmarkId);
    setVvError(null);
    try {
      const res = await fetch('/api/vv/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmark_id: benchmarkId, execution_mode: 'celery' }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.report) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const report: VVSuiteReport = data.report;
      setVvLatestReport(report);
      setVvCertificateMd(typeof data.certificate_markdown === 'string' ? data.certificate_markdown : '');
      setVvResultsById((prev) => {
        const next = { ...prev };
        for (const r of report.results || []) {
          next[r.benchmark_id] = r;
        }
        return next;
      });
    } catch (err: any) {
      setVvError(`فشل تشغيل اختبار التحقق (${benchmarkId}): ${err?.message || String(err)}`);
    } finally {
      setVvRunningId(null);
    }
  };

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentText =
    activeTab === 'vv'
      ? vvCertificateMd || SIMSCALE_AUDIT_REPORT_TEXT
      : activeTab === 'simscale'
        ? SIMSCALE_AUDIT_REPORT_TEXT
        : AUDIT_REPORT_TEXT;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadMd = () => {
    if (activeTab === 'vv' && vvCertificateMd) {
      triggerDownload(vvCertificateMd, 'VV_VERIFICATION_CERTIFICATE.md', 'text/markdown;charset=utf-8;');
      return;
    }
    const filename =
      activeTab === 'simscale' ? 'simscale_cae_platform_audit.md' : 'technical_audit_and_completeness_report.md';
    triggerDownload(currentText, filename, 'text/markdown;charset=utf-8;');
  };

  const handleDownloadJson = () => {
    if (!vvLatestReport) return;
    triggerDownload(
      JSON.stringify(vvLatestReport, null, 2),
      'vv_verification_certificate.json',
      'application/json;charset=utf-8;',
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const solvers = liveStatus?.pythonDetails?.solvers;
  const workersOnline = liveStatus?.pythonDetails?.workers_online;

  const completedResults = Object.values(vvResultsById);
  const passedCount = completedResults.filter((r) => r.status === 'PASS').length;
  const failedCount = completedResults.filter((r) => r.status === 'FAIL').length;
  const skippedCount = completedResults.filter((r) => r.status === 'SKIPPED_NO_BINARY').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/90">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  مركز التدقيق وشهادة التحقق الدولية (Live Docker Audit & V&amp;V)
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                  Zero-Mock Strict Mode
                </span>
              </div>
              <p className="text-xs text-slate-400">
                تشغيل حي لاختبارات ASME V&amp;V 20 / NAFEMS / NASA TMR على حاويات Docker (:8000) وإصدار شهادة تحقق موقّعة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
            </button>
            <button
              onClick={handleDownloadMd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{activeTab === 'vv' && vvCertificateMd ? 'شهادة V&V (.md)' : 'تنزيل (.md)'}</span>
            </button>
            {activeTab === 'vv' && vvLatestReport && (
              <button
                onClick={handleDownloadJson}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white transition-colors shadow-sm"
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>شهادة (.json)</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 text-xs flex-wrap">
          <button
            onClick={() => setActiveTab('vv')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'vv'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>شهادة التحقق الدولية V&amp;V (NAFEMS / ASME / NASA TMR)</span>
          </button>

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
              OpenFOAM: {isSolverAvailable(solvers?.openfoam) ? 'READY' : 'N/A'} | CCX:{' '}
              {isSolverAvailable(solvers?.calculix) ? 'READY' : 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Server className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="truncate">
              Gmsh: {isSolverAvailable(solvers?.gmsh) ? 'READY' : 'N/A'} | Elmer:{' '}
              {isSolverAvailable(solvers?.elmer) ? 'READY' : 'N/A'}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-sm text-slate-200 leading-relaxed font-sans select-text flex-1">
          {activeTab === 'vv' ? (
            <div className="space-y-4">
              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span>حزمة الاختبارات المرجعية الدولية الآلية (6 معايير معتمدة — صفر نتائج مسبقة)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    كل اختبار يُشغِّل المحرك الحقيقي داخل Docker (OpenFOAM / CalculiX / ElmerFEM) ويقارن الناتج رقمياً بالحل التحليلي المرجعي. عند غياب المحرك يُسجَّل{' '}
                    <code className="text-amber-300">SKIPPED_NO_BINARY</code> دون أي تزييف.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchLiveAuditData}
                    disabled={vvLoadingCatalog || vvRunningId !== null}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${vvLoadingCatalog ? 'animate-spin' : ''}`} />
                    <span>تحديث الحالة</span>
                  </button>
                  <button
                    onClick={() => handleRunVV('all')}
                    disabled={vvRunningId !== null || vvBenchmarks.length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors shadow-sm"
                  >
                    {vvRunningId === 'all' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{vvRunningId === 'all' ? 'جارٍ تشغيل الحزمة الكاملة...' : 'تشغيل الحزمة الكاملة وإصدار الشهادة'}</span>
                  </button>
                </div>
              </div>

              {vvError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{vvError}</span>
                </div>
              )}

              {/* Summary Strip if any results exist */}
              {(completedResults.length > 0 || vvLatestReport) && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase">Overall Verdict</div>
                    <div
                      className={`text-sm font-bold mt-0.5 ${
                        vvLatestReport?.overall_status === 'CERTIFIED_PASS'
                          ? 'text-emerald-400'
                          : vvLatestReport?.overall_status === 'FAIL'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {vvLatestReport?.overall_status || 'PARTIAL'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                    <div className="text-[10px] text-emerald-300/80 uppercase">PASS</div>
                    <div className="text-base font-bold text-emerald-300 mt-0.5">{passedCount}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30">
                    <div className="text-[10px] text-rose-300/80 uppercase">FAIL</div>
                    <div className="text-base font-bold text-rose-300 mt-0.5">{failedCount}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30">
                    <div className="text-[10px] text-amber-300/80 uppercase">SKIPPED</div>
                    <div className="text-base font-bold text-amber-300 mt-0.5">{skippedCount}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 col-span-2 sm:col-span-1">
                    <div className="text-[10px] text-slate-400 uppercase">SHA-256 Digest</div>
                    <div
                      className="text-[11px] text-sky-300 truncate mt-1"
                      title={vvLatestReport?.sha256_integrity_hash || ''}
                    >
                      {vvLatestReport?.sha256_integrity_hash
                        ? vvLatestReport.sha256_integrity_hash.slice(0, 16) + '…'
                        : '—'}
                    </div>
                  </div>
                </div>
              )}

              {/* Benchmarks Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono text-[11px]">
                      <th className="py-2.5 px-3">المعيار / الاختبار</th>
                      <th className="py-2.5 px-3">المحرك</th>
                      <th className="py-2.5 px-3">القيمة المرجعية</th>
                      <th className="py-2.5 px-3">ناتج المحرك الحي</th>
                      <th className="py-2.5 px-3">الخطأ % / السماحية</th>
                      <th className="py-2.5 px-3 text-center">الحكم</th>
                      <th className="py-2.5 px-3 text-center">تشغيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {vvLoadingCatalog ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          <Loader2 className="w-5 h-5 animate-spin inline-block ml-2" />
                          جارٍ فحص جاهزية المحركات وقائمة الاختبارات من Docker (:8000)...
                        </td>
                      </tr>
                    ) : vvBenchmarks.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          لا تتوفر قائمة اختبارات حالياً — تأكد من تشغيل حاوية FastAPI على المنفذ :8000 ثم اضغط «تحديث الحالة».
                        </td>
                      </tr>
                    ) : (
                      vvBenchmarks.map((b) => {
                        const res = vvResultsById[b.id];
                        const isThisRunning = vvRunningId === b.id || vvRunningId === 'all';
                        return (
                          <tr key={b.id} className="hover:bg-slate-900/50 transition-colors align-top">
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono font-bold text-sky-300">{b.id}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                                  {b.standard}
                                </span>
                              </div>
                              <div className="text-slate-100 font-semibold mt-1">{b.title_ar}</div>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5" dir="ltr">
                                {b.formula}
                              </div>
                              {res?.details && (
                                <div className="text-[10px] text-slate-400 mt-1 font-mono" dir="ltr">
                                  {res.details}
                                  {typeof res.runtime_sec === 'number' ? ` · ${res.runtime_sec}s` : ''}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 font-mono whitespace-nowrap">
                              <div className="text-slate-200 text-[11px]">{b.solver_name}</div>
                              <span
                                className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  b.solver_available
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                {b.solver_available ? 'BINARY READY' : 'BINARY N/A'}
                              </span>
                            </td>

                            <td className="py-3 px-3 font-mono whitespace-nowrap text-slate-200" dir="ltr">
                              {b.reference_value} <span className="text-slate-400">{b.unit}</span>
                            </td>

                            <td className="py-3 px-3 font-mono whitespace-nowrap" dir="ltr">
                              {res && typeof res.simulated_value === 'number' ? (
                                <span className="text-white font-bold">
                                  {res.simulated_value} <span className="text-slate-400 font-normal">{res.unit}</span>
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>

                            <td className="py-3 px-3 font-mono whitespace-nowrap" dir="ltr">
                              {res && typeof res.relative_error_percent === 'number' ? (
                                <span
                                  className={
                                    res.relative_error_percent <= b.tolerance_percent
                                      ? 'text-emerald-300 font-bold'
                                      : 'text-rose-300 font-bold'
                                  }
                                >
                                  {res.relative_error_percent.toFixed(3)}%
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                              <div className="text-[10px] text-slate-400">tol &lt;= {b.tolerance_percent}%</div>
                            </td>

                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              {res ? (
                                res.status === 'PASS' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-[11px]">
                                    <CheckCircle2 className="w-3 h-3" />
                                    PASS
                                  </span>
                                ) : res.status === 'FAIL' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold text-[11px]">
                                    <XCircle className="w-3 h-3" />
                                    FAIL
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-bold text-[10px]">
                                    <MinusCircle className="w-3 h-3" />
                                    SKIPPED
                                  </span>
                                )
                              ) : (
                                <span className="text-[11px] font-mono text-slate-500">PENDING</span>
                              )}
                            </td>

                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <button
                                onClick={() => handleRunVV(b.id)}
                                disabled={vvRunningId !== null}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600/90 hover:bg-sky-500 disabled:opacity-40 text-white text-[11px] font-bold transition-colors"
                              >
                                {isThisRunning ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                                <span>{isThisRunning ? '...' : 'تشغيل'}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* CLI tip for offline / terminal certification */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 font-mono flex flex-wrap items-center justify-between gap-2">
                <span>CLI Certification (Docker Worker):</span>
                <code className="text-sky-300 bg-slate-900 px-2 py-1 rounded border border-slate-800" dir="ltr">
                  docker compose exec worker python3 /app/vv_regression_suite.py --out-dir /app/jobs
                </code>
              </div>
            </div>
          ) : (
            <div className="space-y-4 bg-slate-950/70 p-6 rounded-xl border border-slate-800 text-slate-200 whitespace-pre-wrap font-sans text-xs sm:text-sm shadow-inner">
              {currentText}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80">
          <span className="text-xs text-slate-400 font-mono">
            Endpoint:{' '}
            <code className="text-sky-400">{liveStatus?.config?.backendUrl || 'http://127.0.0.1:8000'}</code>
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
