import { withEnterpriseAuthHeaders } from './enterpriseAuth';

export interface SafeJsonResult<T = any> {
  data: T | null;
  isJson: boolean;
  rawText: string;
  diagnosticMessage: string;
}

const TERMINAL_JOB_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * Safely parse an HTTP Response body as JSON without crashing on HTML/text 502/504 proxy pages.
 */
export async function readJsonSafe<T = any>(res: Response): Promise<SafeJsonResult<T>> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return {
      data: null,
      isJson: false,
      rawText: '',
      diagnosticMessage: `تعذر قراءة استجابة الخادم (HTTP ${res.status}). تأكد من تشغيل حاويات Docker على المنفذ :8000.`,
    };
  }

  const trimmed = rawText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as T;
      return {
        data: parsed,
        isJson: true,
        rawText,
        diagnosticMessage: '',
      };
    } catch {
      // Non-JSON response (e.g., 502 Bad Gateway / 504 Gateway Timeout HTML from reverse proxy)
    }
  }

  let diagnosticMessage: string;
  if (res.status === 502 || res.status === 503) {
    diagnosticMessage = `تعذر الاتصال بخادم المحاكاة في Docker (HTTP ${res.status} — Bad Gateway/Unavailable). تحقق من تشغيل خدمات FastAPI وRedis وWorker.`;
  } else if (res.status === 504) {
    diagnosticMessage = `انتهت مهلة البوابة الوسيطة أثناء الانتظار (HTTP 504 — Gateway Timeout). أعد المحاولة أو راقب حالة المهمة من سجل المهام.`;
  } else {
    const snippet = trimmed.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    diagnosticMessage = snippet
      ? `استجابة غير صالحة (غير JSON) من الخادم (HTTP ${res.status}): ${snippet}`
      : `استجابة فارغة أو غير صالحة من الخادم (HTTP ${res.status}).`;
  }

  return {
    data: null,
    isJson: false,
    rawText,
    diagnosticMessage,
  };
}

export interface StreamJobOptions {
  signal?: AbortSignal;
  pollIntervalMs?: number;
  onProgress?: (snapshot: any) => void;
}

function isTerminalSnapshot(snapshot: any): boolean {
  const st = String(snapshot?.status || '').toUpperCase();
  return TERMINAL_JOB_STATES.has(st);
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollJobUntilDone(taskId: string, options: StreamJobOptions): Promise<any> {
  const { signal, pollIntervalMs = 1000, onProgress } = options;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`, {
      headers: withEnterpriseAuthHeaders(),
      signal,
    });
    const parsed = await readJsonSafe<any>(res);
    if (!res.ok || !parsed.data) {
      throw new Error(
        parsed.data?.error ||
          parsed.data?.detail?.error ||
          parsed.diagnosticMessage ||
          `Unable to read job ${taskId} (HTTP ${res.status})`,
      );
    }
    const snapshot = parsed.data;
    onProgress?.(snapshot);
    if (isTerminalSnapshot(snapshot)) {
      return snapshot;
    }
    await sleepWithAbort(pollIntervalMs, signal);
  }
}

/**
 * Subscribe to a live job via SSE `/api/jobs/{taskId}/stream` (keeping Bearer tokens strictly in
 * Authorization headers, never in URLs) and automatically fall back to `/api/jobs/{taskId}` polling
 * if SSE is unavailable or drops before a terminal state.
 */
export async function streamJobUntilDone(taskId: string, options: StreamJobOptions = {}): Promise<any> {
  const { signal, onProgress } = options;

  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(taskId)}/stream`, {
      method: 'GET',
      headers: withEnterpriseAuthHeaders({ Accept: 'text/event-stream' }),
      signal,
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        const parsed = await readJsonSafe<any>(res);
        throw new Error(
          parsed.data?.error ||
            parsed.data?.detail?.error ||
            parsed.diagnosticMessage ||
            `Job stream failed (HTTP ${res.status})`,
        );
      }
      // Transient 5xx or unsupported stream proxy -> fall back to polling
      return await pollJobUntilDone(taskId, options);
    }

    if (!contentType.includes('text/event-stream') || !res.body) {
      return await pollJobUntilDone(taskId, options);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let lastSnapshot: any = null;

    const processEventBlock = (block: string): { done: boolean; snapshot: any | null } => {
      let eventType = 'message';
      const dataLines: string[] = [];
      for (const rawLine of block.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) continue;
        if (rawLine.startsWith('event:')) {
          eventType = rawLine.slice(6).trim();
        } else if (rawLine.startsWith('data:')) {
          dataLines.push(rawLine.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) return { done: false, snapshot: null };
      const dataStr = dataLines.join('\n');
      try {
        const snapshot = JSON.parse(dataStr);
        lastSnapshot = snapshot;
        onProgress?.(snapshot);
        if (eventType === 'done' || isTerminalSnapshot(snapshot)) {
          return { done: true, snapshot };
        }
      } catch {
        // Ignore malformed partial frame
      }
      return { done: false, snapshot: null };
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || '';
        for (const block of parts) {
          const outcome = processEventBlock(block);
          if (outcome.done && outcome.snapshot) {
            await reader.cancel().catch(() => {});
            return outcome.snapshot;
          }
        }
      }
      if (buffer.trim()) {
        const outcome = processEventBlock(buffer);
        if (outcome.done && outcome.snapshot) {
          return outcome.snapshot;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (lastSnapshot && isTerminalSnapshot(lastSnapshot)) {
      return lastSnapshot;
    }
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    // Stream closed before terminal state (e.g., proxy idle timeout) -> seamless polling fallback
    return await pollJobUntilDone(taskId, options);
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    // If authorization/404 error was explicitly thrown above, propagate it directly
    if (err instanceof Error && /Job stream failed|not found|Authentication|privileges/i.test(err.message)) {
      throw err;
    }
    return await pollJobUntilDone(taskId, options);
  }
}
