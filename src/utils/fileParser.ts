import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { IngestedFileItem } from '../types/thesis';
import { compactEngineeringContent, compactTableDataset } from './tokenCompactor';

export interface ParsedFileResult {
  id: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  category: 'word' | 'excel' | 'image' | 'code' | 'pdf' | 'text' | 'archive';
  content?: string;
  base64Data?: string;
  isImage: boolean;
  isArchive?: boolean;
  parentArchiveName?: string;
  archiveFilesCount?: number;
  archiveTree?: { path: string; size: number; category: string }[];
  parsedLines?: number;
  sheetCount?: number;
  sheetsData?: { sheetName: string; rows: number; columns: number; preview: (string | number)[][] }[];
  summary: string;
  detectedParameters: { key: string; value: string; unit?: string }[];
  detectedDomain?: 'AI/ML' | 'CFD' | 'FEA' | 'Thermal' | 'Control' | 'Multiphysics' | 'Data';
  compactedContent?: string;
  tokenSavingsPercent?: number;
  estimatedTokensSaved?: number;
  status: 'ready' | 'parsed' | 'error';
  errorMessage?: string;
}

/**
 * Check if the file is a compressed archive (.zip, .wbpz ANSYS archive, .tar, .gz, or PK magic header)
 */
function isArchiveFile(file: File, buffer: ArrayBuffer, ext: string): boolean {
  if (['zip', 'wbpz', 'gz', 'tar', 'tgz', '7z', 'rar', 'bz2'].includes(ext)) {
    return true;
  }
  if (file.type.includes('zip') || file.type.includes('compressed') || file.type.includes('archive')) {
    return true;
  }
  if (buffer.byteLength >= 4) {
    const bytes = new Uint8Array(buffer.slice(0, 4));
    // PK\x03\x04 or PK\x05\x06 or PK\x07\x08
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
      return true;
    }
  }
  return false;
}

/**
 * Universal engineering file and compressed archive parser:
 * - Unpacks ZIP and ANSYS Workbench Project Archives (.wbpz, .zip)
 * - Extracts every internal script, CAD journal, and macro (.py, .jou, .mac, .inp, .dat, .cas, .cdb, .m)
 * - Extracts Word documents (.docx, .doc)
 * - Extracts Excel spreadsheets (.xlsx, .xls, .csv)
 * - Extracts schematics & CAD diagrams (.png, .jpg, .jpeg, .svg, .webp)
 * - Extracts engineering PDFs (.pdf)
 */
export async function parseEngineeringFilesOrArchive(file: File): Promise<ParsedFileResult[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const arrayBuffer = await readFileAsArrayBuffer(file);

  // Check if file is a compressed archive (ZIP, ANSYS WBPZ, etc.)
  if (isArchiveFile(file, arrayBuffer, ext)) {
    try {
      const unpackedItems = await parseZipArchive(file, arrayBuffer, ext);
      if (unpackedItems.length > 0) {
        return unpackedItems;
      }
    } catch (zipErr: any) {
      console.warn('Direct zip extraction failed, falling back to binary inspection:', zipErr);
    }
  }

  // Single file handling
  const single = await parseSingleEngineeringFile(file, ext, arrayBuffer);
  return [single];
}

export async function parseEngineeringFile(file: File): Promise<ParsedFileResult> {
  const results = await parseEngineeringFilesOrArchive(file);
  return results[0];
}

/**
 * Decompress and deeply inspect ZIP / ANSYS WBPZ archives
 */
async function parseZipArchive(file: File, arrayBuffer: ArrayBuffer, ext: string): Promise<ParsedFileResult[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const extractedResults: ParsedFileResult[] = [];
  const tree: { path: string; size: number; category: string }[] = [];
  const aggregatedParams: { key: string; value: string; unit?: string }[] = [];
  let totalUncompressedBytes = 0;

  const validEntries = Object.keys(zip.files).filter((relativePath) => {
    const entry = zip.files[relativePath];
    if (entry.dir) return false;
    if (relativePath.includes('__MACOSX') || relativePath.endsWith('.DS_Store')) return false;
    return true;
  });

  for (const relativePath of validEntries) {
    const entry = zip.files[relativePath];
    const pathParts = relativePath.split('/');
    const entryName = pathParts[pathParts.length - 1];
    const subExt = entryName.split('.').pop()?.toLowerCase() || '';

    try {
      // 1. Script, Code, Macro, Mesh, or Data Files (.py, .mac, .jou, .inp, .dat, .cas, .cdb, .m, .txt, .csv, .json, .wbpj, .xml, .c, .cpp, .f, .f90, .log, .msh)
      const isScriptOrText = [
        'py', 'mac', 'jou', 'inp', 'dat', 'cas', 'cdb', 'm', 'txt', 'csv',
        'json', 'wbpj', 'xml', 'c', 'cpp', 'f', 'f90', 'log', 'msh', 'rst'
      ].includes(subExt);

      if (isScriptOrText) {
        const textContent = await entry.async('text');
        totalUncompressedBytes += textContent.length;
        const subCat = ['py', 'mac', 'jou', 'inp', 'cas', 'dat', 'cdb', 'm'].includes(subExt) ? 'code' : 'text';
        tree.push({ path: relativePath, size: textContent.length, category: subCat });

        const lines = textContent.split('\n');
        const subParams: { key: string; value: string; unit?: string }[] = [];
        extractParametersFromText(textContent, subParams);

        // Aggregate parameters
        for (const p of subParams) {
          if (!aggregatedParams.some((ap) => ap.key === p.key && ap.value === p.value)) {
            aggregatedParams.push(p);
          }
        }

        extractedResults.push({
          id: `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `${entryName} [من: ${file.name}]`,
          size: textContent.length,
          extension: subExt,
          mimeType: 'text/plain',
          category: subCat,
          isImage: false,
          parentArchiveName: file.name,
          content: textContent,
          parsedLines: lines.length,
          summary: `ملف سكربت مستخرج من الأرشيف (${file.name}) يحتوي على ${lines.length} سطر برمجي. تم استخلاص أوامره ومعادلاته بنجاح.`,
          detectedParameters: subParams,
          status: 'ready',
        });
        continue;
      }

      // 2. Word Documents (.docx)
      if (subExt === 'docx') {
        const docxBuffer = await entry.async('arraybuffer');
        totalUncompressedBytes += docxBuffer.byteLength;
        tree.push({ path: relativePath, size: docxBuffer.byteLength, category: 'word' });

        const mammothResult = await mammoth.extractRawText({ arrayBuffer: docxBuffer });
        const rawText = mammothResult.value || '';
        const lines = rawText.split('\n').filter((l: string) => l.trim().length > 0);
        const subParams: { key: string; value: string; unit?: string }[] = [];
        extractParametersFromText(rawText, subParams);

        extractedResults.push({
          id: `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `${entryName} [من: ${file.name}]`,
          size: docxBuffer.byteLength,
          extension: subExt,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          category: 'word',
          isImage: false,
          parentArchiveName: file.name,
          content: rawText,
          parsedLines: lines.length,
          summary: `مستند مواصفات تقني وورد مستخرج من الأرشيف يحتوي على ${lines.length} فقرة نصية.`,
          detectedParameters: subParams,
          status: 'ready',
        });
        continue;
      }

      // 3. Excel Spreadsheets (.xlsx, .xls)
      if (['xlsx', 'xls'].includes(subExt)) {
        const xlsxBuffer = await entry.async('arraybuffer');
        totalUncompressedBytes += xlsxBuffer.byteLength;
        tree.push({ path: relativePath, size: xlsxBuffer.byteLength, category: 'excel' });

        const workbook = XLSX.read(xlsxBuffer, { type: 'array' });
        const sheetsData: { sheetName: string; rows: number; columns: number; preview: (string | number)[][] }[] = [];
        let consolidatedText = `=== EXCEL DATASET (FROM ARCHIVE): ${entryName} ===\n`;

        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
          const rows = jsonData.length;
          const cols = jsonData[0] ? (jsonData[0] as any[]).length : 0;
          sheetsData.push({ sheetName, rows, columns: cols, preview: jsonData.slice(0, 8) });
          consolidatedText += `\n[Sheet: ${sheetName}] (${rows} rows x ${cols} cols)\n`;
          consolidatedText += XLSX.utils.sheet_to_csv(sheet).slice(0, 10000) + '\n';
        });

        const subParams: { key: string; value: string; unit?: string }[] = [];
        extractParametersFromText(consolidatedText, subParams);

        extractedResults.push({
          id: `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `${entryName} [من: ${file.name}]`,
          size: xlsxBuffer.byteLength,
          extension: subExt,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          category: 'excel',
          isImage: false,
          parentArchiveName: file.name,
          content: consolidatedText,
          sheetCount: workbook.SheetNames.length,
          sheetsData,
          parsedLines: consolidatedText.split('\n').length,
          summary: `جدول بيانات إكسيل مستخرج من الأرشيف يحتوي على ${workbook.SheetNames.length} أوراق عمل.`,
          detectedParameters: subParams,
          status: 'ready',
        });
        continue;
      }

      // 4. Images (.png, .jpg, .jpeg, .svg, .webp)
      if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'].includes(subExt)) {
        const base64 = await entry.async('base64');
        const mime = subExt === 'svg' ? 'image/svg+xml' : `image/${subExt === 'jpg' ? 'jpeg' : subExt}`;
        const dataUrl = `data:${mime};base64,${base64}`;
        totalUncompressedBytes += base64.length;
        tree.push({ path: relativePath, size: base64.length, category: 'image' });

        extractedResults.push({
          id: `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `${entryName} [من: ${file.name}]`,
          size: base64.length,
          extension: subExt,
          mimeType: mime,
          category: 'image',
          isImage: true,
          parentArchiveName: file.name,
          base64Data: dataUrl,
          summary: `مخطط / صورة هندسية (${subExt.toUpperCase()}) مستخرجة من الأرشيف للتحليل البصري.`,
          detectedParameters: [{ key: 'ملف صورة في الأرشيف', value: entryName }],
          status: 'ready',
        });
        continue;
      }

      // 5. PDF Documents (.pdf)
      if (subExt === 'pdf') {
        const base64 = await entry.async('base64');
        const dataUrl = `data:application/pdf;base64,${base64}`;
        totalUncompressedBytes += base64.length;
        tree.push({ path: relativePath, size: base64.length, category: 'pdf' });

        extractedResults.push({
          id: `arch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `${entryName} [من: ${file.name}]`,
          size: base64.length,
          extension: subExt,
          mimeType: 'application/pdf',
          category: 'pdf',
          isImage: false,
          parentArchiveName: file.name,
          base64Data: dataUrl,
          summary: `وثيقة PDF معتمدة مستخرجة من الأرشيف جاهزة للتحليل الشامل.`,
          detectedParameters: [{ key: 'وثيقة PDF في الأرشيف', value: entryName }],
          status: 'ready',
        });
        continue;
      }

      // Binary / CAD files (STEP, IGES, Parasolid, etc.)
      tree.push({ path: relativePath, size: 0, category: 'cad/binary' });
    } catch (err: any) {
      console.warn('Could not extract file inside zip:', relativePath, err);
    }
  }

  // Master Archive Manifest Card
  const archiveManifest: ParsedFileResult = {
    id: `archive_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: file.name,
    size: file.size,
    extension: ext || 'zip',
    mimeType: file.type || 'application/zip',
    category: 'archive',
    isImage: false,
    isArchive: true,
    archiveFilesCount: extractedResults.length,
    archiveTree: tree,
    summary: `📦 تم فك ضغط الأرشيف الهندسي بنجاح! تم استخراج وقراءة محتويات ${extractedResults.length} ملفات وسكربتات هندسية من أصل ${validEntries.length} عنصراً في الأرشيف (${(totalUncompressedBytes / 1024).toFixed(1)} KB غير مضغوط).`,
    content: `=== محتويات الأرشيف الهندسي المفكوك (${file.name}) ===\n` +
      `نوع الأرشيف: ${ext.toUpperCase() === 'WBPZ' ? 'مشروع أرشيف ANSYS Workbench Project Archive (.wbpz)' : 'أرشيف ملفات هندسية مضغوط (.zip)'}\n` +
      `إجمالي العناصر الداخلية: ${validEntries.length}\n` +
      `الملفات المقروءة والمستخرجة: ${extractedResults.length}\n` +
      `الحجم بعد فك الضغط: ${(totalUncompressedBytes / 1024).toFixed(1)} KB\n\n` +
      `شجرة الملفات الداخلية للأرشيف:\n` +
      tree.map((t) => `  • ${t.path} (${t.size > 0 ? (t.size / 1024).toFixed(1) + ' KB' : 'binary'}) [${t.category}]`).join('\n') +
      `\n\nملخص المعاملات المستخلصة من سكربتات الأرشيف:\n` +
      aggregatedParams.map((p) => `  - ${p.key}: ${p.value} ${p.unit || ''}`).join('\n') +
      `\n\n=== نصوص ومحتويات السكربتات المستخرجة ===\n` +
      extractedResults
        .filter((r) => r.content)
        .map((r) => `--- [ملف: ${r.name}] ---\n${r.content?.slice(0, 15000)}`)
        .join('\n\n'),
    detectedParameters: aggregatedParams,
    status: 'ready',
  };

  return [archiveManifest, ...extractedResults];
}

/**
 * Handle non-archive single files
 */
async function parseSingleEngineeringFile(file: File, ext: string, arrayBuffer: ArrayBuffer): Promise<ParsedFileResult> {
  const baseItem: ParsedFileResult = {
    id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: file.name,
    size: file.size,
    extension: ext,
    mimeType: file.type || 'application/octet-stream',
    category: 'text',
    isImage: false,
    summary: '',
    detectedParameters: [],
    status: 'ready',
  };

  try {
    // 1. Image Files (CAD snapshots, mesh diagrams, schematics)
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'].includes(ext) || file.type.startsWith('image/')) {
      baseItem.category = 'image';
      baseItem.isImage = true;
      baseItem.mimeType = file.type || (ext === 'svg' ? 'image/svg+xml' : 'image/png');

      const dataUrl = await readFileAsDataURL(file);
      baseItem.base64Data = dataUrl;
      baseItem.summary = `مخطط / صورة هندسية بصيغة ${ext.toUpperCase()} بحجم ${(file.size / 1024).toFixed(1)} KB جاهزة للتحليل البصري المتعدد الوسائط.`;
      baseItem.detectedParameters.push({
        key: 'نوع الوثيقة',
        value: 'مخطط هندسي مرئي / رسم CAD',
      });
      return baseItem;
    }

    // 2. PDF Documents (Datasheets, project directives, research specs)
    if (ext === 'pdf' || file.type === 'application/pdf') {
      baseItem.category = 'pdf';
      baseItem.mimeType = 'application/pdf';
      const dataUrl = await readFileAsDataURL(file);
      baseItem.base64Data = dataUrl;
      baseItem.summary = `وثيقة هندسية / كراسة مواصفات بصيغة PDF بحجم ${(file.size / 1024).toFixed(1)} KB.`;
      baseItem.detectedParameters.push({
        key: 'نوع الملف',
        value: 'وثيقة PDF معتمدة',
      });
      return baseItem;
    }

    // 3. Word Documents (.docx, .doc)
    if (ext === 'docx') {
      baseItem.category = 'word';
      baseItem.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const mammothResult = await mammoth.extractRawText({ arrayBuffer });
      const rawText = mammothResult.value || '';
      baseItem.content = rawText;
      const lines = rawText.split('\n').filter((l: string) => l.trim().length > 0);
      baseItem.parsedLines = lines.length;
      baseItem.summary = `مستند وورد تقني يحتوي على ${lines.length} فقرة نصية ومواصفات هندسية.`;

      extractParametersFromText(rawText, baseItem.detectedParameters);
      return baseItem;
    }

    // 4. Excel Spreadsheets (.xlsx, .xls, .csv)
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      baseItem.category = 'excel';
      baseItem.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      baseItem.sheetCount = workbook.SheetNames.length;
      baseItem.sheetsData = [];
      let consolidatedText = `=== EXCEL DATASET: ${file.name} ===\n`;

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
        const rows = jsonData.length;
        const cols = jsonData[0] ? (jsonData[0] as any[]).length : 0;

        baseItem.sheetsData?.push({
          sheetName,
          rows,
          columns: cols,
          preview: jsonData.slice(0, 8),
        });

        consolidatedText += `\n[Sheet: ${sheetName}] (${rows} rows x ${cols} cols)\n`;
        const csvText = XLSX.utils.sheet_to_csv(sheet);
        consolidatedText += csvText.slice(0, 15000) + '\n';
      });

      baseItem.content = consolidatedText;
      baseItem.parsedLines = consolidatedText.split('\n').length;
      baseItem.summary = `جدول بيانات إكسيل يحتوي على ${workbook.SheetNames.length} أوراق عمل بإجمالي صفوف تم تحليلها.`;

      extractParametersFromText(consolidatedText, baseItem.detectedParameters);
      return baseItem;
    }

    // 5. Code & Scripts (.py, .jou, .mac, .inp, .dat, .cas, .cdb, .m, .txt)
    baseItem.category = ['py', 'jou', 'mac', 'inp', 'cas', 'dat', 'cdb', 'm'].includes(ext) ? 'code' : 'text';
    const text = await readFileAsText(file);
    baseItem.content = text;
    baseItem.parsedLines = text.split('\n').length;
    baseItem.summary = `ملف برمجي / سكربت هندسي (${ext.toUpperCase()}) يحتوي على ${baseItem.parsedLines} سطراً برمجياً.`;

    extractParametersFromText(text, baseItem.detectedParameters);
    return baseItem;
  } catch (err: any) {
    console.error('Error parsing file:', file.name, err);
    baseItem.status = 'error';
    baseItem.errorMessage = err?.message || 'تعذر استخراج المحتوى بدقة';
    baseItem.summary = 'حدث خطأ في القراءة: ' + baseItem.errorMessage;
    return baseItem;
  }
}

// Deep Multidisciplinary Engineering Parameter & Domain Extraction
function extractParametersFromText(
  text: string,
  params: { key: string; value: string; unit?: string }[]
): 'AI/ML' | 'CFD' | 'FEA' | 'Thermal' | 'Control' | 'Multiphysics' | 'Data' {
  let detectedDomain: 'AI/ML' | 'CFD' | 'FEA' | 'Thermal' | 'Control' | 'Multiphysics' | 'Data' = 'CFD';

  // 1. Python AI / Deep Learning / Data Science Detection
  const isPyTorch = text.includes('torch.') || text.includes('nn.Module') || text.includes('optim.');
  const isTensorFlow = text.includes('tensorflow') || text.includes('tf.keras') || text.includes('keras.');
  const isSklearn = text.includes('sklearn') || text.includes('train_test_split') || text.includes('RandomForest');
  const isDataScience = text.includes('pandas') || text.includes('pd.read_') || text.includes('numpy') || text.includes('plt.');

  if (isPyTorch || isTensorFlow || isSklearn || isDataScience) {
    detectedDomain = 'AI/ML';
    params.push({
      key: 'إطار الذكاء الاصطناعي (AI Framework)',
      value: isPyTorch ? 'PyTorch Deep Learning' : isTensorFlow ? 'TensorFlow / Keras' : isSklearn ? 'Scikit-Learn Machine Learning' : 'Python Data Science Stack',
    });

    // Neural Architecture
    const archMatch = text.match(/(?:ResNet|UNet|Transformer|BERT|CNN|LSTM|GRU|MLP|Sequential|Conv2d|Linear|Dense)/i);
    if (archMatch) {
      params.push({ key: 'البنية العصبية (Model Architecture)', value: archMatch[0] });
    }

    // Learning Rate
    const lrMatch = text.match(/(?:lr|learning_rate)\s*[:=]\s*([0-9.eE+-]+)/i);
    if (lrMatch) {
      params.push({ key: 'معدل التعلم (Learning Rate)', value: lrMatch[1] });
    }

    // Batch Size
    const batchMatch = text.match(/(?:batch_size|batch)\s*[:=]\s*(\d+)/i);
    if (batchMatch) {
      params.push({ key: 'حجم الحزمة (Batch Size)', value: batchMatch[1] });
    }

    // Epochs
    const epochsMatch = text.match(/(?:epochs|n_epochs|max_epochs|iter)\s*[:=]\s*(\d+)/i);
    if (epochsMatch) {
      params.push({ key: 'دورات التدريب (Epochs)', value: epochsMatch[1] });
    }

    // Optimizer
    const optMatch = text.match(/(?:Adam|AdamW|SGD|RMSprop|Adagrad)/i);
    if (optMatch) {
      params.push({ key: 'خوارزمية التحسين (Optimizer)', value: optMatch[0] });
    }

    // Loss function
    const lossMatch = text.match(/(?:CrossEntropyLoss|MSELoss|BCELoss|L1Loss|HuberLoss|loss_fn|criterion)/i);
    if (lossMatch) {
      params.push({ key: 'دالة الخسارة (Loss Function)', value: lossMatch[0] });
    }
  }

  // 2. ANSYS APDL / Structural FEA Detection
  const isAPDL = text.includes('/PREP7') || text.includes('/SOLU') || text.includes('/POST1') || text.includes('MP,') || text.includes('ET,');
  const isFEA = isAPDL || text.includes('ansys mechanical') || text.includes('von_mises') || text.includes('solid186') || text.includes('fixed support');

  if (isFEA) {
    detectedDomain = detectedDomain === 'AI/ML' ? 'Multiphysics' : 'FEA';
    params.push({ key: 'بيئة النمذجة (CAE Environment)', value: 'ANSYS Mechanical / APDL Structural Solver' });

    // APDL Element Type
    const apdlEtMatch = text.match(/ET\s*,\s*\d+\s*,\s*([A-Za-z0-9_-]+)/i);
    if (apdlEtMatch) {
      params.push({ key: 'عنصر الميش (Element Type)', value: apdlEtMatch[1].toUpperCase() });
    }

    // Young's Modulus
    const apdlExMatch = text.match(/MP\s*,\s*EX\s*,\s*\d+\s*,\s*([\d.eE+-]+)/i);
    if (apdlExMatch) {
      let val = parseFloat(apdlExMatch[1]);
      let unit = 'Pa';
      if (val >= 1e9) {
        val = Number((val / 1e9).toFixed(1));
        unit = 'GPa';
      } else if (val >= 1e6) {
        val = Number((val / 1e6).toFixed(1));
        unit = 'MPa';
      }
      params.push({ key: 'معامل المرونة (Elastic Modulus E)', value: val.toString(), unit });
    }

    // Poisson's Ratio
    const apdlPrxyMatch = text.match(/MP\s*,\s*PRXY\s*,\s*\d+\s*,\s*([\d.]+)/i);
    if (apdlPrxyMatch) {
      params.push({ key: 'نسبة بواسون (Poisson Ratio ν)', value: apdlPrxyMatch[1] });
    }

    // Density
    const apdlDensMatch = text.match(/MP\s*,\s*DENS\s*,\s*\d+\s*,\s*([\d.]+)/i);
    if (apdlDensMatch) {
      params.push({ key: 'الكثافة (Density ρ)', value: apdlDensMatch[1], unit: 'kg/m³' });
    }

    // Surface Pressure
    const apdlPresMatch = text.match(/SF\s*,\s*[^,]+\s*,\s*PRES\s*,\s*([\d.]+)/i);
    if (apdlPresMatch) {
      params.push({ key: 'حمولة الضغط السطحي (Surface Pressure)', value: apdlPresMatch[1], unit: 'MPa' });
    }

    // Applied Force
    const apdlForceMatch = text.match(/F\s*,\s*[^,]+\s*,\s*F[XYZ]\s*,\s*([\d.]+)/i);
    if (apdlForceMatch) {
      params.push({ key: 'القوة المركزة المطبقة (Applied Force)', value: apdlForceMatch[1], unit: 'N' });
    }
  }

  // 3. ANSYS Fluent / OpenFOAM / CFD Detection
  const isFluent = text.includes('/define/boundary-conditions') || text.includes('/solve/iterate') || text.includes('velocity-inlet');
  const isOpenFOAM = text.includes('foamFile') || text.includes('fvSchemes') || text.includes('controlDict');

  if (isFluent || isOpenFOAM) {
    detectedDomain = detectedDomain === 'FEA' ? 'Multiphysics' : 'CFD';
    params.push({
      key: 'بيئة التدفق (CFD Environment)',
      value: isFluent ? 'ANSYS Fluent Journal / Scheme TUI' : 'OpenFOAM Finite Volume Solver',
    });

    const turbMatch = text.match(/(sst-kw|k-omega|ke-standard|ke-realizable|spalart-allmaras|laminar|k-epsilon)/i);
    if (turbMatch) {
      params.push({ key: 'نموذج الاضطراب (Turbulence Model)', value: turbMatch[1].toUpperCase() });
    }
  }

  // 4. General Flow & Physical Variables
  const velMatch = text.match(/(?:velocity|v_in|vel|inlet_vel|سرعة)\s*[:=,\s]\s*([\d.]+)\s*(m\/s|km\/h)?/i);
  if (velMatch) {
    params.push({ key: 'سرعة التدفق (Inlet Velocity)', value: velMatch[1], unit: velMatch[2] || 'm/s' });
    if (detectedDomain !== 'FEA' && detectedDomain !== 'AI/ML') detectedDomain = 'CFD';
  }

  const pressMatch = text.match(/(?:pressure|press|p_in|load|stress|ضغط|حمولة|إجهاد)\s*[:=,\s]\s*([\d.]+)\s*(pa|kpa|mpa|bar|psi)?/i);
  if (pressMatch && !params.some((p) => p.key.includes('حمولة الضغط السطحي'))) {
    params.push({ key: 'الضغط / الحمولة (Pressure/Load)', value: pressMatch[1], unit: pressMatch[2] || 'MPa' });
  }

  const tempMatch = text.match(/(?:temp|temperature|t_in|t_wall|حرارة)\s*[:=,\s]\s*([\d.]+)\s*(c|k|°c)?/i);
  if (tempMatch) {
    params.push({ key: 'درجة الحرارة (Temperature)', value: tempMatch[1], unit: tempMatch[2] || '°C' });
    if (detectedDomain === 'CFD') detectedDomain = 'Thermal';
  }

  const matMatch = text.match(/(?:material|مادة|المعدن|المائع|structural steel|aluminum|titanium|water|air)\s*[:=]?\s*([a-zA-Z\u0621-\u064A0-9\s_-]+)/i);
  if (matMatch) {
    const cleanMat = matMatch[1].trim().slice(0, 35);
    if (!['true', 'false', 'none', 'null'].includes(cleanMat.toLowerCase())) {
      params.push({ key: 'المادة (Material)', value: cleanMat });
    }
  }

  const meshMatch = text.match(/(?:elements|cells|nodes|عناصر|شبكة)\s*[:=,\s]\s*([\d,]+)/i);
  if (meshMatch) {
    params.push({ key: 'عناصر الميش (Mesh Elements)', value: meshMatch[1] });
  }

  const iterMatch = text.match(/(?:iterate|iterations|n_iter|تكرارات|خطوات)\s*[:=,\s]\s*(\d+)/i);
  if (iterMatch) {
    params.push({ key: 'عدد التكرارات (Iterations)', value: iterMatch[1] });
  }

  return detectedDomain;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as ArrayBuffer) || new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
