const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // dialogs
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),

  // media inspection / processing
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  detectHwEncoders: () => ipcRenderer.invoke('detect-hw-encoders'),
  getVideoMetadata: (filePath) => ipcRenderer.invoke('get-video-metadata', filePath),
  generateThumbnail: (filePath, timeSec) =>
    ipcRenderer.invoke('generate-thumbnail', filePath, timeSec),
  convertInsv: (inputPath) => ipcRenderer.invoke('convert-insv', inputPath),
  findSubtitle: (videoPath) => ipcRenderer.invoke('find-subtitle', videoPath),
  generateProxy: (videoPath) => ipcRenderer.invoke('generate-proxy', videoPath),
  preparePhoto: (photoPath) => ipcRenderer.invoke('prepare-photo', photoPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  savePng: (dataUrl, defaultName) => ipcRenderer.invoke('save-png', dataUrl, defaultName),
  scanFolder: (dirPath) => ipcRenderer.invoke('scan-folder', dirPath),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  findInsvPair: (insvPath) => ipcRenderer.invoke('find-insv-pair', insvPath),
  stitchInsv: (opts) => ipcRenderer.invoke('stitch-insv', opts),
  combineInsvPair: (opts) => ipcRenderer.invoke('combine-insv-pair', opts),
  onStitchProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('stitch-progress', listener);
    return () => ipcRenderer.removeListener('stitch-progress', listener);
  },
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
