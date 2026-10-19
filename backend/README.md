# ANSYS Engineering WorkBench - Python Backend Architecture
خادم المعالجة الرياضية الحتمية وحل المعادلات الفيزيائية لمنصة أنسيز

## 🛠️ نظرة عامة (Overview)
هذا الخادم الخلفي مصمم بلغة Python لمعالجة الأحمال الحسابية الثقيلة التي تتجاوز قدرة المتصفح:
1. **حل المعادلات الحتمية للإجهاد المرن (FEA)** عبر SciPy Sparse Matrices وقانون هوك وإجهاد فون ميسيس.
2. **حل معادلات جريان الموائع (2D Incompressible Navier-Stokes)** بطريقة إسقاط شورين (Chorin Projection).
3. **قراءة وتحليل ملفات الـ CAD والشبيكات الهندسية** (.step, .stp, .stl, .inp, .mac, .wbpz, .zip).
4. **التواصل المباشر مع محرك ANSYS APDL** بواسطة مكتبة PyMAPDL (`ansys-mapdl-core`).

---

## 🚀 خطوات التثبيت والتشغيل (Quickstart)

### 1. إنشاء البيئة الافتراضية (Virtual Environment)
```bash
# إنشاء بيئة عمل بايثون مستقلة
python -m venv venv

# تفعيل البيئة:
# على أنظمة Windows (PowerShell):
.\venv\Scripts\Activate.ps1

# على أنظمة Linux أو macOS:
source venv/bin/activate
```

### 2. تثبيت الحزم والمكتبات الهندسية
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. تشغيل خادم FastAPI
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- الخادم سيعمل على: `http://localhost:8000`
- توثيق واجهة Swagger التفاعلية: `http://localhost:8000/docs`
- توثيق ReDoc: `http://localhost:8000/redoc`

---

## 📡 المسارات البرمجية المتاحة (API Endpoints)

| المسار | الطريقة | الوصف |
| :--- | :---: | :--- |
| `/` | `GET` | فحص حالة الخادم ومعلومات المحللات الفيزيائية |
| `/api/health` | `GET` | فحص جاهزية المكتبات (NumPy, SciPy, PyMAPDL) |
| `/api/upload-model` | `POST` | رفع وتحليل ملفات CAD والشبيكات واستخراج العقد والعناصر |
| `/api/run-simulation` | `POST` | تنفيذ المحاكاة الفيزيائية وحساب الكونتورات والإجهادات |
| `/api/pymapdl-execute`| `POST` | تنفيذ مباشر لأوامر وسكربتات APDL عبر أنسيز المحلي |

---

## 🧪 اختبار نقطة النهاية (cURL Example)

### محاكاة الإجهادات الإنشائية (FEA):
```bash
curl -X POST "http://localhost:8000/api/run-simulation" \
  -H "Content-Type: application/json" \
  -d '{
    "simulation_type": "FEA",
    "boundary_conditions": {
      "pressure_load_mpa": 15.0,
      "support_constraint": "Fixed Cantilever"
    },
    "material": {
      "name": "Structural Steel 4340",
      "elastic_modulus_gpa": 205.0,
      "poisson_ratio": 0.29,
      "yield_strength_mpa": 470.0
    },
    "mesh": {
      "nx": 40,
      "ny": 15
    }
  }'
```

---

## ☁️ إعدادات الخادم السحابي (400GB Cloud Storage) والترخيص (ANSYS FlexNet)

### 1. تجهيز بيئة السحابة ومساحة التخزين (400GB SSD):
```bash
# إنشاء مجلد العمل السحابي لحفظ ملفات الشبيكة والحلول الضخمة
sudo mkdir -p /data/ansys_workspace
sudo chown -R $USER:$USER /data/ansys_workspace
```

### 2. إعداد ترخيص أنسيز (FlexNet License Client):
قم بإضافة هذه الأسطر إلى ملف `~/.bashrc` على السحابة:
```bash
# توجيه أنسيز إلى خادم التراخيص (استبدل IP برقم خادم الترخيص الفعلي):
export ANSYSLMD_LICENSE_FILE=1055@license_server_ip
export ANSYSLI_SERVERS=2325@license_server_ip

# مسارات حزمة أنسيز المثبتة:
export AWP_ROOT241=/ansys_inc/v241
export PATH=$AWP_ROOT241/ansys/bin:$PATH
```

### 3. تشغيل الخادم السحابي في الخلفية (Production Daemon):
```bash
# تشغيل الخادم بواسطة Uvicorn أو Gunicorn لدعم الطلبات المتعددة:
nohup uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4 > /data/ansys_workspace/backend.log 2>&1 &
```

### 4. ربط المنصة بالسحابة:
من واجهة المنصة، اضغط على زر **"السحابة والترخيص (400GB)"** في الشريط العلوي:
1. أدخل رابط السيرفر السحابي: `http://<YOUR_CLOUD_IP>:8000`
2. اضغط **"فحص الاتصال والزمن"** للتأكد من وصول واجهة المتصفح إلى السحابة.
3. اضغط **"فحص الاتصال بخادم الترخيص"** للتحقق من جاهزية FlexNet Port 1055.
4. اضغط **"حفظ وتطبيق الإعدادات السحابية"**.

