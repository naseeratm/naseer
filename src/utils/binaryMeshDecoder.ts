/**
 * Zero-Copy Binary `NSR1` Volumetric Mesh & Streamline Decoder
 * ============================================================
 * Decodes the exact 4-byte-aligned `application/octet-stream` binary format
 * produced by `backend/volumetric_post.py` (`pack_mesh_binary`):
 *
 *   Bytes [0..4)            : ASCII magic "NSR1"
 *   Bytes [4..8)            : uint32 little-endian `header_len`
 *   Bytes [8..8+header_len) : UTF-8 JSON header (space-padded so (8 + header_len) % 4 === 0)
 *   Bytes [8+header_len..)  : 4-byte aligned little-endian Float32Array / Uint32Array buffers
 */

import { withEnterpriseAuthHeaders } from './enterpriseAuth';

export interface NSR1BufferDescriptor {
  dtype: 'float32' | 'uint32';
  offset: number;
  byte_length?: number;
  length?: number;
  count?: number;
  shape?: number[];
}

export interface NSR1HeaderEnvelope {
  format?: string;
  version?: number;
  metadata?: Record<string, unknown>;
  buffers?: Record<string, NSR1BufferDescriptor>;
}

export interface DecodedNSR1Payload {
  metadata: Record<string, unknown>;
  buffers: Record<string, Float32Array | Uint32Array>;
  points?: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
  scalars?: Float32Array;
  speed_scalars?: Float32Array;
  line_counts?: Uint32Array;
  descriptors: Record<string, NSR1BufferDescriptor>;
}

export interface VolumetricScalarFieldMeta {
  name: string;
  min: number;
  max: number;
}

export interface VolumetricVectorFieldMeta {
  name: string;
  components: number;
  mag_min: number;
  mag_max: number;
}

export interface VolumetricPostMetadata {
  available: boolean;
  source_file?: string;
  bounds?: [number, number, number, number, number, number];
  cell_count?: number;
  point_count?: number;
  scalars: VolumetricScalarFieldMeta[];
  vectors: VolumetricVectorFieldMeta[];
  bad_cell_points?: number[][];
  error?: string;
}

const NSR1_MAGIC = 'NSR1';
const utf8Decoder = new TextDecoder('utf-8');

/**
 * Decode an `NSR1` ArrayBuffer directly into zero-copy Float32Array / Uint32Array views.
 * Throws a descriptive Error on corrupted magic bytes, truncated headers/buffers, or bad alignment.
 */
export function decodeNSR1Buffer(arrayBuffer: ArrayBuffer): DecodedNSR1Payload {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error('NSR1 decoder expects an ArrayBuffer.');
  }
  const totalBytes = arrayBuffer.byteLength;
  if (totalBytes < 8) {
    throw new Error(`Invalid NSR1 payload: expected at least 8 header bytes, got ${totalBytes}.`);
  }

  const bytes = new Uint8Array(arrayBuffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== NSR1_MAGIC) {
    throw new Error(`Invalid NSR1 magic header: expected "${NSR1_MAGIC}", got "${magic}".`);
  }

  const view = new DataView(arrayBuffer);
  const headerLen = view.getUint32(4, true);
  const dataStart = 8 + headerLen;

  if (headerLen === 0 || dataStart > totalBytes) {
    throw new Error(
      `Truncated NSR1 header: header_len=${headerLen} exceeds payload size (${totalBytes} bytes).`,
    );
  }
  if (dataStart % 4 !== 0) {
    throw new Error(
      `Misaligned NSR1 binary payload: data section starts at byte ${dataStart} (not 4-byte aligned).`,
    );
  }

  const headerSlice = bytes.subarray(8, dataStart);
  let header: NSR1HeaderEnvelope;
  try {
    header = JSON.parse(utf8Decoder.decode(headerSlice)) as NSR1HeaderEnvelope;
  } catch (err) {
    throw new Error(
      `Corrupted NSR1 JSON header: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (header.format && header.format !== NSR1_MAGIC) {
    throw new Error(`Unsupported NSR1 header format "${header.format}".`);
  }

  const metadata: Record<string, unknown> =
    header.metadata && typeof header.metadata === 'object' ? header.metadata : {};
  const descriptors: Record<string, NSR1BufferDescriptor> =
    header.buffers && typeof header.buffers === 'object' ? header.buffers : {};

  const payloadBytes = totalBytes - dataStart;
  const buffers: Record<string, Float32Array | Uint32Array> = {};

  for (const [name, desc] of Object.entries(descriptors)) {
    if (!desc || typeof desc !== 'object') {
      throw new Error(`Invalid NSR1 buffer descriptor for "${name}".`);
    }
    const dtype = String(desc.dtype || '').toLowerCase();
    if (dtype !== 'float32' && dtype !== 'uint32') {
      throw new Error(`Unsupported NSR1 buffer dtype "${desc.dtype}" for "${name}".`);
    }

    const offset = Number(desc.offset);
    const byteLength =
      typeof desc.byte_length === 'number'
        ? desc.byte_length
        : typeof desc.length === 'number'
          ? desc.length * 4
          : typeof desc.count === 'number'
            ? desc.count * 4
            : -1;

    if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) {
      throw new Error(`Invalid or misaligned NSR1 offset (${desc.offset}) for buffer "${name}".`);
    }
    if (!Number.isInteger(byteLength) || byteLength < 0 || byteLength % 4 !== 0) {
      throw new Error(
        `Invalid NSR1 byte_length (${byteLength}) for buffer "${name}" (must be non-negative multiple of 4).`,
      );
    }
    if (offset + byteLength > payloadBytes) {
      throw new Error(
        `Truncated NSR1 buffer "${name}": requires bytes [${offset}..${offset + byteLength}), but binary payload is ${payloadBytes} bytes.`,
      );
    }

    const elementCount = byteLength / 4;
    if (typeof desc.count === 'number' && desc.count !== elementCount) {
      throw new Error(
        `Inconsistent NSR1 count for "${name}": descriptor count=${desc.count} vs byte_length/4=${elementCount}.`,
      );
    }

    const absOffset = dataStart + offset;
    buffers[name] =
      dtype === 'uint32'
        ? new Uint32Array(arrayBuffer, absOffset, elementCount)
        : new Float32Array(arrayBuffer, absOffset, elementCount);
  }

  return {
    metadata,
    buffers,
    points: buffers.points instanceof Float32Array ? buffers.points : undefined,
    indices: buffers.indices instanceof Uint32Array ? buffers.indices : undefined,
    normals: buffers.normals instanceof Float32Array ? buffers.normals : undefined,
    scalars: buffers.scalars instanceof Float32Array ? buffers.scalars : undefined,
    speed_scalars: buffers.speed_scalars instanceof Float32Array ? buffers.speed_scalars : undefined,
    line_counts: buffers.line_counts instanceof Uint32Array ? buffers.line_counts : undefined,
    descriptors,
  };
}

/**
 * Extract a human-readable error message from a failed FastAPI / Express response.
 */
async function extractHttpErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status} ${response.statusText || 'Request failed'}`.trim();
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as Record<string, unknown>;
      const detail = data.detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail && typeof detail === 'object') {
        const d = detail as Record<string, unknown>;
        if (typeof d.message === 'string' && d.message.trim()) return d.message;
        if (typeof d.error === 'string' && d.error.trim()) return d.error;
      }
      if (typeof data.error === 'string' && data.error.trim()) return data.error;
      if (typeof data.message === 'string' && data.message.trim()) return data.message;
    } else {
      const text = (await response.text()).trim();
      if (text) return text.slice(0, 300);
    }
  } catch {
    // Fall through to status fallback
  }
  return fallback;
}

/**
 * Fetch an `NSR1` binary payload from `/api/jobs/{taskId}/post/*.bin` with Enterprise RBAC headers.
 */
export async function fetchBinaryPostPayload(
  url: string,
  init: RequestInit = {},
): Promise<DecodedNSR1Payload> {
  const existingHeaders: Record<string, string> = {};
  if (init.headers) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      existingHeaders[key] = value;
    });
  }
  if (init.body && !existingHeaders['Content-Type'] && !existingHeaders['content-type']) {
    existingHeaders['Content-Type'] = 'application/json';
  }
  if (!existingHeaders.Accept && !existingHeaders.accept) {
    existingHeaders.Accept = 'application/octet-stream, application/json';
  }

  const response = await fetch(url, {
    ...init,
    headers: withEnterpriseAuthHeaders(existingHeaders),
  });

  if (!response.ok) {
    const msg = await extractHttpErrorMessage(response);
    throw new Error(msg);
  }

  const buffer = await response.arrayBuffer();
  return decodeNSR1Buffer(buffer);
}

/**
 * Query volumetric post-processing capabilities & fields for a completed solver job.
 */
export async function fetchVolumetricPostMetadata(
  taskId: string,
  signal?: AbortSignal,
): Promise<VolumetricPostMetadata> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/post/metadata`, {
    method: 'GET',
    headers: withEnterpriseAuthHeaders({ Accept: 'application/json' }),
    signal,
  });

  if (!response.ok) {
    const msg = await extractHttpErrorMessage(response);
    return {
      available: false,
      scalars: [],
      vectors: [],
      error: msg,
    };
  }

  const data = (await response.json()) as Partial<VolumetricPostMetadata>;
  return {
    available: Boolean(data.available),
    source_file: data.source_file,
    bounds: Array.isArray(data.bounds) && data.bounds.length === 6 ? (data.bounds as [number, number, number, number, number, number]) : undefined,
    cell_count: typeof data.cell_count === 'number' ? data.cell_count : undefined,
    point_count: typeof data.point_count === 'number' ? data.point_count : undefined,
    scalars: Array.isArray(data.scalars) ? data.scalars : [],
    vectors: Array.isArray(data.vectors) ? data.vectors : [],
    bad_cell_points: Array.isArray(data.bad_cell_points) ? data.bad_cell_points : [],
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}
