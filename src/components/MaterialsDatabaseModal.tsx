import React, { useState } from 'react';
import {
  X,
  Database,
  Search,
  CheckCircle2,
  Atom,
  Flame,
  Wind,
  Cpu,
  Check,
  Layers,
  Sparkles,
} from 'lucide-react';
import { MaterialProperties } from '../types/thesis';

export interface MaterialLibraryItem {
  id: string;
  name: string;
  nameEn: string;
  category: 'Metals & Alloys' | 'Fluids & Gases' | 'Thermal & Phase Change' | 'Composites & Advanced';
  properties: MaterialProperties;
  description: string;
  applications: string;
}

export const PRESET_MATERIALS_LIBRARY: MaterialLibraryItem[] = [
  {
    id: 'mat_steel_a36',
    name: 'فولاذ إنشائي قياسي (Structural Steel ASTM A36)',
    nameEn: 'Structural Steel ASTM A36',
    category: 'Metals & Alloys',
    description: 'فولاذ كربوني إنشائي شائع الاستخدام في الجواسر والأبنية والمياكل الهندسية.',
    applications: 'الجوائز الكابولية، الأسطوانات الهيكلية، الهياكل المعدنية',
    properties: {
      name: 'فولاذ إنشائي قياسي (ASTM A36)',
      phaseOrType: 'Solid',
      density: '7850 kg/m³',
      elasticModulus: '200 GPa (200,000 MPa)',
      poissonRatio: '0.26',
      yieldStrength: '250 MPa (36 ksi)',
      thermalConductivity: '52 W/(m·K)',
      specificHeat: '434 J/(kg·K)',
    },
  },
  {
    id: 'mat_steel_a992',
    name: 'فولاذ عالي المقاومة (ASTM A992 High-Strength Steel)',
    nameEn: 'ASTM A992 High-Strength Structural Steel',
    category: 'Metals & Alloys',
    description: 'فولاذ سبائكي منخفض العناصر ذو خضوع مرتفع مخصص للمقاطع الإنشائية الثقيلة (I-Beams).',
    applications: 'الأطقم الإنشائية، جسور الرافعة، الهياكل المجهدة',
    properties: {
      name: 'فولاذ إنشائي عالي المقاومة (ASTM A992)',
      phaseOrType: 'Solid',
      density: '7850 kg/m³',
      elasticModulus: '205 GPa',
      poissonRatio: '0.30',
      yieldStrength: '345 MPa (50 ksi)',
      thermalConductivity: '48 W/(m·K)',
      specificHeat: '460 J/(kg·K)',
    },
  },
  {
    id: 'mat_aluminum_6061',
    name: 'سبائك ألمنيوم معالجة (Aluminum Alloy 6061-T6)',
    nameEn: 'Aluminum Alloy 6061-T6',
    category: 'Metals & Alloys',
    description: 'سبائك ألمنيوم حرارية خفيفة الوزن ومقاومة للتآكل عالية التوصيلية.',
    applications: 'هياكل الطائرات، المبددات الحرارية، العينات الطبية والفضائية',
    properties: {
      name: 'سبائك ألمنيوم (Aluminum 6061-T6)',
      phaseOrType: 'Solid',
      density: '2700 kg/m³',
      elasticModulus: '68.9 GPa',
      poissonRatio: '0.33',
      yieldStrength: '276 MPa',
      thermalConductivity: '167 W/(m·K)',
      specificHeat: '896 J/(kg·K)',
    },
  },
  {
    id: 'mat_titanium_gr5',
    name: 'سبائك تيتانيوم فضائية (Titanium Grade 5 Ti-6Al-4V)',
    nameEn: 'Titanium Grade 5 (Ti-6Al-4V)',
    category: 'Metals & Alloys',
    description: 'سبائك تيتانيوم فائقة الصلابة مع نسبة قوة إلى وزن عالية ومقاومة للحرارة.',
    applications: 'شفرات المحركات التوربينية، أجزاء الطيران، الأجهزة الطبية',
    properties: {
      name: 'تيتانيوم فضائي (Ti-6Al-4V Grade 5)',
      phaseOrType: 'Solid',
      density: '4430 kg/m³',
      elasticModulus: '113.8 GPa',
      poissonRatio: '0.342',
      yieldStrength: '880 MPa',
      thermalConductivity: '6.7 W/(m·K)',
      specificHeat: '526 J/(kg·K)',
    },
  },
  {
    id: 'mat_air_standard',
    name: 'الهواء الجوي القياسي (Standard Air at 20°C)',
    nameEn: 'Standard Air at 20°C',
    category: 'Fluids & Gases',
    description: 'مائع غازي نيوتوني قياسي للجريان الخارجي حول الأجنحة والقنوات الهوائية.',
    applications: 'ديناميكا الهواء الخارجية (NACA Airfoils)، الأنفاق الهوائية، التبريد بالحمل',
    properties: {
      name: 'الهواء الجوي القياسي (Air at 20°C)',
      phaseOrType: 'Fluid',
      density: '1.225 kg/m³',
      viscosity: '1.789e-5 Pa·s',
      thermalConductivity: '0.0257 W/(m·K)',
      specificHeat: '1006.43 J/(kg·K)',
    },
  },
  {
    id: 'mat_water_liquid',
    name: 'الماء السائل القياسي (Liquid Water at 20°C)',
    nameEn: 'Liquid Water at 20°C',
    category: 'Fluids & Gases',
    description: 'مائع غير منضغط ذو سعة حرارية عالية للجريان المائي والأنظمة الهيدروليكية.',
    applications: 'المبادلات الحرارية، الأنابيب المائية، المبردات الصناعية',
    properties: {
      name: 'الماء السائل (Water Liquid at 20°C)',
      phaseOrType: 'Fluid',
      density: '998.2 kg/m³',
      viscosity: '0.001003 Pa·s',
      thermalConductivity: '0.598 W/(m·K)',
      specificHeat: '4182 J/(kg·K)',
    },
  },
  {
    id: 'mat_rt50_nepcm',
    name: 'مادة تغير طور معززة بالنانو (RT50 PCM + 3 vol.% Al2O3 NePCM)',
    nameEn: 'RT50 Organic PCM + 3 vol.% Al2O3 Nano-Enhanced',
    category: 'Thermal & Phase Change',
    description: 'مركب تخزين حرارة كامنة عالي الأداء مع تعزيز التوصيلية بجسيمات نانو الألومينا.',
    applications: 'وحدات LHTES، تخزين الطاقة الشمسية، التبريد السلبي للإلكترونيات',
    properties: {
      name: 'مادة RT50 PCM + 3 vol.% Al2O3 NePCM',
      phaseOrType: 'Composite',
      density: '866 kg/m³ (Liquid) / 940 kg/m³ (Solid)',
      viscosity: '0.0245 Pa·s',
      thermalConductivity: '0.245 W/(m·K)',
      specificHeat: '2400 J/(kg·K)',
      yieldStrength: 'Latent Heat = 144.9 kJ/kg | T_melt = 321 - 325 K',
    },
  },
  {
    id: 'mat_carbon_fiber',
    name: 'مركب ألياف الكربون (Carbon Fiber Epoxy Composite)',
    nameEn: 'Carbon Fiber Reinforced Polymer (CFRP)',
    category: 'Composites & Advanced',
    description: 'مادة مركية فائقة الخفة ومتعددة الاتجاهات (Orthotropic) عالية المتانة الإنشائية.',
    applications: 'أجنحة طائرات الحديثة، سيارات السباق، أوعية الضغط الفائقة',
    properties: {
      name: 'ألياف الكربون المدمجة (CFRP Composite)',
      phaseOrType: 'Composite',
      density: '1550 kg/m³',
      elasticModulus: '135 GPa (Fiber Direction)',
      poissonRatio: '0.27',
      yieldStrength: '1500 MPa (Tensile Strength)',
      thermalConductivity: '5.0 W/(m·K)',
      specificHeat: '1130 J/(kg·K)',
    },
  },
];

interface MaterialsDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMaterial: (material: MaterialProperties) => void;
  currentMaterialName?: string;
}

export const MaterialsDatabaseModal: React.FC<MaterialsDatabaseModalProps> = ({
  isOpen,
  onClose,
  onSelectMaterial,
  currentMaterialName,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [appliedToast, setAppliedToast] = useState<string | null>(null);

  if (!isOpen) return null;

  const categories = [
    { id: 'all', label: 'كافة المواد' },
    { id: 'Metals & Alloys', label: 'المعادن والسبائك الإنشائية' },
    { id: 'Fluids & Gases', label: 'الموائع والغازات (CFD)' },
    { id: 'Thermal & Phase Change', label: 'مواد التبريد وتغير الطور (Thermal/PCM)' },
    { id: 'Composites & Advanced', label: 'المواد المركبة والمتقدمة' },
  ];

  const filteredMaterials = PRESET_MATERIALS_LIBRARY.filter((mat) => {
    const matchesSearch =
      mat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mat.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mat.applications.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCat = activeCategory === 'all' || mat.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  const handleApply = (mat: MaterialLibraryItem) => {
    onSelectMaterial(mat.properties);
    setAppliedToast(`تم اعتماد المادة (${mat.name}) للمشروع الحالي بنجاح!`);
    setTimeout(() => {
      setAppliedToast(null);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shadow-lg shadow-amber-950/50">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                  مكتبة المواد الهندسية المعيارية القياسية (Materials Database)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  ANSYS / ASME Verified
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                اختر واعتماد أي مادة هندسية بضغطة زر واحدة لتحديث الخواص الفيزيائية والحرارية لمشروعك النشط
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3.5 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم المادة أو الاستخدام الهندسي..."
              className="w-full pr-10 pl-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeCategory === cat.id
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-750 text-slate-400 hover:text-slate-200 border border-slate-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Materials Cards List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {appliedToast && (
            <div className="p-3.5 rounded-2xl bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{appliedToast}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMaterials.map((item) => {
              const isCurrent = currentMaterialName === item.properties.name || currentMaterialName === item.name;
              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 relative overflow-hidden ${
                    isCurrent
                      ? 'bg-amber-950/30 border-amber-500/60 shadow-lg shadow-amber-950/20'
                      : 'bg-slate-950/70 hover:bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-slate-800 text-amber-400 border border-slate-700">
                        {item.category}
                      </span>
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-emerald-400 font-bold text-[10px] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>المادة المعتمدة حالياً</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="font-bold text-sm text-slate-100">{item.name}</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    </div>

                    {/* Properties Matrix */}
                    <div className="grid grid-cols-2 gap-1.5 p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/80 text-[11px] font-mono">
                      <div>
                        <span className="text-slate-500 block">الكثافة (ρ):</span>
                        <span className="text-slate-200 font-bold">{item.properties.density}</span>
                      </div>
                      {item.properties.viscosity && (
                        <div>
                          <span className="text-slate-500 block">اللزوجة (μ):</span>
                          <span className="text-sky-400 font-bold">{item.properties.viscosity}</span>
                        </div>
                      )}
                      {item.properties.elasticModulus && (
                        <div>
                          <span className="text-slate-500 block">معامل يونغ (E):</span>
                          <span className="text-emerald-400 font-bold">{item.properties.elasticModulus}</span>
                        </div>
                      )}
                      {item.properties.yieldStrength && (
                        <div>
                          <span className="text-slate-500 block">إجهاد الخضوع (Sy):</span>
                          <span className="text-rose-400 font-bold">{item.properties.yieldStrength}</span>
                        </div>
                      )}
                      {item.properties.thermalConductivity && (
                        <div>
                          <span className="text-slate-500 block">التوصيلية (k):</span>
                          <span className="text-amber-400 font-bold">{item.properties.thermalConductivity}</span>
                        </div>
                      )}
                      {item.properties.specificHeat && (
                        <div>
                          <span className="text-slate-500 block">الحرارة النوعية (Cp):</span>
                          <span className="text-indigo-400 font-bold">{item.properties.specificHeat}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 truncate max-w-[200px]">
                      التطبيقات: {item.applications}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleApply(item)}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md shadow-amber-950/40 flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>تطبيق هذه المادة</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
