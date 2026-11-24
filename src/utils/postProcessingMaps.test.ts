import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReportMatrix } from './reportModel';
import {
  computeScalarGradientField,
  computeVtkSurfaceGradientMagnitude,
  extractIsoContourSegments,
  extractVtkProjectedVectors,
} from './postProcessingMaps';

function makeLinearTemperatureMatrix(rows: number, cols: number, widthM: number, heightM: number): ReportMatrix {
  // Exact analytical field: T(x, y) = 100 - 40*x + 30*y  =>  dT/dx = -40 K/m, dT/dy = +30 K/m, |grad T| = 50 K/m
  const data = Array.from({ length: rows }, (_, r) => {
    const y = (r * heightM) / (rows - 1);
    return Array.from({ length: cols }, (_, c) => {
      const x = (c * widthM) / (cols - 1);
      return 100 - 40 * x + 30 * y;
    });
  });
  return {
    key: 'temperature_matrix',
    label: 'Temperature field',
    unit: '°C',
    rows,
    cols,
    min: 20,
    max: 130,
    mean: 75,
    nonFiniteCount: 0,
    data,
    widthM,
    heightM,
  };
}

describe('computeScalarGradientField', () => {
  it('reproduces analytical partial derivatives, |grad T|, and Fourier heat flux q = -k*gradT exactly', () => {
    const m = makeLinearTemperatureMatrix(11, 21, 2.0, 1.0);
    const k = 0.6; // W/(m*K)
    const grad = computeScalarGradientField(m, k);
    assert.ok(grad);
    assert.equal(grad.physicalDimensions, true);
    assert.equal(grad.gradientUnit, 'K/m');
    assert.equal(grad.vectorUnit, 'W/m²');
    assert.ok(Math.abs(grad.gradX[5][10] - -40) < 1e-9);
    assert.ok(Math.abs(grad.gradY[5][10] - 30) < 1e-9);
    assert.ok(Math.abs(grad.magnitude[5][10] - 50) < 1e-9);
    assert.ok(Math.abs(grad.minMag - 50) < 1e-9);
    assert.ok(Math.abs(grad.maxMag - 50) < 1e-9);
    // Fourier heat flux q = -k * gradT = (-0.6 * -40, -0.6 * 30) = (+24, -18) W/m²
    assert.ok(Math.abs(grad.vecX[5][10] - 24) < 1e-9);
    assert.ok(Math.abs(grad.vecY[5][10] - -18) < 1e-9);
  });

  it('returns null on degenerate matrices instead of inventing synthetic gradients', () => {
    const tiny: ReportMatrix = {
      key: 'temperature_matrix',
      label: 'Temperature field',
      rows: 1,
      cols: 1,
      min: 300,
      max: 300,
      mean: 300,
      nonFiniteCount: 0,
      data: [[300]],
    };
    assert.equal(computeScalarGradientField(tiny), null);
  });
});

describe('extractVtkProjectedVectors', () => {
  it('projects real OpenFOAM 3D U vectors onto XY, XZ, and YZ planes accurately', () => {
    const vtk = {
      points: [0, 0, 0, 1, 0, 0, 0, 0.5, 0.25],
      triangles: [0, 1, 2],
      vectors: {
        U: [3, 4, 0, 6, 8, 0, 0, 0, 5],
      },
      units: { U: 'm/s' },
    };
    const xy = extractVtkProjectedVectors(vtk, 'U', 'XY', 10);
    assert.ok(xy);
    assert.equal(xy.unit, 'm/s');
    assert.equal(xy.nodeCount, 3);
    assert.ok(Math.abs(xy.maxMag - 10) < 1e-9);
    assert.equal(xy.samples.length, 3);

    const xz = extractVtkProjectedVectors(vtk, 'U', 'XZ', 10);
    assert.ok(xz);
    assert.equal(xz.axisVLabel, 'z (m)');
    assert.ok(Math.abs(xz.vMax - 0.25) < 1e-9);
  });

  it('returns null when solver returned no vector arrays (Zero-Mock guard)', () => {
    assert.equal(
      extractVtkProjectedVectors({ points: [0, 0, 0], triangles: [0, 0, 0], scalars: { T: [300] } }, 'U', 'XY'),
      null,
    );
  });
});

describe('extractIsoContourSegments', () => {
  it('extracts Marching Squares isotherm segments strictly inside [0,1] bounds', () => {
    const m = makeLinearTemperatureMatrix(9, 9, 1.0, 1.0);
    const segments = extractIsoContourSegments(m.data, 6);
    assert.ok(segments.length > 20);
    for (const seg of segments) {
      assert.ok(seg.x0 >= 0 && seg.x0 <= 1 && seg.y0 >= 0 && seg.y0 <= 1);
      assert.ok(seg.x1 >= 0 && seg.x1 <= 1 && seg.y1 >= 0 && seg.y1 <= 1);
    }
  });
});

describe('computeVtkSurfaceGradientMagnitude', () => {
  it('computes exact tangential |grad T| = 50 K/m on a 3D triangulated mesh with T(x,y,z) = 100 - 40x + 30y', () => {
    // 2x1 quad split into 2 right triangles on z = 0.25 plane
    const points = [
      0, 0, 0.25,
      2, 0, 0.25,
      2, 1, 0.25,
      0, 1, 0.25,
    ];
    const triangles = [0, 1, 2, 0, 2, 3];
    const scalars = [
      100 - 40 * 0 + 30 * 0,
      100 - 40 * 2 + 30 * 0,
      100 - 40 * 2 + 30 * 1,
      100 - 40 * 0 + 30 * 1,
    ];
    const res = computeVtkSurfaceGradientMagnitude(points, triangles, scalars);
    assert.ok(res);
    assert.equal(res.validTriangles, 2);
    assert.equal(res.values.length, 4);
    for (const v of res.values) {
      assert.ok(Math.abs(v - 50) < 1e-9, `expected 50 K/m, got ${v}`);
    }
    assert.ok(Math.abs(res.min - 50) < 1e-9);
    assert.ok(Math.abs(res.max - 50) < 1e-9);
  });

  it('returns null for degenerate zero-area triangles (Zero-Mock guard)', () => {
    const res = computeVtkSurfaceGradientMagnitude(
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 2],
      [300, 310, 320],
    );
    assert.equal(res, null);
  });
});
