'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const Store = require('electron-store');
const axios = require('axios');
const FormData = require('form-data');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = !!DEV_URL;

// API endpoints
const ENDPOINT_PRO =
  'https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-pro';
const ENDPOINT_STD =
  'https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-std';
const ENDPOINT_POLL = (taskId) =>
  `https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/${taskId}`;

// Polling cadence
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Persistent store. New fields added in this version:
//   * keys[].exhausted / exhaustedAt / exhaustedReason / completedCount / failedCount
//   * tasks[].assignedKeyId / request / localPath / localDownloadError
//   * outputFolder (string|null)
const store = new Store({
  defaults: {
    keys: [],
    tasks: [],
    outputFolder: null,
  },
});

// ---------- Windows / UI plumbing ----------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function notifyAllRenderers(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function broadcastToast(type, message) {
  notifyAllRenderers('toast', { type, message });
}

// ---------- Store helpers ----------

function getKeys() {
  return store.get('keys') || [];
}

function setKeys(keys) {
  store.set('keys', keys);
  notifyAllRenderers('keys:changed', keys);
}

function patchKey(keyId, patch) {
  const keys = getKeys();
  const idx = keys.findIndex((k) => k.id === keyId);
  if (idx < 0) return null;
  keys[idx] = { ...keys[idx], ...patch };
  setKeys(keys);
  return keys[idx];
}

function getTasks() {
  return store.get('tasks') || [];
}

function setTasks(tasks) {
  store.set('tasks', tasks);
  notifyAllRenderers('tasks:changed', tasks);
}

function upsertTask(task) {
  const tasks = getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = { ...tasks[idx], ...task };
  else tasks.unshift(task);
  setTasks(tasks);
  return tasks[idx >= 0 ? idx : 0];
}

function deleteTaskById(id) {
  const tasks = getTasks().filter((t) => t.id !== id);
  setTasks(tasks);
  return tasks;
}

function uuid() {
  return crypto.randomUUID();
}

// ---------- Magnific helpers ----------

/**
 * One-shot Magnific request bound to a specific API key. Throws the raw
 * axios error so callers can inspect `err.response?.status` (used by the
 * scheduler to decide between "retry on another key", "mark key
 * exhausted", and "fail the task").
 */
async function callMagnificWithKey({ method, url, data, apiKey }) {
  const resp = await axios({
    method,
    url,
    headers: {
      'x-magnific-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    data: data ?? undefined,
    timeout: 60_000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return resp.data;
}

/**
 * Convenience wrapper that resolves the API key automatically: prefers
 * any non-exhausted key, falling back to the (legacy) active key. Used
 * by non-queue paths like download-video.
 */
async function callMagnificAny({ method, url, data }) {
  const keys = getKeys();
  if (keys.length === 0) {
    throw new Error('No API key configured. Add a key in Settings.');
  }
  const candidates = [
    ...keys.filter((k) => !k.exhausted && k.isActive),
    ...keys.filter((k) => !k.exhausted && !k.isActive),
    ...keys.filter((k) => k.exhausted), // last-ditch: try exhausted ones too
  ];
  let lastErr = null;
  for (const k of candidates) {
    try {
      return await callMagnificWithKey({ method, url, data, apiKey: k.value });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status === 402 || isInsufficientCredits(err)) {
        markKeyExhausted(k.id, describeApiError(err));
        continue;
      }
      if (status === 429) continue;
      throw err; // non-credit failures propagate immediately
    }
  }
  throw lastErr || new Error('All API keys failed');
}

const CREDIT_REGEX = /credit|quota|insufficient|exhaust|out\s*of|limit\s*reach/i;

function isInsufficientCredits(err) {
  const status = err?.response?.status;
  if (status === 402) return true;
  const body = err?.response?.data;
  const txt =
    typeof body === 'string'
      ? body
      : body && typeof body === 'object'
        ? JSON.stringify(body)
        : '';
  return CREDIT_REGEX.test(txt);
}

function describeApiError(err) {
  const r = err?.response;
  if (r) {
    let body = r.data;
    if (typeof body !== 'string') {
      try {
        body = JSON.stringify(body);
      } catch {
        body = String(body);
      }
    }
    body = (body || '').replace(/\s+/g, ' ').slice(0, 200);
    return `HTTP ${r.status}${body ? ` — ${body}` : ''}`;
  }
  return err?.code || err?.message || String(err);
}

function markKeyExhausted(keyId, reason) {
  const keys = getKeys();
  const k = keys.find((x) => x.id === keyId);
  if (!k || k.exhausted) return;
  k.exhausted = true;
  k.exhaustedAt = new Date().toISOString();
  k.exhaustedReason = reason || 'Marked as out of credits';
  setKeys(keys);
  broadcastToast(
    'warning',
    `Key "${k.label}" marked Habis — skipping in queue. ${reason || ''}`.trim(),
  );
}

/**
 * Magnific's poll response uses different field names for failures
 * depending on quality / endpoint variant. Surface whatever the server
 * actually returned so the user sees the real reason instead of a flat
 * "Task failed".
 */
function extractFailureReason(inner) {
  if (!inner || typeof inner !== 'object') return null;
  const candidates = [
    inner.failure_reason,
    inner.failed_reason,
    inner.fail_reason,
    inner.error_message,
    inner.errorMessage,
    inner.error,
    inner.reason,
    inner.message,
    inner.detail,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 500);
    if (c && typeof c === 'object') {
      if (typeof c.message === 'string' && c.message.trim()) {
        return c.message.trim().slice(0, 500);
      }
      if (typeof c.detail === 'string' && c.detail.trim()) {
        return c.detail.trim().slice(0, 500);
      }
    }
  }
  const known = new Set([
    'task_id', 'id', 'status', 'generated',
    'created_at', 'createdAt', 'updated_at', 'updatedAt',
    'started_at', 'finished_at',
  ]);
  const extras = {};
  for (const [k, v] of Object.entries(inner)) {
    if (!known.has(k) && v != null && v !== '') extras[k] = v;
  }
  if (Object.keys(extras).length) {
    try {
      return JSON.stringify(extras).slice(0, 500);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------- Temporary public upload (uguu.se + tmpfiles.org fallback) ----------

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function mimeFor(filename) {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

const UPLOAD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function describeUploadError(err) {
  return describeApiError(err);
}

async function putToUguu(buffer, filename) {
  const form = new FormData();
  form.append('files[]', buffer, { filename, contentType: mimeFor(filename) });
  const resp = await axios.post('https://uguu.se/upload', form, {
    headers: { ...form.getHeaders(), 'User-Agent': UPLOAD_UA },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 5 * 60_000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const data = resp.data || {};
  if (data.success === false) {
    throw new Error(data.description || 'uguu.se rejected upload');
  }
  const file = Array.isArray(data.files) ? data.files[0] : null;
  const publicUrl = file?.url;
  if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
    throw new Error('uguu.se returned no URL');
  }
  return publicUrl;
}

async function putToTmpfiles(buffer, filename) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeFor(filename) });
  const resp = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
    headers: { ...form.getHeaders(), 'User-Agent': UPLOAD_UA },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 5 * 60_000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const data = resp.data || {};
  const viewerUrl = data?.data?.url;
  if (data.status !== 'success' || !viewerUrl) {
    throw new Error('tmpfiles.org rejected upload');
  }
  return viewerUrl
    .replace(/^http:\/\//i, 'https://')
    .replace('tmpfiles.org/', 'tmpfiles.org/dl/');
}

async function putToHost(buffer, filename) {
  const safeName = filename || `upload-${Date.now()}.bin`;
  const errors = [];
  try {
    return await putToUguu(buffer, safeName);
  } catch (err) {
    errors.push(`uguu.se: ${describeUploadError(err)}`);
  }
  try {
    return await putToTmpfiles(buffer, safeName);
  } catch (err) {
    errors.push(`tmpfiles.org: ${describeUploadError(err)}`);
  }
  throw new Error(
    `All upload hosts failed for "${safeName}". ${errors.join(' | ')}`,
  );
}

async function uploadFromPath(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  return putToHost(buf, path.basename(filePath));
}

// ---------- Auto-download to user-configured folder ----------

async function downloadResultToFolder({ task, outFolder }) {
  if (!outFolder) return null;
  if (!fs.existsSync(outFolder)) {
    try {
      fs.mkdirSync(outFolder, { recursive: true });
    } catch (err) {
      throw new Error(`Output folder not writable: ${err.message}`);
    }
  }
  if (!task.resultUrl) return null;

  const filename = makeAutoDownloadName(task);
  const target = path.join(outFolder, filename);

  // Try with the task's assigned key first (most likely the one that
  // owns the URL), then with any other non-exhausted key, then unauthed.
  const keys = getKeys();
  const ordered = [];
  if (task.assignedKeyId) {
    const k = keys.find((x) => x.id === task.assignedKeyId);
    if (k) ordered.push(k);
  }
  for (const k of keys) {
    if (!ordered.includes(k) && !k.exhausted) ordered.push(k);
  }

  async function attempt(headers) {
    const resp = await axios.get(task.resultUrl, {
      headers,
      responseType: 'stream',
      timeout: 5 * 60_000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await pipeline(resp.data, fs.createWriteStream(target));
  }

  let lastErr = null;
  const baseHeaders = { 'User-Agent': UPLOAD_UA, Accept: 'video/mp4,*/*' };

  for (const k of ordered) {
    try {
      await attempt({ ...baseHeaders, 'x-magnific-api-key': k.value });
      return target;
    } catch (err) {
      lastErr = err;
      if (err?.response?.status !== 401 && err?.response?.status !== 403) {
        break;
      }
    }
  }
  // Last resort: unauthenticated.
  try {
    await attempt(baseHeaders);
    return target;
  } catch (err) {
    lastErr = err;
  }
  throw lastErr || new Error('Download failed');
}

function makeAutoDownloadName(task) {
  const slug = (task.prompt || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const shortId = (task.magnificTaskId || task.id || '').split('-')[0] || 'task';
  return slug ? `${slug}-${shortId}.mp4` : `magnific-${shortId}.mp4`;
}

// ---------- Scheduler: assigns queued tasks to free keys ----------

// Maps keyId → running task id (in-memory; also reflected on key.activeTaskId).
const keyBusy = new Map();
// Maps magnificTaskId → poll timer handle.
const pollers = new Map();

function isKeyAvailable(key) {
  return !key.exhausted && !keyBusy.get(key.id);
}

function nextQueuedTask() {
  const tasks = getTasks();
  // FIFO by createdAt within QUEUED state.
  return tasks
    .filter((t) => t.status === 'QUEUED')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
}

let schedulerScheduled = false;
function tickScheduler() {
  // Debounce: many upserts will request a tick; only run once per turn.
  if (schedulerScheduled) return;
  schedulerScheduled = true;
  setImmediate(() => {
    schedulerScheduled = false;
    runSchedulerOnce();
  });
}

function runSchedulerOnce() {
  const keys = getKeys();
  const availableKeys = keys.filter(isKeyAvailable);
  if (availableKeys.length === 0) {
    const hasQueue = getTasks().some((t) => t.status === 'QUEUED');
    if (hasQueue && keys.length > 0 && keys.every((k) => k.exhausted)) {
      broadcastToast(
        'error',
        'All API keys are marked Habis — queue paused. Reset a key in API Management to continue.',
      );
    }
    return;
  }
  for (const key of availableKeys) {
    const task = nextQueuedTask();
    if (!task) break;
    assignAndRun(task.id, key.id);
  }
}

function assignAndRun(taskId, keyId) {
  keyBusy.set(keyId, taskId);
  patchKey(keyId, { activeTaskId: taskId });
  upsertTask({
    id: taskId,
    status: 'PREPARING',
    assignedKeyId: keyId,
    startedAt: new Date().toISOString(),
  });

  runJob(taskId, keyId).catch((err) => {
    // runJob should handle all errors internally, but be defensive.
    console.error('runJob crashed:', err);
    upsertTask({
      id: taskId,
      status: 'FAILED',
      lastError: err?.message || String(err),
    });
    finishTask(taskId, keyId, false);
  });
}

function finishTask(taskId, keyId, completed) {
  keyBusy.delete(keyId);
  const keys = getKeys();
  const k = keys.find((x) => x.id === keyId);
  if (k) {
    k.activeTaskId = null;
    if (completed) k.completedCount = (k.completedCount || 0) + 1;
    else k.failedCount = (k.failedCount || 0) + 1;
    setKeys(keys);
  }
  tickScheduler();
}

async function runJob(taskId, keyId) {
  const initial = getTasks().find((t) => t.id === taskId);
  if (!initial) return;
  const { request } = initial;
  if (!request) {
    upsertTask({
      id: taskId,
      status: 'FAILED',
      lastError: 'Internal error: task has no request payload',
    });
    finishTask(taskId, keyId, false);
    return;
  }

  const key = getKeys().find((k) => k.id === keyId);
  if (!key) {
    // Re-queue if the key disappeared.
    upsertTask({ id: taskId, status: 'QUEUED', assignedKeyId: null });
    keyBusy.delete(keyId);
    tickScheduler();
    return;
  }

  // 1) Uploads — only run for fields we don't already have.
  let { imageUrl, videoUrl } = initial;
  try {
    if (!imageUrl) {
      imageUrl = await uploadFromPath(request.imagePath);
      upsertTask({ id: taskId, imageUrl });
    }
    if (!videoUrl) {
      videoUrl = await uploadFromPath(request.videoPath);
      upsertTask({ id: taskId, videoUrl });
    }
  } catch (err) {
    upsertTask({
      id: taskId,
      status: 'FAILED',
      lastError: `Upload failed: ${describeApiError(err)}`,
    });
    finishTask(taskId, keyId, false);
    return;
  }

  // 2) Submit to Magnific with this specific key. Translate 402/credit
  //    failures into key-exhaustion + re-queue.
  upsertTask({ id: taskId, status: 'SUBMITTING' });
  const endpoint = request.quality === 'std' ? ENDPOINT_STD : ENDPOINT_PRO;
  const body = { image_url: imageUrl, video_url: videoUrl };
  if (request.prompt) body.prompt = String(request.prompt).slice(0, 2500);
  if (request.orientation) body.character_orientation = request.orientation;
  if (typeof request.cfg_scale === 'number') body.cfg_scale = request.cfg_scale;

  let magnificTaskId = null;
  try {
    const data = await callMagnificWithKey({
      method: 'post',
      url: endpoint,
      data: body,
      apiKey: key.value,
    });
    const inner = data?.data || data || {};
    magnificTaskId = inner.task_id || inner.id;
    if (!magnificTaskId) {
      throw new Error('Magnific did not return a task_id');
    }
  } catch (err) {
    if (isInsufficientCredits(err)) {
      markKeyExhausted(keyId, describeApiError(err));
      // Re-queue: another key may still be able to handle this job.
      upsertTask({
        id: taskId,
        status: 'QUEUED',
        assignedKeyId: null,
        lastError: `Key Habis: ${describeApiError(err)}`,
      });
      finishTask(taskId, keyId, false);
      return;
    }
    if (err?.response?.status === 429) {
      // Rate limited on this key — re-queue and let scheduler retry later.
      upsertTask({
        id: taskId,
        status: 'QUEUED',
        assignedKeyId: null,
        lastError: `Rate-limited on key "${key.label}", will retry`,
      });
      finishTask(taskId, keyId, false);
      return;
    }
    upsertTask({
      id: taskId,
      status: 'FAILED',
      lastError: `Submit failed: ${describeApiError(err)}`,
    });
    finishTask(taskId, keyId, false);
    return;
  }

  upsertTask({
    id: taskId,
    status: 'CREATED',
    magnificTaskId,
  });

  // 3) Poll until terminal status.
  let finalStatus;
  try {
    finalStatus = await pollUntilTerminal(taskId, magnificTaskId, key.value);
  } catch (err) {
    if (isInsufficientCredits(err)) {
      markKeyExhausted(keyId, describeApiError(err));
    }
    upsertTask({
      id: taskId,
      status: 'FAILED',
      lastError: `Polling failed: ${describeApiError(err)}`,
    });
    finishTask(taskId, keyId, false);
    return;
  }

  if (finalStatus.status !== 'COMPLETED') {
    finishTask(taskId, keyId, false);
    return;
  }

  // 4) Auto-download to the configured folder (best effort).
  const outFolder = store.get('outputFolder');
  if (outFolder) {
    upsertTask({ id: taskId, status: 'DOWNLOADING' });
    try {
      const task = getTasks().find((t) => t.id === taskId);
      const localPath = await downloadResultToFolder({
        task: { ...task, assignedKeyId: keyId },
        outFolder,
      });
      upsertTask({
        id: taskId,
        status: 'DONE',
        localPath,
        completedAt: new Date().toISOString(),
        localDownloadError: null,
      });
      broadcastToast('success', `Saved: ${path.basename(localPath)}`);
    } catch (err) {
      upsertTask({
        id: taskId,
        status: 'COMPLETED',
        localDownloadError: describeApiError(err),
        completedAt: new Date().toISOString(),
      });
      broadcastToast(
        'error',
        `Auto-download failed: ${describeApiError(err)}`,
      );
    }
  } else {
    upsertTask({
      id: taskId,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    });
  }

  finishTask(taskId, keyId, true);
}

async function pollUntilTerminal(localTaskId, magnificTaskId, apiKey) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('Polling timed out after 10 minutes');
    }
    await sleep(POLL_INTERVAL_MS);
    const data = await callMagnificWithKey({
      method: 'get',
      url: ENDPOINT_POLL(magnificTaskId),
      apiKey,
    });
    const inner = data?.data || data || {};
    const status = inner.status || 'IN_PROGRESS';
    const generated = Array.isArray(inner.generated) ? inner.generated : [];
    const resultUrl = generated.find(Boolean) || null;
    const failureReason = status === 'FAILED' ? extractFailureReason(inner) : null;
    upsertTask({
      id: localTaskId,
      status: status === 'COMPLETED' || status === 'FAILED' ? status : 'IN_PROGRESS',
      ...(resultUrl ? { resultUrl } : {}),
      ...(failureReason ? { lastError: failureReason } : {}),
      lastPolledAt: new Date().toISOString(),
    });
    if (status === 'COMPLETED' || status === 'FAILED') {
      return { status, resultUrl, failureReason };
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resumeOnRestart() {
  const tasks = getTasks();
  for (const t of tasks) {
    if (t.status === 'PREPARING' || t.status === 'SUBMITTING') {
      // Mid-flight at the time of shutdown; re-queue so a free key picks
      // it up again. The upload step is idempotent (it short-circuits if
      // imageUrl / videoUrl already populated).
      upsertTask({ id: t.id, status: 'QUEUED', assignedKeyId: null });
    } else if (t.status === 'CREATED' || t.status === 'IN_PROGRESS') {
      // Re-enter polling for this task using the previously assigned
      // key (or any non-exhausted key as fallback).
      const key = getKeys().find(
        (k) => k.id === t.assignedKeyId && !k.exhausted,
      ) || getKeys().find((k) => !k.exhausted);
      if (!key) continue;
      keyBusy.set(key.id, t.id);
      patchKey(key.id, { activeTaskId: t.id });
      (async () => {
        try {
          const status = await pollUntilTerminal(t.id, t.magnificTaskId, key.value);
          if (status.status === 'COMPLETED') {
            const outFolder = store.get('outputFolder');
            if (outFolder) {
              const cur = getTasks().find((x) => x.id === t.id);
              upsertTask({ id: t.id, status: 'DOWNLOADING' });
              try {
                const localPath = await downloadResultToFolder({
                  task: { ...cur, assignedKeyId: key.id },
                  outFolder,
                });
                upsertTask({
                  id: t.id,
                  status: 'DONE',
                  localPath,
                  completedAt: new Date().toISOString(),
                });
              } catch (err) {
                upsertTask({
                  id: t.id,
                  status: 'COMPLETED',
                  localDownloadError: describeApiError(err),
                  completedAt: new Date().toISOString(),
                });
              }
            } else {
              upsertTask({
                id: t.id,
                status: 'COMPLETED',
                completedAt: new Date().toISOString(),
              });
            }
            finishTask(t.id, key.id, true);
          } else {
            finishTask(t.id, key.id, false);
          }
        } catch (err) {
          if (isInsufficientCredits(err)) {
            markKeyExhausted(key.id, describeApiError(err));
          }
          upsertTask({
            id: t.id,
            status: 'FAILED',
            lastError: `Polling failed: ${describeApiError(err)}`,
          });
          finishTask(t.id, key.id, false);
        }
      })();
    }
  }
  tickScheduler();
}

// ---------- IPC handlers ----------

function registerIpc() {
  // ---- Store passthrough (now also exposes `outputFolder`) ----
  ipcMain.handle('store:get', (_e, key) => {
    if (!['keys', 'tasks', 'outputFolder'].includes(key)) {
      throw new Error(`Unsupported store key: ${key}`);
    }
    return store.get(key);
  });

  ipcMain.handle('store:set', (_e, key, value) => {
    if (!['keys', 'tasks', 'outputFolder'].includes(key)) {
      throw new Error(`Unsupported store key: ${key}`);
    }
    store.set(key, value);
    notifyAllRenderers(`${key}:changed`, value);
    return true;
  });

  // ---- File picker / folder picker ----
  ipcMain.handle('dialog:select-file', async (_e, kind) => {
    const filters =
      kind === 'image'
        ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
        : kind === 'video'
          ? [{ name: 'Videos', extensions: ['mp4', 'mov'] }]
          : [{ name: 'All files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'image' ? 'Select character image' : 'Select reference video',
      properties: ['openFile'],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size };
  });

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('output-folder:get', () => store.get('outputFolder'));
  ipcMain.handle('output-folder:set', (_e, folder) => {
    if (folder && !fs.existsSync(folder)) {
      try {
        fs.mkdirSync(folder, { recursive: true });
      } catch (err) {
        throw new Error(`Cannot create folder: ${err.message}`);
      }
    }
    store.set('outputFolder', folder || null);
    notifyAllRenderers('outputFolder:changed', folder || null);
    return folder || null;
  });

  // ---- Buffer persistence (for cropped images that need to enter the
  //      queue with a stable file path) ----
  ipcMain.handle('persist-buffer', async (_e, payload) => {
    const { filename, dataBase64 } = payload || {};
    if (typeof dataBase64 !== 'string' || !dataBase64) {
      throw new Error('persist-buffer: dataBase64 is required');
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) throw new Error('persist-buffer: empty buffer');
    const dir = path.join(app.getPath('userData'), 'queued-images');
    fs.mkdirSync(dir, { recursive: true });
    const safe = (filename || `image-${Date.now()}.jpg`).replace(/[^\w.\-]+/g, '_');
    const target = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(target, buf);
    return target;
  });

  // ---- Legacy direct upload helpers (still used by tests / debug) ----
  ipcMain.handle('upload-file', async (_e, filePath) => uploadFromPath(filePath));
  ipcMain.handle('upload-buffer', async (_e, payload) => {
    const { filename, dataBase64 } = payload || {};
    if (typeof dataBase64 !== 'string' || !dataBase64) {
      throw new Error('upload-buffer: dataBase64 is required');
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) throw new Error('upload-buffer: empty buffer');
    return putToHost(buf, filename);
  });

  ipcMain.handle('read-file-base64', async (_e, filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const buf = fs.readFileSync(filePath);
    return {
      name: path.basename(filePath),
      size: buf.length,
      mime: mimeFor(filePath),
      dataBase64: buf.toString('base64'),
    };
  });

  // ---- Queue a new task (replaces direct submit-task) ----
  ipcMain.handle('queue-task', async (_e, request) => {
    if (!request?.imagePath || !request?.videoPath) {
      throw new Error('queue-task: imagePath and videoPath are required');
    }
    if (!fs.existsSync(request.imagePath)) {
      throw new Error(`Image file not found: ${request.imagePath}`);
    }
    if (!fs.existsSync(request.videoPath)) {
      throw new Error(`Video file not found: ${request.videoPath}`);
    }
    const task = {
      id: uuid(),
      status: 'QUEUED',
      quality: request.quality === 'std' ? 'std' : 'pro',
      prompt: request.prompt || '',
      orientation: request.orientation || 'video',
      cfg_scale: typeof request.cfg_scale === 'number' ? request.cfg_scale : 0.5,
      request: {
        imagePath: request.imagePath,
        videoPath: request.videoPath,
        prompt: request.prompt || '',
        quality: request.quality === 'std' ? 'std' : 'pro',
        orientation: request.orientation || 'video',
        cfg_scale: typeof request.cfg_scale === 'number' ? request.cfg_scale : 0.5,
      },
      imageUrl: null,
      videoUrl: null,
      resultUrl: null,
      magnificTaskId: null,
      assignedKeyId: null,
      localPath: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    upsertTask(task);
    tickScheduler();
    return task;
  });

  // ---- Manual download to a user-chosen file path (kept for users who
  //      didn't configure an output folder, or for re-downloads) ----
  ipcMain.handle('download-video', async (_e, payload) => {
    const { taskId, defaultName } = payload || {};
    let { url } = payload || {};
    if (taskId) {
      const t = getTasks().find((x) => x.id === taskId);
      if (t?.resultUrl) url = t.resultUrl;
    }
    if (!url) throw new Error('No result URL available for this task yet.');

    const safeName = defaultName || `magnific-${Date.now()}.mp4`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save generated video',
      defaultPath: safeName,
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const keys = getKeys();
    const ordered = keys.filter((k) => !k.exhausted);
    const baseHeaders = { 'User-Agent': UPLOAD_UA, Accept: 'video/mp4,*/*' };

    async function attempt(headers) {
      const resp = await axios.get(url, {
        headers,
        responseType: 'stream',
        timeout: 5 * 60_000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      await pipeline(resp.data, fs.createWriteStream(result.filePath));
      return result.filePath;
    }

    let lastErr = null;
    for (const k of ordered) {
      try {
        return await attempt({ ...baseHeaders, 'x-magnific-api-key': k.value });
      } catch (err) {
        lastErr = err;
        const s = err?.response?.status;
        if (s !== 401 && s !== 403) break;
      }
    }
    try {
      return await attempt(baseHeaders);
    } catch (err) {
      throw lastErr || err;
    }
  });

  // ---- Task management ----
  ipcMain.handle('task:delete', (_e, taskId) => {
    const t = getTasks().find((x) => x.id === taskId);
    if (t?.magnificTaskId && pollers.has(t.magnificTaskId)) {
      clearTimeout(pollers.get(t.magnificTaskId));
      pollers.delete(t.magnificTaskId);
    }
    return deleteTaskById(taskId);
  });

  ipcMain.handle('task:resume-polling', (_e, taskId) => {
    // Re-queue if it ended up stuck.
    const t = getTasks().find((x) => x.id === taskId);
    if (!t) return false;
    if (t.status === 'FAILED' || t.status === 'COMPLETED' || t.status === 'DONE') {
      upsertTask({ id: taskId, status: 'QUEUED', assignedKeyId: null, lastError: null });
      tickScheduler();
    }
    return true;
  });

  // ---- Key management ----
  ipcMain.handle('keys:active', () => {
    const keys = getKeys();
    return keys.find((k) => k.isActive && !k.exhausted) ||
      keys.find((k) => k.isActive) ||
      keys.find((k) => !k.exhausted) ||
      null;
  });

  ipcMain.handle('keys:reset-exhausted', (_e, keyId) => {
    const updated = patchKey(keyId, {
      exhausted: false,
      exhaustedAt: null,
      exhaustedReason: null,
    });
    tickScheduler();
    return updated;
  });

  ipcMain.handle('keys:mark-exhausted', (_e, keyId) => {
    markKeyExhausted(keyId, 'Manually marked Habis');
    return true;
  });
}

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  resumeOnRestart();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const t of pollers.values()) clearTimeout(t);
  pollers.clear();
});
