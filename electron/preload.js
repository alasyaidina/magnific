'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const safeOn = (channel, handler) => {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('api', {
  // store
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },

  // file pickers + uploads
  selectFile: (kind) => ipcRenderer.invoke('dialog:select-file', kind),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  uploadFile: (filePath) => ipcRenderer.invoke('upload-file', filePath),
  uploadBuffer: (payload) => ipcRenderer.invoke('upload-buffer', payload),
  persistBuffer: (payload) => ipcRenderer.invoke('persist-buffer', payload),
  readFile: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),

  // output folder for auto-download
  getOutputFolder: () => ipcRenderer.invoke('output-folder:get'),
  setOutputFolder: (folder) => ipcRenderer.invoke('output-folder:set', folder),

  // queue-based task lifecycle
  queueTask: (payload) => ipcRenderer.invoke('queue-task', payload),
  resumePolling: (taskId) => ipcRenderer.invoke('task:resume-polling', taskId),
  deleteTask: (taskId) => ipcRenderer.invoke('task:delete', taskId),

  // result download (manual / re-download)
  downloadVideo: (payload) => ipcRenderer.invoke('download-video', payload),

  // keys helpers
  getActiveKey: () => ipcRenderer.invoke('keys:active'),
  resetExhausted: (keyId) => ipcRenderer.invoke('keys:reset-exhausted', keyId),
  markExhausted: (keyId) => ipcRenderer.invoke('keys:mark-exhausted', keyId),

  // events
  onTasksChanged: (handler) => safeOn('tasks:changed', handler),
  onKeysChanged: (handler) => safeOn('keys:changed', handler),
  onOutputFolderChanged: (handler) => safeOn('outputFolder:changed', handler),
  onToast: (handler) => safeOn('toast', handler),
});
