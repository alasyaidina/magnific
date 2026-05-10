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
  uploadFile: (filePath) => ipcRenderer.invoke('upload-file', filePath),

  // task lifecycle
  submitTask: (payload) => ipcRenderer.invoke('submit-task', payload),
  pollTask: (taskId) => ipcRenderer.invoke('poll-task', taskId),
  resumePolling: (taskId) => ipcRenderer.invoke('task:resume-polling', taskId),
  deleteTask: (taskId) => ipcRenderer.invoke('task:delete', taskId),

  // result download
  downloadVideo: (payload) => ipcRenderer.invoke('download-video', payload),

  // keys helpers
  getActiveKey: () => ipcRenderer.invoke('keys:active'),

  // events
  onTasksChanged: (handler) => safeOn('tasks:changed', handler),
  onKeysChanged: (handler) => safeOn('keys:changed', handler),
  onToast: (handler) => safeOn('toast', handler),
});
