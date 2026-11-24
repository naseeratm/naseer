import { MeshStudyResult } from '../types/thesis';
import { formatNumber } from './numberFormat';

export type VerdictTone = 'good' | 'warn' | 'bad';
export type ComplianceCheckStatus = 'pass' | 'warn' | 'fail' | 'na';
export type ComplianceOverallStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT';

export interface MeshQualityMetricsInput {
  minOrthogonalQuality?: number;
  maxSkewness?: number;
  maxNonOrthogonality?: number;
  elementsCount?: number;
}

export interface MeshComplianceCriterion {
  id: string;
  label: string;
  labelAr: string;
  measured: string;
  requirement: string;
  status: ComplianceCheckStatus;
  detail: string;
}

export interface MeshQualityComplianceReport {
  standard: string;
  overallStatus: ComplianceOverallStatus;
  tone: VerdictTone;
  headlineEn: string;
  headlineAr: string;
  criteria: MeshComplianceCriterion[];
  recommendedMeshSizeM: number | null;
  requiredRefinementFactor: number | null;
  fineMeshSizeM: number | null;
  recommendationEn: string;
  recommendationAr: string;
}

// One wording of the mesh-study outcome, shared by the on-screen tab and the exported reports.
export function meshStudyVerdict(study: MeshStudyResult): { tone: VerdictTone; text: string } {
  const gci = study.gci_fine_percent === null ? '—' : formatNumber(study.gci_fine_percent);
  switch (study.convergence_type) {
    case 'converged':
      return { tone: 'good', text: 'The key result agrees on the compared grids to floating-point precision: mesh independent.' };
    case 'monotonic':
      return study.grid_independent
        ? { tone: 'good', text: `Grid-independent: GCI (fine) = ${gci}% is within the ${study.gci_threshold_percent}% threshold.` }
        : { tone: 'warn', text: `Not yet grid-independent: GCI (fine) = ${gci}% exceeds the ${study.gci_threshold_percent}% threshold.` };
    case 'oscillatory':
      return { tone: 'warn', text: 'Oscillatory convergence: the GCI is indicative only, so no verdict is given.' };
    case 'divergent':
      return { tone: 'bad', text: 'The key result does not converge with refinement, so no GCI is reported and the mesh cannot be called independent.' };
    default:
      return { tone: 'warn', text: 'The convergence behaviour could not be determined from these three grids.' };
  }
}

/**
 * Extract real geometric mesh quality metrics (if reported by Gmsh or OpenFOAM checkMesh)
 * from report rows without fabricating or defaulting missing quantities.
 */
export function extractMeshQualityFromRows(
  rows: ReadonlyArray<{ label: string; value: string }>,
): MeshQualityMetricsInput {
  const result: MeshQualityMetricsInput = {};
  for (const row of rows) {
    const label = row.label.toLowerCase();
    const numeric = Number(String(row.value).replace(/,/g, '').replace(/[^0-9eE.+-]/g, ''));
    if (!Number.isFinite(numeric)) continue;
    if ((label.includes('orthogonal') || label.includes('minsicn') || label.includes('min quality')) && !label.includes('non-orthogonal')) {
      result.minOrthogonalQuality = numeric;
    } else if (label.includes('non-orthogonal')) {
      result.maxNonOrthogonality = numeric;
    } else if (label.includes('skewness')) {
      result.maxSkewness = numeric;
    } else if (label.includes('cell') || label.includes('element')) {
      if (result.elementsCount === undefined) result.elementsCount = numeric;
    }
  }
  return result;
}

/**
 * Deterministic ASME V&V 20 / Celik et al. (2008) Mesh Quality Compliance evaluation.
 * Every check and any target mesh size h_target is derived strictly from the real GCI
 * study outputs and solver-reported mesh quality metrics.
 */
export function evaluateMeshQualityCompliance(
  study: MeshStudyResult,
  meshMetrics?: MeshQualityMetricsInput,
): MeshQualityComplianceReport {
  const criteria: MeshComplianceCriterion[] = [];
  const threshold = study.gci_threshold_percent;
  const gciFine = study.gci_fine_percent;
  const orderP = study.observed_order;
  const ar = study.asymptotic_ratio;
  const r21 = study.r21;
  const r32 = study.r32;

  const fineLevel = study.levels.find((lvl) => lvl.level === 'fine') ?? study.levels[study.levels.length - 1];
  const fineMeshSizeM =
    fineLevel && typeof fineLevel.mesh_size === 'number' && Number.isFinite(fineLevel.mesh_size) && fineLevel.mesh_size > 0
      ? fineLevel.mesh_size
      : null;

  // 1. Discretization Error — GCI (fine)
  let gciStatus: ComplianceCheckStatus;
  let gciDetail: string;
  if (study.convergence_type === 'converged') {
    gciStatus = 'pass';
    gciDetail = 'All three grids agree within floating-point precision; discretization error is negligible.';
  } else if (study.convergence_type === 'monotonic' && gciFine !== null) {
    if (study.grid_independent && gciFine <= threshold) {
      gciStatus = 'pass';
      gciDetail = `Fine-grid discretization uncertainty (${formatNumber(gciFine)}%) satisfies the <= ${formatNumber(threshold)}% threshold.`;
    } else {
      gciStatus = 'fail';
      gciDetail = `Fine-grid discretization uncertainty (${formatNumber(gciFine)}%) exceeds the ${formatNumber(threshold)}% compliance threshold.`;
    }
  } else if (study.convergence_type === 'oscillatory') {
    gciStatus = 'warn';
    gciDetail = 'Solution oscillates across grid levels; monotonic Richardson extrapolation is indicative only.';
  } else if (study.convergence_type === 'divergent') {
    gciStatus = 'fail';
    gciDetail = 'Key result diverges with refinement; grid independence is not achieved.';
  } else {
    gciStatus = 'warn';
    gciDetail = 'Convergence behaviour could not be classified cleanly from the three grids.';
  }
  criteria.push({
    id: 'gci_fine',
    label: 'Fine-Grid Convergence Index (GCI_fine)',
    labelAr: 'مؤشر تقارب الشبكة الناعمة (GCI_fine)',
    measured: gciFine === null ? '—' : `${formatNumber(gciFine)} %`,
    requirement: `≤ ${formatNumber(threshold)} % (monotonic)`,
    status: gciStatus,
    detail: gciDetail,
  });

  // 2. Grid Refinement Ratio (Celik et al. 2008: r >= 1.3)
  let rStatus: ComplianceCheckStatus = 'na';
  let rDetail = 'Refinement ratios were not reported by the backend.';
  if (r21 !== null && r32 !== null) {
    if (r21 >= 1.3 && r32 >= 1.3) {
      rStatus = 'pass';
      rDetail = `Both refinement ratios (r21=${formatNumber(r21)}, r32=${formatNumber(r32)}) meet the Celik et al. (2008) minimum of 1.30.`;
    } else {
      rStatus = 'warn';
      rDetail = `At least one refinement ratio (r21=${formatNumber(r21)}, r32=${formatNumber(r32)}) is below 1.30; discretization differences may be close to iterative noise.`;
    }
  }
  criteria.push({
    id: 'refinement_ratio',
    label: 'Grid Refinement Ratios (r21, r32)',
    labelAr: 'نسب تنعيم الشبكة (r21, r32)',
    measured: r21 !== null && r32 !== null ? `${formatNumber(r21)} / ${formatNumber(r32)}` : '—',
    requirement: '≥ 1.30 (ASME V&V 20)',
    status: rStatus,
    detail: rDetail,
  });

  // 3. Asymptotic Range Verification (AR ≈ 1.0)
  let arStatus: ComplianceCheckStatus = 'na';
  let arDetail = 'Asymptotic ratio is not defined for non-monotonic or converged-to-precision grids.';
  if (study.convergence_type === 'converged') {
    arStatus = 'pass';
    arDetail = 'Grid-invariant to machine precision; asymptotic convergence is already satisfied.';
  } else if (ar !== null) {
    if (ar >= 0.85 && ar <= 1.15) {
      arStatus = 'pass';
      arDetail = `Asymptotic ratio (${formatNumber(ar)}) lies within 1.00 ± 0.15, confirming solutions lie in the asymptotic range.`;
    } else {
      arStatus = 'warn';
      arDetail = `Asymptotic ratio (${formatNumber(ar)}) deviates from 1.00; the coarse or medium grid may lie outside the asymptotic range.`;
    }
  }
  criteria.push({
    id: 'asymptotic_ratio',
    label: 'Asymptotic Range Ratio (AR)',
    labelAr: 'نسبة النطاق المقارب (Asymptotic Ratio)',
    measured: ar === null ? '—' : formatNumber(ar),
    requirement: '0.85 – 1.15 (nominal ≈ 1.0)',
    status: arStatus,
    detail: arDetail,
  });

  // 4. Observed Order of Accuracy p
  let orderStatus: ComplianceCheckStatus = 'na';
  let orderDetail = 'Observed order p could not be extracted from the grid triplet.';
  if (orderP !== null) {
    if (orderP >= 0.5 && orderP <= 3.5) {
      orderStatus = 'pass';
      orderDetail = `Observed convergence order p = ${formatNumber(orderP)} is physically consistent with 1st/2nd-order finite-volume/element discretization.`;
    } else {
      orderStatus = 'warn';
      orderDetail = `Observed order p = ${formatNumber(orderP)} lies outside the typical 0.5–3.5 range; verify mesh grading and solver residual convergence.`;
    }
  }
  criteria.push({
    id: 'observed_order',
    label: 'Observed Order of Accuracy (p)',
    labelAr: 'رتبة الدقة المرصودة (Observed Order p)',
    measured: orderP === null ? '—' : formatNumber(orderP),
    requirement: '0.50 – 3.50',
    status: orderStatus,
    detail: orderDetail,
  });

  // 5. Optional real geometric mesh quality metrics (only added when reported by Gmsh / OpenFOAM)
  if (meshMetrics?.minOrthogonalQuality !== undefined && Number.isFinite(meshMetrics.minOrthogonalQuality)) {
    const q = meshMetrics.minOrthogonalQuality;
    const status: ComplianceCheckStatus = q >= 0.2 ? 'pass' : q >= 0.1 ? 'warn' : 'fail';
    criteria.push({
      id: 'orthogonal_quality',
      label: 'Min Orthogonal Quality / Gmsh minSICN',
      labelAr: 'أدنى جودة تعامد / مؤشر Gmsh minSICN',
      measured: formatNumber(q),
      requirement: '≥ 0.20 (critical < 0.10)',
      status,
      detail:
        status === 'pass'
          ? `Minimum element quality (${formatNumber(q)}) satisfies industrial stability thresholds.`
          : status === 'warn'
            ? `Minimum element quality (${formatNumber(q)}) is marginal; check sharp corners or inflation transitions.`
            : `Minimum element quality (${formatNumber(q)}) is below 0.10 and risks numerical instability.`,
    });
  }

  if (meshMetrics?.maxSkewness !== undefined && Number.isFinite(meshMetrics.maxSkewness)) {
    const sk = meshMetrics.maxSkewness;
    const status: ComplianceCheckStatus = sk <= 0.85 ? 'pass' : sk <= 0.95 ? 'warn' : 'fail';
    criteria.push({
      id: 'max_skewness',
      label: 'Maximum Element Skewness',
      labelAr: 'أقصى انحراف للعناصر (Max Skewness)',
      measured: formatNumber(sk),
      requirement: '≤ 0.85 (critical > 0.95)',
      status,
      detail:
        status === 'pass'
          ? `Maximum skewness (${formatNumber(sk)}) is well within acceptable bounds.`
          : status === 'warn'
            ? `Maximum skewness (${formatNumber(sk)}) is elevated; local refinement or smoothing is advised.`
            : `Maximum skewness (${formatNumber(sk)}) exceeds 0.95 and degrades discretization accuracy.`,
    });
  }

  if (meshMetrics?.maxNonOrthogonality !== undefined && Number.isFinite(meshMetrics.maxNonOrthogonality)) {
    const nonOrtho = meshMetrics.maxNonOrthogonality;
    const status: ComplianceCheckStatus = nonOrtho <= 70 ? 'pass' : nonOrtho <= 80 ? 'warn' : 'fail';
    criteria.push({
      id: 'max_non_orthogonality',
      label: 'Maximum Mesh Non-Orthogonality',
      labelAr: 'أقصى لا-تعامد للشبكة (Non-Orthogonality)',
      measured: `${formatNumber(nonOrtho)}°`,
      requirement: '≤ 70° (OpenFOAM limit < 80°)',
      status,
      detail:
        status === 'pass'
          ? `Non-orthogonality (${formatNumber(nonOrtho)}°) requires no excessive non-orthogonal correction loops.`
          : status === 'warn'
            ? `Non-orthogonality (${formatNumber(nonOrtho)}°) is between 70° and 80°; enable nNonOrthogonalCorrectors >= 2.`
            : `Non-orthogonality (${formatNumber(nonOrtho)}°) exceeds 80° and can destabilize pressure-velocity coupling.`,
    });
  }

  // Deterministic next-step cell size calculation when GCI_fine exceeds threshold:
  // Since GCI ∝ h^p, h_target = h_fine * (GCI_threshold / GCI_fine)^(1/p)
  let recommendedMeshSizeM: number | null = null;
  let requiredRefinementFactor: number | null = null;
  if (
    study.convergence_type === 'monotonic' &&
    gciFine !== null &&
    gciFine > threshold &&
    orderP !== null &&
    orderP >= 0.25 &&
    fineMeshSizeM !== null
  ) {
    const scale = Math.pow(threshold / gciFine, 1 / orderP);
    if (Number.isFinite(scale) && scale > 0.05 && scale < 1.0) {
      recommendedMeshSizeM = Number((fineMeshSizeM * scale).toPrecision(3));
      requiredRefinementFactor = Number((1 / scale).toFixed(2));
    }
  }

  // Overall classification
  const hasFail = criteria.some((c) => c.status === 'fail');
  const hasWarn = criteria.some((c) => c.status === 'warn');

  let overallStatus: ComplianceOverallStatus;
  let tone: VerdictTone;
  let headlineEn: string;
  let headlineAr: string;
  let recommendationEn: string;
  let recommendationAr: string;

  const keyLabel = study.key_result.label;
  const fineDesc = fineMeshSizeM !== null ? `h = ${formatNumber(fineMeshSizeM)} m` : 'the fine mesh level';

  if (!hasFail && !hasWarn) {
    overallStatus = 'COMPLIANT';
    tone = 'good';
    headlineEn = 'PASS — Mesh Quality & Discretization Compliance Certified (ASME V&V 20)';
    headlineAr = 'مطابق للمعيار (PASS) — الشبكة معتمدة ومستقلة عن حجم العناصر وفق ASME V&V 20';
    recommendationEn =
      `Adopt ${fineDesc} for final production runs and engineering sign-off. ` +
      `All ASME V&V 20 criteria are satisfied for ${keyLabel}` +
      (gciFine !== null ? ` (GCI_fine = ${formatNumber(gciFine)}% <= ${formatNumber(threshold)}%)` : '') +
      `; further global mesh refinement is not justified by discretization uncertainty.`;
    recommendationAr =
      `التوصية النهائية: اعتماد الشبكة الناعمة (${fineDesc}) لتوليد النتائج النهائية والتوثيق الهندسي. ` +
      `استوفت الشبكة جميع شروط معيار ASME V&V 20 للكمية (${keyLabel})` +
      (gciFine !== null ? ` بقيمة GCI_fine = ${formatNumber(gciFine)}% (أقل من الحد المسموح ${formatNumber(threshold)}%)` : '') +
      ` ولا توجد حاجة علمية لمزيد من التنعيم الشامل.`;
  } else if (!hasFail && hasWarn) {
    overallStatus = 'CONDITIONAL';
    tone = 'warn';
    headlineEn = 'CONDITIONAL — Acceptable for Engineering Screening; Review Flagged Criteria';
    headlineAr = 'مطابقة مشروطة (CONDITIONAL) — صالحة للتقييم الهندسي مع مراجعة الملاحظات المؤشّرة';
    if (study.convergence_type === 'oscillatory') {
      recommendationEn =
        `Retain ${fineDesc} for preliminary evaluation only. Because ${keyLabel} exhibited oscillatory convergence across the three grids, tighten iterative solver residual tolerances (<= 1e-6), verify boundary-layer grading, and repeat the triplet study with refinement ratio r >= 1.30 before final certification.`;
      recommendationAr =
        `التوصية النهائية: يُنصح باستخدام الشبكة الحالية (${fineDesc}) للتقييم المبدئي فقط. نظراً لظهور تقارب متذبذب (Oscillatory) للكمية (${keyLabel})، يُوصى بتشديد معيار بواقي الحل (Residuals <= 1e-6)، ومراجعة تدريج الطبقة الحدية، وإعادة دراسة الشبكات الثلاث بنسبة تنعيم r >= 1.30 قبل الاعتماد النهائي.`;
    } else {
      recommendationEn =
        `Fine mesh (${fineDesc}) meets the primary GCI threshold for ${keyLabel}, but one or more secondary ASME V&V 20 indicators (refinement ratio, asymptotic range, observed order, or geometric quality) triggered a caution. Confirm sensitivity on a refined triplet with r >= 1.30 before safety-critical sign-off.`;
      recommendationAr =
        `التوصية النهائية: حققت الشبكة الناعمة (${fineDesc}) شرط GCI الأساسي للكمية (${keyLabel})، إلا أن أحد المؤشرات الثانوية (نسبة التنعيم أو النطاق المقارب أو الجودة الهندسية) يقع على الحد الهامشي؛ يُوصى بالتحقق بشبكة إضافية بنسبة تنعيم r >= 1.30 قبل الاعتماد في التطبيقات الحرجة.`;
    }
  } else {
    overallStatus = 'NON_COMPLIANT';
    tone = 'bad';
    headlineEn = 'NON-COMPLIANT — Additional Mesh Refinement or Quality Remediation Required';
    headlineAr = 'غير مطابق (NON-COMPLIANT) — يلزم تنعيم إضافي للشبكة أو تحسين جودتها قبل الاعتماد';
    if (recommendedMeshSizeM !== null && requiredRefinementFactor !== null) {
      recommendationEn =
        `Do not sign off on ${fineDesc} for ${keyLabel} (GCI_fine = ${formatNumber(gciFine!)}% > ${formatNumber(threshold)}%). ` +
        `Based on the observed convergence order p = ${formatNumber(orderP!)}, refine the mesh by a linear factor of ${requiredRefinementFactor}x to target element size h_target ≈ ${formatNumber(recommendedMeshSizeM)} m (${formatNumber(recommendedMeshSizeM * 1000)} mm) and re-run the GCI verification.`;
      recommendationAr =
        `التوصية النهائية: لا يُنصح باعتماد الشبكة الحالية (${fineDesc}) للكمية (${keyLabel}) لأن مؤشر الخطأ العددي GCI_fine = ${formatNumber(gciFine!)}% يتجاوز الحد المسموح (${formatNumber(threshold)}%). ` +
        `بناءً على رتبة التقارب الفعلية p = ${formatNumber(orderP!)}، يُوصى بتنعيم الشبكة بمعامل خطي قدره ${requiredRefinementFactor}× للوصول إلى حجم خلية مستهدف h_target ≈ ${formatNumber(recommendedMeshSizeM)} m (${formatNumber(recommendedMeshSizeM * 1000)} mm) ثم إعادة فحص GCI.`;
    } else if (study.convergence_type === 'divergent') {
      recommendationEn =
        `Do not use the current mesh for design decisions: ${keyLabel} diverged under refinement. Check boundary conditions, geometric singularities, element skewness/non-orthogonality, and solver convergence residuals before rebuilding the mesh.`;
      recommendationAr =
        `التوصية النهائية: لا يُسمح باعتماد النتائج الحالية لاتخاذ قرارات تصميمية بسبب تباعد الحل (Divergent) مع تنعيم الشبكة للكمية (${keyLabel}). راجع الشروط الحدية، نقاط التركيز الهندسي، جودة العناصر، وتقارب بواقي المحلل قبل إعادة التوليد.`;
    } else {
      recommendationEn =
        `Mesh refinement or geometric quality remediation is required before signing off on ${fineDesc}. Reduce characteristic element size h (target refinement factor >= 1.3x), eliminate high-skewness or low-orthogonality cells, and re-run the 3-grid GCI study.`;
      recommendationAr =
        `التوصية النهائية: يلزم تنعيم الشبكة أو معالجة جودة العناصر قبل اعتماد (${fineDesc}). قم بتصغير حجم الخلية h بمعامل تنعيم لا يقل عن 1.3×، ومعالجة العناصر ذات الانحراف العالي أو التعامد المنخفض، ثم أعد تشغيل دراسة GCI.`;
    }
  }

  return {
    standard: 'ASME V&V 20-2009 / Celik et al. (2008)',
    overallStatus,
    tone,
    headlineEn,
    headlineAr,
    criteria,
    recommendedMeshSizeM,
    requiredRefinementFactor,
    fineMeshSizeM,
    recommendationEn,
    recommendationAr,
  };
}
