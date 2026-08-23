const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const { resolveBinary, probeFile, extractMetadata } = require('./src-shared/ffmpeg-utils');

// ---------------------------------------------------------------------------
// FFmpeg setup (fluent-ffmpeg is used for thumbnails and .insv remux;
// probing lives in src-shared/ffmpeg-utils.js)
// ---------------------------------------------------------------------------

ffmpeg.setFfmpegPath(resolveBinary('ffmpeg'));
ffmpeg.setFlvtoolPath(resolveBinary('ffprobe'));

let ffmpegVersion = null;

function detectFfmpegVersion() {
  return new Promise((resolve) => {
    const proc = spawn(resolveBinary('ffmpeg'), ['-version']);
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const m = /ffmpeg version (\S+)/.exec(out);
      resolve(m ? m[1] : 'unknown');
    });
  });
}

// ---------------------------------------------------------------------------
// media:// protocol so the renderer can play local files with Range support
// (an http:// page served by vite cannot load file:// subresources).
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.insv': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);
      if (filePath.startsWith('/')) filePath = filePath.slice(1);
      if (process.platform === 'win32') {
        filePath = filePath.replace(/^\/([A-Za-z]:)/, '$1');
      }

      // Robust proxy editing: generate a lightweight 480p sibling so high-res
// footage (e.g. 5.7K 360° or 4K drone) previews smoothly. The media://
// handler serves the proxy automatically whenever it exists.
ipcMain.handle('generate-proxy', async (_event, inputPath) => {
  const parsed = path.parse(inputPath);
  const outPath = path.join(parsed.dir, `${parsed.name}.aeroproxy.mp4`);
  if (fs.existsSync(outPath)) return { ok: true, proxyPath: outPath, existed: true };

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'scale=-2:480',
        '-preset', 'veryfast',
        '-crf', '23',
        '-an',
        '-movflags', '+faststart',
      ])
      .on('error', (err) => resolve({ ok: false, error: err.message }))
      .on('end', () => resolve({ ok: true, proxyPath: outPath }))
      .save(outPath);
  });
});

// Robust proxy editing: transparently serve a sibling
      // "<name>.aeroproxy.mp4" when one has been generated for the source.
      const proxyMatch = filePath.match(/^(.*)\.([^.]+)$/);
      const proxyCandidate =
        proxyMatch && !filePath.endsWith('.aeroproxy.mp4')
          ? `${proxyMatch[1]}.aeroproxy.mp4`
          : null;
      if (proxyCandidate && fs.existsSync(proxyCandidate)) {
        filePath = proxyCandidate;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      const total = stat.size;
      let start = 0;
      let end = total - 1;
      let status = 200;

      const range = request.headers.get('Range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match && (match[1] !== '' || match[2] !== '')) {
          if (match[1] !== '') {
            start = parseInt(match[1], 10);
            end = match[2] !== '' ? parseInt(match[2], 10) : total - 1;
          } else {
            start = Math.max(0, total - parseInt(match[2], 10));
            end = total - 1;
          }
          if (start >= total || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` },
            });
          }
          status = 206;
        }
      }

      const nodeStream = fs.createReadStream(filePath, { start, end });
      const ext = path.extname(filePath).toLowerCase();
      const headers = {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      };
      if (status === 206) {
        headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      }
      return new Response(Readable.toWeb(nodeStream), { status, headers });
    } catch (err) {
      return new Response(`Media error: ${err && err.message}`, { status: 500 });
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow = null;
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'AeroSphere',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerMediaProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// Dialog IPC
// ---------------------------------------------------------------------------

ipcMain.handle('open-file-dialog', async (_event, options) => {
  const filters = options && options.fileTypes ? options.fileTypes : [{ name: 'All Files', extensions: ['*'] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters,
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('save-file-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: (options && options.title) || 'Save File',
    defaultPath: (options && options.defaultPath) || '',
    filters: (options && options.filters) || [{ name: 'MP4', extensions: ['mp4'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? [] : result.filePaths;
});

// ---------------------------------------------------------------------------
// FFmpeg IPC
// ---------------------------------------------------------------------------

ipcMain.handle('check-ffmpeg', async () => {
  if (ffmpegVersion === null) {
    ffmpegVersion = await detectFfmpegVersion();
  }
  return { available: !!ffmpegVersion, version: ffmpegVersion };
});

ipcMain.handle('get-video-metadata', async (_event, filePath) => {
  try {
    const data = await probeFile(filePath);
    const metadata = extractMetadata(data);
    return { ok: true, metadata };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('generate-thumbnail', async (_event, filePath, timeSec) => {
  const tmpDir = path.join(os.tmpdir(), 'video-editor-thumbs');
  fs.mkdirSync(tmpDir, { recursive: true });
  const fileName = `thumb-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const outPath = path.join(tmpDir, fileName);

  return new Promise((resolve) => {
    const seek = typeof timeSec === 'number' && isFinite(timeSec) ? Math.max(0.1, timeSec) : Math.max(0.1, 1);
    ffmpeg(filePath)
      .on('error', (err) => resolve({ ok: false, error: err.message }))
      .on('end', () => {
        try {
          const buf = fs.readFileSync(outPath);
          fs.unlinkSync(outPath);
          resolve({ ok: true, thumbnail: `data:image/jpeg;base64,${buf.toString('base64')}` });
        } catch (readErr) {
          resolve({ ok: false, error: readErr.message });
        }
      })
      .screenshots({
        timestamps: [seek],
        folder: tmpDir,
        filename: fileName,
        size: '320x?',
      });
  });
});

// Fast remux of an .insv (which is an MP4 container) to a standard .mp4 file.
ipcMain.handle('convert-insv', async (_event, inputPath) => {
  if (!/\.insv$/i.test(inputPath)) {
    return { ok: false, error: 'Not an .insv file' };
  }
  const parsed = path.parse(inputPath);
  const outputPath = path.join(parsed.dir, `${parsed.name}-flat.mp4`);

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .on('error', (err) => resolve({ ok: false, error: err.message }))
      .on('end', () => resolve({ ok: true, outputPath }))
      .save(outputPath);
  });
});

// DJI drones (and others) record a telemetry .srt next to the video with the
// same basename - detect it so the renderer can offer burn-in.
ipcMain.handle('find-subtitle', async (_event, videoPath) => {
  try {
    const parsed = path.parse(videoPath);
    const candidates = [`${parsed.name}.srt`, `${parsed.name}.SRT`];
    for (const name of candidates) {
      const p = path.join(parsed.dir, name);
      if (fs.existsSync(p)) return { ok: true, srtPath: p };
    }
    return { ok: true, srtPath: null };
  } catch (err) {
    return { ok: false, srtPath: null, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Timeline export pipeline (implemented in export-pipeline.js)
// ---------------------------------------------------------------------------

const pipeline = require('./export-pipeline');

function sendExportProgress(percent, stage) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('export-progress', {
      percent: Math.max(0, Math.min(99.5, percent)),
      stage,
    });
  }
}

ipcMain.handle('export-timeline', async (_event, options) => {
  return pipeline.runExport({
    ...options,
    onProgress: (percent, stage) => sendExportProgress(percent, stage),
  });
});

ipcMain.handle('cancel-export', async () => {
  pipeline.requestCancel();
  return { ok: true };
});

