import React, { useState } from 'react';
import {
  Key,
  Shield,
  Cpu,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Info,
  X,
  Lock,
  Layers,
  Activity,
} from 'lucide-react';
import { ApiKeyItem, EngineMode } from '../types/thesis';

interface KeyPoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: ApiKeyItem[];
  onUpdateKeys: (keys: ApiKeyItem[]) => void;
  engineMode: EngineMode;
  onUpdateEngineMode: (mode: EngineMode) => void;
}

export function KeyPoolModal({
  isOpen,
  onClose,
  apiKeys,
  onUpdateKeys,
  engineMode,
  onUpdateEngineMode,
}: KeyPoolModalProps) {
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null);

  if (!isOpen) return null;

  const handleAddKey = () => {
    const keyVal = newKeyInput.trim();
    if (!keyVal) return;

    const newItem: ApiKeyItem = {
      id: `key_${Date.now()}`,
      key: keyVal,
      label: newKeyLabel.trim() || `مفتاح إضافي #${apiKeys.length + 1}`,
      status: 'active',
      requestsCount: 0,
      errorCount: 0,
    };

    onUpdateKeys([...apiKeys, newItem]);
    setNewKeyInput('');
    setNewKeyLabel('');
  };

  const handleDeleteKey = (id: string) => {
    onUpdateKeys(apiKeys.filter((k) => k.id !== id));
  };

  const handleTestKey = async (item: ApiKeyItem) => {
    setTestingKeyId(item.id);
    setTestResult(null);

    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': item.key,
        },
        body: JSON.stringify({ apiKey: item.key }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ id: item.id, success: true, msg: 'المفتاح سليم ومتصل بنجاح بنسبة 100%' });
        onUpdateKeys(
          apiKeys.map((k) => (k.id === item.id ? { ...k, status: 'active', errorCount: 0 } : k))
        );
      } else {
        const isQuota = data.isQuota || res.status === 429;
        setTestResult({
          id: item.id,
          success: false,
          msg: isQuota ? 'تم تجاوز حصة الاستخدام (Quota 429)' : data.error || 'فشل الاتصال بالمفتاح',
        });
        onUpdateKeys(
          apiKeys.map((k) =>
            k.id === item.id ? { ...k, status: isQuota ? 'exhausted' : 'cooling' } : k
          )
        );
      }
    } catch {
      setTestResult({ id: item.id, success: false, msg: 'خطأ في الشبكة أثناء اختبار المفتاح' });
    } finally {
      setTestingKeyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                مدير مجمّع المفاتيح والمحرك الرقمي
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Zero-Downtime Engine
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                إدارة تعدد مفاتيح الذكاء الاصطناعي مع التدوير التلقائي أو التبديل للمحرك الفيزيائي المحلي
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Engine Mode Selection */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-400" />
              وضع تشغيل محرك المحاكاة والتحليل:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onUpdateEngineMode('hybrid')}
                className={`p-3.5 rounded-xl border text-right transition-all flex flex-col gap-1.5 ${
                  engineMode === 'hybrid'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-sky-400" />
                    الوضع الهجين الفائق (موصى به)
                  </span>
                  {engineMode === 'hybrid' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  يدمج التوليف الذكي مع المحرك الرقمي، ويقوم بتدوير المفاتيح تلقائياً والتحول للمحلي عند أي حد استهلاك.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onUpdateEngineMode('pure_local')}
                className={`p-3.5 rounded-xl border text-right transition-all flex flex-col gap-1.5 ${
                  engineMode === 'pure_local'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    المحرك الفيزيائي المحلي الخالص
                  </span>
                  {engineMode === 'pure_local' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  يعتمد 100% على الحسابات الرياضية والفيزيائية الحتمية المحلية. لا يحتاج لأي مفتاح خارجي ولا يتوقف إطلاقاً.
                </p>
              </button>
            </div>
          </div>

          {/* Key Pool List & Add */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                مجمّع المفاتيح الاحتياطية (Key Rotation Pool):
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {apiKeys.length} مفتاح مضاف
              </span>
            </div>

            {/* Keys Table / Cards */}
            <div className="space-y-2">
              {/* Default Server Key Item */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-mono text-xs">
                    SYS
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                      مفتاح الخادم الافتراضي المدمج
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        النظام
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono">
                      •••••••••••••••••••••••• (جاهز للعمل)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    نشط أساسي
                  </span>
                </div>
              </div>

              {/* User Added Keys */}
              {apiKeys.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center font-mono text-xs font-bold">
                      #{idx + 1}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                        {item.label}
                        {item.status === 'exhausted' && (
                          <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            مستنفد الحصة (429)
                          </span>
                        )}
                        {item.status === 'active' && (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            جاهز
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {item.key.slice(0, 6)}••••••••••••{item.key.slice(-4)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={testingKeyId === item.id}
                      onClick={() => handleTestKey(item)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${testingKeyId === item.id ? 'animate-spin' : ''}`}
                      />
                      فحص
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(item.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="حذف المفتاح"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Test result banner if any */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                )}
                <span>{testResult.msg}</span>
              </div>
            )}

            {/* Add Key Input */}
            <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 space-y-3">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-400" />
                إضافة مفتاح إضافي لمجمع التدوير:
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="تسمية المفتاح (مثال: مفتاح العمل 1)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
                <input
                  type="password"
                  placeholder="أدخل مفتاح Gemini API Key (AIza...)"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  className="px-3 py-2 sm:col-span-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddKey}
                  disabled={!newKeyInput.trim()}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  حفظ في المجمّع
                </button>
              </div>
            </div>
          </div>

          {/* Explanatory Policy */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 leading-relaxed space-y-1">
              <p className="font-semibold text-slate-300">
                كيف تضمن المنصة استمرارية العمل بدون توقف نهائياً؟
              </p>
              <p>
                1. عند إرسال طلب تحليل، يُستخدم المفتاح النشط الأول. إذا أرجع المزود خطأ تجاوز الحصة (429 Quota Exceeded)، يتم التبديل تلقائياً وفوراً للمفتاح التالي في المجمّع.
              </p>
              <p>
                2. في حال استنفاد كافة المفاتيح، يتحول النظام ذاتياً وبشكل صامت إلى **المحرك الفيزيائي الرقمي الحتمي** المبرمج مسبقاً، مما يضمن ظهور النتائج الهندسية والميش والكونتورات فوراً دون أي توقف أو رسائل عطل.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>المفاتيح تُحفظ مشفرة في متصفحك محلياً فقط ولا تُشارك خارج طلباتك.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            إغلاق وحفظ
          </button>
        </div>
      </div>
    </div>
  );
}
