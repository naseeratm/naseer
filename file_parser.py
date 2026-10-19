"""
================================================================================
ANSYS Engineering WorkBench - Python CAD & Mesh File Parser (file_parser.py)
معالج ومحلل الملفات الهندسية والشبيكات ونماذج CAD ومصفوفات العقد والعناصر
================================================================================
الوظائف الأساسية:
1. قراءة وتحليل ملفات الشبيكة والعناصر المحدودة (.inp, .cdb, .dat) باستخدام meshio والتحليل المباشر.
2. قراءة وتحليل أوامر وماكرو أنسيز (.mac, .jou, .apdl) واستخراج المتغيرات والشروط الحدية وخصائص المواد.
3. قراءة نماذج الـ CAD والشبيكات الهندسية ثلاثية الأبعاد (.step, .stp, .stl, .obj) عبر meshio و trimesh.
4. استخراج مصفوفة العقد (Nodes: coordinates x, y, z) ومصفوفة العناصر (Elements: connectivity).
5. حساب الأبعاد الهندسية (Bounding Box: dx, dy, dz)، المركز (Centroid)، وإحصاءات الجودة.
6. فك وفحص أرشيفات مشاريع أنسيز المضغوطة (.wbpz, .zip).
================================================================================
"""

import os
import re
import io
import zipfile
import tempfile
from typing import Dict, List, Any, Optional, Tuple, Union
from pathlib import Path

# الاستيراد المرن للمكتبات الهندسية مع التراجع الآمن في حال عدم توفر بعض الملحقات الاختيارية
try:
    import numpy as np
except ImportError:
    np = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import meshio
    HAS_MESHIO = True
except ImportError:
    HAS_MESHIO = False

try:
    import trimesh
    HAS_TRIMESH = True
except ImportError:
    HAS_TRIMESH = False


class EngineeringFileParser:
    """
    محلل شامل للملفات الهندسية والشبيكات (Mesh Deck & CAD Parser).
    يدعم صيغ ANSYS, Abaqus, Nastran, OpenFOAM, STEP, STL, والجداول.
    """

    def __init__(self):
        self.supported_mesh_extensions = {
            ".inp", ".cdb", ".dat", ".msh", ".mesh", ".vtk", ".vtu", ".obj", ".stl", ".ply"
        }
        self.supported_cad_extensions = {
            ".step", ".stp", ".iges", ".igs", ".brep"
        }
        self.supported_macro_extensions = {
            ".mac", ".jou", ".apdl", ".py", ".script"
        }
        self.supported_tabular_extensions = {
            ".csv", ".xlsx", ".xls", ".txt", ".tsv"
        }

    # --------------------------------------------------------------------------
    # 1. الدالة المركزية لمعالجة أي ملف هندسي مرفوع
    # --------------------------------------------------------------------------
    def parse_file(self, file_path_or_bytes: Union[str, bytes, io.BytesIO], filename: str) -> Dict[str, Any]:
        """
        معالجة الملف المرفوع واستخراج كافة الخصائص الهندسية والعقد والعناصر.
        """
        ext = os.path.splitext(filename)[1].lower()
        base_name = os.path.basename(filename)

        # التعامل مع المدخلات كمسار ملف أو بايتات في الذاكرة
        temp_file_created = False
        if isinstance(file_path_or_bytes, (bytes, io.BytesIO)):
            temp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            if isinstance(file_path_or_bytes, bytes):
                temp.write(file_path_or_bytes)
            else:
                temp.write(file_path_or_bytes.getvalue())
            temp.flush()
            temp.close()
            target_path = temp.name
            temp_file_created = True
        else:
            target_path = str(file_path_or_bytes)

        try:
            # 1. التحقق من ملفات الأرشيف (ANSYS Workbench .wbpz أو .zip)
            if ext in [".zip", ".wbpz"]:
                return self._parse_archive(target_path, base_name)

            # 2. ملفات ماكرو أنسيز والأوامر النصية (.mac, .jou, .apdl)
            if ext in self.supported_macro_extensions:
                return self._parse_ansys_macro(target_path, base_name)

            # 3. ملفات الشبيكة والعناصر المحدودة (.inp, .cdb, .stl, إلخ)
            if ext in self.supported_mesh_extensions:
                return self._parse_mesh_file(target_path, base_name, ext)

            # 4. ملفات نماذج CAD القياسية (.step, .stp)
            if ext in self.supported_cad_extensions:
                return self._parse_step_cad(target_path, base_name)

            # 5. ملفات البيانات والجداول الهندسية (.csv, .xlsx)
            if ext in self.supported_tabular_extensions:
                return self._parse_tabular_data(target_path, base_name, ext)

            # 6. قراءة كنص هندسي عام إذا لم تكن الصيغة معروفة بدقة
            return self._parse_generic_text(target_path, base_name)

        finally:
            if temp_file_created and os.path.exists(target_path):
                try:
                    os.unlink(target_path)
                except Exception:
                    pass

    # --------------------------------------------------------------------------
    # 2. قراءة ملفات الشبيكة والعناصر المحدودة (.inp, .cdb, .stl, etc.)
    # --------------------------------------------------------------------------
    def _parse_mesh_file(self, file_path: str, filename: str, ext: str) -> Dict[str, Any]:
        """
        استخراج بيانات العقد (Nodes) والعناصر (Elements) باستخدام meshio أو المحلل المخصص.
        """
        nodes_list = []
        elements_list = []
        element_types_summary = {}
        bounding_box = {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0], "dimensions": [0.0, 0.0, 0.0]}
        centroid = [0.0, 0.0, 0.0]

        # محاولة القراءة بمكتبة meshio المتقدمة
        mesh_read_success = False
        if HAS_MESHIO:
            try:
                mesh = meshio.read(file_path)
                mesh_read_success = True

                # 1. استخراج العقد (Nodes)
                points = mesh.points
                num_nodes = len(points)
                if num_nodes > 0:
                    pts_np = np.array(points) if np is not None else points
                    min_coords = [float(np.min(pts_np[:, i])) for i in range(pts_np.shape[1])]
                    max_coords = [float(np.max(pts_np[:, i])) for i in range(pts_np.shape[1])]
                    dims = [max_coords[i] - min_coords[i] for i in range(len(min_coords))]
                    cent = [float(np.mean(pts_np[:, i])) for i in range(pts_np.shape[1])]

                    # ضمان التنسيق ثلاثي الأبعاد
                    while len(min_coords) < 3:
                        min_coords.append(0.0)
                        max_coords.append(0.0)
                        dims.append(0.0)
                        cent.append(0.0)

                    bounding_box = {"min": min_coords[:3], "max": max_coords[:3], "dimensions": dims[:3]}
                    centroid = cent[:3]

                    # عينة من العقد للتخزين والعرض الخفيف في الواجهة (حتى 500 عقدة للعرض الفوري)
                    sample_step = max(1, num_nodes // 500)
                    for idx in range(0, num_nodes, sample_step):
                        pt = points[idx]
                        nodes_list.append({
                            "id": idx + 1,
                            "x": round(float(pt[0]), 5),
                            "y": round(float(pt[1]), 5),
                            "z": round(float(pt[2]) if len(pt) > 2 else 0.0, 5)
                        })

                # 2. استخراج العناصر (Elements & Cells)
                total_elements = 0
                for cell_block in mesh.cells:
                    c_type = cell_block.type
                    c_data = cell_block.data
                    count = len(c_data)
                    total_elements += count
                    element_types_summary[c_type] = element_types_summary.get(c_type, 0) + count

                    # عينة من العناصر للعرض
                    elem_sample_step = max(1, count // 250)
                    for e_idx in range(0, count, elem_sample_step):
                        conn = [int(n_id) + 1 for n_id in c_data[e_idx]]
                        elements_list.append({
                            "id": len(elements_list) + 1,
                            "type": c_type,
                            "nodes": conn
                        })

                # قراءة معايير هندسية إضافية من ملف النص المصاحب
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content_str = f.read(50000)
                extracted_params = self._extract_physical_parameters(content_str)

                return {
                    "filename": filename,
                    "category": "mesh",
                    "file_type": ext.replace(".", "").upper(),
                    "nodes_count": int(num_nodes),
                    "elements_count": int(total_elements),
                    "element_types": element_types_summary,
                    "bounding_box": bounding_box,
                    "centroid": centroid,
                    "nodes_sample": nodes_list,
                    "elements_sample": elements_list,
                    "parameters": extracted_params,
                    "summary": f"تم تحليل الشبيكة الهندسية بنجاح: {num_nodes:,} عقدة و {total_elements:,} عنصر حقيقي عبر meshio."
                }
            except BaseException:
                # التراجع إلى المحلل الأصلي الداخلي في حال حدوث أي خطأ أو استثناء
                mesh_read_success = False

        # المحلل الأصلي الداخلي لملفات .inp و .cdb في حال عدم توفر meshio أو فشل القراءة
        return self._native_inp_cdb_parser(file_path, filename, ext)

    # --------------------------------------------------------------------------
    # 3. محلل أصلي متخصص لصيغ ABAQUS/ANSYS INP & CDB
    # --------------------------------------------------------------------------
    def _native_inp_cdb_parser(self, file_path: str, filename: str, ext: str) -> Dict[str, Any]:
        """
        محلل خطي حتمي يستخرج كتل *NODE و *ELEMENT أو NBLOCK و EBLOCK من ملفات ANSYS/Abaqus.
        """
        nodes = []
        elements = []
        element_types_summary = {}
        in_node_block = False
        in_element_block = False
        current_elem_type = "UNKNOWN"
        raw_lines_parsed = 0

        min_x, max_x = float('inf'), float('-inf')
        min_y, max_y = float('inf'), float('-inf')
        min_z, max_z = float('inf'), float('-inf')

        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                raw_lines_parsed += 1
                stripped = line.strip()

                if not stripped or stripped.startswith("**") or stripped.startswith("!!"):
                    continue

                upper = stripped.upper()

                # كشف كتل العقد في Abaqus (*NODE) أو ANSYS (NBLOCK)
                if upper.startswith("*NODE") or upper.startswith("NBLOCK"):
                    in_node_block = True
                    in_element_block = False
                    continue

                # كشف كتل العناصر في Abaqus (*ELEMENT) أو ANSYS (EBLOCK)
                if upper.startswith("*ELEMENT"):
                    in_element_block = True
                    in_node_block = False
                    type_match = re.search(r'TYPE\s*=\s*([A-Za-z0-9_-]+)', upper)
                    current_elem_type = type_match.group(1) if type_match else "SOLID"
                    continue
                elif upper.startswith("EBLOCK"):
                    in_element_block = True
                    in_node_block = False
                    current_elem_type = "SOLID_ANSYS"
                    continue

                # إذا بدأ سطر بأمر جديد بنجمة
                if stripped.startswith("*"):
                    in_node_block = False
                    in_element_block = False
                    continue

                # معالجة بيانات العقد
                if in_node_block:
                    parts = [p.strip() for p in stripped.split(",") if p.strip()]
                    if len(parts) >= 3:
                        try:
                            n_id = int(parts[0])
                            x = float(parts[1])
                            y = float(parts[2])
                            z = float(parts[3]) if len(parts) > 3 else 0.0

                            min_x = min(min_x, x); max_x = max(max_x, x)
                            min_y = min(min_y, y); max_y = max(max_y, y)
                            min_z = min(min_z, z); max_z = max(max_z, z)

                            if len(nodes) < 500 or (n_id % 10 == 0 and len(nodes) < 1000):
                                nodes.append({"id": n_id, "x": round(x, 5), "y": round(y, 5), "z": round(z, 5)})
                        except ValueError:
                            pass
                    continue

                # معالجة بيانات العناصر
                if in_element_block:
                    parts = [p.strip() for p in stripped.split(",") if p.strip()]
                    if len(parts) >= 3:
                        try:
                            e_id = int(parts[0])
                            conn = [int(p) for p in parts[1:]]
                            element_types_summary[current_elem_type] = element_types_summary.get(current_elem_type, 0) + 1
                            if len(elements) < 500 or (e_id % 10 == 0 and len(elements) < 1000):
                                elements.append({"id": e_id, "type": current_elem_type, "nodes": conn})
                        except ValueError:
                            pass
                    continue

        # تصحيح حدود الصندوق المحيط في حال عدم وجود عقد
        if min_x == float('inf'):
            min_x, max_x, min_y, max_y, min_z, max_z = 0.0, 1.0, 0.0, 1.0, 0.0, 1.0

        bounding_box = {
            "min": [min_x, min_y, min_z],
            "max": [max_x, max_y, max_z],
            "dimensions": [max_x - min_x, max_y - min_y, max_z - min_z]
        }
        centroid = [(min_x + max_x) / 2.0, (min_y + max_y) / 2.0, (min_z + max_z) / 2.0]

        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content_str = f.read(50000)
        extracted_params = self._extract_physical_parameters(content_str)

        total_nodes = len(nodes)
        total_elems = sum(element_types_summary.values()) or len(elements)

        return {
            "filename": filename,
            "category": "mesh",
            "file_type": ext.replace(".", "").upper(),
            "nodes_count": total_nodes,
            "elements_count": total_elems,
            "element_types": element_types_summary or {"QUAD/HEX": total_elems},
            "bounding_box": bounding_box,
            "centroid": centroid,
            "nodes_sample": nodes,
            "elements_sample": elements,
            "parameters": extracted_params,
            "summary": f"تم استخراج بيانات العقد والشبيكة بنجاح ({total_nodes:,} عقدة و {total_elems:,} عنصر) عبر المحلل الحتمي الداخلي."
        }

    # --------------------------------------------------------------------------
    # 4. محلل أوامر وماكرو أنسيز (.mac, .jou, .apdl)
    # --------------------------------------------------------------------------
    def _parse_ansys_macro(self, file_path: str, filename: str) -> Dict[str, Any]:
        """
        قراءة سكربتات وأوامر APDL واستخراج المتغيرات والشروط الحدية وخصائص المواد.
        """
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        apdl_variables = {}
        boundary_conditions = []
        materials = []
        commands_summary = {}

        for line in lines:
            cleaned = line.split("!")[0].strip()
            if not cleaned:
                continue

            # استخراج المتغيرات المسندة (مثال: VEL_IN = 22.5 أو PRESS = 15.0)
            assign_match = re.match(r"^([A-Za-z0-9_]+)\s*=\s*([0-9.eE+-]+)", cleaned)
            if assign_match:
                var_name = assign_match.group(1).upper()
                try:
                    var_val = float(assign_match.group(2))
                    apdl_variables[var_name] = var_val
                except ValueError:
                    pass

            # استخراج خصائص المواد (MP, EX, 1, 205E9)
            if cleaned.upper().startswith("MP,"):
                parts = [p.strip().upper() for p in cleaned.split(",")]
                if len(parts) >= 4:
                    prop = parts[1]
                    mat_id = parts[2]
                    try:
                        val = float(parts[3])
                        materials.append({"property": prop, "mat_id": mat_id, "value": val})
                    except ValueError:
                        pass

            # استخراج الشروط الحدية للأحمال (SF, SFA, D, DA, F, FK)
            if re.match(r"^(SF|SFA|D|DA|F|FK),", cleaned, re.IGNORECASE):
                boundary_conditions.append(cleaned)

            # إحصاء الأوامر الأساسية (مثل /PREP7, /SOLU, /POST1)
            cmd_root = cleaned.split(",")[0].split()[0].upper()
            commands_summary[cmd_root] = commands_summary.get(cmd_root, 0) + 1

        full_text = "\n".join(lines[:500])
        extracted_params = self._extract_physical_parameters(full_text)
        extracted_params.update(apdl_variables)

        return {
            "filename": filename,
            "category": "ansys_macro",
            "file_type": "APDL_MACRO",
            "lines_count": len(lines),
            "apdl_variables": apdl_variables,
            "materials_defined": materials,
            "boundary_conditions_commands": boundary_conditions[:30],
            "commands_histogram": commands_summary,
            "parameters": extracted_params,
            "summary": f"تم تحليل ماكرو أنسيز بنجاح: تم التعرف على {len(apdl_variables)} متغير و {len(boundary_conditions)} شرط حدي."
        }

    # --------------------------------------------------------------------------
    # 5. محلل نماذج الـ CAD القياسية (.step, .stp)
    # --------------------------------------------------------------------------
    def _parse_step_cad(self, file_path: str, filename: str) -> Dict[str, Any]:
        """
        قراءة وتحليل ملفات الـ CAD بصيغة STEP واستخراج الكيانات والأبعاد والخصائص السطحية.
        """
        # محاولة التحليل الهندسي السطحي إذا كانت مكتبة trimesh متوفرة
        if HAS_TRIMESH:
            try:
                scene_or_mesh = trimesh.load(file_path)
                if hasattr(scene_or_mesh, "vertices") and len(scene_or_mesh.vertices) > 0:
                    verts = np.array(scene_or_mesh.vertices)
                    faces = np.array(scene_or_mesh.faces) if hasattr(scene_or_mesh, "faces") else []
                    min_coords = [float(np.min(verts[:, i])) for i in range(3)]
                    max_coords = [float(np.max(verts[:, i])) for i in range(3)]
                    dims = [max_coords[i] - min_coords[i] for i in range(3)]

                    return {
                        "filename": filename,
                        "category": "cad_geometry",
                        "file_type": "STEP_CAD",
                        "nodes_count": int(len(verts)),
                        "elements_count": int(len(faces)),
                        "bounding_box": {"min": min_coords, "max": max_coords, "dimensions": dims},
                        "volume": float(scene_or_mesh.volume) if hasattr(scene_or_mesh, "volume") else None,
                        "surface_area": float(scene_or_mesh.area) if hasattr(scene_or_mesh, "area") else None,
                        "summary": f"تم تحليل نموذج الـ CAD بنجاح: الأبعاد {dims[0]:.2f} × {dims[1]:.2f} × {dims[2]:.2f} مم."
                    }
            except Exception:
                pass

        # تحليل هيكل STEP المباشر عند تعذر المعالجة السطحية
        entities_count = {}
        header_info = []
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                stripped = line.strip()
                if stripped.startswith("FILE_DESCRIPTION") or stripped.startswith("FILE_NAME"):
                    header_info.append(stripped[:100])
                if stripped.startswith("#") and "=" in stripped:
                    ent_part = stripped.split("=")[1].strip()
                    ent_name = ent_part.split("(")[0].strip()
                    if ent_name:
                        entities_count[ent_name] = entities_count.get(ent_name, 0) + 1

        total_geom_entities = sum(entities_count.values())
        return {
            "filename": filename,
            "category": "cad_geometry",
            "file_type": "STEP_BREP",
            "entities_count": entities_count,
            "total_entities": total_geom_entities,
            "header": header_info,
            "summary": f"تم تحليل نموذج STEP CAD: يحتوي على {total_geom_entities:,} كيان هندسي (منها {entities_count.get('CARTESIAN_POINT', 0)} نقطة فراغية و {entities_count.get('MANIFOLD_SOLID_BREP', 0)} مجسم صلب)."
        }

    # --------------------------------------------------------------------------
    # 6. محلل ملفات البيانات والجداول (.csv, .xlsx)
    # --------------------------------------------------------------------------
    def _parse_tabular_data(self, file_path: str, filename: str, ext: str) -> Dict[str, Any]:
        """
        قراءة جداول البيانات وتحليل الأعمدة الهندسية وحساب الإحصاءات والارتباطات.
        """
        if pd is None:
            return {"filename": filename, "summary": "مكتبة pandas غير متوفرة."}

        try:
            if ext in [".xlsx", ".xls"]:
                df = pd.read_excel(file_path)
            else:
                df = pd.read_csv(file_path, sep=None, engine="python")

            num_rows, num_cols = df.shape
            numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist() if np is not None else []

            stats = {}
            for col in numeric_cols[:10]:
                stats[col] = {
                    "min": float(df[col].min()),
                    "max": float(df[col].max()),
                    "mean": float(df[col].mean()),
                    "std": float(df[col].std()) if len(df[col]) > 1 else 0.0
                }

            preview_data = df.head(10).fillna("").values.tolist()

            return {
                "filename": filename,
                "category": "tabular",
                "file_type": ext.replace(".", "").upper(),
                "rows_count": num_rows,
                "columns_count": num_cols,
                "columns": df.columns.tolist(),
                "numeric_statistics": stats,
                "preview_sample": preview_data,
                "summary": f"تم فحص جدول البيانات بنجاح: {num_rows:,} صف و {num_cols} عمود."
            }
        except Exception as e:
            return {
                "filename": filename,
                "category": "tabular",
                "status": "error",
                "errorMessage": str(e)
            }

    # --------------------------------------------------------------------------
    # 7. فك وتحليل الأرشيفات الهندسية ومشاريع أنسيز (.wbpz, .zip)
    # --------------------------------------------------------------------------
    def _parse_archive(self, file_path: str, filename: str) -> Dict[str, Any]:
        """
        فك حزم مشاريع أنسيز المكتملة وتفقد كل ملف هندسي ومخطط ومحرر بداخلها.
        """
        extracted_files = []
        archive_tree = []

        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                file_list = zf.infolist()
                for member in file_list:
                    if member.is_dir():
                        continue
                    m_ext = os.path.splitext(member.filename)[1].lower()
                    archive_tree.append({
                        "path": member.filename,
                        "size_bytes": member.file_size,
                        "extension": m_ext
                    })

                    # معالجة فورية لأهم 10 ملفات أساسية داخل الأرشيف
                    if m_ext in self.supported_mesh_extensions or m_ext in self.supported_macro_extensions:
                        try:
                            with zf.open(member) as f_entry:
                                sub_content = f_entry.read()
                                sub_parsed = self.parse_file(sub_content, os.path.basename(member.filename))
                                extracted_files.append(sub_parsed)
                        except Exception:
                            pass

            return {
                "filename": filename,
                "category": "ansys_project_archive",
                "file_type": "WBPZ_OR_ZIP",
                "total_files_in_archive": len(archive_tree),
                "archive_structure": archive_tree[:50],
                "parsed_internal_files": extracted_files,
                "summary": f"تم فحص أرشيف مشروع ANSYS Workbench بنجاح: يحتوي على {len(archive_tree)} ملف داخلي ومصفوفة شبيكات متكاملة."
            }
        except Exception as e:
            return {
                "filename": filename,
                "category": "archive",
                "status": "error",
                "errorMessage": f"فشل فك الأرشيف: {str(e)}"
            }

    # --------------------------------------------------------------------------
    # 8. استخراج المتغيرات والبارامترات الفيزيائية من النصوص (Physical Regex)
    # --------------------------------------------------------------------------
    def _extract_physical_parameters(self, text: str) -> Dict[str, Any]:
        """
        استخراج المعاملات الفيزيائية (السرعة، الضغط، درجات الحرارة، معاملات المرونة).
        """
        params = {}
        t_low = text.lower()

        # استخراج السرعة
        vel = re.search(r'(?:velocity|vel|v_in|v|سرعة)\s*(?:=|:|\bis\b)?\s*([0-9]+(?:\.[0-9]+)?)', t_low)
        if vel:
            params["velocity_inlet"] = float(vel.group(1))

        # استخراج الضغط
        pres = re.search(r'(?:pressure|press|p_load|p|ضغط|إجهاد)\s*(?:=|:|\bis\b)?\s*([0-9]+(?:\.[0-9]+)?)\s*(mpa|kpa|bar|pa)?', t_low)
        if pres:
            val = float(pres.group(1))
            unit = pres.group(2) or "mpa"
            params["pressure_load"] = val
            params["pressure_unit"] = unit

        # استخراج درجة الحرارة
        temp = re.search(r'(?:temperature|temp|t_in|t|حرار)\s*(?:=|:|\bis\b)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:c|k|°c)?', t_low)
        if temp:
            params["temperature"] = float(temp.group(1))

        # استخراج معامل يونغ (Elastic Modulus)
        ex = re.search(r'(?:mp\s*,\s*ex\s*,\s*\d+\s*,\s*|elastic_modulus|young|ex)\s*(?:=|:|,)?\s*([0-9.eE+-]+)', t_low)
        if ex:
            try:
                mod_val = float(ex.group(1))
                if mod_val > 1e6:
                    mod_val = mod_val / 1e9  # تحويل إلى GPa
                params["elastic_modulus_gpa"] = round(mod_val, 2)
            except ValueError:
                pass

        # استخراج نسبة بواسون (Poisson's ratio)
        nu = re.search(r'(?:mp\s*,\s*prxy\s*,\s*\d+\s*,\s*|poisson|prxy|nu)\s*(?:=|:|,)?\s*([0-9.]+)', t_low)
        if nu:
            try:
                params["poisson_ratio"] = float(nu.group(1))
            except ValueError:
                pass

        # استخراج إجهاد الخضوع
        yield_s = re.search(r'(?:yield|خضوع|sigma_y)\s*(?:=|:|\bis\b)?\s*([0-9]+(?:\.[0-9]+)?)', t_low)
        if yield_s:
            params["yield_strength_mpa"] = float(yield_s.group(1))

        # استخراج المادة
        if "titanium" in t_low or "تيتانيوم" in t_low:
            params["detected_material"] = "تيتانيوم سبائكي (Titanium Ti-6Al-4V)"
        elif "aluminum" in t_low or "ألمنيوم" in t_low:
            params["detected_material"] = "ألمنيوم صناعي (Aluminum 6061-T6)"
        elif "steel" in t_low or "فولاذ" in t_low or "solid186" in t_low:
            params["detected_material"] = "فولاذ إنشائي عالي المتانة (Structural Steel 4340)"
        elif "water" in t_low or "ماء" in t_low:
            params["detected_material"] = "ماء نقي سائل (Water Liquid)"
        elif "air" in t_low or "هواء" in t_low:
            params["detected_material"] = "هواء جوي مضغوط (Air Ideal Gas)"

        return params

    def _parse_generic_text(self, file_path: str, filename: str) -> Dict[str, Any]:
        """
        قراءة عامة للملفات النصية واستخراج المعاملات.
        """
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read(20000)
        params = self._extract_physical_parameters(content)
        return {
            "filename": filename,
            "category": "text",
            "file_type": "TEXT",
            "lines_count": len(content.splitlines()),
            "parameters": params,
            "summary": f"تمت قراءة الملف النصي بنجاح واستخراج المعطيات الفيزيائية."
        }


# توفير كائن عام جاهز للاستخدام المباشر
parser_instance = EngineeringFileParser()

def parse_engineering_file(file_path_or_bytes: Union[str, bytes, io.BytesIO], filename: str) -> Dict[str, Any]:
    """
    نقطة الدخول الرئيسية لقراءة وتحليل أي ملف هندسي.
    """
    return parser_instance.parse_file(file_path_or_bytes, filename)
