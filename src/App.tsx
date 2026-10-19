import React, { useState, useEffect } from 'react';
import {
  Layers,
  Grid3X3,
  Palette,
  ShieldCheck,
  Table as TableIcon,
  FileText,
  Sparkles,
  Cpu,
  Key,
  Shield,
  Upload,
  RotateCcw,
  FolderOpen,
  Save,
  Check,
} from 'lucide-react';
import { ThesisProject, ApiKeyItem, EngineMode, CloudServerConfig } from './types/thesis';
import { Navbar } from './components/Navbar';
import { CleanWorkspaceHome } from './components/CleanWorkspaceHome';
import { OverviewTab } from './components/OverviewTab';
import { MeshStudyTab } from './components/MeshStudyTab';
import { ContoursTab } from './components/ContoursTab';
import { ValidationTab } from './components/ValidationTab';
import { TablesTab } from './components/TablesTab';
import { ThesisReportTab } from './components/ThesisReportTab';
import { ScriptUploaderModal } from './components/ScriptUploaderModal';
import { SupervisorAssistantDrawer } from './components/SupervisorAssistantDrawer';
import { KeyPoolModal } from './components/KeyPoolModal';
import { ProjectsLibraryModal } from './components/ProjectsLibraryModal';
import { CloudServerSettingsModal } from './components/CloudServerSettingsModal';
import {
  LHTES_V3_MASTER_PROJECT,
  NACA_0012_CFD_PROJECT,
  CANTILEVER_BEAM_FEA_PROJECT,
} from './data/defaultPresets';

export type TabType = 'report' | 'contours' | 'mesh' | 'validation' | 'tables' | 'overview';

export default function App() {
  // Start with clean workspace (null) so previous research does NOT stick to the app!
  const [currentProject, setCurrentProject] = useState<ThesisProject | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('report');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [isKeyPoolModalOpen, setIsKeyPoolModalOpen] = useState<boolean>(false);
  const [isProjectsLibraryOpen, setIsProjectsLibraryOpen] = useState<boolean>(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Cloud 400GB & ANSYS License Server Configuration
  const [cloudConfig, setCloudConfig] = useState<CloudServerConfig>(() => {
    try {
      const saved = localStorage.getItem('workbench_cloud_config');
      return saved
        ? JSON.parse(saved)
        : {
            backendUrl: 'http://127.0.0.1:8001',
            workingDirectory: '/data/ansys_workspace',
            parallelCores: 8,
            storageCapacityGb: 400,
            solverBackend: 'scipy_deterministic',
            licenseServerHost: '127.0.0.1',
            licenseFlexNetPort: 1055,
            licenseAnsysLiPort: 2325,
            licenseType: 'academic',
            autoFallbackToOpenSource: true,
            status: 'unconfigured',
          };
    } catch {
      return {
        backendUrl: 'http://127.0.0.1:8001',
        workingDirectory: '/data/ansys_workspace',
        parallelCores: 8,
        storageCapacityGb: 400,
        solverBackend: 'scipy_deterministic',
        licenseServerHost: '127.0.0.1',
        licenseFlexNetPort: 1055,
        licenseAnsysLiPort: 2325,
        licenseType: 'academic',
        autoFallbackToOpenSource: true,
        status: 'unconfigured',
      };
    }
  });

  // Custom User Projects persistent in localStorage
  const [customProjects, setCustomProjects] = useState<ThesisProject[]>(() => {
    try {
      const saved = localStorage.getItem('workbench_custom_projects');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const allAvailableProjects: ThesisProject[] = [
    LHTES_V3_MASTER_PROJECT,
    NACA_0012_CFD_PROJECT,
    CANTILEVER_BEAM_FEA_PROJECT,
    ...customProjects,
  ];

  // Persistent API Keys Pool & Engine Mode
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem('workbench_api_keys');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [engineMode, setEngineMode] = useState<EngineMode>(() => {
    try {
      const saved = localStorage.getItem('workbench_engine_mode');
      return (saved as EngineMode) || 'hybrid';
    } catch {
      return 'hybrid';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('workbench_api_keys', JSON.stringify(apiKeys));
    } catch (e) {
      console.error('Error saving keys:', e);
    }
  }, [apiKeys]);

  useEffect(() => {
    try {
      localStorage.setItem('workbench_cloud_config', JSON.stringify(cloudConfig));
      // Sync with server backend
      fetch('/api/cloud/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudConfig),
      }).catch(() => {});
    } catch (e) {
      console.error('Error saving cloud config:', e);
    }
  }, [cloudConfig]);


  const tabs: { id: TabType; label: string; icon: React.ReactNode; badge?: string }[] = currentProject
    ? [
        {
          id: 'overview',
          label: 'محطة نمذجة وحل ANSYS Workbench (Project Schematic & Solver)',
          icon: <Layers className="w-4 h-4 text-sky-400" />,
          badge: currentProject.field,
        },
        {
          id: 'contours',
          label: 'حقول الكونتورات والمتجهات (2D/3D Fields)',
          icon: <Palette className="w-4 h-4 text-amber-400" />,
          badge: `${currentProject.contours.length} حقول`,
        },
        {
          id: 'mesh',
          label: 'شبكات الميش ومؤشر روتش (Mesh & GCI)',
          icon: <Grid3X3 className="w-4 h-4 text-emerald-400" />,
          badge: `GCI ${currentProject.meshStudy.meshLevels[2]?.gciPercent}%`,
        },
        {
          id: 'validation',
          label: 'التحقق والمعايرة (ASME V&V 20)',
          icon: <ShieldCheck className="w-4 h-4 text-indigo-400" />,
          badge: `R² ${currentProject.validation.rSquared}`,
        },
        {
          id: 'tables',
          label: 'مصفوفات وجداول النتائج (Data Matrices)',
          icon: <TableIcon className="w-4 h-4 text-purple-400" />,
          badge: `${currentProject.thesisTables.length} جداول`,
        },
        {
          id: 'report',
          label: 'التقرير الهندسي المعتمد (Certified Report)',
          icon: <FileText className="w-4 h-4 text-slate-300" />,
          badge: 'التقرير الشامل',
        },
      ]
    : [];

  const handleStartProject = (newProject: ThesisProject) => {
    setCurrentProject(newProject);
    setActiveTab('overview');
  };

  const handleSaveCurrentProject = () => {
    if (!currentProject) return;
    const projectToSave: ThesisProject = {
      ...currentProject,
      isCustom: true,
      lastModified: new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const existingIdx = customProjects.findIndex((p) => p.id === projectToSave.id);
    let updated: ThesisProject[];
    if (existingIdx >= 0) {
      updated = [...customProjects];
      updated[existingIdx] = projectToSave;
    } else {
      updated = [projectToSave, ...customProjects];
    }

    setCustomProjects(updated);
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving custom project:', e);
    }

    setSaveToast('تم حفظ هذا المشروع بنجاح في مكتبة مشاريعك السابقة');
    setTimeout(() => {
      setSaveToast(null);
    }, 3500);
  };

  const handleDeleteCustomProject = (projectId: string) => {
    const updated = customProjects.filter((p) => p.id !== projectId);
    setCustomProjects(updated);
    try {
      localStorage.setItem('workbench_custom_projects', JSON.stringify(updated));
    } catch (e) {
      console.error('Error deleting project:', e);
    }
  };

  const handlePrint = () => {
    if (activeTab !== 'report') {
      setActiveTab('report');
      setTimeout(() => {
        window.print();
      }, 350);
    } else {
      window.print();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Cairo',sans-serif] selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Navbar */}
      <Navbar
        currentProject={currentProject}
        onResetToCleanWorkspace={() => setCurrentProject(null)}
        onOpenProjectsLibrary={() => setIsProjectsLibraryOpen(true)}
        onOpenUploadModal={() => setIsUploadModalOpen(true)}
        onOpenAssistant={() => setIsAssistantOpen(true)}
        onOpenKeyPoolModal={() => setIsKeyPoolModalOpen(true)}
        onOpenCloudModal={() => setIsCloudModalOpen(true)}
        onPrintReport={handlePrint}
        engineMode={engineMode}
        apiKeys={apiKeys}
        cloudConfig={cloudConfig}
        savedProjectsCount={allAvailableProjects.length}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* If no project is currently loaded: render the Pristine Clean Workspace Studio */}
        {!currentProject ? (
          <CleanWorkspaceHome
            onStartProject={handleStartProject}
            apiKeys={apiKeys}
            engineMode={engineMode}
            onOpenKeyPool={() => setIsKeyPoolModalOpen(true)}
            onOpenProjectsLibrary={() => setIsProjectsLibraryOpen(true)}
            onOpenCloudSettings={() => setIsCloudModalOpen(true)}
            savedProjectsCount={allAvailableProjects.length}
          />
        ) : (
          /* Active Simulation Session Workspace */
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Active Simulation Session Header Bar */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl text-xs space-y-3 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-md shadow-emerald-400/50" />
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">
                      {currentProject.title}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono text-[11px]">
                      {currentProject.field} · {currentProject.softwareType}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setIsProjectsLibraryOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 transition-colors font-bold text-xs"
                    title="استدعاء أو تبديل إلى مشروع بحثي سابق من المكتبة"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                    <span>استدعاء بحث سابق</span>
                  </button>

                  <button
                    onClick={handleSaveCurrentProject}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors font-semibold text-xs"
                    title="حفظ التعديلات في مكتبة المشاريع السابقة"
                  >
                    <Save className="w-3.5 h-3.5 text-emerald-400" />
                    <span>حفظ في المكتبة</span>
                  </button>

                  <button
                    onClick={() => setCurrentProject(null)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors font-medium text-xs"
                    title="إغلاق هذا المشروع والعودة لبيئة العمل الصافية لعمل جديد"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                    <span>إغلاق وجلسة جديدة</span>
                  </button>

                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-sky-500/20 active:scale-95 transition-all flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>استيراد ملفات إضافية</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    المحرك النشط:{' '}
                    <strong className="text-emerald-300">
                      {engineMode === 'pure_local' ? 'المحرك الفيزيائي المحلي 100%' : 'الوضع الهجين الفائق'}
                    </strong>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-sky-400" />
                    حالة النظام:{' '}
                    <strong className="text-sky-300">جاهز ومستقر (Zero-Downtime)</strong>
                  </span>
                </div>
                {currentProject.directivesApplied && (
                  <div className="text-amber-300/90 truncate max-w-md">
                    التوجيهات المطبقة: {currentProject.directivesApplied}
                  </div>
                )}
              </div>
            </div>

            {/* Tab Navigation Bar */}
            <div className="bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 shadow-xl overflow-x-auto flex gap-1.5 no-scrollbar print:hidden">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    {tab.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                          isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active Tab Content Display */}
            <div className="pb-12">
              {activeTab === 'report' && (
                <ThesisReportTab project={currentProject} onPrint={handlePrint} />
              )}

              {activeTab === 'contours' && (
                <ContoursTab contours={currentProject.contours} />
              )}

              {activeTab === 'mesh' && (
                <MeshStudyTab
                  meshStudy={currentProject.meshStudy}
                  softwareType={currentProject.softwareType}
                />
              )}

              {activeTab === 'validation' && (
                <ValidationTab
                  validation={currentProject.validation}
                  field={currentProject.field}
                />
              )}

              {activeTab === 'tables' && (
                <TablesTab tables={currentProject.thesisTables} />
              )}

              {activeTab === 'overview' && (
                <OverviewTab project={currentProject} />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-6 text-xs text-slate-400 print:hidden text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            ANSYS Engineering WorkBench - منصة المحاكاة والتحليل الهندسي الشاملة متعددة المجالات (CFD & FEA) © 2026
          </p>
          <div className="flex items-center gap-4 text-slate-400">
            <span>ASME V&V 20-2009 Compliant</span>
            <span>·</span>
            <span>Roache GCI Verified</span>
            <span>·</span>
            <span>Navier-Stokes & Hooke Elasticity Formulation</span>
            <span>·</span>
            {currentProject && (
              <button
                onClick={() => setIsAssistantOpen(true)}
                className="text-amber-400 hover:underline"
              >
                استشارة المستشار الهندسي
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Universal Multi-Format Ingestion Modal */}
      <ScriptUploaderModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onAnalysisComplete={handleStartProject}
        apiKeys={apiKeys}
        engineMode={engineMode}
      />

      {/* Senior Simulation Consultant Drawer */}
      {currentProject && (
        <SupervisorAssistantDrawer
          isOpen={isAssistantOpen}
          onClose={() => setIsAssistantOpen(false)}
          project={currentProject}
          apiKeys={apiKeys}
          engineMode={engineMode}
        />
      )}

      {/* Multi-Key Pool & Engine Console Modal */}
      <KeyPoolModal
        isOpen={isKeyPoolModalOpen}
        onClose={() => setIsKeyPoolModalOpen(false)}
        apiKeys={apiKeys}
        onUpdateKeys={setApiKeys}
        engineMode={engineMode}
        onUpdateEngineMode={setEngineMode}
      />

      {/* 400GB Cloud Server & ANSYS FlexNet Licensing Configuration Modal */}
      <CloudServerSettingsModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        config={cloudConfig}
        onSaveConfig={(newConfig) => {
          setCloudConfig(newConfig);
          setSaveToast('تم حفظ إعدادات الخادم السحابي والترخيص بنجاح');
          setTimeout(() => setSaveToast(null), 3000);
        }}
      />


      {/* Dedicated Previous Research Projects Recall Window */}
      <ProjectsLibraryModal
        isOpen={isProjectsLibraryOpen}
        onClose={() => setIsProjectsLibraryOpen(false)}
        projects={allAvailableProjects}
        currentProjectId={currentProject?.id}
        onSelectProject={(proj) => {
          setCurrentProject(proj);
          setActiveTab('report');
        }}
        onStartBlankProject={() => setCurrentProject(null)}
        onDeleteProject={handleDeleteCustomProject}
      />

      {/* Floating Save Toast Notification */}
      {saveToast && (
        <div className="fixed bottom-6 left-6 z-50 bg-emerald-950 border border-emerald-500/40 text-emerald-200 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs animate-in slide-in-from-bottom duration-300">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}
    </div>
  );
}
