import React, { useState } from 'react';
import { X, Wind, Cpu, Flame, Plus, CheckCircle2 } from 'lucide-react';
import { ThesisProject, MaterialProperties } from '../types/thesis';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (project: ThesisProject) => void;
  onOpenMeshGenerator?: () => void;
}

type DomainType = 'CFD' | 'FEA' | 'Thermal';

const MATERIAL_PRESETS: Record<DomainType, MaterialProperties> = {
  CFD: {
    name: 'Air (Standard Sea Level, 20°C)',
    phaseOrType: 'Fluid',
    density: '1.204 kg/m³',
    viscosity: '1.825e-5 Pa·s',
    thermalConductivity: '0.0251 W/(m·K)',
    specificHeat: '1007 J/(kg·K)',
  },
  FEA: {
    name: 'Structural Steel (ASTM A36)',
    phaseOrType: 'Solid',
    density: '7850 kg/m³',
    elasticModulus: '200 GPa',
    poissonRatio: '0.30',
    yieldStrength: '250 MPa',
    thermalConductivity: '50.2 W/(m·K)',
    specificHeat: '490 J/(kg·K)',
  },
  Thermal: {
    name: 'Aluminum Alloy 6061-T6',
    phaseOrType: 'Solid',
    density: '2700 kg/m³',
    elasticModulus: '68.9 GPa',
    poissonRatio: '0.33',
    yieldStrength: '276 MPa',
    thermalConductivity: '167 W/(m·K)',
    specificHeat: '896 J/(kg·K)',
  },
};

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onCreateProject,
}) => {
  const [title, setTitle] = useState('');
  const [field, setField] = useState<DomainType>('CFD');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');

  if (!isOpen) return null;

  const solverName =
    field === 'FEA'
      ? 'CalculiX v2.21 (Static / Thermal FEA)'
      : field === 'Thermal'
      ? 'OpenFOAM v2406 (chtMultiRegionFoam)'
      : 'OpenFOAM v2406 (simpleFoam / pimpleFoam)';

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim() || `${field}_Simulation_Case`;
    const material = MATERIAL_PRESETS[field];

    const newProject: ThesisProject = {
      id: `case_${Date.now()}`,
      title: cleanTitle,
      titleEn: cleanTitle,
      author: author.trim() || 'CAE Engineer',
      supervisor: '',
      university: '',
      department: `${field} Simulation Workspace`,
      date: new Date().getFullYear().toString(),
      field,
      softwareType: solverName,
      projectType: 'R&D Verification',
      isCustom: true,
      lastModified: new Date().toLocaleDateString('en-CA'),
      standardsCompliance: ['ASME V&V 20-2009'],
      directivesApplied: `Solver: ${solverName} | Units: SI (m, kg, s, K, Pa)`,
      extractedSummary: description.trim() || `${field} simulation setup using ${solverName}.`,
      abstractAr: description.trim(),
      abstractEn: description.trim(),
      governingEquations:
        field === 'FEA'
          ? [
              {
                name: 'Static Equilibrium (Cauchy)',
                latex: '\\nabla \\cdot \\boldsymbol{\\sigma} + \\mathbf{b} = \\mathbf{0}',
                description: 'Structural stress equilibrium under applied loads.',
              },
            ]
          : field === 'Thermal'
          ? [
              {
                name: 'Energy Conservation Equation',
                latex: '\\rho c_p \\frac{\\partial T}{\\partial t} + \\rho c_p (\\vec{V} \\cdot \\nabla T) = \\nabla \\cdot (k \\nabla T)',
                description: 'Conjugate conductive and convective heat transfer.',
              },
            ]
          : [
              {
                name: 'Incompressible Navier-Stokes',
                latex: '\\rho \\frac{D\\vec{V}}{Dt} = -\\nabla p + \\mu \\nabla^2 \\vec{V}',
                description: 'Conservation of mass and momentum.',
              },
            ],
      boundaryConditions: [],
      material,
      solver: {
        solverType: solverName,
        scheme: 'Second Order Linear Upwind',
        discretization: field === 'FEA' ? 'Finite Element (C3D10)' : 'Finite Volume (FVM)',
        convergenceCriteria: '1e-6',
        iterations: 1000,
      },
      meshStudy: {
        description: 'Pending mesh generation.',
        minOrthogonalQuality: 0,
        maxSkewness: 0,
        maxAspectRatio: 0,
        averageEquisizeSkew: 0,
        recommendation: 'Import CAD geometry and generate mesh to compute quality metrics.',
        meshLevels: [],
      },
      validation: {
        benchmarkSource: '',
        independentVarName: 'X',
        independentVarUnit: '-',
        dependentVarName: 'Y',
        dependentVarUnit: '-',
        rSquared: 0,
        rmse: 0,
        meanAbsoluteErrorPercent: 0,
        scientificDiscussion: '',
        points: [],
      },
      contours: [],
      thesisTables: [],
      supervisorDefensePoints: [],
      workbenchComponents: [
        { id: 'wb_geom', name: '1. Geometry', nameEn: 'Geometry', type: 'Geometry', status: 'Pending', details: 'Awaiting CAD import (.stl / .step)' },
        { id: 'wb_mesh', name: '2. Mesh', nameEn: 'Mesh', type: 'Mesh', status: 'Pending', details: 'Not generated yet' },
        { id: 'wb_eng_data', name: '3. Material', nameEn: 'Material', type: 'Engineering Data', status: 'Up-to-date', details: material.name },
        { id: 'wb_setup', name: '4. Boundary Conditions', nameEn: 'Boundary Conditions', type: 'Setup', status: 'Pending', details: '0 boundaries defined' },
        { id: 'wb_solu', name: '5. Solver', nameEn: 'Solver', type: 'Solution', status: 'Pending', details: solverName },
        { id: 'wb_res', name: '6. Post-Processing', nameEn: 'Results', type: 'Results', status: 'Pending', details: 'Run simulation to compute fields' },
      ],
    };

    onCreateProject(newProject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <form
        onSubmit={handleCreate}
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Create New Simulation Project</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select an active solver domain and initialize a clean workspace
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Project Name */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 block">Project Name</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Pipe_Flow_Analysis or Bracket_Stress_Test"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 text-white focus:outline-none"
            />
          </div>

          {/* Active Solver Domains (Only Real Docker Engines) */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-300 block">Analysis Type (Active Solvers)</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'CFD' as DomainType,
                  title: 'Fluid Flow (CFD)',
                  engine: 'OpenFOAM v2406',
                  icon: <Wind className="w-4 h-4 text-sky-400" />,
                },
                {
                  id: 'FEA' as DomainType,
                  title: 'Structural (FEA)',
                  engine: 'CalculiX v2.21',
                  icon: <Cpu className="w-4 h-4 text-emerald-400" />,
                },
                {
                  id: 'Thermal' as DomainType,
                  title: 'Heat Transfer',
                  engine: 'OpenFOAM CHT',
                  icon: <Flame className="w-4 h-4 text-amber-400" />,
                },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setField(item.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-2.5 ${
                    field === item.id
                      ? 'bg-sky-950/60 border-sky-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {item.icon}
                    {field === item.id && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
                  </div>
                  <div>
                    <div className="font-bold text-xs">{item.title}</div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">{item.engine}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Solver & Base Material Readout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[11px]">
            <div>
              <span className="text-slate-500 block">Assigned Solver:</span>
              <span className="text-sky-400 font-semibold">{solverName}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Default Material:</span>
              <span className="text-slate-200">{MATERIAL_PRESETS[field].name}</span>
            </div>
          </div>

          {/* Optional Notes / Engineer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">Engineer / Lead (Optional)</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Naseer"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 text-white focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300 block">Unit System</label>
              <input
                type="text"
                disabled
                value="SI (m, kg, s, K, Pa)"
                className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 block">Case Description (Optional)</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief notes on geometry dimensions and operating conditions..."
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 text-white focus:outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-sky-950/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Project</span>
          </button>
        </div>
      </form>
    </div>
  );
};