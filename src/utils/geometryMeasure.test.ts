import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeMeasurementMetrics,
  computeVtkPhysicalBounds,
  formatLengthSI,
} from './geometryMeasure';

describe('computeMeasurementMetrics', () => {
  it('computes exact 3D Euclidean distance, components, mesh sizing hints, and scalar slope', () => {
    const res = computeMeasurementMetrics(
      { x: 0.1, y: 0.2, z: 0.0, scalarValue: 300, scalarLabel: 'T', scalarUnit: 'K' },
      { x: 0.4, y: 0.6, z: 0.0, scalarValue: 350, scalarLabel: 'T', scalarUnit: 'K' },
    );
    assert.ok(res);
    assert.ok(Math.abs(res.dx - 0.3) < 1e-12);
    assert.ok(Math.abs(res.dy - 0.4) < 1e-12);
    assert.ok(Math.abs(res.dz - 0.0) < 1e-12);
    assert.ok(Math.abs(res.distanceM - 0.5) < 1e-12);
    assert.ok(Math.abs(res.distanceMm - 500) < 1e-9);
    assert.ok(Math.abs(res.meshHintFineM - 0.5 / 15) < 1e-12);
    assert.ok(Math.abs(res.meshHintCoarseM - 0.05) < 1e-12);
    assert.ok(Math.abs((res.scalarDelta ?? 0) - 50) < 1e-12);
    assert.ok(Math.abs((res.scalarSlope ?? 0) - 100) < 1e-12);
    assert.equal(res.slopeUnit, 'K/m');
  });

  it('omits scalar delta when endpoints have no solved VTK scalar values (Zero-Mock guard)', () => {
    const res = computeMeasurementMetrics(
      { x: 0, y: 0, z: 0 },
      { x: 0.02, y: 0, z: 0 },
    );
    assert.ok(res);
    assert.equal(res.scalarDelta, undefined);
    assert.equal(res.scalarSlope, undefined);
    assert.ok(Math.abs(res.distanceMm - 20) < 1e-9);
  });

  it('rejects non-finite coordinates cleanly', () => {
    assert.equal(
      computeMeasurementMetrics({ x: NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      null,
    );
  });
});

describe('computeVtkPhysicalBounds', () => {
  it('computes exact overall Lx x Ly x Lz and diagonal from VTK points', () => {
    const b = computeVtkPhysicalBounds([0, 0, 0, 1.2, 0.4, 0.3, 0.6, 0.2, 0.15]);
    assert.ok(b);
    assert.ok(Math.abs(b.size[0] - 1.2) < 1e-12);
    assert.ok(Math.abs(b.size[1] - 0.4) < 1e-12);
    assert.ok(Math.abs(b.size[2] - 0.3) < 1e-12);
    assert.ok(Math.abs(b.diagonalM - 1.3) < 1e-12);
  });

  it('returns null on empty point arrays', () => {
    assert.equal(computeVtkPhysicalBounds([]), null);
    assert.equal(computeVtkPhysicalBounds(null), null);
  });
});

describe('formatLengthSI', () => {
  it('formats millimeter and meter scales cleanly', () => {
    assert.ok(formatLengthSI(0.05).includes('50.00 mm'));
    assert.ok(formatLengthSI(1.25).includes('1.2500 m'));
  });
});
