# خطة التطوير المنفذة وقائمة التشييك خطوة بخطوة (NASEER Universal CAE Studio)

هذا الملف مخصص للمراجعة الميدانية وتشييك كل خطوة في **VS Code** على جهازك المحلي (اللابتوب) مع حاويات **Docker**.

---

## القسم الأول: كيف تعمل حاويات Docker الثلاث في اللابتوب؟ (مهم جداً)

عند تشغيل `docker compose` في مشروعنا، **العدد الصحيح للحاويات هو 3 حاويات فقط** (وليس حاوية منفصلة لكل برنامج محاكاة):

1. **`api` (`Dockerfile.api` — المنفذ `8000`)**: خادم **FastAPI** الذي يستقبل طلبات المنصة من المنفذ `3000` (تشغيل محاكاة، معاينة CAD، تشبيك Gmsh، رفع النماذج، مسح بارامتري، دراسة GCI، إلغاء مهام) ويسجلها في SQLite ويدفعها إلى الطابور.
2. **`worker` (`Dockerfile.worker` — عامل Celery)**: هذه **الحاوية الواحدة** تحتوي بداخلها على جميع المحركات الفيزيائية وأدوات التشبيك مجتمعة:
   - `openfoam` (`simpleFoam`, `pimpleFoam`, `rhoSimpleFoam`, `rhoPimpleFoam`, `buoyantSimpleFoam`, `interFoam`, `blockMesh`, `snappyHexMesh`, `foamToVTK`)
   - `calculix-ccx` (`ccx`)
   - `gmsh` (البرنامج + مكتبة بايثون `gmsh`)
   - `elmerfem-csc` (`ElmerSolver`, `ElmerGrid`)
   - إضافةً إلى `meshio` و`scipy` و`numpy`
3. **`redis` (`redis:7-alpine`)**: وسيط الطابور والنتائج بين `api` و`worker`.

### ماذا تفعل على اللابتوب عند استلام التحديثات الجديدة؟
بعد نقل ملفات المشروع المحدّثة إلى مجلد المشروع في VS Code على اللابتوب، نفّذ الأوامر التالية في **VS Code Terminal**:

```bash
# 1. إيقاف الحاويات القديمة وإعادة بنائها مع الكود المحدث
docker compose down
docker compose up --build -d

# 2. التأكد أن الحاويات الثلاث تعمل (api + worker + redis)
docker compose ps

# 3. التأكد من توفر جميع المحركات الأربع داخل worker
curl http://127.0.0.1:8000/api/health
```

---

## القسم الثاني: خطة التطوير الشاملة المطبّقة (التكافؤ العالمي Ansys / SimScale / PrePoMax)

### الحزمة 1: هندسة الواجهة والشجرة الديناميكية الموحدة (Global CAE UI & Live Simulation Tree)
- [x] **توحيد لغة العمل والمصطلحات الهندسية**: اعتماد الإنجليزية الهندسية الموحدة في شجرة المحاكاة ولوحة الخصائص ولوحة التحكم وفق معايير Ansys Workbench وSimScale.
- [x] **ترقية `SimulationTree.tsx` إلى شجرة ديناميكية حية من 8 محطات**:
  1. `Geometry` (عرض اسم CAD والأبعاد والأسطح المكتشفة).
  2. `Mesh & Sizing` (عرض عدد العناصر ورتبة العنصر وطبقات الطبقة الحدية).
  3. `Physics & Materials` (اسم المادة النشطة ونوع التحليل).
  4. `Boundary Conditions` (قائمة حية قابلة للتوسيع بكل الشروط الحدية المعيّنة وحالتها `Defined / Incomplete` متزامنة بالاتجاهين مع العارض ولوحة الخصائص).
  5. `Contacts & Interfaces` (`Bonded` / `Sliding` / `CHT Interface`).
  6. `Solution Controls` (`Steady / Transient`، الجاذبية، معاملات الاسترخاء، الدقة).
  7. `OmniSolve AI (Copilot)` (المستشار الفيزيائي).
  8. `Results & Post` (تقرير النتائج والتكاملات السطحية).

### الحزمة 2: استيراد ومعاينة CAD وتشبيك Gmsh 3D قبل الحل (Pre-Solve CAD & Mesh Parity)
- [x] **مسار `POST /api/cad-preview` في `main.py` و`universal_dispatcher.py` والربط العكسي في `server.ts`**:
  - يدعم ملفات `.STEP / .STP / .IGES / .IGS / .STL / .INP / .MSH` مباشرة عبر OpenCascade (`gmsh.model.occ.importShapes`) و`meshio` داخل حاوية `worker` ويعيد أسطح التسمية (`patches`) والأبعاد (`dimensions`) وبيانات المعاينة `vtk_data`.
- [x] **ترقية `call_gmsh_mesher` ولوحة `Mesh & Sizing` في `PropertiesPanel.tsx`**:
  - إضافة اختيار **رتبة العنصر (`Element Order`: 1st Linear / 2nd Quadratic)** مع دعم مثلثات النوع 9 ورباعيات النوع 11 في Gmsh.
  - إضافة **طبقات الطبقة الحدية (`Inflation Layers`, `First Layer Height h₀`, `Growth Rate`)** عبر حقول Gmsh (`Distance + Threshold`).
  - زر **"Generate & Preview 3D Mesh"** المباشر في لوحة الخصائص لرسم شبكة Gmsh داخل العارض ثلاثي الأبعاد فوراً قبل تشغيل الحل الفيزيائي.

### الحزمة 3: ضوابط المحللات المتقدمة وبطاقات الفيزياء الحقيقية (OpenFOAM / CalculiX / ElmerFEM)
- [x] **ترقية `call_openfoam_solver`**:
  - دعم **Transient / Steady State** (`pimpleFoam` / `rhoPimpleFoam` / `simpleFoam` مع `time_step` و`end_time`).
  - دعم **الجاذبية الأرضية (`gravity_enabled` / `gravity_y`)** وكتابة `constant/g`.
  - دعم **خطط التفاضل (`discretization_scheme`: `first_order` / `second_order`)** و**عوامل الاسترخاء (`relaxation_p`, `relaxation_u`, `relaxation_t`)** و**هدف المتبقيات (`residual_target`)** وإدخال خواص المائع مباشرة (`fluid_density`, `dynamic_viscosity`).
  - دعم أنواع الشروط الحدية الفرعية المخصصة (`Mass Flow Inlet`, `Pressure Inlet`, `Pressure Outlet`, `Slip Wall`, `Moving Wall`, `Velocity Inlet`, `Heat`).
- [x] **ترقية `call_calculix_solver`**:
  - دعم عدد الأنماط (`modes_count` في `*FREQUENCY` و`*BUCKLE`)، والأحمال المركزة (`force_n` / `pressure_load_mpa`)، ونوع التلامس (`contact_type`: `Bonded` / `Sliding`).
  - دعم الخطوة الزمنية في `Thermal_Transient`، والإشعاع الحقيقي عبر `*PHYSICAL CONSTANTS` + `*RADIATE` في `Thermal_Radiation`، واللاخطية الهندسية `*NLGEOM`.
- [x] **ترقية `call_elmer_solver`**:
  - إضافة التخصصات الكهرومغناطيسية الفرعية (`Electrostatic`, `Magnetostatic`, `EddyCurrent`, `Acoustics`) مع تمرير الموصلية الكهربائية (`electrical_conductivity σ`)، والنفاذية النسبية (`relative_permeability μr`)، والسماحية (`relative_permittivity εr`)، وكثافة التيار (`current_density J`)، والتردد (`frequency_hz`).

### الحزمة 4: أدوات ما بعد المعالجة الثلاثية الأبعاد والتكاملات السطحية (CFD-Post / Mechanical Parity)
- [x] **حساب التكاملات السطحية والحقلية (`integrals`) حقيقياً في بايثون من مخرجات المحللات**:
  - `mass_flow_kg_s`, `pressure_drop_pa`, `max_velocity_mps`, `total_heat_transfer_w` في OpenFOAM.
  - `max_displacement_m`, `max_von_mises_pa`, `avg_von_mises_pa`, `max_reaction_n`, `total_reaction_x/y/z_n`, `heat_flux_w_m2`, `total_heat_transfer_w` في CalculiX.
  - `field_min`, `field_max`, `field_average`, `domain_volume_m3`, `surface_area_m2` في ElmerFEM.
- [x] **أدوات ما بعد المعالجة التفاعلية في `Interactive3DViewport.tsx` و`PropertiesPanel.tsx`**:
  - **مقاطع القطع الثلاثية (`Section Slice Plane`: `Off / X / Y / Z` + منزلق الإزاحة)** عبر `THREE.Plane` وإطار المقطع البصري داخل WebGL.
  - **مرشح العتبة المتساوية (`Iso-Threshold Filter`: `Min% – Max%`)** لتصفية مثلثات الحقل الحراري/السرعة/الإجهاد حياً.
  - **مقياس التشوه الإنشائي (`Deformation Scale`: `0x – 100x`)** المعتمد على متجهات الإزاحة الحقيقية (`vtkData.vectors.displacement`).
  - **عارض التكاملات السطحية (`Integrals HUD` + جدول `Surface & Field Integrals` في `PropertiesPanel`)** لقراءة هبوط الضغط وتدفق الكتلة والقوى الردية والحرارة المنقولة.

### الحزمة 5: التطهير الجذري وإلزامية المحركات الثلاثة ودعم CAD/INP الكامل (Zero-Mock & Multi-Engine Enforcement)
- [x] **تعطيل كافة المحللات البديلة البايثونية**: إيقاف محلل الفروقات المحددة ثنائي الأبعاد في `physics_solver.py` ومحللات `SciPy` / `PyMAPDL` البديلة في `backend/physics_solver.py` و`backend/main.py` وإلزام `server.ts` بتشغيل `main.py` الرئيسي المرتبط بـ `universal_dispatcher.py`.
- [x] **إزالة الحسابات التحليلية الجانبية والثوابت الوهمية من الواجهة**:
  - استبدال حاسبة الإكسيرجي/الحساسية المغلقة في `OverviewTab.tsx` بعارض حقيقي لمخرجات المحركات (`integrals` / `values` على Docker `:8000`) وإزالة `PHD-2026-ENG` و`16 Cores | Double Precision` و`yieldStrengthMpa = 420`.
  - استبدال مولد الشبكة الإجرائي ثنائي الأبعاد في `MeshGenerativeTool.tsx` بربط كامل مع محرك **Gmsh 3D** الحقيقي على `:8000` ومعاينة ثلاثية الأبعاد مباشرة لـ `vtk_data`.
  - ربط `ParametricSweepTool.tsx` بمدخلات المشروع الحية والملف المرفوع (`STEP`/`STL`) ودبابيس الشروط الحدية واستخراج `nusselt_number`.
  - إصلاح قراءة حالة المحركات الحية (`{ available, version }`) في `AuditReportModal.tsx`.
- [x] **دعم ملفات الهندسة `.STEP`/`.STL`/`.IGES` و`.INP` في OpenFOAM و CalculiX و ElmerFEM**:
  - توليد مجموعات فيزيائية متوافقة في `call_gmsh_mesher` وتحديث `OpenFOAM polyMesh` تلقائياً وربط دبابيس الشروط الحدية بالمساحات الهندسية ودعم القنوات المتموجة (`corrugated_channel`) وحساب `nusselt_number` و`heat_transfer_coeff_h`.
  - استخراج كامل البيانات ثلاثية الأبعاد `vtk_data` لملفات `.inp` والملفات الهندسية المرفوعة في `call_calculix_solver` عبر تشبيك `Gmsh`، وربط دبابيس العارض (`boundary_markers`) بعقد التثبيت والأحمال، وإلغاء القيمة الافتراضية للانبعاج (`-1000.0`).
  - ربط دبابيس الشروط الحدية (`boundary_markers`) بحدود `ElmerGrid` الحقيقية في `call_elmer_solver` وإصلاح دراسة استقلالية الشبكة `backend/vv_metrics.py` لدعم CAD عبر `mesh_size`.

### التحقق البرمجي في بيئة التطوير (Zero-Mock Verified)
- [x] تطهير كامل من أي بيانات وهمية أو fallback حسابي أو ثوابت جامدة.
- [x] فحص تجميع بايثون (`python3 -m py_compile`) لكافة ملفات الخادم والمحلل.
- [x] فحص بناء الواجهة والخادم (`npm run build` / `compile_applet`) — Exit 0.
- [x] فحص أنواع TypeScript (`npm run lint` / `lint_applet`) — Exit 0.

---

## القسم الثالث: قائمة التشييك الميدانية على اللابتوب (ضع `[x]` لكل بند عند التجربة)

### أ. فحص البنية التحتية والحاويات (في Terminal)
- [ ] **1. عدد الحاويات وحالتها**: `docker compose ps` يُظهر الثلاث خدمات (`api`, `worker`, `redis`) في وضع `Up / Running`.
- [ ] **2. فحص `/api/health`**: `curl http://127.0.0.1:8000/api/health` يُرجع `ONLINE` وتوفر `openfoam`, `calculix`, `gmsh`, `elmer`.
- [ ] **3. فحص البوابة الوسيطة `:3000`**: `curl http://127.0.0.1:3000/api/cloud/status` يشير إلى `http://127.0.0.1:8000`.

### ب. فحص الواجهة والأزرار والحزم على `http://localhost:3000`
- [ ] **4. استيراد ملف `.STEP` أو `.IGES` أو `.STL` أو `.INP` وتشغيله مباشرة**: يتحقق عبر `/api/cad-preview` وتظهر الأسطح (`Detected CAD Faces`) ويُحل داخل **OpenFOAM** أو **CalculiX** (عبر تشبيك Gmsh) مع إرجاع `vtk_data` ثلاثي الأبعاد كامل.
- [ ] **5. شجرة المحاكاة الديناميكية الحية**: التبديل بين `Geometry` و`Mesh & Sizing` و`Physics & Materials` و`Boundary Conditions` و`Contacts` و`Solution Controls` و`Results & Post` باللغة الإنجليزية الهندسية الموحدة.
- [ ] **6. التشبيك المسبق (`Mesh & Sizing` و`Mesh Generator`)**: ضبط `Element Order = 2` وطبقات `Inflation Layers = 4` والضغط على `Generate Real Gmsh 3D Mesh`، والتأكد من رسم شبكة Gmsh ثلاثية الأبعاد وظهور عدد العقد والعناصر الحقيقي.
- [ ] **7. تحديد الشروط الحدية بالدبابيس والأنواع الفرعية (`Boundary Conditions`)**: النقر على المجسم (`+ Inlet` / `+ Outlet` / `+ Heat` / `+ Wall`) والتأكد من ارتباط إحداثيات الدبوس بأسطح OpenFOAM وعقد CalculiX وحدود ElmerFEM.
- [ ] **8. القنوات المتموجة وحساب رقم نسلت (`Corrugated Duct` & `Nusselt Nu`)**: تشغيل حالة `CHT_Coupled` مع نمط `corrugated_channel` والتأكد من توليد `polyLine` في `blockMeshDict` وظهور `nusselt_number` و`heat_transfer_coeff_h` في لوحة المقاييس والتكاملات.
- [ ] **9. تحليل كهرومغناطيسي فرعي (`ElmerFEM`)**: اختيار `Electromagnetic` ثم تغيير `EM Submode` إلى `Magnetostatic` وتحديد $\sigma$ و$\mu_r$ و$J$ وتشغيل الحل.
- [ ] **10. مقاطع القطع ومقياس التشوه والعزل (`Slice / Post`)**: بعد انتهاء محاكاة `Structural_Static` أو `CFD_Incompressible` أو `CHT_Coupled` (سواء صندوق قياسي أو CAD/INP): تفعيل `Slice Plane` و`Deformation Scale` و`Iso-Threshold Filter`.
- [ ] **11. التكاملات السطحية (`Integrals` + تبويب `Docker Telemetry`)**: التأكد من ظهور `Mass Flow Rate` و`Pressure Drop ΔP` و`Nusselt Nu` أو `Max Von Mises` و`Reaction Forces` من المحرك الفعلي دون أي صيغ جانب عميل.
- [ ] **12. زر الإيقاف (`Cancel`) والمسح البارامتري ودراسة GCI**: التأكد من إلغاء المهام في Celery، وتنفيذ المسح عبر `/api/parametric-sweep` (بمدخلات المشروع الحية والـ CAD)، ودراسة GCI عبر `/api/mesh-study` (للحالات القياسية وCAD).

