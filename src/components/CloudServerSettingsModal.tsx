import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Server,
  Cpu,
  HardDrive,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Terminal,
  Zap,
  Globe,
  Copy,
  Check,
  Download,
  Layers,
} from 'lucide-react';
import { CloudServerConfig } from '../types/thesis';

interface CloudServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CloudServerConfig;
  onSaveConfig: (newConfig: CloudServerConfig) => void;
}

interface ClusterWorkerNode {
  name: string;
  status: string;
  pid?: number;
  concurrency: number;
  mpi_cores: number;
  active_tasks: number;
  queued_tasks: number;
}

interface ClusterStatusTelemetry {
  connected: boolean;
  status: string;
  redis: boolean;
  workers_online: number;
  worker_names: string[];
  workers: ClusterWorkerNode[];
  total_cluster_cores: number;
  host_cpu_cores: number;
  mpi_cores_per_worker: number;
  active_tasks_count: number;
  queued_tasks_count: number;
  solvers?: Record<string, any>;
}

export function CloudServerSettingsModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}: CloudServerSettingsModalProps) {
  const [formData, setFormData] = useState<CloudServerConfig>(config);
  const [workerReplicas, setWorkerReplicas] = useState<number>(4);
  const [isTestingCloud, setIsTestingCloud] = useState(false);
  const [isRefreshingCluster, setIsRefreshingCluster] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    message: string;
    details?: any;
  } | null>(null);

  const [isTestingLicense, setIsTestingLicense] = useState(false);
  const [licenseTestResult, setLicenseTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    error?: string;
    fallbackAvailable?: boolean;
  } | null>(null);

  const [systemMetrics, setSystemMetrics] = useState<{
    totalMemoryGb: number;
    freeMemoryGb: number;
    cpuCount: number;
    platform: string;
    pythonConnected: boolean;
    pythonDetails?: {
      status?: string;
      redis?: boolean;
      workers_online?: number;
      worker_names?: string[];
      solvers?: Record<string, any>;
    } | null;
  } | null>(null);

  const [clusterTelemetry, setClusterTelemetry] = useState<ClusterStatusTelemetry | null>(null);
  const [copiedBash, setCopiedBash] = useState(false);

  useEffect(() => {
    setFormData(config);
  }, [config]);

  const fetchClusterAndSystemMetrics = async () => {
    setIsRefreshingCluster(true);
    try {
      const [cloudRes, clusterRes] = await Promise.all([
        fetch('/api/cloud/status').catch(() => null),
        fetch('/api/cluster/status').catch(() => null),
      ]);
      if (cloudRes && cloudRes.ok) {
        const data = await cloudRes.json();
        if (data.system) {
          setSystemMetrics({
            totalMemoryGb: data.system.totalMemoryGb,
            freeMemoryGb: data.system.freeMemoryGb,
            cpuCount: data.system.cpuCount,
            platform: data.system.platform,
            pythonConnected: Boolean(data.pythonConnected),
            pythonDetails: data.pythonDetails ?? null,
          });
        }
      }
      if (clusterRes && clusterRes.ok) {
        const cData = await clusterRes.json();
        setClusterTelemetry(cData);
      }
    } catch (err) {
      console.warn('Could not fetch cluster metrics:', err);
    } finally {
      setIsRefreshingCluster(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchClusterAndSystemMetrics();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestCloudConnection = async () => {
    setIsTestingCloud(true);
    setCloudTestResult(null);

    try {
      const res = await fetch('/api/cloud/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backendUrl: formData.backendUrl }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCloudTestResult({
          success: true,
          latencyMs: data.latencyMs,
          message: data.message || `تم الاتصال بالخادم بنجاح (${data.latencyMs}ms)`,
          details: data.data,
        });
        setSystemMetrics((prev) =>
          prev
            ? { ...prev, pythonConnected: true, pythonDetails: data.data }
            : prev
        );
        setFormData((prev) => ({ ...prev, status: 'connected', lastTestedAt: new Date().toLocaleTimeString('ar-EG') }));
        await fetchClusterAndSystemMetrics();
      } else {
        setCloudTestResult({
          success: false,
          latencyMs: data.latencyMs,
          message: data.error || 'فشل الاتصال بخادم Docker FastAPI (:8000)',
        });
        setFormData((prev) => ({ ...prev, status: 'disconnected' }));
      }
    } catch (err: any) {
      setCloudTestResult({
        success: false,
        message: `خطأ في الاتصال بالشبكة: ${err?.message || 'تعذر الوصول للرابط'}`,
      });
      setFormData((prev) => ({ ...prev, status: 'disconnected' }));
    } finally {
      setIsTestingCloud(false);
    }
  };

  const handleTestLicense = async () => {
    setIsTestingLicense(true);
    setLicenseTestResult(null);

    try {
      const res = await fetch('/api/license/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: formData.licenseServerHost,
          port: formData.licenseFlexNetPort,
          licenseType: formData.licenseType,
        }),
      });
      const data = await res.json();
      setLicenseTestResult(data);
    } catch (err: any) {
      setLicenseTestResult({
        success: false,
        message: 'فشل إرسال طلب الفحص لخادم المحركات',
        error: err?.message,
      });
    } finally {
      setIsTestingLicense(false);
    }
  };

  const handleSave = async () => {
    try {
      await fetch('/api/cloud/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
    } catch (e) {
      console.warn('Config sync error:', e);
    }
    onSaveConfig(formData);
    onClose();
  };

  const copyClusterScalingBash = () => {
    const text = `# 1. التشغيل المتوازي متعدد العمال (Multi-Worker HPC Cluster: ${workerReplicas} Workers x ${formData.parallelCores} MPI Cores):
NASEER_MPI_CORES_PER_WORKER=${formData.parallelCores} docker compose -f docker-compose.cluster.yml up -d --build --scale worker=${workerReplicas}

# 2. أو التشغيل الآلي بضغطة واحدة على خادم سحابي Ubuntu HPC أو محطة عمل Linux:
chmod +x deploy-hpc-cluster.sh
./deploy-hpc-cluster.sh ${workerReplicas} ${formData.parallelCores}

# 3. فحص حالة العنقود والأنوية النشطة:
curl -s http://127.0.0.1:8000/api/cluster/status | python3 -m json.tool`;
    navigator.clipboard.writeText(text);
    setCopiedBash(true);
    setTimeout(() => setCopiedBash(false), 2500);
  };

  const liveHealth = cloudTestResult?.details || clusterTelemetry || systemMetrics?.pythonDetails;
  const solverFlags = liveHealth?.solvers as Record<string, any> | undefined;
  const workerNodes: ClusterWorkerNode[] = Array.isArray(clusterTelemetry?.workers) ? clusterTelemetry!.workers : [];
  const totalClusterCores = clusterTelemetry?.total_cluster_cores || (workerReplicas * formData.parallelCores);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/90">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-right">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  مركز إدارة العنقود السحابي وتعدد العمال (HPC Cluster & Multi-Worker Gateway)
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                مراقبة حية لعقد Celery و MPI وتوسيع حاويات المعالجة المتوازية (OpenFOAM · CalculiX · Gmsh · ElmerFEM)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* Quick Hardware & Cloud Capacity Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 font-sans">
                <Server className="w-4 h-4 text-emerald-400" />
                <span>عمال العنقود النشطون</span>
              </div>
              <div className="text-lg font-bold text-emerald-300">
                {clusterTelemetry?.workers_online ?? 0} Workers
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                {clusterTelemetry?.redis ? 'وسيط Redis متصل ونشط' : 'بانتظار تشغيل حاويات العنقود'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 font-sans">
                <Cpu className="w-4 h-4 text-sky-400" />
                <span>إجمالي أنوية العنقود (MPI)</span>
              </div>
              <div className="text-lg font-bold text-sky-300">
                {totalClusterCores} Cores
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                {systemMetrics?.cpuCount ? `أنوية الجهاز المضيف: ${systemMetrics.cpuCount} نواة` : `${formData.parallelCores} أنوية لكل عامل`}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 font-sans">
                <Activity className="w-4 h-4 text-amber-400" />
                <span>المهام الجارية / بالانتظار</span>
              </div>
              <div className="text-lg font-bold text-amber-300">
                {clusterTelemetry?.active_tasks_count ?? 0} / {clusterTelemetry?.queued_tasks_count ?? 0}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                مهام نشطة · مهام في طابور Celery
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1 font-sans">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                <span>الذاكرة العشوائية RAM</span>
              </div>
              <div className="text-lg font-bold text-indigo-300">
                {systemMetrics?.totalMemoryGb ? `${systemMetrics.totalMemoryGb} GB` : '—'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                {systemMetrics?.freeMemoryGb ? `${systemMetrics.freeMemoryGb} GB متاح حالياً` : 'مجلد مشترك /app/jobs'}
              </div>
            </div>
          </div>

          {/* Live HPC Cluster Worker Nodes Table */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  مراقب عقد الحوسبة المتوازية (Live Celery & MPI Worker Nodes)
                </h3>
              </div>
              <button
                type="button"
                onClick={fetchClusterAndSystemMetrics}
                disabled={isRefreshingCluster}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCluster ? 'animate-spin text-sky-400' : 'text-slate-400'}`} />
                <span>تحديث حالة العنقود</span>
              </button>
            </div>

            {workerNodes.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs text-right font-mono tabular-nums">
                  <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-sans">
                    <tr>
                      <th className="py-2 px-3 text-right">اسم عقدة العامل (Worker Hostname)</th>
                      <th className="py-2 px-3 text-right">الحالة</th>
                      <th className="py-2 px-3 text-right">PID</th>
                      <th className="py-2 px-3 text-right">أنوية MPI/OpenMP</th>
                      <th className="py-2 px-3 text-right">مهام نشطة</th>
                      <th className="py-2 px-3 text-right">في الطابور</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
                    {workerNodes.map((node) => (
                      <tr key={node.name} className="hover:bg-slate-900/40">
                        <td className="py-2 px-3 text-sky-300 font-semibold">{node.name}</td>
                        <td className="py-2 px-3 text-emerald-400">{node.status}</td>
                        <td className="py-2 px-3 text-slate-400">{node.pid ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-200">{node.mpi_cores} Cores</td>
                        <td className="py-2 px-3 text-amber-300">{node.active_tasks}</td>
                        <td className="py-2 px-3 text-slate-400">{node.queued_tasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-xs text-slate-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div>
                  لا توجد حاويات <code className="text-sky-300 font-mono">worker</code> متصلة حالياً على المنفذ <code className="text-sky-300 font-mono">:8000</code>. استخدم ملفات التوسع أدناه لتشغيل عدة عمال بالتوازي على جهازك أو خادمك السحابي.
                </div>
              </div>
            )}

            {/* Live Container Solver Readiness Strip */}
            {solverFlags && Object.keys(solverFlags).length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-slate-400 font-sans font-semibold">جاهزية المحركات الفيزيائية في العنقود:</span>
                <div className="flex flex-wrap items-center gap-3 text-slate-300">
                  {Object.entries(solverFlags).map(([name, info]) => {
                    const ready = typeof info === 'object' && info !== null ? Boolean(info.available) : Boolean(info);
                    return (
                      <span
                        key={name}
                        className={ready ? 'text-emerald-300' : 'text-rose-300'}
                      >
                        {name.toUpperCase()}: {ready ? 'READY' : 'MISSING'}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section 1: Cloud Server Backend Connection */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  1. عنوان بوابة محركات المحاكاة Docker (FastAPI Gateway Endpoint)
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, backendUrl: 'http://127.0.0.1:8000' }))}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  Docker محلي (Localhost:8000)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, backendUrl: 'http://192.168.1.100:8000' }))}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  خادم سحابي خارجي (Cloud VM IP)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">
                  رابط بوابة محركات المحاكاة (FastAPI / Celery Docker URL):
                </label>
                <input
                  type="text"
                  value={formData.backendUrl}
                  onChange={(e) => setFormData({ ...formData, backendUrl: e.target.value })}
                  placeholder="http://127.0.0.1:8000 أو http://your-cloud-ip:8000"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">فحص الاتصال الحي:</label>
                <button
                  type="button"
                  onClick={handleTestCloudConnection}
                  disabled={isTestingCloud}
                  className="w-full h-9 flex items-center justify-center gap-1.5 px-3 rounded-lg text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingCloud ? 'animate-spin' : ''}`} />
                  <span>{isTestingCloud ? 'جارِ فحص الحاوية...' : 'فحص الاتصال والزمن'}</span>
                </button>
              </div>
            </div>

            {/* Cloud Test Result Box */}
            {cloudTestResult && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                  cloudTestResult.success
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
                }`}
              >
                {cloudTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold">{cloudTestResult.message}</div>
                  {cloudTestResult.latencyMs !== undefined && (
                    <div className="text-[11px] font-mono mt-0.5 opacity-80">
                      زمن الاستجابة الحقيقي (Latency): {cloudTestResult.latencyMs}ms
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Storage directory, Worker Replicas & MPI Cores configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/60">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  مجلد العمل المشترك (Shared Workspace):
                </label>
                <input
                  type="text"
                  value={formData.workingDirectory}
                  onChange={(e) => setFormData({ ...formData, workingDirectory: e.target.value })}
                  placeholder="/app/jobs"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  عدد حاويات العمال المتوازية (Worker Replicas):
                </label>
                <select
                  value={workerReplicas}
                  onChange={(e) => setWorkerReplicas(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                >
                  <option value={1}>1 Worker (مهمة واحدة باللحظة)</option>
                  <option value={2}>2 Workers (مهمتان بالتوازي)</option>
                  <option value={4}>4 Workers (موصى به للمسح البارامتري و GCI)</option>
                  <option value={8}>8 Workers (خادم سحابي متقدم)</option>
                  <option value={16}>16 Workers (عنقود سحابي تجاري)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  أنوية MPI/OpenMP لكل عامل (Cores/Worker):
                </label>
                <select
                  value={formData.parallelCores}
                  onChange={(e) => setFormData({ ...formData, parallelCores: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                >
                  <option value={2}>2 Cores / Worker</option>
                  <option value={4}>4 Cores / Worker</option>
                  <option value={8}>8 Cores / Worker</option>
                  <option value={16}>16 Cores / Worker</option>
                  <option value={32}>32 Cores / Worker</option>
                  <option value={64}>64 Cores / Worker</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Ready-to-Run Multi-Worker Compose & Automated Ubuntu Cloud Script */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  2. ملفات التوسع المتوازي وتجهيز الخوادم السحابية (Ready-to-Run HPC Files)
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/api/cluster/compose-file"
                  download="docker-compose.cluster.yml"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تنزيل docker-compose.cluster.yml</span>
                </a>
                <a
                  href="/api/cluster/deploy-script"
                  download="deploy-hpc-cluster.sh"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تنزيل سكربت السحابة deploy-hpc-cluster.sh</span>
                </a>
                <button
                  type="button"
                  onClick={copyClusterScalingBash}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  {copiedBash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedBash ? 'تم النسخ!' : 'نسخ الأوامر'}</span>
                </button>
              </div>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto text-left dir-ltr">
              {`# Option A — Scale ${workerReplicas} Parallel Workers x ${formData.parallelCores} MPI Cores (${workerReplicas * formData.parallelCores} Total Cores):
NASEER_MPI_CORES_PER_WORKER=${formData.parallelCores} docker compose -f docker-compose.cluster.yml up -d --build --scale worker=${workerReplicas}

# Option B — Automated One-Command Ubuntu Cloud HPC Setup:
chmod +x deploy-hpc-cluster.sh && ./deploy-hpc-cluster.sh ${workerReplicas} ${formData.parallelCores}

# Verify Live Cluster Status:
curl -s http://127.0.0.1:8000/api/cluster/status | python3 -m json.tool`}
            </pre>
          </div>

          {/* Section 3: CAE Solvers & Optional External Cluster Verification */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  3. فحص جاهزية المحركات الفيزيائية (OpenFOAM · CalculiX · Gmsh · ElmerFEM)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleTestLicense}
                disabled={isTestingLicense}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all disabled:opacity-50"
              >
                <Shield className={`w-3.5 h-3.5 ${isTestingLicense ? 'animate-spin' : ''}`} />
                <span>{isTestingLicense ? 'جارِ فحص الجاهزية...' : 'فحص جاهزية محركات Docker'}</span>
              </button>
            </div>

            {licenseTestResult && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                  licenseTestResult.success
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-amber-950/30 border-amber-800/60 text-amber-300'
                }`}
              >
                {licenseTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold">{licenseTestResult.message}</div>
                  {licenseTestResult.error && (
                    <div className="text-[11px] font-mono mt-0.5 text-amber-400">
                      {licenseTestResult.error}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            إلغاء
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-500/20 transition-all active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>حفظ وتطبيق إعدادات العنقود</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
