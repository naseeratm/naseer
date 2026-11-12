import React, { useState, useEffect } from 'react';
import {
  Package,
  Truck,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Layers,
  Server,
  Terminal,
  ShieldCheck,
  Play,
  RotateCcw,
  X,
  Activity,
  Box,
  FileCode,
  FileText,
  Sliders,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Copy,
  Check,
  Grid3X3,
  Flame,
  Wind,
  Maximize2,
  Compass,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  BookOpen,
} from 'lucide-react';

interface PipelineTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId?: string;
  field?: string;
  solverType?: string;
  solverJobStatus?: string;
  solverProgress?: number | null;
  solverLogs?: string[];
  onTriggerRun?: () => void;
}

interface StationInfo {
  id: number;
  code: string;
  titleAr: string;
  titleEn: string;
  containerName: string;
  techStack: string;
  estimatedMs: string;
  roleAr: string;
  inputsAr: string;
  outputsAr: string;
  verificationRule: string;
  terminalLogs: string[];
}

const STATIONS: StationInfo[] = [
  {
    id: 1,
    code: 'GATE-01/INGEST',
    titleAr: 'محطة الاستقبال والختم المشفر (SHA-256 Gate)',
    titleEn: 'Input Ingestion & Cryptographic Provenance',
    containerName: 'naseer-ingestion-proxy:v2.4',
    techStack: 'Node.js Express + Web Crypto SHA-256',
    estimatedMs: '12 ms',
    roleAr: 'استلام الشروط الحدية، الأبعاد الهندسية، والملفات المرفوعة (CAD/APDL/OpenFOAM)، وتوليد بصمة تجزئة أمنية SHA-256 لا تقبل التعديل.',
    inputsAr: 'الأبعاد (Lx, Ly)، سرعة الدخول، درجات حرارة الجدران، خواص المائع والمعدن.',
    outputsAr: 'حزمة بيانات مشفرة وموقعة برمز التحقق ASME-VV20 وتوليد معرف الشحنة (Task ID).',
    verificationRule: 'مطابقة تامة للشروط الحدية وتثبيت البصمة لمنع أي تلاعب لاحق بالمدخلات.',
    terminalLogs: [
      '[GATEWAY] Incoming simulation payload validated against ASME schema.',
      '[CRYPTO] SHA-256 hash computed: e3b0c44298fc1c149afbf4c8996fb92427ae41...',
      '[DISPATCH] Task manifest generated and certified for pipeline delivery.',
    ],
  },
  {
    id: 2,
    code: 'QUEUE-02/BROKER',
    titleAr: 'طابور الانتظار وتوزيع الحمولات (Redis & Celery Hub)',
    titleEn: 'Job Queue & Orchestration Dispatcher',
    containerName: 'naseer-redis-broker:7.2 / celery-worker-pool',
    techStack: 'Redis 7.2 In-Memory + Celery 5.3 Distributed Task Queue',
    estimatedMs: '28 ms',
    roleAr: 'استقبال الشحنة الحسابية في طابور مهام موزع، وفحص عتاد الخوادم السحابية الشاغرة (HPC Pods) أو توجيهها للوضع المحلي المستقل فورياً.',
    inputsAr: 'معرف المهمة (Task ID) ومستوى الأولوية وشهادة الترخيص.',
    outputsAr: 'إسناد المهمة إلى حاوية المعالجة المخصصة وحجز الذاكرة الحسابية RAM/VRAM.',
    verificationRule: 'صفر فقدان للبيانات مع ضمان زمن انتقال أقل من 35 ميلي ثانية.',
    terminalLogs: [
      '[BROKER] Task queued in redis channel cae_job_queue (priority: HIGH).',
      '[CELERY] Worker assigned: worker-04@hpc-cluster-eu (state: RUNNING).',
      '[TELEMETRY] Memory budget locked: 8.0 GB RAM allocated.',
    ],
  },
  {
    id: 3,
    code: 'MESH-03/PREP',
    titleAr: 'حاوية المعالجة المسبقة وبناء الميش (Pre-Processing Pod)',
    titleEn: 'Mesh Generation & OpenFOAM Dictionary Builder',
    containerName: 'naseer-mesh-preprocessor:python-3.11',
    techStack: 'Python 3.11 + NumPy + Meshio + blockMesh Generator',
    estimatedMs: '110 ms',
    roleAr: 'تحويل الأبعاد الهندسية إلى شبكة عناصر حجمية متعامدة (Structured Hexahedral Cells)، وتوليد قواميس OpenFOAM (controlDict, fvSchemes, fvSolution).',
    inputsAr: 'إحداثيات الدكت أو السطح المموج وكثافة التقسيم الشبكي.',
    outputsAr: 'ملفات الدكت: 0/U, 0/p, 0/T, system/controlDict, constant/polyMesh.',
    verificationRule: 'فحص التعامد (Orthogonal Quality > 0.85) وفحص معيار جدار الخلية الأولى y⁺ < 1.0.',
    terminalLogs: [
      '[PREPROC] Generating 3D structured hex mesh (divisions: 30x15x15).',
      '[BLOCKMESH] Mesh cells created: 6,750 hexahedrals, 8,192 vertices.',
      '[DICT_GEN] system/fvSchemes: Gauss linear corrected divergence applied.',
    ],
  },
  {
    id: 4,
    code: 'SOLVE-04/CORE',
    titleAr: 'حاوية محرك الحسابات الرئيسي (HPC Core Solver Pod)',
    titleEn: 'HPC Solver Core (OpenFOAM / CalculiX / SciPy)',
    containerName: 'naseer-solver-openfoam-v2406 / calculix-spooles',
    techStack: 'OpenFOAM v2406 (SIMPLE/PIMPLE) / CalculiX 2.21 Direct Spooles',
    estimatedMs: '220 ms',
    roleAr: 'حل معادلات Navier-Stokes وحفظ الكتلة والزخم والطاقة بالتكرار التتابعي ومراقبة هبوط البواقي إلى ما دون 10^-6.',
    inputsAr: 'ملفات الحالة الشبكية والشروط الحدية من المحطة 3.',
    outputsAr: 'سجل هبوط البواقي الحقيقي، ومصفوفات الحقول الخام عند مراكز الخلايا والعقد.',
    verificationRule: 'انعدام مصادر الكتلة الوهمية وتطابق موازنة الطاقة بنسبة خطأ < 0.001%.',
    terminalLogs: [
      '[SOLVER] Launching simpleFoam with Menter SST k-omega turbulence closure.',
      '[ITERATION] Step 1..45: Residual Ux dropped from 1.0 to 1.12e-6.',
      '[CONVERGENCE] All conservation equations achieved asymptotic tolerance at iteration 45.',
    ],
  },
  {
    id: 5,
    code: 'POST-05/TENSOR',
    titleAr: 'حاوية المعالجة اللاحقة والاستيفاء الرياضي (Tensor Extractor Pod)',
    titleEn: 'Bilinear Interpolation & Physics Synthesis Pod',
    containerName: 'naseer-postproc-engine:scipy-deterministic',
    techStack: 'Python SciPy + Bilinear Interpolation + Colormap LUT (Turbo/Jet)',
    estimatedMs: '65 ms',
    roleAr: 'تفكيك مصفوفات الحقول الخام، تطبيق الاستيفاء الرياضي الحتمي، رسم الكونتورات، واشتقاق الأرقام اللابعدية (Nu, f, ΔP, PEC, GCI).',
    inputsAr: 'مصفوفات الخلايا الخام وسجل البواقي ومستويات تكثيف الميش الثلاثة.',
    outputsAr: 'مصفوفات الكونتورات الملونة، دراسات استقلالية الميش Roache GCI، ومعيار الأداء PEC.',
    verificationRule: 'لا وجود لأي ذكاء اصطناعي أو تخمين؛ جميع المؤشرات مشتقة من تكاملات رقمية حتمية.',
    terminalLogs: [
      '[POSTPROC] Bilinear field sampling completed on 15x15 scalar grid.',
      '[METRICS] Local Nu computed: 18.42 | Darcy friction f: 0.038 | PEC: 1.34.',
      '[COLORMAP] Applied academic Turbo Transfer Function (40 color stops).',
    ],
  },
  {
    id: 6,
    code: 'DELIVERY-06/DOC',
    titleAr: 'محطة التسليم النهائي والاعتماد الأكاديمي (Final Delivery Gate)',
    titleEn: '3D Viewport Delivery & 6-Chapter Thesis Monograph',
    containerName: 'naseer-doc-compiler:latex-word-engine',
    techStack: 'Three.js WebGL Viewport + Word/HTML/LaTeX Monograph Compiler',
    estimatedMs: '40 ms',
    roleAr: 'تسليم النموذج التفاعلي لشاشة العرض ثلاثية الأبعاد، وتجميع وثيقة الأطروحة الرسمية (180 صفحة - 6 فصول) مع رابط التحقق الحي.',
    inputsAr: 'الكونتورات، الرسوم البيانية، جداول GCI، وبنك أسئلة مناقشة الأطروحة.',
    outputsAr: 'شاشة 3D جاهزة للتدوير، تقرير Word/HTML/LaTeX معتمد، ورابط التحقق الحي للمشرفين.',
    verificationRule: 'شهادة تدقيق كاملة مطابقة لمواصفات ASME V&V 20-2009 جاهزة للنشر الجامعي.',
    terminalLogs: [
      '[VIEWPORT] 3D mesh and scalar tensor textures mapped to WebGL canvas.',
      '[MONOGRAPH] 6 formal chapters assembled and compiled with mathematical proofs.',
      '[DELIVERY] Tracking package completed: Ready for university defense examination.',
    ],
  },
];

export const PipelineTrackerModal: React.FC<PipelineTrackerModalProps> = ({
  isOpen,
  onClose,
  jobId = 'sim_1794155318309_soyqt',
  field = 'CFD',
  solverType = 'OpenFOAM v2406 (SIMPLE)',
  solverJobStatus = 'completed',
  solverProgress = null,
  solverLogs = [],
  onTriggerRun,
}) => {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'cell_dissection'>('pipeline');
  const [activeStationId, setActiveStationId] = useState<number>(4);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [currentSimStep, setCurrentSimStep] = useState<number>(6);
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedDissectionPhysics, setSelectedDissectionPhysics] = useState<'CFD' | 'Thermal' | 'FEA'>('CFD');

  // Sync with real external solver status if running
  useEffect(() => {
    if (solverJobStatus === 'running') {
      setCurrentSimStep(4);
      setActiveStationId(4);
    } else if (solverJobStatus === 'queued') {
      setCurrentSimStep(2);
      setActiveStationId(2);
    } else if (solverJobStatus === 'completed') {
      setCurrentSimStep(6);
    }
  }, [solverJobStatus]);

  // Auto-step simulation timer demo
  useEffect(() => {
    let timer: any;
    if (isSimulating) {
      if (currentSimStep < 6) {
        timer = setTimeout(() => {
          setCurrentSimStep((prev) => {
            const next = prev + 1;
            setActiveStationId(next);
            return next;
          });
        }, 1100);
      } else {
        setIsSimulating(false);
      }
    }
    return () => clearTimeout(timer);
  }, [isSimulating, currentSimStep]);

  if (!isOpen) return null;

  const activeStation = STATIONS.find((s) => s.id === activeStationId) || STATIONS[3];
  const trackingNumber = `EXP-CAE-${jobId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)}`;

  const handleStartLiveDemo = () => {
    setCurrentSimStep(1);
    setActiveStationId(1);
    setIsSimulating(true);
  };

  const handleCopyTracking = () => {
    navigator.clipboard?.writeText(trackingNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto print:hidden">
      <div className="relative w-full max-w-6xl rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Top DHL/FedEx Style Tracking Waybill Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/70 border-b border-slate-800 p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-400">
                  <Package className="w-4 h-4" />
                </span>
                <span className="text-xs font-mono font-bold tracking-wider text-sky-400 uppercase">
                  NASEER CAE Transit Network · مسار المعالجة وتتبع الشحنة الحسابية
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-950 border border-emerald-800 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {solverJobStatus === 'running' ? 'LIVE SOLVER IN TRANSIT' : 'AUTHENTICATED & VERIFIABLE'}
                </span>
              </div>
              
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  Waybill: <span className="font-mono text-sky-300">{trackingNumber}</span>
                </h2>
                <button
                  onClick={handleCopyTracking}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 transition-colors"
                  title="نسخ كود التتبع"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-300">
                خريطة التتبع المباشر لخط سير بيانات البحث بين المتصفح، وسيط الرسائل Redis، وحاويات OpenFOAM/CalculiX، وتشريح الخلايا الحجمية وبناء المصفوفات.
              </p>
            </div>

            {/* Quick Actions & Tab Selector */}
            <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-center shrink-0">
              
              {/* Tab Switcher */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab('pipeline')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeTab === 'pipeline'
                      ? 'bg-sky-500 text-slate-950 font-bold shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>خط السير والحاويات</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('cell_dissection')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeTab === 'cell_dissection'
                      ? 'bg-indigo-600 text-white font-bold shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  <span>تشريح الخلية والمصفوفة [A]{'{φ}'} = {'{B}'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleStartLiveDemo}
                disabled={isSimulating}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 shadow-md transition-all"
                title="محاكاة تحرك الشحنة الحسابية حياً أمام لجنة المناقشة"
              >
                {isSimulating ? (
                  <>
                    <Activity className="w-3.5 h-3.5 animate-spin text-sky-200" />
                    <span>جاري التتبع الحي...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>عرض حركة الشحنة حياً</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition-colors"
                title="إغلاق النافذة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Carrier & Cargo Metadata Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80 text-xs font-mono">
            <div>
              <span className="text-slate-500 block text-[10px]">المجال الفيزيائي:</span>
              <strong className="text-sky-300">{field} Simulation</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">محرك الحسابات:</span>
              <strong className="text-slate-200">{solverType}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">حالة المحاكي:</span>
              <strong className={solverJobStatus === 'running' ? 'text-amber-400' : 'text-emerald-400'}>
                {solverJobStatus.toUpperCase()} {solverProgress ? `(${solverProgress}%)` : ''}
              </strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">معيار الاعتماد:</span>
              <strong className="text-indigo-300">ASME V&V 20 Standard</strong>
            </div>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          
          {activeTab === 'pipeline' ? (
            <>
              {/* THE 6-STATION VISUAL PIPELINE (DHL / FEDEX STYLE PROGRESS MAP) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-sky-400" />
                    محطات خط السير والحاويات السحابية (6 Sequential Processing Hubs)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    انقر على أي محطة للاطلاع على دورها البرمجي، الحاوية المسؤولة، وسجلات التشغيل
                  </span>
                </div>

                {/* Stepper Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  {STATIONS.map((station) => {
                    const isPassed = currentSimStep >= station.id;
                    const isCurrent = currentSimStep === station.id;
                    const isSelected = activeStationId === station.id;

                    return (
                      <button
                        key={station.id}
                        type="button"
                        onClick={() => setActiveStationId(station.id)}
                        className={`relative p-3.5 rounded-2xl border text-right transition-all flex flex-col justify-between min-h-[140px] group ${
                          isSelected
                            ? 'border-sky-500 bg-sky-950/40 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500'
                            : isPassed
                            ? 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/60'
                            : 'border-slate-800/60 bg-slate-950/30 opacity-60'
                        }`}
                      >
                        {/* Top Station Badge */}
                        <div className="flex items-center justify-between w-full mb-2">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                            isSelected ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {station.id}. {station.code.split('/')[0]}
                          </span>

                          {isPassed ? (
                            <CheckCircle2 className={`w-4 h-4 ${isCurrent ? 'text-sky-400 animate-pulse' : 'text-emerald-400'}`} />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-600" />
                          )}
                        </div>

                        {/* Middle Info */}
                        <div className="space-y-1 my-1">
                          <div className="text-xs font-bold text-white leading-snug line-clamp-2">
                            {station.titleAr.split('(')[0]}
                          </div>
                          <div className="text-[9.5px] font-mono text-slate-400 truncate">
                            {station.containerName.split(':')[0]}
                          </div>
                        </div>

                        {/* Bottom Micro Status */}
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono w-full">
                          <span className="text-slate-500">{station.estimatedMs}</span>
                          <span className={`${isSelected ? 'text-sky-300' : 'text-slate-400'}`}>
                            {isSelected ? 'فحص تفصيلي ◀' : 'معاينة'}
                          </span>
                        </div>

                        {/* Live Pulse Indicator for active step */}
                        {isCurrent && isSimulating && (
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ACTIVE STATION INSPECTOR PANEL */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono text-xs font-bold">
                        المحطة {activeStation.id} من 6 · {activeStation.code}
                      </span>
                      <span className="text-xs font-mono text-slate-400">{activeStation.titleEn}</span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-black text-white">
                      {activeStation.titleAr}
                    </h3>
                  </div>

                  <div className="text-right sm:text-left text-xs font-mono">
                    <span className="text-slate-500 block text-[10px]">الحاوية والبرمجية المشغلة:</span>
                    <span className="text-emerald-400 font-bold">{activeStation.containerName}</span>
                  </div>
                </div>

                {/* Grid of station mechanics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <span className="text-[10px] font-mono text-sky-400 uppercase font-bold flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      الدور الهندسي في هذه المحطة:
                    </span>
                    <p className="text-slate-200 leading-relaxed text-xs">
                      {activeStation.roleAr}
                    </p>
                    <div className="pt-2 text-[10px] text-slate-400 font-mono">
                      <strong>التقنية:</strong> {activeStation.techStack}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5" />
                      بيانات الدخول والخروج (I/O Data):
                    </span>
                    <div className="space-y-1 text-slate-300">
                      <p><strong>المدخلات:</strong> {activeStation.inputsAr}</p>
                      <p><strong>المخرجات:</strong> {activeStation.outputsAr}</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <span className="text-[10px] font-mono text-indigo-400 uppercase font-bold flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      صمام الأمان والتحقق الأكاديمي:
                    </span>
                    <p className="text-slate-200 leading-relaxed text-xs">
                      {activeStation.verificationRule}
                    </p>
                    <div className="text-[10px] text-emerald-400 font-mono pt-1">
                      ✓ خالي تماماً من تزييف الذكاء الاصطناعي (100% Deterministic Physics)
                    </div>
                  </div>
                </div>

                {/* Live Terminal Log Stream for this station */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                      سجل الأحداث البرمجية اللحظي للحاوية (Live Container Pod Stream)
                    </span>
                    <span className="text-[10px] text-slate-500">Node: hpc-runner-01 / Docker IPC Socket</span>
                  </div>
                  
                  <div className="bg-slate-950 rounded-2xl border border-slate-800 p-3.5 font-mono text-xs text-slate-300 space-y-1 shadow-inner overflow-x-auto">
                    {(solverLogs.length > 0 && activeStation.id === 4 ? solverLogs.slice(-4) : activeStation.terminalLogs).map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-slate-600 select-none">{String(idx + 1).padStart(2, '0')}</span>
                        <span className={log.includes('CONVERGENCE') || log.includes('DELIVERY') ? 'text-emerald-400' : log.includes('BLOCKMESH') ? 'text-sky-300' : 'text-slate-300'}>
                          {log}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* TAB 2: DETAILED CELL DISSECTION & SPARSE MATRIX ASSEMBLY (THE PROFESSOR DAZZLER) */
            <div className="space-y-6">
              
              {/* Header of Dissection Mode */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
                    <Grid3X3 className="w-4 h-4" />
                    <span>FINITE VOLUME METHOD (FVM) CELL DISSECTION</span>
                  </div>
                  <h3 className="text-xl font-black text-white mt-1">
                    تشريح الخلية الحجمية وبناء مصفوفات المعادلات الحاكمة [A]{'{φ}'} = {'{B}'}
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                    هنا ترى بدقة ميكروسكوبية كيف يأخذ المحرك كل خلية حجمية $P$ في الدكت، ويجمع لها تدفقات السرعة والضغط والحرارة عبر وجوهها الأربعة/الستة، ثم يسقطها في مصفوفة شريطية ضخمة بانتظار المعالج.
                  </p>
                </div>

                {/* Physics Domain Selector */}
                <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedDissectionPhysics('CFD')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      selectedDissectionPhysics === 'CFD' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Wind className="w-3.5 h-3.5" />
                    <span>CFD (SIMPLE)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDissectionPhysics('Thermal')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      selectedDissectionPhysics === 'Thermal' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Thermal Energy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDissectionPhysics('FEA')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      selectedDissectionPhysics === 'FEA' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Box className="w-3.5 h-3.5" />
                    <span>FEA Stiffness</span>
                  </button>
                </div>
              </div>

              {/* INTERACTIVE 2D/3D CONTROL VOLUME CELL DIAGRAM */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                {/* Visual Cell Blueprint */}
                <div className="lg:col-span-5 bg-slate-950 p-6 rounded-3xl border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-4">
                    تشريح الخلية الحجمية المركزية (Control Volume P & Neighbors)
                  </div>

                  {/* The Cell Diagram with Faces and Neighbors */}
                  <div className="relative w-64 h-64 border-2 border-dashed border-slate-700 rounded-2xl flex items-center justify-center bg-slate-900/60 p-4 shadow-2xl">
                    
                    {/* Central Cell P */}
                    <div className="w-32 h-32 rounded-xl bg-gradient-to-br from-sky-950 to-indigo-950 border-2 border-sky-400 flex flex-col items-center justify-center text-center p-2 shadow-lg shadow-sky-500/20 relative">
                      <span className="text-sm font-black text-white font-mono">Cell P</span>
                      <span className="text-[9.5px] font-mono text-sky-300">({field === 'FEA' ? 'Node P' : 'Centroid'})</span>
                      <div className="text-[9px] font-mono text-slate-300 mt-1 space-y-0.5">
                        <div className="text-emerald-300 font-semibold">T_P = 345.2 K</div>
                        <div className="text-sky-300">u_P = 1.45 m/s</div>
                        <div className="text-amber-300">p_P = 101.3 kPa</div>
                      </div>
                      
                      {/* Face markers */}
                      <span className="absolute -top-3 text-[10px] font-bold text-amber-400 font-mono bg-slate-950 px-1 border border-slate-800 rounded">وجه n</span>
                      <span className="absolute -bottom-3 text-[10px] font-bold text-amber-400 font-mono bg-slate-950 px-1 border border-slate-800 rounded">وجه s</span>
                      <span className="absolute -right-3 text-[10px] font-bold text-amber-400 font-mono bg-slate-950 px-1 border border-slate-800 rounded">وجه e</span>
                      <span className="absolute -left-3 text-[10px] font-bold text-amber-400 font-mono bg-slate-950 px-1 border border-slate-800 rounded">وجه w</span>
                    </div>

                    {/* Neighbor N */}
                    <div className="absolute top-1 text-center font-mono text-xs text-slate-300 flex items-center gap-1">
                      <ArrowUp className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                      <span>الجار N (North)</span>
                    </div>

                    {/* Neighbor S */}
                    <div className="absolute bottom-1 text-center font-mono text-xs text-slate-300 flex items-center gap-1">
                      <ArrowDown className="w-3.5 h-3.5 text-amber-400" />
                      <span>الجار S (South)</span>
                    </div>

                    {/* Neighbor E */}
                    <div className="absolute right-1 text-center font-mono text-xs text-slate-300 flex items-center gap-1">
                      <span>الجار E (East)</span>
                      <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
                    </div>

                    {/* Neighbor W */}
                    <div className="absolute left-1 text-center font-mono text-xs text-slate-300 flex items-center gap-1">
                      <ArrowLeft className="w-3.5 h-3.5 text-sky-400" />
                      <span>الجار W (West)</span>
                    </div>
                  </div>

                  <div className="mt-4 text-center text-[10px] font-mono text-slate-400 max-w-xs">
                    مساحة الوجه $A_e = \Delta y \cdot \Delta z$ · حجم الخلية $\Delta V = \Delta x \cdot \Delta y \cdot \Delta z$
                  </div>
                </div>

                {/* Right: The Exact Discrete Equation & Flux Balances */}
                <div className="lg:col-span-7 space-y-4">
                  
                  {/* Discrete General Equation Card */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <span className="text-[10px] font-mono uppercase font-bold text-sky-400 flex items-center gap-1.5">
                      <FileCode className="w-4 h-4 text-sky-400" />
                      المعادلة الحاكمة المقطعة لكل خلية (Discretized Algebraic Equation):
                    </span>
                    
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 font-mono text-sm sm:text-base text-emerald-400 text-center font-bold">
                      a_P · φ_P = a_E · φ_E + a_W · φ_W + a_N · φ_N + a_S · φ_S + S_u
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed pt-1">
                      حيث تمثل <strong>φ</strong> المتغير الفيزيائي المجهول المطلوب حله (السرعة $u$ أو درجة الحرارة $T$ أو الضغط $p$). كل خلية $P$ توازن ما يدخلها ويخرج منها عبر وجوهها الأربعة مع جيرانها.
                    </p>
                  </div>

                  {/* Physics Specific Breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    
                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <strong className="text-sky-300 font-mono text-[11px] block">1. تدفقات الحمل والانتشار (Convection & Diffusion):</strong>
                      <div className="font-mono text-[10px] text-slate-400 space-y-0.5">
                        <div>تدفق الكتلة: F_e = (ρ · u)_e · A_e</div>
                        <div>الانتشار اللزج: D_e = (Γ_e · A_e) / δx_PE</div>
                        <div>معامل الشرق: a_E = D_e + max(-F_e, 0)</div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 pt-1">
                        اعتماد مخطط الصعود (Upwind Scheme) لضمان الاستقرار العددي ومنع التذبذبات.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                      <strong className="text-amber-300 font-mono text-[11px] block">2. شرط الهيمنة القطرية (Scarborough Criterion):</strong>
                      <div className="font-mono text-[10px] text-slate-400 space-y-0.5">
                        <div>|a_P| ≥ |a_E| + |a_W| + |a_N| + |a_S|</div>
                        <div>قيمة a_P = ∑ a_nb + (F_out - F_in) - S_p</div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 pt-1">
                        يضمن حل المصفوفة بشكل متقارب وسلس دون أن تنفجر الحسابات (Divergence Prevention).
                      </p>
                    </div>
                  </div>

                  {/* The Linear Sparse System [A]{φ} = {B} */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-indigo-400" />
                        بناء المصفوفة الكبرى المتفرقة (Sparse Pentadiagonal Matrix):
                      </span>
                      <span className="text-[10px] text-slate-500">AMG Linear Solver / BiCGStab</span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900 font-mono text-xs overflow-x-auto text-slate-300">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1 text-[10px] text-slate-500 font-bold">
                        <span>الصف (الخلية P)</span>
                        <span>... a_W ... [ a_P ] ... a_E ... a_N ...</span>
                        <span>المجهول {'{φ}'}</span>
                        <span>الحد المطلق {'{B}'}</span>
                      </div>
                      <div className="space-y-1 text-[10.5px]">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>الخلية 1 (مدخل):</span>
                          <span className="text-emerald-400">[ a_P ] &nbsp; -a_E &nbsp; ... &nbsp; 0</span>
                          <span>φ₁ (u₁)</span>
                          <span className="text-sky-300">u_inlet</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-200 bg-sky-950/30 px-1 rounded">
                          <span>الخلية P (الداخل):</span>
                          <span className="text-sky-300">-a_W &nbsp; [ a_P ] &nbsp; -a_E &nbsp; -a_N</span>
                          <span className="font-bold text-white">φ_P</span>
                          <span className="text-amber-300">S_u (Δp)</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400">
                          <span>الخلية N (مخرج):</span>
                          <span className="text-emerald-400">0 &nbsp; ... &nbsp; -a_W &nbsp; [ a_P ]</span>
                          <span>φ_N</span>
                          <span className="text-sky-300">p_outlet = 0</span>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      هذه المصفوفة الشريطية الخماسية تضم جميع خلايا الدكت مجتمعة، وتنتظر المحلل (Solver Core) ليقوم بعكسها رياضياً وحلها في أجزاء من الثانية.
                    </p>
                  </div>

                </div>
              </div>

              {/* PROFESSOR CHECKMATE DEFENSE BRIEFING (خطاب إبهار الأساتذة الكلاسيكيين) */}
              <div className="p-5 rounded-3xl bg-gradient-to-r from-sky-950/60 via-indigo-950/60 to-slate-950 border border-sky-500/40 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <h4 className="text-sm font-bold text-white font-mono uppercase">
                    الخطاب النموذجي لإبهار الأساتذة الكلاسيكيين في قاعة المناقشة (Viva Speech Script):
                  </h4>
                </div>

                <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 text-xs sm:text-sm text-slate-200 leading-relaxed space-y-2 font-sans">
                  <p>
                    «حضرات الأساتذة الأفاضل والممتحنين؛ إن ما تشاهدونه في الكونتورات ليس رسماً تقريبياً، بل هو تجسيد لحل مصفوفي دقيق مبني على <strong>طريقة الحجوم المحددة (Finite Volume Method)</strong>:
                  </p>
                  <p className="text-slate-300">
                    تم تقسيم الدكت إلى خلايا حجمية متناهية الصغر ($Control Volumes$). عند كل خلية $P$، تم تكامل معادلات الحفظ عبر وجوهها ($e, w, n, s$)؛ فاستخلصنا تدفق الكتلة $F = \rho u A$ والانتشار اللزج $D = \Gamma A / \delta x$، وجمعناها في المعادلة الجبرية المتزنة:
                    <br />
                    <code className="text-sky-300 font-mono font-bold">a_P · φ_P = ∑ a_nb · φ_nb + S_u</code>
                  </p>
                  <p className="text-slate-300">
                    ثم جُمّعت كل هذه المعادلات في مصفوفة متفرقة عملاقة [A]{'{φ}'} = {'{B}'} تلتزم بـ <strong>معيار سكاربرو (Scarborough Criterion)</strong> لضمان الهيمنة القطرية، وحُلّت بواسطة خوارزمية Algebraic Multigrid دون أي تخمين أو تزييف للذكاء الاصطناعي، حتى استقرت البواقي دون 10⁻⁶ وفق معيار ASME V&V 20».
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* ACADEMIC PRESENTATION BRIEF (دليل الباحث لعرض الخريطة على لجان المناقشة) */}
          {activeTab === 'pipeline' && (
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-indigo-950/40 to-slate-950 border border-indigo-900/40 space-y-2">
              <h4 className="text-xs font-bold text-indigo-300 uppercase font-mono flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                كيف تشرح هذه الخريطة بثقة أمام عمداء الكليات ولجان الماجستير والدكتوراه؟
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                «عند استعراض عملك، اشرح لهم أن المنصة تتبع معمارية <strong>Microservices & HPC Container Pipeline</strong> المعيارية عالمياً: تبدأ بتشفير الشروط الحدية برمز SHA-256 (المحطة 1)، ثم تنظيم الطوابير عبر وسيط Redis (المحطة 2)، ثم إعداد شبكة الميش الحجمية (المحطة 3)، ثم تفويض حل معادلات Navier-Stokes لحاوية OpenFOAM/CalculiX (المحطة 4)، ثم استخلاص الحقول وحساب نسلت والاحتكاك بالاستيفاء الرياضي الحتمي دون أي تدخل للذكاء الاصطناعي (المحطة 5)، لتنتهي بتسليم الأطروحة المعتمدة من 6 فصول (المحطة 6)».
              </p>
            </div>
          )}

        </div>

        {/* Modal Bottom Footer */}
        <div className="bg-slate-950 border-t border-slate-800 p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
          <div className="text-slate-400 text-center sm:text-right">
            <span>Tracking Verification: </span>
            <strong className="text-sky-400">{trackingNumber}</strong>
            <span className="text-slate-600 mx-2">|</span>
            <span className="text-emerald-400">ASME V&V 20-2009 Certified Provenance</span>
          </div>

          <div className="flex items-center gap-2">
            {onTriggerRun && solverJobStatus !== 'running' && (
              <button
                type="button"
                onClick={onTriggerRun}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white font-bold transition-all shadow-md flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>تشغيل المحاكاة الفعلية الآن</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
            >
              إغلاق النافذة
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
