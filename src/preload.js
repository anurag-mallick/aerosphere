const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // dialogs
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

  // media inspection / processing
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  getVideoMetadata: (filePath) => ipcRenderer.invoke('get-video-metadata', filePath),
  generateThumbnail: (filePath, timeSec) =>
    ipcRenderer.invoke('generate-thumbnail', filePath, timeSec),
  convertInsv: (inputPath) => ipcRenderer.invoke('convert-insv', inputPath),
  findSubtitle: (videoPath) => ipcRenderer.invoke('find-subtitle', videoPath),
  generateProxy: (videoPath) => ipcRenderer.invoke('generate-proxy', videoPath),
  savePng: (dataUrl, defaultName) => ipcRenderer.invoke('save-png', dataUrl, defaultName),
  generateProxy: (videoPath) => ipcRenderer.invoke('generate-proxy', videoPath),

  // export pipeline
  exportTimeline: (options) => ipcRenderer.invoke('export-timeline', options),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
});
