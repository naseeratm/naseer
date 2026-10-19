import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Server,
  Cpu,
  HardDrive,
  Key,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Terminal,
  Settings2,
  Zap,
  Globe,
  Database,
  Layers,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { CloudServerConfig } from '../types/thesis';

interface CloudServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CloudServerConfig;
  onSaveConfig: (newConfig: CloudServerConfig) => void;
}

export function CloudServerSettingsModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}: CloudServerSettingsModalProps) {
  const [formData, setFormData] = useState<CloudServerConfig>(config);
  const [isTestingCloud, setIsTestingCloud] = useState(false);
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
  } | null>(null);

  const [copiedBash, setCopiedBash] = useState(false);

  useEffect(() => {
    setFormData(config);
  }, [config]);

  // Fetch initial system and cloud metrics when opened
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/cloud/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.system) {
          setSystemMetrics({
            totalMemoryGb: data.system.totalMemoryGb,
            freeMemoryGb: data.system.freeMemoryGb,
            cpuCount: data.system.cpuCount,
            platform: data.system.platform,
            pythonConnected: data.pythonConnected,
          });
        }
      })
      .catch((err) => console.warn('Could not fetch cloud metrics:', err));
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
        setFormData((prev) => ({ ...prev, status: 'connected', lastTestedAt: new Date().toLocaleTimeString('ar-EG') }));
      } else {
        setCloudTestResult({
          success: false,
          latencyMs: data.latencyMs,
          message: data.error || 'فشل الاتصال بالخادم السحابي',
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
        message: 'فشل إرسال طلب الفحص لخادم الترخيص',
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

  const copyLicenseSetupBash = () => {
    const text = `# إعدادات ترخيص أنسيز والمتغيرات البيئية على خادمك السحابي:
export ANSYSLMD_LICENSE_FILE=${formData.licenseFlexNetPort}@${formData.licenseServerHost}
export ANSYSLI_SERVERS=${formData.licenseAnsysLiPort}@${formData.licenseServerHost}
export AWP_ROOT241=/ansys_inc/v241
export PATH=$AWP_ROOT241/ansys/bin:$PATH

# تشغيل خادم بايثون السحابي المتكامل مع المعالجة المتوازية:
mkdir -p ${formData.workingDirectory}
cd /path/to/ansys-workbench
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4`;
    navigator.clipboard.writeText(text);
    setCopiedBash(true);
    setTimeout(() => setCopiedBash(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-right">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-amber-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  إعدادات الخادم السحابي وترخيص أنسيز (400GB Cloud & ANSYS Engine)
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  High Performance CAE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                تهيئة الاتصال بين واجهة المستخدم وخادم الحساب السحابي، إدارة تراخيص FlexNet، والتحكم بالمعالجة المتوازية
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <HardDrive className="w-4 h-4 text-amber-400" />
                <span>المساحة السحابية</span>
              </div>
              <div className="text-lg font-bold font-mono text-amber-300">
                400 GB <span className="text-xs text-slate-400 font-normal">SSD / NVMe</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">جاهزة لملفات الشبيكة والحل الضخمة</div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <Cpu className="w-4 h-4 text-sky-400" />
                <span>الأنوية المتوازية (MPI)</span>
              </div>
              <div className="text-lg font-bold font-mono text-sky-300">
                {formData.parallelCores} Cores
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {systemMetrics?.cpuCount ? `من أصل ${systemMetrics.cpuCount} نواة متاحة` : 'معالجة متوازية متعددة الأنوية'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>الذاكرة العشوائية RAM</span>
              </div>
              <div className="text-lg font-bold font-mono text-emerald-300">
                {systemMetrics?.totalMemoryGb ? `${systemMetrics.totalMemoryGb} GB` : '32+ GB'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {systemMetrics?.freeMemoryGb ? `${systemMetrics.freeMemoryGb} GB فارغ حالياً` : 'كافية لحل مصفوفات 5M+ Cells'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <Server className="w-4 h-4 text-indigo-400" />
                <span>حالة المحرك</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    formData.status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                <span className="text-xs font-bold text-slate-200">
                  {formData.status === 'connected' ? 'خادم متصل' : 'جاهز للإعداد'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                {formData.lastTestedAt ? `فُحص: ${formData.lastTestedAt}` : 'اضغط فحص الاتصال'}
              </div>
            </div>
          </div>

          {/* Section 1: Cloud Server Backend Connection */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  1. عنوان الخادم السحابي ومعالج الحساب (Cloud API Endpoint)
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, backendUrl: 'http://127.0.0.1:8001' }))}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  محلي (Localhost:8001)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, backendUrl: 'http://192.168.1.100:8000' }))}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  سحابي / IP مخصص
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">
                  رابط الخادم السحابي (FastAPI / Uvicorn Server URL):
                </label>
                <input
                  type="text"
                  value={formData.backendUrl}
                  onChange={(e) => setFormData({ ...formData, backendUrl: e.target.value })}
                  placeholder="http://127.0.0.1:8001 أو http://your-cloud-ip:8000"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
                <div className="mt-2 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] space-y-1.5 text-slate-300">
                  <div className="flex items-center gap-1.5 font-bold text-sky-400">
                    <Zap className="w-3.5 h-3.5" />
                    <span>ماذا أكتب في هذه الخانة؟</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    • <strong className="text-slate-200">الوضع الافتراضي (الموصى به حالياً):</strong> اترك <code className="text-sky-300 font-mono px-1 py-0.5 bg-slate-800 rounded">http://127.0.0.1:8001</code>؛ فالمنصة تستخدم المحرك الفيزيائي والرقمي المدمج مباشرة دون الحاجة لأي خادم خارجي.
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    • <strong className="text-slate-200">إذا كان لديك خادم افتراضي خارجي (VPS):</strong> ضع رابط خادمك مثل <code className="text-amber-300 font-mono px-1 py-0.5 bg-slate-800 rounded">http://IP:8000</code> لتنفيذ الحسابات المتوازية عليه.
                  </p>
                </div>
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
                  <span>{isTestingCloud ? 'جارِ فحص السحابة...' : 'فحص الاتصال والزمن'}</span>
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

            {/* Storage directory & Cores configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  مجلد العمل ومخرجات المحاكاة على الـ 400GB:
                </label>
                <input
                  type="text"
                  value={formData.workingDirectory}
                  onChange={(e) => setFormData({ ...formData, workingDirectory: e.target.value })}
                  placeholder="/data/ansys_workspace"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  عدد المعالجات المتوازية (Parallel Cores -np):
                </label>
                <select
                  value={formData.parallelCores}
                  onChange={(e) => setFormData({ ...formData, parallelCores: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                >
                  <option value={2}>2 Cores (توفير الموارد)</option>
                  <option value={4}>4 Cores (معالجة قياسية)</option>
                  <option value={8}>8 Cores (موصى بها للأبحاث)</option>
                  <option value={16}>16 Cores (شبيكات ضخمة High Density)</option>
                  <option value={32}>32 Cores (محاكاة متوازية فائقة HPC)</option>
                  <option value={64}>64 Cores (خوادم الحوسبة العالية)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: ANSYS License Manager & FlexNet */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  2. إعدادات ترخيص أنسيز (ANSYS License Server & FlexNet)
                </h3>
              </div>
              <span className="text-xs text-amber-400/90 font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                FlexNet Port 1055 / 2325
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">نوع الترخيص المعتمد:</label>
                <select
                  value={formData.licenseType}
                  onChange={(e) =>
                    setFormData({ ...formData, licenseType: e.target.value as any })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="academic">ترخيص أكاديمي بحثي (ANSYS Academic)</option>
                  <option value="commercial">ترخيص تجاري صناعي (ANSYS Commercial)</option>
                  <option value="open_source_unlicensed">
                    بدون ترخيص (محرك OpenFOAM + CalculiX المفتوح)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  خادم الترخيص (License Server Host / IP):
                </label>
                <input
                  type="text"
                  value={formData.licenseServerHost}
                  onChange={(e) => setFormData({ ...formData, licenseServerHost: e.target.value })}
                  placeholder="1055@license.university.edu أو IP"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">منفذ FlexNet Port:</label>
                <input
                  type="number"
                  value={formData.licenseFlexNetPort}
                  onChange={(e) => setFormData({ ...formData, licenseFlexNetPort: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Test License Button & Fallback Toggle */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.autoFallbackToOpenSource}
                  onChange={(e) =>
                    setFormData({ ...formData, autoFallbackToOpenSource: e.target.checked })
                  }
                  className="rounded border-slate-700 text-sky-500 focus:ring-0 bg-slate-900"
                />
                <span>
                  التحويل التلقائي لمحرك OpenFOAM / SciPy عند انقطاع خادم التراخيص (منع توقف الحسابات)
                </span>
              </label>

              <button
                type="button"
                onClick={handleTestLicense}
                disabled={isTestingLicense}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all disabled:opacity-50"
              >
                <Shield className={`w-3.5 h-3.5 ${isTestingLicense ? 'animate-spin' : ''}`} />
                <span>{isTestingLicense ? 'جارِ فحص الترخيص...' : 'فحص الاتصال بخادم الترخيص'}</span>
              </button>
            </div>

            {/* License Test Result */}
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
                  {licenseTestResult.fallbackAvailable && (
                    <div className="text-[11px] text-emerald-400 mt-1 font-semibold">
                      ✓ البديل المفتوح المصدر (OpenFOAM / Python SciPy) جاهز للعمل فوراً وبدون أي عوائق ترخيص.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Copyable Server Setup Scripts */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">
                  3. أوامر التفعيل السريع على خادمك السحابي (Terminal Commands)
                </h3>
              </div>
              <button
                type="button"
                onClick={copyLicenseSetupBash}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                {copiedBash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedBash ? 'تم النسخ!' : 'نسخ الأوامر'}</span>
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto text-left dir-ltr">
              {`export ANSYSLMD_LICENSE_FILE=${formData.licenseFlexNetPort}@${formData.licenseServerHost}
export ANSYSLI_SERVERS=${formData.licenseAnsysLiPort}@${formData.licenseServerHost}
mkdir -p ${formData.workingDirectory}
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4`}
            </pre>
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
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/20 transition-all active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>حفظ وتطبيق الإعدادات السحابية</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
