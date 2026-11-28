import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import net from 'net';
import os from 'os';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const val = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.PORT) {
    const val = parseInt(process.env.PORT, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return 3000;
}

function resolveHost(): string {
  const hostArgIndex = process.argv.indexOf('--host');
  if (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) {
    return process.argv[hostArgIndex + 1];
  }
  return process.env.HOST || '0.0.0.0';
}

const PORT = resolvePort();
const HOST = resolveHost();
const app = express();
const PYTHON_PORT = process.env.PYTHON_PORT || '8000';
const DEFAULT_PYTHON_URL = process.env.PYTHON_BACKEND_URL || `http://127.0.0.1:${PYTHON_PORT}`;
let activeCloudUrl = DEFAULT_PYTHON_URL;
let activeLicenseConfig = {
  licenseServerHost: '127.0.0.1',
  licenseFlexNetPort: 1055,
  licenseAnsysLiPort: 2325,
  licenseType: 'open_source_unlicensed',
  parallelCores: 8,
  workingDirectory: '/app/jobs',
};

// Integrated CAE & Physics Backend Ready natively on Node.js
console.log(`[NASEER Universal CAE Studio] Solver bridge starting on port ${PORT} -> Docker FastAPI ${DEFAULT_PYTHON_URL}`);


// Canonical job authority: FastAPI owns all simulation jobs. These routes are a strict
// reverse proxy and are mounted before the body parsers so the raw request body is forwarded untouched.
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'content-encoding',
]);

async function proxyToFastApi(req: Request, res: Response) {
  let body: Buffer | undefined;
  const pathname = (req.originalUrl || '').split('?')[0];
  const isSseRoute = pathname.endsWith('/stream');
  const abortController = new AbortController();
  const handleClientClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };

  try {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunks.length > 0) body = Buffer.concat(chunks);
    }

    const targetUrl = `${activeCloudUrl}${req.originalUrl}`;
    const timeoutMs =
      req.originalUrl.includes('mesh-study') ||
      req.originalUrl.includes('parametric-sweep') ||
      req.originalUrl.includes('export-case')
        ? 180000
        : 420000;

    let signal: AbortSignal;
    if (isSseRoute) {
      req.on('close', handleClientClose);
      signal = abortController.signal;
    } else {
      signal = AbortSignal.timeout(timeoutMs);
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal,
    });

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isEventStream = isSseRoute || contentType.includes('text/event-stream');

    if (isEventStream && upstream.body && upstream.status < 400) {
      req.on('close', handleClientClose);
      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== 'cache-control' && lower !== 'x-accel-buffering') {
          res.setHeader(name, value);
        }
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (res.writableEnded || req.destroyed) {
            await reader.cancel().catch(() => {});
            break;
          }
          if (value && value.byteLength > 0) {
            res.write(Buffer.from(value));
          }
        }
      } catch (streamErr: any) {
        if (streamErr?.name !== 'AbortError' && !req.destroyed) {
          console.warn('[SSE Proxy] Upstream stream terminated:', streamErr?.message || streamErr);
        }
      } finally {
        req.off('close', handleClientClose);
        reader.releaseLock();
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    req.off('close', handleClientClose);
    upstream.headers.forEach((value, name) => {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
    });
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err: any) {
    req.off('close', handleClientClose);
    if (err?.name === 'AbortError' && (req.destroyed || res.writableEnded)) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    return res.status(502).json({
      success: false,
      code: 'PYTHON_SOLVER_UNREACHABLE',
      error: `تعذر الوصول إلى محرك المحاكاة في Docker على (${activeCloudUrl}): ${err?.message || String(err)}`,
    });
  }
}
app.use(
  ['/api/run-simulation', '/api/jobs', '/api/verify-job', '/api/provenance', '/api/mesh-study', '/api/mesh-generate', '/api/cad-preview', '/api/cad', '/api/parametric-sweep', '/api/vv', '/api/telemetry', '/api/enterprise'],
  proxyToFastApi,
);
// Stream raw multipart/form-data CAD/mesh uploads directly to FastAPI without JSON buffering
app.use('/api/upload-model', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    return proxyToFastApi(req, res);
  }
  return next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.get('/api/implementation-checklist', (_req: Request, res: Response) => {
  const checklistPath = path.resolve(process.cwd(), 'IMPLEMENTATION_PLAN_AND_VERIFICATION_CHECKLIST.md');
  if (!fs.existsSync(checklistPath)) {
    return res.status(404).json({ error: 'Checklist file not found' });
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="NASEER_IMPLEMENTATION_PLAN_AND_VERIFICATION_CHECKLIST.md"');
  return res.send(fs.readFileSync(checklistPath, 'utf-8'));
});

// Helper to get Gemini client either from client-provided key or server environment
function getGeminiClient(req: Request): GoogleGenAI | null {
  const customKey = (req.headers['x-gemini-api-key'] as string) || '';
  const apiKey = customKey.trim() || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return null;

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Supported @google/genai text models
const MODEL_CASCADE = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

async function generateWithModelFallback(client: GoogleGenAI, requestPayload: any) {
  let lastError: any = null;

  for (const model of MODEL_CASCADE) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.models.generateContent({
          ...requestPayload,
          model,
        });
        if (response && response.text) {
          return { response, usedModel: model };
        }
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || String(err);
        const isTemporary = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
        if (isTemporary && attempt === 0) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('فشلت جميع المحاولات مع نماذج التحليل الهندسية');
}

// API Route: Test API Key Health
app.post('/api/keys/test', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const testKey = (apiKey || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY || '') as string;

    if (!testKey.trim()) {
      return res.status(400).json({ success: false, error: 'لم يتم توفير مفتاح API للاختبار' });
    }

    const testClient = new GoogleGenAI({
      apiKey: testKey.trim(),
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const { response, usedModel } = await generateWithModelFallback(testClient, {
      contents: [{ role: 'user', parts: [{ text: 'Respond with exactly: OK' }] }],
      config: { systemInstruction: 'Reply with a single word: OK.' },
    });

    if (response && response.text !== undefined) {
      return res.json({
        success: true,
        message: `المفتاح نشط ويعمل بكفاءة عبر نموذج (${usedModel})`,
        model: usedModel,
      });
    }
    return res.status(500).json({ success: false, error: 'استجابة غير متوقعة من المزود' });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const isQuota = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
    return res.status(isQuota ? 429 : 500).json({
      success: false,
      error: isQuota ? 'تم تجاوز حصة الاستخدام (Rate Limit / Quota Exceeded 429)' : errorMsg,
      isQuota,
    });
  }
});

// ==============================================================================
// Python Backend Integration Endpoints (FastAPI Bridge)
// ==============================================================================

// Cloud & Python Backend Health and System Status
app.get('/api/python/health', async (_req: Request, res: Response) => {
  try {
    const pyRes = await fetch(`${activeCloudUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (pyRes.ok) {
      const data = await pyRes.json();
      return res.json({ connected: true, backendUrl: activeCloudUrl, ...data });
    }
    throw new Error('Not ok');
  } catch (err: any) {
    return res.json({
      connected: false,
      status: 'unreachable',
      backendUrl: activeCloudUrl,
      message: `تعذر الاتصال بمحرك بايثون على ${activeCloudUrl}`,
      engine: 'NASEER Universal CAE Studio solver bridge',
      error: err?.message || String(err),
    });
  }
});


// Full Cloud System & Hardware Metrics
app.get('/api/cloud/status', async (_req: Request, res: Response) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();

  let pythonConnected = false;
  let pythonDetails: any = null;
  try {
    const pyRes = await fetch(`${activeCloudUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (pyRes.ok) {
      pythonConnected = true;
      pythonDetails = await pyRes.json();
    }
  } catch (e: any) {
    pythonConnected = false;
  }

  return res.json({
    status: 'online',
    backendUrl: activeCloudUrl,
    isLocal: activeCloudUrl.includes('127.0.0.1') || activeCloudUrl.includes('localhost'),
    pythonConnected,
    pythonDetails,
    system: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Standard Multi-Core CPU',
      totalMemoryGb: +(totalMem / (1024 ** 3)).toFixed(2),
      freeMemoryGb: +(freeMem / (1024 ** 3)).toFixed(2),
      usedMemoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      storageCapacityGb: 400,
    },
    licenseConfig: activeLicenseConfig,
  });
});

// Live HPC Cluster Telemetry (Workers, MPI Cores, Active & Queued Jobs)
app.get('/api/cluster/status', async (_req: Request, res: Response) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();

  try {
    const pyRes = await fetch(`${activeCloudUrl}/api/cluster/status`, { signal: AbortSignal.timeout(3000) });
    if (pyRes.ok) {
      const clusterData = await pyRes.json();
      return res.json({
        connected: true,
        backendUrl: activeCloudUrl,
        ...clusterData,
        hostSystem: {
          cpuCount: cpus.length,
          cpuModel: cpus[0]?.model || 'Multi-Core Processor',
          totalMemoryGb: +(totalMem / (1024 ** 3)).toFixed(2),
          freeMemoryGb: +(freeMem / (1024 ** 3)).toFixed(2),
        },
        configuredParallelCores: activeLicenseConfig.parallelCores,
      });
    }
  } catch (_err) {
    // Fallback when Docker FastAPI (:8000) is not yet running
  }

  return res.json({
    connected: false,
    status: 'DEGRADED',
    backendUrl: activeCloudUrl,
    redis: false,
    workers_online: 0,
    worker_names: [],
    workers: [],
    total_cluster_cores: cpus.length,
    host_cpu_cores: cpus.length,
    mpi_cores_per_worker: activeLicenseConfig.parallelCores,
    active_tasks_count: 0,
    queued_tasks_count: 0,
    solvers: {},
    hostSystem: {
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Multi-Core Processor',
      totalMemoryGb: +(totalMem / (1024 ** 3)).toFixed(2),
      freeMemoryGb: +(freeMem / (1024 ** 3)).toFixed(2),
    },
    configuredParallelCores: activeLicenseConfig.parallelCores,
  });
});

// Downloadable Multi-Worker Docker Compose File
app.get('/api/cluster/compose-file', (_req: Request, res: Response) => {
  const filePath = path.resolve(process.cwd(), 'docker-compose.cluster.yml');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'docker-compose.cluster.yml not found' });
  }
  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="docker-compose.cluster.yml"');
  return res.send(fs.readFileSync(filePath, 'utf-8'));
});

// Downloadable Ubuntu HPC Cloud Provisioning Script
app.get('/api/cluster/deploy-script', (_req: Request, res: Response) => {
  const filePath = path.resolve(process.cwd(), 'deploy-hpc-cluster.sh');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'deploy-hpc-cluster.sh not found' });
  }
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="deploy-hpc-cluster.sh"');
  return res.send(fs.readFileSync(filePath, 'utf-8'));
});

function validateCloudBackendUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return { valid: false, error: 'الرجاء توفير رابط الخادم السحابي' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'صيغة رابط الخادم غير صالحة (يجب أن يبدأ بـ http:// أو https://)' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'يُسمح فقط ببروتوكول http أو https لرابط الخادم' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fd00:ec2:')
  ) {
    return { valid: false, error: 'عنوان الخادم محظور لأسباب أمنية (نطاق بيانات سحابية داخلية غير مسموح)' };
  }
  return { valid: true, normalized: `${parsed.protocol}//${parsed.host}` };
}

// Test Connection to a specified Cloud Backend URL
app.post('/api/cloud/test-connection', async (req: Request, res: Response) => {
  const check = validateCloudBackendUrl(req.body?.backendUrl || activeCloudUrl || '');
  if (!check.valid || !check.normalized) {
    return res.status(400).json({ success: false, error: check.error || 'رابط غير صالح' });
  }
  const testUrl = check.normalized;

  const startTime = Date.now();
  try {
    const response = await fetch(`${testUrl}/api/health`, { signal: AbortSignal.timeout(20000) });
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      activeCloudUrl = testUrl; // dynamically apply tested cloud endpoint
      return res.json({
        success: true,
        latencyMs,
        backendUrl: testUrl,
        message: `تم الاتصال بالخادم السحابي بنجاح (${latencyMs}ms)`,
        data,
      });
    }

    return res.status(response.status).json({
      success: false,
      latencyMs,
      error: `استجاب الخادم برمز خطأ HTTP ${response.status}`,
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return res.status(502).json({
      success: false,
      latencyMs,
      error: `تعذر الوصول إلى الخادم السحابي الخارجي على (${testUrl}). تأكد من إدخال عنوان IP صحيح وتشغيل الخادم عليه.`,
      detail: err?.message,
    });
  }
});

// Update & Persist Cloud & License Configuration
app.post('/api/cloud/config', async (req: Request, res: Response) => {
  try {
    const {
      backendUrl,
      workingDirectory,
      parallelCores,
      licenseServerHost,
      licenseFlexNetPort,
      licenseAnsysLiPort,
      licenseType,
    } = req.body || {};

    if (backendUrl && typeof backendUrl === 'string') {
      const check = validateCloudBackendUrl(backendUrl);
      if (!check.valid || !check.normalized) {
        return res.status(400).json({ success: false, error: check.error || 'رابط غير صالح' });
      }
      activeCloudUrl = check.normalized;
    }

    activeLicenseConfig = {
      licenseServerHost: licenseServerHost || activeLicenseConfig.licenseServerHost,
      licenseFlexNetPort: Number(licenseFlexNetPort) || 1055,
      licenseAnsysLiPort: Number(licenseAnsysLiPort) || 2325,
      licenseType: licenseType || activeLicenseConfig.licenseType,
      parallelCores: Number(parallelCores) || activeLicenseConfig.parallelCores,
      workingDirectory: workingDirectory || activeLicenseConfig.workingDirectory,
    };

    return res.json({
      success: true,
      message: 'تم حفظ إعدادات السحابة والترخيص بنجاح',
      activeCloudUrl,
      config: activeLicenseConfig,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// Probe & Test HPC Cluster / External License Server Connectivity
app.post('/api/license/test', async (req: Request, res: Response) => {
  const { host, port = 1055, licenseType = 'academic' } = req.body || {};
  const cleanHost = (host || activeLicenseConfig.licenseServerHost || '127.0.0.1')
    .replace(/^https?:\/\//, '')
    .split(':')[0]
    .trim()
    .toLowerCase();
  const testPort = Number(port) || 1055;
  if (
    !cleanHost ||
    !/^[a-z0-9.\-]+$/.test(cleanHost) ||
    cleanHost === '169.254.169.254' ||
    cleanHost.startsWith('169.254.') ||
    cleanHost === 'metadata.google.internal' ||
    !Number.isInteger(testPort) ||
    testPort < 1 ||
    testPort > 65535
  ) {
    return res.status(400).json({
      success: false,
      reachable: false,
      error: 'عنوان أو منفذ خادم الترخيص غير صالح أو محظور أمنياً',
    });
  }

  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
    try {
      const startTime = Date.now();
      const healthRes = await fetch(`${activeCloudUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      const latencyMs = Date.now() - startTime;
      if (!healthRes.ok) {
        return res.status(healthRes.status).json({
          success: false,
          reachable: false,
          host: cleanHost,
          port: testPort,
          licenseType,
          status: 'api_error',
          error: `استجاب خادم Docker على ${activeCloudUrl} برمز خطأ HTTP ${healthRes.status}.`,
        });
      }
      const healthData = await healthRes.json();
      const workersOnline = Number(healthData?.workers_online ?? 0);
      const solvers = healthData?.solvers || {};
      const solverSummary = Object.entries(solvers)
        .filter(([, info]: [string, any]) => info?.available)
        .map(([name, info]: [string, any]) => `${name}${info?.version ? ` (${info.version})` : ''}`)
        .join(', ');

      return res.json({
        success: true,
        reachable: true,
        host: cleanHost,
        port: testPort,
        licenseType,
        latencyMs,
        status: workersOnline > 0 ? 'docker_worker_ready' : 'api_online_no_worker',
        solvers,
        redis: healthData?.redis,
        workersOnline,
        message:
          workersOnline > 0
            ? `تم التحقق الفعلي من حاوية Docker (${activeCloudUrl}) خلال ${latencyMs}ms. عمال Celery النشطون: ${workersOnline}. المحركات: ${solverSummary || 'تحقق من حاوية worker'}.`
            : `خادم FastAPI يعمل على ${activeCloudUrl} (${latencyMs}ms)، لكن لم يُرصد عامل Celery نشط (workers_online=${workersOnline}). تأكد من تشغيل خدمة worker و redis في docker-compose.`,
      });
    } catch (err: any) {
      return res.status(502).json({
        success: false,
        reachable: false,
        host: cleanHost,
        port: testPort,
        licenseType,
        status: 'docker_unreachable',
        error: `تعذر الوصول إلى خادم محركات Docker على ${activeCloudUrl}: ${err?.message || String(err)}. تأكد من تشغيل docker compose up.`,
      });
    }
  }

  // Socket TCP probe for remote license server
  const probeSocket = new net.Socket();
  const startTime = Date.now();
  let completed = false;

  const cleanup = () => {
    probeSocket.removeAllListeners();
    probeSocket.destroy();
  };

  probeSocket.setTimeout(4000);

  probeSocket.once('connect', () => {
    if (completed) return;
    completed = true;
    const latency = Date.now() - startTime;
    cleanup();
    return res.json({
      success: true,
      reachable: true,
      host: cleanHost,
      port: testPort,
      latencyMs: latency,
      message: `تم الوصول لخادم الترخيص الشبكي على المنفذ ${testPort} بنجاح (${latency}ms).`,
    });
  });

  probeSocket.once('timeout', () => {
    if (completed) return;
    completed = true;
    cleanup();
    return res.json({
      success: false,
      reachable: false,
      host: cleanHost,
      port: testPort,
      error: `انتهت مهلة الاتصال (Timeout) بخادم الترخيص ${cleanHost}:${testPort}. تأكد من اتصال الشبكة وفتح المنفذ.`,
    });
  });

  probeSocket.once('error', (err: any) => {
    if (completed) return;
    completed = true;
    cleanup();
    return res.json({
      success: false,
      reachable: false,
      host: cleanHost,
      port: testPort,
      error: `تعذر الاتصال بخادم الترخيص: ${err.message}`,
    });
  });

  try {
    probeSocket.connect(testPort, cleanHost);
  } catch (err: any) {
    if (!completed) {
      completed = true;
      cleanup();
      return res.json({
        success: false,
        reachable: false,
        error: `خطأ أثناء إنشاء مقبس الاتصال: ${err.message}`,
      });
    }
  }
});

// Upload and Parse Engineering Model File via Cloud / Docker FastAPI Parser
app.post('/api/upload-model', async (req: Request, res: Response) => {
  try {
    if (req.body && (req.body.content || req.body.file_content || req.body.base64Data || req.body.filename)) {
      const filename = req.body.filename || 'model.inp';
      const directives = req.body.directives || '';
      let buffer: Buffer;
      if (req.body.base64Data && typeof req.body.base64Data === 'string') {
        const cleanB64 = req.body.base64Data.replace(/^data:[^;]+;base64,/, '');
        buffer = Buffer.from(cleanB64, 'base64');
      } else {
        const fileData = req.body.content || req.body.file_content || '';
        buffer = Buffer.from(String(fileData), 'utf-8');
      }

      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' });
      formData.append('file', blob, filename);
      if (directives) formData.append('directives', directives);

      const forwardHeaders: Record<string, string> = {};
      if (typeof req.headers.authorization === 'string' && req.headers.authorization.trim()) {
        forwardHeaders.Authorization = req.headers.authorization;
      }

      const pyRes = await fetch(`${activeCloudUrl}/api/upload-model`, {
        method: 'POST',
        headers: forwardHeaders,
        body: formData,
        signal: AbortSignal.timeout(420000),
      });
      const data = await pyRes.json();
      return res.status(pyRes.status).json(data);
    }

    return res.status(400).json({ error: 'الرجاء إرسال الملف أو محتواه للمعالجة' });
  } catch (err: any) {
    return res.status(502).json({
      status: 'error',
      errorMessage: `فشل تمرير الملف لمحرك Docker على (${activeCloudUrl})`,
      detail: err?.message,
    });
  }
});


// API Route: Universal Multiphysics & Script/Files/Image Analysis
app.post('/api/analyze-multiphysics', async (req: Request, res: Response) => {
  try {
    const client = getGeminiClient(req);
    if (!client) {
      return res.status(400).json({
        error: 'لم يتم العثور على مفتاح API صالح. يمكنك استخدام المحرك الفيزيائي المحلي بدلاً من ذلك.',
      });
    }

    const {
      files = [],
      directives = '',
      projectField = 'CFD & Thermal',
      projectType = 'Engineering Simulation & Analysis',
      userTitle = '',
    } = req.body;

    const parts: any[] = [];

    const systemInstruction = `You are a Principal Engineering & Software Systems Architect with deep cross-disciplinary expertise across AI, Data Science, Mechanical, Electrical, Civil, Control Systems, Computational Physics, and Software Engineering.

ABSOLUTE MANDATES:
1. TRUTHFUL & UNBIASED FILE CONTENT RECOGNITION:
   - Carefully examine the user's uploaded files, scripts, documents, code, or unpacked archive files.
   - You MUST identify the ACTUAL engineering/scientific/technical domain of the user's files (e.g., Python AI/ML, Data Analytics, Control Systems, Robotics, Electrical Circuit, Software Architecture, Structural, Thermal, Aerodynamics, etc.).
   - NEVER force an ANSYS or Navier-Stokes or CFD/FEA interpretation if the user's files are NOT about that! Model the EXACT subject, code logic, variables, algorithms, and purpose present in the files!
   - In "extractedSummary", write an accurate, clear Arabic explanation detailing the true contents of the user's files, what each file does, and the actual parameters or logic extracted.

2. DOMAIN-SPECIFIC RIGOR:
   - If the project is AI/Data/Software: Detail the algorithms, loss functions, architecture, training/evaluation metrics, and hyper-parameters.
   - If the project is Physics/CAE: Detail the governing conservation equations, boundary conditions, mesh/grid study, and validation.
   - Always output pure JSON adhering to the structure below.`;

    let filesSummary = '';
    for (const f of files) {
      const isPdf = f.extension === 'pdf' || f.mimeType === 'application/pdf';
      if ((f.isImage || isPdf) && f.base64Data) {
        const cleanBase64 = f.base64Data.replace(/^data:[^;]+;base64,/, '');
        parts.push({
          inlineData: {
            mimeType: f.mimeType || (isPdf ? 'application/pdf' : 'image/png'),
            data: cleanBase64,
          },
        });
        filesSummary += `\n[Attached Visual / Document: ${f.name} (${f.mimeType || (isPdf ? 'application/pdf' : 'image')})]`;
      } else if (f.content) {
        filesSummary += `\n=== Attached Engineering File: ${f.name} (${f.category || f.extension}) ===\n${f.content.slice(0, 40000)}\n`;
      }
    }

    const userPromptText = `
Project Domain: ${projectField}
Project Type: ${projectType}
User Engineering Title: ${userTitle || 'Comprehensive CAE Analysis'}
User Directives & Specifications:
"${directives || 'Perform comprehensive multiphysics modeling, extract all boundary conditions, compute Roache GCI, and validate to ASME standards.'}"

Uploaded Engineering Documentation & Data:
${filesSummary || 'No raw files; generate a rigorous CAE model based on the directives.'}

Generate a JSON specification strictly grounded ONLY in the uploaded files and directives. CRITICAL INTEGRITY RULE: Do NOT fabricate, invent, or guess numerical simulation results, GCI percentages, R^2 values, or contour min/max results unless those exact numbers are explicitly printed inside the user's uploaded files. Leave unexecuted solver result arrays empty ([]) and numeric fields as null when not present in the source files.

Expected JSON shape:
{
  "id": "eng_proj_${Date.now()}",
  "title": "Arabic title of the exact engineering model",
  "titleEn": "English title of the engineering model",
  "author": "مهندس التحليل والمحاكاة",
  "supervisor": "مراجعة هندسية",
  "university": "NASEER CAE Workbench",
  "department": "Computational Engineering",
  "date": "${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}",
  "field": "Exact field detected from files (e.g. CFD, FEA, Thermal, CHT, Multiphase, Electromagnetic, Control)",
  "softwareType": "Actual solver or format detected (e.g. OpenFOAM, CalculiX, ElmerFEM, Gmsh, STL, STEP, INP)",
  "abstractAr": "ملخص فني دقيق بالعربية يصف المشكلة الهندسية والمدخلات المستخرجة من الملفات فقط",
  "abstractEn": "Technical abstract in English describing only the geometry, physics, and inputs extracted from the files",
  "extractedSummary": "ملخص دقيق لما تم استخراجه فعلياً من الملف المرفق والمتغيرات والشروط الحدية",
  "governingEquations": [
    { "name": "Governing equation name", "latex": "\\\\nabla \\\\cdot \\\\vec{V} = 0", "description": "Arabic explanation" }
  ],
  "boundaryConditions": [
    { "name": "Boundary name", "type": "Inlet/Outlet/Wall/Fixed Support/Load/Heat Flux", "value": "exact value from file or empty string", "unit": "unit", "description": "Explanation" }
  ],
  "material": {
    "name": "Material name from file",
    "phaseOrType": "Fluid" | "Solid" | "Gas" | "Composite",
    "density": "Value with unit if specified",
    "viscosity": "Value with unit if specified",
    "thermalConductivity": "Value with unit if specified",
    "specificHeat": "Value with unit if specified",
    "elasticModulus": "Value with unit if specified",
    "poissonRatio": "Value if specified",
    "yieldStrength": "Value with unit if specified"
  },
  "solverSettings": {
    "solverType": "Recommended OpenFOAM / CalculiX / ElmerFEM solver",
    "scheme": "Numerical discretization scheme",
    "discretization": "Spatial scheme",
    "convergenceCriteria": "Target residual tolerance from file or empty string",
    "iterations": null
  },
  "meshStudy": {
    "description": "Mesh independence methodology note — do not invent numeric GCI outcomes before Docker execution",
    "meshLevels": []
  },
  "validation": {
    "benchmarkSource": "Benchmark reference if cited in uploaded files, otherwise empty string",
    "independentVarName": "Independent parameter",
    "independentVarUnit": "-",
    "dependentVarName": "Dependent response",
    "dependentVarUnit": "-",
    "scientificDiscussion": "Only experimental/benchmark comparison data actually extracted from the uploaded files; empty if none uploaded.",
    "points": []
  },
  "contours": [],
  "thesisTables": [],
  "supervisorDefensePoints": []
}
`;

    parts.push({ text: `${systemInstruction}\n\n${userPromptText}` });

    const { response, usedModel } = await generateWithModelFallback(client, {
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const textOutput = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(textOutput);
    } catch {
      const cleaned = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    parsedData.modelUsed = usedModel;
    return res.json({ success: true, data: parsedData, modelUsed: usedModel });
  } catch (err: any) {
    console.error('Error analyzing multiphysics model:', err);
    const errorMsg = err?.message || String(err);
    const isQuota = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
    return res.status(isQuota ? 429 : 500).json({
      error: isQuota
        ? 'تم تجاوز حد الاستخدام المؤقت (Quota Exceeded 429).'
        : 'تعذر معالجة النموذج عبر السيرفر',
      details: errorMsg,
      isQuota,
    });
  }
});

// Backward-compatible and updated route for engineering simulation consultant
app.post(['/api/supervisor-query', '/api/consultant-query'], async (req: Request, res: Response) => {
  try {
    const client = getGeminiClient(req);
    if (!client) {
      return res.status(400).json({ error: 'لم يتم العثور على مفتاح API صالح' });
    }

    const { query, currentModelContext } = req.body;

    const { response, usedModel } = await generateWithModelFallback(client, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are a Senior Principal Engineering Simulation Consultant with mastery of OpenFOAM (CFD/CHT/VOF), CalculiX (FEA/Thermal-Structural), ElmerFEM (Electromagnetics/Acoustics), Gmsh, and ASME V&V 20 simulation standards.
Context of the current NASEER Universal CAE Studio model:
${JSON.stringify(currentModelContext || {}).slice(0, 10000)}

Engineer / Analyst Query:
"${query}"

Provide an authoritative, mathematically rigorous answer in clear Arabic with standard English engineering terminology. Explain the physics, equations, numerical stability criteria, and step-by-step resolution. Do not invent solver results that are not present in the context.`,
            },
          ],
        },
      ],
    });

    return res.json({ success: true, answer: response.text, usedModel });
  } catch (err: any) {
    console.error('Error in consultant query:', err);
    const errorMsg = err?.message || String(err);
    const isQuota = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
    return res.status(isQuota ? 429 : 500).json({
      error: isQuota
        ? 'تم تجاوز حد الاستخدام المؤقت (Quota Exceeded 429).'
        : 'تعذر الرد من المستشار الهندسي',
      details: errorMsg,
      isQuota,
    });
  }
});

// Production: serve built static files
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// Development: mount Vite middlewares
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

let loggedDockerAuthority = false;

async function ensureLocalPythonBackend(): Promise<void> {
  if (process.env.NASEER_AUTO_SPAWN_LOCAL_BACKEND !== '1') {
    if (!loggedDockerAuthority) {
      loggedDockerAuthority = true;
      console.log(
        `[Python Backend] Docker backend (${activeCloudUrl}) is the sole solver authority; local uvicorn auto-spawn is disabled (set NASEER_AUTO_SPAWN_LOCAL_BACKEND=1 to opt in).`,
      );
    }
    return;
  }

  try {
    const localBackend = new URL(activeCloudUrl).hostname;
    if (localBackend !== '127.0.0.1' && localBackend !== 'localhost') return;

    try {
      const response = await fetch(`${activeCloudUrl}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
    } catch {
      // The local backend is not running yet.
    }

    const backendDir = fs.existsSync(path.join(__dirname, 'main.py'))
      ? __dirname
      : path.join(__dirname, 'backend');

    const pythonCandidates = [
      path.join(backendDir, '.venv312', 'bin', 'python'),
      path.join(backendDir, '.venv', 'bin', 'python'),
      path.join(__dirname, '.venv', 'bin', 'python'),
      path.join(backendDir, '.venv312', 'Scripts', 'python.exe'),
      path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
      path.join(__dirname, '.venv', 'Scripts', 'python.exe'),
    ];
    const pythonExecutable = pythonCandidates.find((candidate) => fs.existsSync(candidate));
    if (!pythonExecutable) {
      console.warn('[Python Backend] No local virtual environment found; set PYTHON_BACKEND_URL or install backend dependencies.');
      return;
    }

    const child = spawn(pythonExecutable, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', PYTHON_PORT], {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout?.on('data', (data) => process.stdout.write(`[Python Backend] ${data}`));
    child.stderr?.on('data', (data) => process.stderr.write(`[Python Backend] ${data}`));
    child.on('error', (error) => console.error('[Python Backend] Failed to start:', error.message));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) console.error(`[Python Backend] Exited with code ${code}`);
    });
  } catch (err: any) {
    console.warn('[Python Backend] Startup check skipped:', err?.message || String(err));
  }
}

ensureLocalPythonBackend().catch((error) => {
  console.error('[Python Backend] Startup check failed:', error);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[NASEER Universal CAE Studio] Listening on http://${HOST}:${PORT}`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server Error] Port ${PORT} is already in use. Retrying or shutting down...`);
  } else {
    console.error('[Server Error]', err);
  }
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
