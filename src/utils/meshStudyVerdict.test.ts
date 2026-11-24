import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MeshStudyResult } from '../types/thesis';
import { evaluateMeshQualityCompliance, extractMeshQualityFromRows } from './meshStudyVerdict';

function baseStudy(overrides: Partial<MeshStudyResult> = {}): MeshStudyResult {
  return {
    schema_version: 2,
    dimension: 3,
    physics_type: 'CFD_Incompressible',
    solver: 'OpenFOAM simpleFoam',
    key_result: {
      id: 'pressure_drop',
      label: 'Pressure Drop',
      unit: 'Pa',
      description: 'Inlet-to-outlet static pressure drop.',
      caveat: null,
      default: true,
    },
    basis_note: null,
    parameters: {},
    safety_factor: 1.25,
    gci_threshold_percent: 2.0,
    levels: [
      { level: 'coarse', cells: 1000, nodes: 1331, mesh_size: 0.08, divisions: null, relative_size: 2.0, key_result: 112.0 },
      { level: 'medium', cells: 2744, nodes: 3375, mesh_size: 0.056, divisions: null, relative_size: 1.4, key_result: 103.2 },
      { level: 'fine', cells: 8000, nodes: 9261, mesh_size: 0.04, divisions: null, relative_size: 1.0, key_result: 100.5 },
    ],
    r21: 1.43,
    r32: 1.4,
    observed_order: 2.0,
    extrapolated_value: 99.6,
    extrapolated_error_percent: 0.9,
    gci_fine_percent: 1.12,
    gci_medium_percent: 2.29,
    uncertainty_fine: 1.12,
    asymptotic_ratio: 1.0,
    convergence_type: 'monotonic',
    grid_independent: true,
    warnings: [],
    recordedAt: '2026-11-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateMeshQualityCompliance', () => {
  it('certifies COMPLIANT when GCI, r21/r32, asymptotic ratio, order p, and geometric quality all pass', () => {
    const report = evaluateMeshQualityCompliance(baseStudy(), {
      minOrthogonalQuality: 0.42,
      maxSkewness: 0.55,
    });
    assert.equal(report.overallStatus, 'COMPLIANT');
    assert.equal(report.tone, 'good');
    assert.equal(report.recommendedMeshSizeM, null);
    assert.ok(report.criteria.every((c) => c.status === 'pass'));
    assert.match(report.recommendationEn, /Adopt h = 0\.04 m/);
    assert.match(report.recommendationAr, /اعتماد الشبكة الناعمة/);
  });

  it('computes exact deterministic h_target when GCI_fine exceeds threshold', () => {
    // GCI_fine = 8.0%, threshold = 2.0%, p = 2.0, h_fine = 0.04 m
    // scale = (2 / 8)^(1/2) = 0.5 -> h_target = 0.02 m, factor = 2.0x
    const report = evaluateMeshQualityCompliance(
      baseStudy({
        gci_fine_percent: 8.0,
        observed_order: 2.0,
        grid_independent: false,
      }),
    );
    assert.equal(report.overallStatus, 'NON_COMPLIANT');
    assert.equal(report.tone, 'bad');
    assert.equal(report.recommendedMeshSizeM, 0.02);
    assert.equal(report.requiredRefinementFactor, 2);
    assert.match(report.recommendationEn, /h_target ≈ 0\.02 m/);
    assert.match(report.recommendationAr, /h_target ≈ 0\.02 m/);
  });

  it('marks CONDITIONAL on oscillatory convergence or low refinement ratio', () => {
    const oscillatory = evaluateMeshQualityCompliance(
      baseStudy({
        convergence_type: 'oscillatory',
        grid_independent: false,
        asymptotic_ratio: null,
      }),
    );
    assert.equal(oscillatory.overallStatus, 'CONDITIONAL');
    assert.equal(oscillatory.tone, 'warn');

    const lowRatio = evaluateMeshQualityCompliance(
      baseStudy({
        r21: 1.15,
        r32: 1.18,
      }),
    );
    assert.equal(lowRatio.overallStatus, 'CONDITIONAL');
    assert.equal(lowRatio.criteria.find((c) => c.id === 'refinement_ratio')?.status, 'warn');
  });

  it('marks NON_COMPLIANT on divergent study or critical geometric skewness', () => {
    const div = evaluateMeshQualityCompliance(
      baseStudy({
        convergence_type: 'divergent',
        gci_fine_percent: null,
        observed_order: null,
        asymptotic_ratio: null,
        grid_independent: false,
      }),
    );
    assert.equal(div.overallStatus, 'NON_COMPLIANT');
    assert.equal(div.tone, 'bad');

    const badSkew = evaluateMeshQualityCompliance(baseStudy(), { maxSkewness: 0.97 });
    assert.equal(badSkew.overallStatus, 'NON_COMPLIANT');
    assert.equal(badSkew.criteria.find((c) => c.id === 'max_skewness')?.status, 'fail');
  });

  it('extracts real geometric quality rows without fabricating missing fields', () => {
    const parsed = extractMeshQualityFromRows([
      { label: 'Min Orthogonal Quality', value: '0.38' },
      { label: 'Max Skewness', value: '0.61' },
      { label: 'Mesh Elements', value: '12,400' },
    ]);
    assert.equal(parsed.minOrthogonalQuality, 0.38);
    assert.equal(parsed.maxSkewness, 0.61);
    assert.equal(parsed.elementsCount, 12400);
    assert.equal(parsed.maxNonOrthogonality, undefined);
  });
});
