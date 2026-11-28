import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeNSR1Buffer } from './binaryMeshDecoder.ts';

function buildNSR1Payload(
  metadata: Record<string, unknown>,
  entries: Array<{
    name: string;
    dtype: 'float32' | 'uint32';
    values: number[];
    shape?: number[];
  }>,
): ArrayBuffer {
  const encoder = new TextEncoder();
  const descriptors: Record<string, Record<string, unknown>> = {};
  const chunks: Uint8Array[] = [];
  let runningOffset = 0;

  for (const entry of entries) {
    const pad = (4 - (runningOffset % 4)) % 4;
    if (pad > 0) {
      chunks.push(new Uint8Array(pad));
      runningOffset += pad;
    }

    const byteLen = entry.values.length * 4;
    const raw = new ArrayBuffer(byteLen);
    const dv = new DataView(raw);
    for (let i = 0; i < entry.values.length; i++) {
      if (entry.dtype === 'uint32') {
        dv.setUint32(i * 4, entry.values[i], true);
      } else {
        dv.setFloat32(i * 4, entry.values[i], true);
      }
    }

    descriptors[entry.name] = {
      dtype: entry.dtype,
      offset: runningOffset,
      byte_length: byteLen,
      count: entry.values.length,
      shape: entry.shape ?? [entry.values.length],
    };
    chunks.push(new Uint8Array(raw));
    runningOffset += byteLen;
  }

  let headerBytes = encoder.encode(
    JSON.stringify({
      format: 'NSR1',
      version: 1,
      metadata,
      buffers: descriptors,
    }),
  );

  const headerPad = (4 - (headerBytes.byteLength % 4)) % 4;
  if (headerPad > 0) {
    const padded = new Uint8Array(headerBytes.byteLength + headerPad);
    padded.set(headerBytes, 0);
    padded.fill(0x20, headerBytes.byteLength);
    headerBytes = padded;
  }

  const totalBytes = 8 + headerBytes.byteLength + runningOffset;
  const out = new ArrayBuffer(totalBytes);
  const outBytes = new Uint8Array(out);
  const outView = new DataView(out);

  outBytes.set([0x4e, 0x53, 0x52, 0x31], 0); // "NSR1"
  outView.setUint32(4, headerBytes.byteLength, true);
  outBytes.set(headerBytes, 8);

  let cursor = 8 + headerBytes.byteLength;
  for (const chunk of chunks) {
    outBytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

test('decodeNSR1Buffer decodes points, indices, scalars, and line_counts across all 4-byte header remainders', () => {
  const points = [0.0, 0.0, 0.0, 1.25, -0.5, 2.75, 0.5, 1.0, -3.5];
  const indices = [0, 1, 2];
  const scalars = [300.5, 350.25, 400.75];
  const lineCounts = [2, 1];

  for (let suffixLen = 0; suffixLen < 4; suffixLen++) {
    const fieldName = `T${'x'.repeat(suffixLen)}`;
    const buf = buildNSR1Payload(
      { operation: 'slice', field: fieldName, min: 300.5, max: 400.75 },
      [
        { name: 'points', dtype: 'float32', values: points, shape: [3, 3] },
        { name: 'indices', dtype: 'uint32', values: indices, shape: [3] },
        { name: 'scalars', dtype: 'float32', values: scalars, shape: [3] },
        { name: 'line_counts', dtype: 'uint32', values: lineCounts, shape: [2] },
      ],
    );

    const decoded = decodeNSR1Buffer(buf);
    assert.equal(decoded.metadata.operation, 'slice');
    assert.equal(decoded.metadata.field, fieldName);

    assert.ok(decoded.points instanceof Float32Array);
    assert.ok(decoded.indices instanceof Uint32Array);
    assert.ok(decoded.scalars instanceof Float32Array);
    assert.ok(decoded.line_counts instanceof Uint32Array);

    // Zero-copy views must share the underlying ArrayBuffer
    assert.equal(decoded.points.buffer, buf);
    assert.equal(decoded.indices.buffer, buf);
    assert.equal(decoded.points.byteOffset % 4, 0);
    assert.equal(decoded.indices.byteOffset % 4, 0);

    assert.deepEqual(Array.from(decoded.indices), indices);
    assert.deepEqual(Array.from(decoded.line_counts), lineCounts);
    for (let i = 0; i < points.length; i++) {
      assert.ok(Math.abs(decoded.points[i] - points[i]) < 1e-5);
    }
    for (let i = 0; i < scalars.length; i++) {
      assert.ok(Math.abs(decoded.scalars[i] - scalars[i]) < 1e-4);
    }
  }
});

test('decodeNSR1Buffer rejects invalid magic bytes, misaligned headers, and truncated payloads', () => {
  // 1. Corrupt magic
  const badMagic = new ArrayBuffer(16);
  new Uint8Array(badMagic).set([0x42, 0x41, 0x44, 0x21], 0); // "BAD!"
  assert.throws(() => decodeNSR1Buffer(badMagic), /Invalid NSR1 magic header/);

  // 2. Truncated header
  const truncHeader = new ArrayBuffer(12);
  new Uint8Array(truncHeader).set([0x4e, 0x53, 0x52, 0x31], 0);
  new DataView(truncHeader).setUint32(4, 1024, true);
  assert.throws(() => decodeNSR1Buffer(truncHeader), /Truncated NSR1 header/);

  // 3. Misaligned header length (not multiple of 4)
  const misaligned = new ArrayBuffer(16);
  new Uint8Array(misaligned).set([0x4e, 0x53, 0x52, 0x31], 0);
  new DataView(misaligned).setUint32(4, 3, true);
  new Uint8Array(misaligned).set(new TextEncoder().encode('{ }'), 8);
  assert.throws(() => decodeNSR1Buffer(misaligned), /Misaligned NSR1 binary payload/);

  // 4. Truncated binary data buffer
  const valid = buildNSR1Payload(
    { operation: 'surface' },
    [{ name: 'points', dtype: 'float32', values: [1, 2, 3, 4, 5, 6] }],
  );
  const truncatedData = valid.slice(0, valid.byteLength - 4);
  assert.throws(() => decodeNSR1Buffer(truncatedData), /Truncated NSR1 buffer/);
});
