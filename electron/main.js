'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const Store = require('electron-store');
const axios = require('axios');

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

// ---------- Helpers: file upload to transfer.sh ----------

async function uploadToTransferSh(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  const filename = encodeURIComponent(path.basename(filePath));
  const url = `https://transfer.sh/${filename}`;

  const resp = await axios.put(url, stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 5 * 60_000,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const publicUrl = String(resp.data || '').trim();
  if (!/^https?:\/\//i.test(publicUrl)) {
    throw new Error('transfer.sh did not return a valid URL');
  }
  return publicUrl;
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

  // -- Upload to transfer.sh --
  ipcMain.handle('upload-file', async (_e, filePath) => {
    return uploadToTransferSh(filePath);
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
  ipcMain.handle('download-video', async (_e, { url, defaultName }) => {
    const safeName = defaultName || `magnific-${Date.now()}.mp4`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save generated video',
      defaultPath: safeName,
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;

    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: 5 * 60_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await pipeline(resp.data, fs.createWriteStream(result.filePath));
    return result.filePath;
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
