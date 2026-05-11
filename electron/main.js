'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
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

// Persistent store
const store = new Store({
  defaults: {
    keys: [], // [{ id, label, value, isActive }]
    tasks: [], // [{ id, status, quality, prompt, imageUrl, videoUrl, resultUrl, createdAt, ... }]
  },
});

// In-memory polling timers, keyed by task id
const pollers = new Map();

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

// ---------- Helpers: keys & API ----------

function getKeys() {
  return store.get('keys') || [];
}

function setKeys(keys) {
  store.set('keys', keys);
}

function getActiveKeyIndex(keys) {
  const idx = keys.findIndex((k) => k.isActive);
  if (idx >= 0) return idx;
  return keys.length > 0 ? 0 : -1;
}

function notifyAllRenderers(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

/**
 * Performs a Magnific API request with multi-key fallback on 429/402.
 * Returns response.data on success. Throws on terminal error.
 */
async function callMagnific({ method, url, data }) {
  const keys = getKeys();
  if (keys.length === 0) {
    throw new Error('No API key configured. Add a key in Settings.');
  }

  let activeIdx = getActiveKeyIndex(keys);
  const tried = new Set();
  let lastError = null;

  while (activeIdx >= 0 && !tried.has(keys[activeIdx].id)) {
    const key = keys[activeIdx];
    tried.add(key.id);

    try {
      const resp = await axios({
        method,
        url,
        headers: {
          'x-magnific-api-key': key.value,
          'Content-Type': 'application/json',
        },
        data: data ?? undefined,
        timeout: 60_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      return resp.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if ((status === 429 || status === 402) && keys.length > 1) {
        // Find the next untried key.
        const nextIdx = keys.findIndex(
          (k, i) => i !== activeIdx && !tried.has(k.id),
        );
        if (nextIdx < 0) {
          throw new Error('All API keys have insufficient credits');
        }
        // Promote the next key to active and persist.
        keys.forEach((k, i) => {
          k.isActive = i === nextIdx;
        });
        setKeys(keys);
        activeIdx = nextIdx;
        notifyAllRenderers('keys:changed', keys);
        notifyAllRenderers('toast', {
          type: 'warning',
          message: `Switched to ${keys[nextIdx].label} due to credit limit`,
        });
        continue;
      }
      // Non-recoverable error.
      throw err;
    }
  }

  if (lastError) throw lastError;
  throw new Error('All API keys have insufficient credits');
}

// ---------- Helpers: tasks store ----------

function getTasks() {
  return store.get('tasks') || [];
}

function upsertTask(task) {
  const tasks = getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = { ...tasks[idx], ...task };
  else tasks.unshift(task);
  store.set('tasks', tasks);
  notifyAllRenderers('tasks:changed', tasks);
  return tasks;
}

function deleteTaskById(id) {
  const tasks = getTasks().filter((t) => t.id !== id);
  store.set('tasks', tasks);
  notifyAllRenderers('tasks:changed', tasks);
  return tasks;
}

// ---------- Helpers: temporary public upload ----------

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

// Distil an axios / generic error down to a short, log-friendly string
// that surfaces what the upload host actually said (status + body
// snippet). Without this, axios's stock "Request failed with status
// code 400" tells the user nothing.
function describeUploadError(err) {
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

// uguu.se accepts up to 128 MB per file via multipart/form-data POST and
// retains files for ~3 hours, which is comfortably longer than the
// app's 10-minute polling window. It can still return 400/500 under
// load (or when its rate-limit / anti-abuse heuristics trip), so we
// fall back to tmpfiles.org as a second host.
async function putToUguu(buffer, filename) {
  const form = new FormData();
  form.append('files[]', buffer, {
    filename,
    contentType: mimeFor(filename),
  });
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

// tmpfiles.org accepts up to 100 MB per file via multipart POST. The
// JSON response carries a viewer URL like
// "http://tmpfiles.org/{id}/{name}"; for a direct download we need
// "https://tmpfiles.org/dl/{id}/{name}", which Magnific can fetch.
async function putToTmpfiles(buffer, filename) {
  const form = new FormData();
  form.append('file', buffer, {
    filename,
    contentType: mimeFor(filename),
  });
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

// ---------- Polling ----------

function stopPolling(taskId) {
  const handle = pollers.get(taskId);
  if (handle) {
    clearTimeout(handle.timer);
    pollers.delete(taskId);
  }
}

function startPolling(taskId) {
  if (pollers.has(taskId)) return;
  const startedAt = Date.now();

  const tick = async () => {
    try {
      const data = await callMagnific({
        method: 'get',
        url: ENDPOINT_POLL(taskId),
      });
      const inner = data?.data || data || {};
      const status = inner.status || 'IN_PROGRESS';
      const generated = Array.isArray(inner.generated) ? inner.generated : [];
      const resultUrl = generated.find(Boolean) || null;

      upsertTask({
        id: taskId,
        status,
        ...(resultUrl ? { resultUrl } : {}),
        lastPolledAt: new Date().toISOString(),
      });

      if (status === 'COMPLETED' || status === 'FAILED') {
        stopPolling(taskId);
        return;
      }
    } catch (err) {
      const tasks = getTasks();
      const t = tasks.find((x) => x.id === taskId);
      // Surface a transient error but keep polling unless we've timed out.
      if (t) {
        upsertTask({
          id: taskId,
          lastError: err.response?.data?.message || err.message || String(err),
          lastPolledAt: new Date().toISOString(),
        });
      }
    }

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      upsertTask({
        id: taskId,
        status: 'FAILED',
        lastError: 'Polling timed out after 10 minutes',
      });
      stopPolling(taskId);
      return;
    }

    const handle = pollers.get(taskId);
    if (!handle) return;
    handle.timer = setTimeout(tick, POLL_INTERVAL_MS);
  };

  const handle = { timer: setTimeout(tick, POLL_INTERVAL_MS) };
  pollers.set(taskId, handle);
}

function resumeInProgressPolling() {
  const tasks = getTasks();
  for (const t of tasks) {
    if (t.status === 'CREATED' || t.status === 'IN_PROGRESS') {
      startPolling(t.id);
    }
  }
}

// ---------- IPC handlers ----------

function registerIpc() {
  // -- Store passthrough (kept narrow: only known keys) --
  ipcMain.handle('store:get', (_e, key) => {
    if (!['keys', 'tasks'].includes(key)) {
      throw new Error(`Unsupported store key: ${key}`);
    }
    return store.get(key);
  });

  ipcMain.handle('store:set', (_e, key, value) => {
    if (!['keys', 'tasks'].includes(key)) {
      throw new Error(`Unsupported store key: ${key}`);
    }
    store.set(key, value);
    notifyAllRenderers(`${key}:changed`, value);
    return true;
  });

  // -- File picker --
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
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
    };
  });

  // -- Upload a local file to a temporary public host (uguu.se) --
  ipcMain.handle('upload-file', async (_e, filePath) => {
    return uploadFromPath(filePath);
  });

  // -- Upload an in-memory buffer (e.g. a cropped image from the renderer) --
  ipcMain.handle('upload-buffer', async (_e, payload) => {
    const { filename, dataBase64 } = payload || {};
    if (typeof dataBase64 !== 'string' || !dataBase64) {
      throw new Error('upload-buffer: dataBase64 is required');
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) throw new Error('upload-buffer: empty buffer');
    return putToHost(buf, filename);
  });

  // -- Read a local file and return base64 (for previewing in the renderer) --
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

  // -- Submit Motion Control task --
  ipcMain.handle('submit-task', async (_e, payload) => {
    const {
      quality = 'pro',
      image_url,
      video_url,
      prompt,
      character_orientation,
      cfg_scale,
    } = payload || {};

    if (!image_url || !video_url) {
      throw new Error('image_url and video_url are required');
    }

    const url = quality === 'std' ? ENDPOINT_STD : ENDPOINT_PRO;
    const body = { image_url, video_url };
    if (prompt) body.prompt = String(prompt).slice(0, 2500);
    if (character_orientation) body.character_orientation = character_orientation;
    if (typeof cfg_scale === 'number') body.cfg_scale = cfg_scale;

    const data = await callMagnific({ method: 'post', url, data: body });
    const inner = data?.data || data || {};
    const taskId = inner.task_id || inner.id;
    if (!taskId) {
      throw new Error('Magnific did not return a task_id');
    }

    const task = {
      id: taskId,
      status: inner.status || 'CREATED',
      quality,
      prompt: prompt || '',
      imageUrl: image_url,
      videoUrl: video_url,
      orientation: character_orientation || 'video',
      cfg_scale: typeof cfg_scale === 'number' ? cfg_scale : 0.5,
      resultUrl: null,
      createdAt: new Date().toISOString(),
    };
    upsertTask(task);
    startPolling(taskId);
    return task;
  });

  // -- Manual poll (renderer can request a fresh status) --
  ipcMain.handle('poll-task', async (_e, taskId) => {
    const data = await callMagnific({
      method: 'get',
      url: ENDPOINT_POLL(taskId),
    });
    const inner = data?.data || data || {};
    const status = inner.status || 'IN_PROGRESS';
    const generated = Array.isArray(inner.generated) ? inner.generated : [];
    const resultUrl = generated.find(Boolean) || null;
    upsertTask({
      id: taskId,
      status,
      ...(resultUrl ? { resultUrl } : {}),
      lastPolledAt: new Date().toISOString(),
    });
    return { taskId, status, resultUrl };
  });

  // -- Download result video to user-chosen folder --
  // Accepts { taskId, defaultName } (preferred) and falls back to a raw
  // { url } for callers that already have one in hand. The handler is
  // resilient to short-lived signed URLs and to APIs that gate downloads
  // on the same x-magnific-api-key header used elsewhere:
  //
  //   1. If a taskId is given, poll Magnific once to refresh `resultUrl`.
  //   2. Try the URL with the active API key + a browser-style UA.
  //   3. On 401/403 fall back to a plain GET (signed URLs sometimes
  //      reject extra auth headers).
  //   4. On 401/403 again, poll once more (URL may have been rotated)
  //      and retry with the freshest URL.
  ipcMain.handle('download-video', async (_e, payload) => {
    const { taskId, defaultName } = payload || {};
    let { url } = payload || {};

    async function refreshUrl() {
      if (!taskId) return url;
      try {
        const data = await callMagnific({
          method: 'get',
          url: ENDPOINT_POLL(taskId),
        });
        const inner = data?.data || data || {};
        const generated = Array.isArray(inner.generated) ? inner.generated : [];
        const fresh = generated.find(Boolean) || null;
        if (fresh) {
          url = fresh;
          upsertTask({
            id: taskId,
            status: inner.status || 'COMPLETED',
            resultUrl: fresh,
            lastPolledAt: new Date().toISOString(),
          });
        }
      } catch (_err) {
        // Best-effort refresh: keep the URL we already have.
      }
      return url;
    }

    if (taskId) {
      // Use the freshest URL we have on disk first; refresh if missing.
      const t = getTasks().find((x) => x.id === taskId);
      if (t?.resultUrl) url = t.resultUrl;
      if (!url) await refreshUrl();
    }

    if (!url) {
      throw new Error('No result URL available for this task yet.');
    }

    const safeName = defaultName || `magnific-${Date.now()}.mp4`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save generated video',
      defaultPath: safeName,
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const BROWSER_UA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    function activeApiKey() {
      const keys = getKeys();
      const idx = getActiveKeyIndex(keys);
      return idx >= 0 ? keys[idx].value : null;
    }

    async function attemptDownload(targetUrl, withApiKey) {
      const headers = { 'User-Agent': BROWSER_UA, Accept: 'video/mp4,*/*' };
      const key = withApiKey ? activeApiKey() : null;
      if (key) headers['x-magnific-api-key'] = key;
      const resp = await axios.get(targetUrl, {
        headers,
        responseType: 'stream',
        timeout: 5 * 60_000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      await pipeline(resp.data, fs.createWriteStream(result.filePath));
      return result.filePath;
    }

    function isAuthError(err) {
      const s = err?.response?.status;
      return s === 401 || s === 403;
    }

    try {
      return await attemptDownload(url, true);
    } catch (err1) {
      if (!isAuthError(err1)) throw err1;
      try {
        return await attemptDownload(url, false);
      } catch (err2) {
        if (!isAuthError(err2) || !taskId) throw err2;
        // Last resort: refresh URL once more and retry both header modes.
        const refreshed = await refreshUrl();
        if (!refreshed || refreshed === url) throw err2;
        try {
          return await attemptDownload(refreshed, true);
        } catch (err3) {
          if (!isAuthError(err3)) throw err3;
          return await attemptDownload(refreshed, false);
        }
      }
    }
  });

  // -- Task management --
  ipcMain.handle('task:delete', (_e, taskId) => {
    stopPolling(taskId);
    return deleteTaskById(taskId);
  });

  ipcMain.handle('task:resume-polling', (_e, taskId) => {
    startPolling(taskId);
    return true;
  });

  // -- Convenience: which key is active? --
  ipcMain.handle('keys:active', () => {
    const keys = getKeys();
    const idx = getActiveKeyIndex(keys);
    return idx >= 0 ? keys[idx] : null;
  });
}

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  resumeInProgressPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const id of pollers.keys()) stopPolling(id);
});
