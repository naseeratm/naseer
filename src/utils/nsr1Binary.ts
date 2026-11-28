import { withEnterpriseAuthHeaders } from './enterpriseAuth';

export interface VolumetricScalarFieldInfo {
  name: string;
  min: number;
  max: number;
}

export interface VolumetricVectorFieldInfo {
  name: string;
  components: number;
  mag_min: number;
  mag_max: number;
}

export interface VolumetricMetadata {
  available: boolean;
  source_file?: string;
  bounds: [number, number, number, number, number, number];
  cell_count: number;
  point_count: number;
  scalars: VolumetricScalarFieldInfo[];
  vectors: VolumetricVectorFieldInfo[];
  bad_cell_points?: [number, number, number][];
}

export interface Nsr1BufferDescriptor {
  dtype: 'float32' | 'uint32';
  offset: number;
  byte_length: number;
  count: number;
  shape: number[];
}

export interface Nsr1IsoSurfaceMetadata {
  operation?: string;
  source_file?: string;
  field?: string;
  iso_value?: number;
  field_min?: number;
  field_max?: number;
  min?: number | null;
  max?: number | null;
  bounds?: [number, number, number, number, number, number];
  point_count?: number;
  triangle_count?: number;
  [key: string]: unknown;
}

export interface ParsedNsr1Payload {
  metadata: Nsr1IsoSurfaceMetadata;
  buffers: Record<string, Float32Array | Uint32Array>;
  byteLength: number;
}

interface Nsr1Header {
  format: string;
  version: number;
  metadata?: Nsr1IsoSurfaceMetadata;
  buffers?: Record<string, Nsr1BufferDescriptor>;
}

/**
 * Unpack a 4-byte-aligned `NSR1` binary buffer streamed from `/api/jobs/{taskId}/post/*.bin`
 * into zero-copy TypedArray views (`Float32Array` / `Uint32Array`) + parsed JSON metadata.
 */
export function unpackNsr1Binary(rawBuffer: ArrayBuffer): ParsedNsr1Payload {
  if (rawBuffer.byteLength < 8) {
    throw new Error('Invalid NSR1 binary stream: payload shorter than 8-byte header.');
  }

  const headerBytes = new Uint8Array(rawBuffer, 0, 4);
  const magic = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (magic !== 'NSR1') {
    throw new Error(`Invalid NSR1 binary magic header: expected "NSR1", received "${magic}".`);
  }

  const view = new DataView(rawBuffer);
  const headerLen = view.getUint32(4, true);
  const dataStart = 8 + headerLen;

  if (dataStart > rawBuffer.byteLength) {
    throw new Error('Truncated NSR1 binary header.');
  }
  if (dataStart % 4 !== 0) {
    throw new Error('Invalid NSR1 binary payload: data section is not 4-byte aligned.');
  }

  const headerText = new TextDecoder('utf-8').decode(new Uint8Array(rawBuffer, 8, headerLen));
  const parsedHeader = JSON.parse(headerText) as Nsr1Header;
  const descriptors = parsedHeader.buffers ?? {};
  const buffers: Record<string, Float32Array | Uint32Array> = {};

  for (const [name, info] of Object.entries(descriptors)) {
    const offset = Number(info.offset);
    const byteLength = Number(info.byte_length);
    const count = Number(info.count);
    const absOffset = dataStart + offset;

    if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0 || absOffset + byteLength > rawBuffer.byteLength) {
      throw new Error(`Corrupt NSR1 buffer slice for "${name}".`);
    }

    if (info.dtype === 'uint32') {
      buffers[name] = new Uint32Array(rawBuffer, absOffset, count);
    } else {
      buffers[name] = new Float32Array(rawBuffer, absOffset, count);
    }
  }

  return {
    metadata: parsedHeader.metadata ?? {},
    buffers,
    byteLength: rawBuffer.byteLength,
  };
}

async function extractHttpError(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const detail = body?.detail as Record<string, unknown> | string | undefined;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail && typeof detail === 'object' && typeof detail.error === 'string') return detail.error;
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    } catch {
      // Fall through to status text
    }
  } else {
    try {
      const text = (await res.text()).trim();
      if (text && !text.startsWith('<!')) return text.slice(0, 280);
    } catch {
      // Fall through
    }
  }
  return `${fallback} (HTTP ${res.status})`;
}

export async function fetchVolumetricMetadata(
  taskId: string,
  signal?: AbortSignal,
): Promise<VolumetricMetadata> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/post/metadata`, {
    method: 'GET',
    headers: withEnterpriseAuthHeaders(),
    signal,
  });
  if (!res.ok) {
    throw new Error(await extractHttpError(res, 'Volumetric metadata unavailable'));
  }
  const data = (await res.json()) as VolumetricMetadata & { success?: boolean; error?: string };
  if (data.success === false) {
    throw new Error(data.error || 'Volumetric metadata request failed');
  }
  return data;
}

export async function fetchIsoSurfaceBinary(
  taskId: string,
  field: string,
  isoValue: number,
  signal?: AbortSignal,
): Promise<ParsedNsr1Payload> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/post/isosurface.bin`, {
    method: 'POST',
    headers: withEnterpriseAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      field,
      iso_value: isoValue,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(await extractHttpError(res, 'Iso-surface extraction failed'));
  }

  const rawBuffer = await res.arrayBuffer();
  return unpackNsr1Binary(rawBuffer);
}
