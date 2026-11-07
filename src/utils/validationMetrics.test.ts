import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProfileSpec } from '../types/thesis';
import { DEFAULT_PROFILE_SPEC, FieldGrid, compareToReference, evaluateValidation, parseReferenceCsv, sampleProfile } from './validationMetrics';

const spec = (patch: Partial<ProfileSpec>): ProfileSpec => ({ ...DEFAULT_PROFILE_SPEC, ...patch });

// Row r is y = r * H / (rows - 1); column c is x = c * W / (cols - 1).
function grid(rows: number, cols: number, W: number | undefined, H: number | undefined, f: (x: number, y: number) => number): FieldGrid {
  const w = W ?? 1;
  const h = H ?? 1;
  return {
    key: 'temperature_matrix',
    label: 'Temperature field',
    unit: '°C',
    rows,
    cols,
    widthM: W,
    heightM: H,
    data: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => f((c * w) / (cols - 1), (r * h) / (rows - 1)))),
  };
}

const linear = (x: number, y: number) => 100 - 80 * x + 0 * y; // T = 100 - 80x on a unit square
const bilinear = (x: number, y: number) => 10 + 2 * x + 3 * y + 5 * x * y;

function ok(result: ReturnType<typeof sampleProfile>) {
  assert.equal(result.ok, true, result.ok ? '' : (result as { error: string }).error);
  return (result as { ok: true; profile: import('./validationMetrics').SampledProfile }).profile;
}

describe('sampleProfile', () => {
  it('horizontal centerline of a linear field is exact, even when the centre is not a node', () => {
    for (const n of [6, 11, 21]) {
      const profile = ok(sampleProfile(grid(n, n, 1, 1, linear), spec({ kind: 'horizontal', position: 0.5 })));
      assert.equal(profile.points.length, n);
      for (const p of profile.points) assert.ok(Math.abs(p.value - (100 - 80 * p.s)) < 1e-9);
      assert.equal(profile.abscissaLabel, 'x (m)');
    }
  });

  it('vertical cut returns y as the abscissa', () => {
    const profile = ok(sampleProfile(grid(11, 11, 1, 1, linear), spec({ kind: 'vertical', position: 0.25 })));
    assert.equal(profile.points.length, 11);
    for (const p of profile.points) assert.ok(Math.abs(p.value - 80) < 1e-9);
    assert.ok(Math.abs(profile.points[10].s - 1) < 1e-12);
    assert.equal(profile.abscissaLabel, 'y (m)');
  });

  it('diagonal and arbitrary cut-lines reproduce a bilinear field exactly (non-square domain)', () => {
    const g = grid(7, 5, 2, 1, bilinear);
    const diagonal = ok(sampleProfile(g, spec({ kind: 'diagonal' })));
    for (const p of diagonal.points) assert.ok(Math.abs(p.value - bilinear(p.x, p.y)) < 1e-9);
    assert.ok(Math.abs(diagonal.points[diagonal.points.length - 1].s - Math.hypot(2, 1)) < 1e-9);

    const line = ok(sampleProfile(g, spec({ kind: 'line', units: 'm', x0: 0.2, y0: 0.1, x1: 1.8, y1: 0.9 })));
    for (const p of line.points) assert.ok(Math.abs(p.value - bilinear(p.x, p.y)) < 1e-9);
    assert.ok(Math.abs(line.points[line.points.length - 1].s - Math.hypot(1.6, 0.8)) < 1e-9);
    assert.match(line.abscissaLabel, /^s \(m\)/);
  });

  it('accepts a reversed cut-line and still increases the abscissa from the start point', () => {
    const forward = ok(sampleProfile(grid(11, 11, 1, 1, bilinear), spec({ kind: 'line', units: 'm', x0: 0, y0: 0, x1: 1, y1: 1 })));
    const backward = ok(sampleProfile(grid(11, 11, 1, 1, bilinear), spec({ kind: 'line', units: 'm', x0: 1, y0: 1, x1: 0, y1: 0 })));
    assert.ok(Math.abs(backward.points[0].value - forward.points[forward.points.length - 1].value) < 1e-12);
    assert.ok(backward.points[1].s > backward.points[0].s);
  });

  it('normalises the abscissa to 0..1 on request', () => {
    const profile = ok(sampleProfile(grid(11, 11, 2, 1, linear), spec({ kind: 'horizontal', normalizeAbscissa: true })));
    assert.equal(profile.points[0].s, 0);
    assert.ok(Math.abs(profile.points[10].s - 1) < 1e-12);
    assert.equal(profile.abscissaLabel, 'x / Lx');
  });

  it('interprets fractions against the real domain size', () => {
    const g = grid(11, 21, 2, 1, (x, y) => y); // value = y
    const profile = ok(sampleProfile(g, spec({ kind: 'horizontal', units: 'fraction', position: 0.3 })));
    for (const p of profile.points) assert.ok(Math.abs(p.value - 0.3) < 1e-9);
    assert.match(profile.description, /y = 0\.3 m/);
    const meters = ok(sampleProfile(g, spec({ kind: 'horizontal', units: 'm', position: 0.3 })));
    assert.ok(Math.abs(meters.points[0].value - 0.3) < 1e-9);
  });

  it('refuses cuts outside the domain instead of extrapolating', () => {
    const g = grid(11, 11, 1, 1, linear);
    assert.equal(sampleProfile(g, spec({ kind: 'horizontal', units: 'm', position: 1.5 })).ok, false);
    assert.equal(sampleProfile(g, spec({ kind: 'vertical', units: 'fraction', position: -0.1 })).ok, false);
    assert.equal(sampleProfile(g, spec({ kind: 'line', units: 'm', x0: 0, y0: 0, x1: 1.2, y1: 1 })).ok, false);
    assert.equal(sampleProfile(g, spec({ kind: 'line', units: 'm', x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 })).ok, false);
  });

  it('does not assume a 1 m domain when the solver reported no size', () => {
    const g = grid(11, 11, undefined, undefined, linear);
    const meters = sampleProfile(g, spec({ units: 'm', position: 0.5 }));
    assert.equal(meters.ok, false);
    assert.match((meters as { error: string }).error, /domain size/);
    const fraction = ok(sampleProfile(g, spec({ units: 'fraction', position: 0.5 })));
    assert.equal(fraction.physical, false);
    assert.equal(fraction.abscissaLabel, 'x / Lx');
  });

  it('keeps a node-aligned sample even when a neighbouring node is non-finite', () => {
    const g = grid(5, 5, 1, 1, linear);
    g.data[1][1] = Number.NaN; // node (x = 0.25, y = 0.25)
    const profile = ok(sampleProfile(g, spec({ kind: 'horizontal', units: 'fraction', position: 0.5 })));
    assert.equal(profile.points.length, 5); // y = 0.5 is row 2: unaffected
    const near = sampleProfile(g, spec({ kind: 'horizontal', units: 'fraction', position: 0.25 }));
    const points = ok(near).points;
    assert.equal(points.length, 4); // only the NaN node itself is dropped
  });
});

describe('parseReferenceCsv', () => {
  it('reads comma, tab, semicolon and whitespace separated numbers, sorted by x', () => {
    const { points, skipped } = parseReferenceCsv('x,T\n0.5,60\n0.1\t92\n# comment\n0.9;28\n0.3 76.5\n1e-1,1.5E+2\nnot,numbers\n');
    assert.deepEqual(points.map((p) => p.x), [0.1, 0.1, 0.3, 0.5, 0.9]);
    assert.equal(points.find((p) => p.y === 150)?.x, 0.1);
    assert.equal(skipped, 2); // the header line and the garbage line
  });

  it('returns nothing for empty or one-column input', () => {
    assert.deepEqual(parseReferenceCsv('').points, []);
    assert.equal(parseReferenceCsv('1\n2\n3').skipped, 3);
  });
});

describe('evaluateValidation', () => {
  it('cuts the first field by default and compares against the reference', () => {
    const g = grid(11, 11, 1, 1, linear);
    const evaluation = evaluateValidation([g], undefined, { points: [{ x: 0.5, y: 60 }] });
    assert.equal(evaluation.spec.kind, 'horizontal');
    assert.equal(evaluation.field?.key, 'temperature_matrix');
    assert.equal(evaluation.comparison?.compared, 1);
    assert.ok((evaluation.comparison?.maxAbsError as number) < 1e-9);
  });

  it('falls back to the first field when the stored field is gone, and reports invalid cuts', () => {
    const g = grid(11, 11, 1, 1, linear);
    const evaluation = evaluateValidation([g], spec({ fieldKey: 'von_mises_matrix', kind: 'horizontal', units: 'm', position: 5 }), undefined);
    assert.equal(evaluation.spec.fieldKey, 'temperature_matrix');
    assert.equal(evaluation.sampled?.ok, false);
    assert.equal(evaluation.comparison, undefined);
  });

  it('has no evaluation when the run returned no 2-D field', () => {
    const evaluation = evaluateValidation([], undefined, { points: [{ x: 0, y: 0 }] });
    assert.equal(evaluation.field, undefined);
    assert.equal(evaluation.sampled, undefined);
  });
});

describe('compareToReference', () => {
  const profile = Array.from({ length: 11 }, (_, i) => ({ s: i / 10, value: 100 - 80 * (i / 10), x: i / 10, y: 0.5 }));

  it('reports zero error for points lying on the profile', () => {
    const result = compareToReference(profile, [0, 0.25, 0.5, 1].map((x) => ({ x, y: 100 - 80 * x })));
    assert.equal(result.compared, 4);
    assert.ok((result.maxAbsError as number) < 1e-9);
    assert.ok((result.meanAbsPercent as number) < 1e-9);
    assert.ok(Math.abs((result.r2 as number) - 1) < 1e-12);
  });

  it('computes percentage, absolute and RMS errors against known offsets', () => {
    // Reference is 10 % above the simulation at every point.
    const ref = [0.2, 0.4, 0.6].map((x) => ({ x, y: (100 - 80 * x) * 1.1 }));
    const result = compareToReference(profile, ref);
    assert.ok(Math.abs((result.meanAbsPercent as number) - 100 / 11) < 1e-9); // |sim-ref|/ref = 0.1/1.1
    const abs = ref.map((p) => Math.abs(100 - 80 * p.x - p.y));
    assert.ok(Math.abs((result.maxAbsError as number) - Math.max(...abs)) < 1e-9);
    assert.ok(Math.abs((result.rmse as number) - Math.sqrt(abs.reduce((s, v) => s + v * v, 0) / 3)) < 1e-9);
  });

  it('excludes reference points outside the sampled range instead of extrapolating', () => {
    const result = compareToReference(profile, [{ x: 0.5, y: 60 }, { x: 1.5, y: -20 }, { x: -0.2, y: 116 }]);
    assert.equal(result.compared, 1);
    assert.equal(result.outOfRange, 2);
    assert.equal(result.rows[1].status, 'out-of-range');
    assert.equal(result.rows[1].sim, undefined);
  });

  it('keeps zero reference values in the absolute metrics but not in the percentage', () => {
    const flat = Array.from({ length: 5 }, (_, i) => ({ s: i / 4, value: 1, x: i / 4, y: 0 }));
    const result = compareToReference(flat, [{ x: 0.25, y: 0 }, { x: 0.5, y: 2 }]);
    assert.equal(result.compared, 2);
    assert.equal(result.zeroReference, 1);
    assert.equal(result.rows[0].percentError, undefined);
    assert.ok(Math.abs((result.meanAbsPercent as number) - 50) < 1e-9);
    assert.ok(Math.abs((result.meanAbsError as number) - 1) < 1e-9);
  });

  it('returns an empty comparison when nothing overlaps', () => {
    const result = compareToReference(profile, [{ x: 5, y: 1 }]);
    assert.equal(result.compared, 0);
    assert.equal(result.rmse, undefined);
  });
});
