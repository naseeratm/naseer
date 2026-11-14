import React, { useState, useRef } from 'react';
import {
  Upload,
  Plus,
  FolderOpen,
  Box,
  Cpu,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { ThesisProject, IngestedFileItem, ApiKeyItem, EngineMode } from '../types/thesis';
import { generateLocalEngineeringProject } from '../utils/physicsEngine';
import { parseEngineeringFilesOrArchive } from '../utils/fileParser';

interface CleanWorkspaceHomeProps {
  onStartProject: (project: ThesisProject) => void;
  apiKeys: ApiKeyItem[];
  engineMode: EngineMode;
  onOpenKeyPool: () => void;
  onOpenNewProjectWizard?: () => void;
  onOpenProjectsLibrary?: () => void;
  onOpenCloudSettings?: () => void;
  onOpenAuditModal?: () => void;
  onOpenMeshGenerator?: () => void;
  onOpenMaterialsModal?: () => void;
  onOpenParametricSweep?: () => void;
  onOpenPipelineTracker?: () => void;
  savedProjectsCount?: number;
  onResetWorkspace?: () => void;
}

export const CleanWorkspaceHome: React.FC<CleanWorkspaceHomeProps> = ({
  onStartProject,
  onOpenNewProjectWizard,
  onOpenProjectsLibrary,
  savedProjectsCount = 0,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCadImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);

    try {
      const file = files[0];
      const results = await parseEngineeringFilesOrArchive(file);
      const parsedItems: IngestedFileItem[] = results.map((parsed) => ({
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
      }));

      const project = generateLocalEngineeringProject(
        file.name,
        '',
        'CFD',
        parsedItems[0]?.content || '',
        parsedItems
      );
      onStartProject(project);
    } catch (err) {
      console.error('CAD Import Error:', err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6 select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.step,.stp,.iges,.igs,.obj,.inp,.zip"
        className="hidden"
        onChange={(e) => handleCadImport(e.target.files)}
      />

      {/* Centered Global CAE Welcome Card (SimScale / Ansys Discovery Style) */}
      <div className="w-full max-w-2xl bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-7">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
              <Box className="w-4 h-4" />
              <span>NASEER CAE WORKBENCH</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Start a New Engineering Simulation
            </h1>
            <p className="text-xs text-slate-400">
              Create a physics setup, import a 3D CAD model, or resume a saved simulation case.
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ASME V&V 20</span>
          </div>
        </div>

        {/* 3 Primary Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <button
            type="button"
            onClick={() => {
              if (onOpenNewProjectWizard) {
                onOpenNewProjectWizard();
              } else {
                onStartProject(generateLocalEngineeringProject('untitled_case.stl', '', 'CFD'));
              }
            }}
            className="p-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-left transition-all shadow-lg shadow-sky-950/50 flex flex-col justify-between gap-4 group"
          >
            <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold">New Project</div>
              <div className="text-[11px] text-sky-100/80 mt-0.5">CFD, FEA or Thermal</div>
            </div>
          </button>

          <button
            type="button"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800/90 border border-slate-800 hover:border-sky-500/50 text-left transition-all flex flex-col justify-between gap-4 group"
          >
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              {isImporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Import CAD</div>
              <div className="text-[11px] text-slate-400 mt-0.5">.STL, .STEP, .IGES, .INP</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenProjectsLibrary && onOpenProjectsLibrary()}
            className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 text-left transition-all flex flex-col justify-between gap-4 group"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
                <FolderOpen className="w-5 h-5" />
              </div>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {savedProjectsCount}
              </span>
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Open Project</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Saved workspace cases</div>
            </div>
          </button>
        </div>

        {/* Solver Engine Footer */}
        <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>Solvers: OpenFOAM v2406 · CalculiX v2.21</span>
          </div>
          <span>Units: SI (m, kg, s, K, Pa)</span>
        </div>
      </div>
    </div>
  );
};