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
    // corsEnabled is REQUIRED for <video crossOrigin="anonymous"> to load —
    // without it Chromium taints the element and WebGL VideoTexture uploads
    // throw SecurityError (black 360° viewport)
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);

      // CORS preflight: Range headers are NOT CORS-safelisted, so seek
      // requests from <video crossOrigin="anonymous"> arrive as OPTIONS.
      // Without an answer the browser blocks the media request entirely.
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      let filePath = decodeURIComponent(url.pathname);
      if (filePath.startsWith('/')) filePath = filePath.slice(1);
      if (process.platform === 'win32') {
        filePath = filePath.replace(/^\/([A-Za-z]:)/, '$1');
      }

      // quality override: ?q=full skips the transparent proxy swap so the
      // user can preview original-quality footage on capable machines
      const forceFull = url.searchParams.get('q') === 'full';

      // Robust proxy editing: transparently serve a sibling
      // "<name>.aeroproxy.mp4" when one has been generated for the source.
      const proxyMatch = filePath.match(/^(.*)\.([^.]+)$/);
      const proxyCandidate =
        proxyMatch && !filePath.endsWith('.aeroproxy.mp4')
          ? `${proxyMatch[1]}.aeroproxy.mp4`
          : null;
      if (!forceFull && proxyCandidate && fs.existsSync(proxyCandidate)) {
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
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
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

// Video editor: playback must start from synthetic clicks (transport bar) and
// scripted automation without a fresh user gesture each time.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

  // Reset-to-defaults on close/quit: wipe the persisted project right before
  // the window goes away, so every launch starts from a clean slate.
  // (Done here — not in the renderer — so dev reloads keep their state.)
  let clearedOnClose = false;
  mainWindow.webContents.on('did-finish-load', () => {
    clearedOnClose = false;
  });
  const clearProjectAndClose = async () => {
    if (clearedOnClose) return;
    clearedOnClose = true;
    let hasContent = false;
    try {
      hasContent = !!(await mainWindow.webContents.executeJavaScript(
        '(function(){try{const p=JSON.parse(localStorage.getItem("ve:v1:project")||"null");return !!p&&(p.videos.length>0||p.photos.length>0||p.audios.length>0||p.tracks.some(t=>t.clips.length>0))}catch(e){return false}})()'
      ));
    } catch { hasContent = false; }
    if (hasContent) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Discard Project', 'Cancel'],
        defaultId: 1,
        title: 'Unsaved Work',
        message: 'Closing AeroSphere will discard this project.',
        detail: 'Your timeline, library and edits will not be saved. Continue?',
      });
      if (response !== 0) {
        clearedOnClose = false;
        return;
      }
    }
    mainWindow.webContents
      .executeJavaScript(
        `(function(){try{Object.keys(localStorage).filter(function(k){return k.indexOf('ve:')===0}).forEach(function(k){localStorage.removeItem(k)})}catch(e){}})();'ok'`
      )
      .catch(() => {})
      .finally(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      });
  };
  mainWindow.on('close', (event) => {
    if (!clearedOnClose) {
      event.preventDefault();
      clearProjectAndClose();
    }
  });
  app.on('before-quit', () => {
    if (!clearedOnClose && mainWindow && !mainWindow.isDestroyed()) clearProjectAndClose();
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
  // last window gone (macOS red-button included): the project was already
  // wiped by the window's close handler above — nothing else to do here,
  // but keep platform behavior intact.
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

// Multi-file/folder import: recursively collect supported media from a folder
const MEDIA_EXTENSIONS = {
  video: ['mp4', 'mov', 'insv', 'webm', 'mkv', 'm4v'],
  photo: ['jpg', 'jpeg', 'png', 'heic', 'webp'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg'],
};

ipcMain.handle('scan-folder', async (_event, dirPath, maxDepth = 4) => {
  const out = { ok: true, videos: [], photos: [], audios: [], errors: [] };
  const walk = (dir, level) => {
    if (level > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      out.errors.push(`${dir}: ${err.message}`);
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, level + 1);
        continue;
      }
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (MEDIA_EXTENSIONS.video.includes(ext)) out.videos.push(full);
      else if (MEDIA_EXTENSIONS.photo.includes(ext)) out.photos.push(full);
      else if (MEDIA_EXTENSIONS.audio.includes(ext)) out.audios.push(full);
    }
  };
  walk(dirPath, 0);
  return out;
});

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
        '-c:v', 'libx265',
        '-preset', 'veryfast',
        '-crf', '26',
        '-tag:v', 'hvc1',
        '-an',
        '-movflags', '+faststart',
      ])
      .on('error', (err) => resolve({ ok: false, error: err.message }))
      .on('end', () => resolve({ ok: true, proxyPath: outPath }))
      .save(outPath);
  });
});

// Grab-still: write a captured PNG data URL to a user-chosen path.
ipcMain.handle('save-png', async (_event, dataUrl, defaultName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Frame',
      defaultPath: defaultName || 'frame.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Insta360 X3: find the sibling lens file and the pre-stitched LRV proxy
const { findInsvPairName } = require('./src-shared/stitch-filter');
const { buildStitchGraph } = require('./src-shared/stitch-filter');

ipcMain.handle('find-insv-pair', async (_event, insvPath) => {
  try {
    const parsed = path.parse(insvPath);
    const siblings = fs
      .readdirSync(parsed.dir)
      .filter((f) => f.toLowerCase().endsWith('.insv') && f !== parsed.base);
    const pairName = findInsvPairName(parsed.base, siblings);
    if (!pairName) return { ok: true, pairPath: null };

    const pairPath = path.join(parsed.dir, pairName);

    // LRV preview proxy shares the recording timestamp with either lens file
    const lrvSibling = fs
      .readdirSync(parsed.dir)
      .find((f) => f.toLowerCase().endsWith('.lrv') && f.includes(parsed.name.slice(4, 19)));
    return { ok: true, pairPath, lrvPath: lrvSibling ? path.join(parsed.dir, lrvSibling) : null };
  } catch (err) {
    return { ok: false, pairPath: null, error: err.message };
  }
});

const STITCH_QUALITY = {
  preview: { width: 1536, height: 768, crf: '26', preset: 'veryfast' },
  standard: { width: 3840, height: 1920, crf: '23', preset: 'medium' },
  master: { width: 5760, height: 2880, crf: '20', preset: 'slow' },
};

ipcMain.handle('stitch-insv', async (_event, opts) => {
  const { frontPath, backPath, lensFov, swapLenses, quality = 'standard', lrvPath } = opts;
  const q = STITCH_QUALITY[quality] || STITCH_QUALITY.standard;
  const parsed = path.parse(frontPath);
  const outputPath = path.join(parsed.dir, `${parsed.name}-stitch-${q.width}x${q.height}.mp4`);

  const yawA = swapLenses ? 90 : -90;
  const yawB = swapLenses ? -90 : 90;
  const { args: fcArgs } = buildStitchGraph({
    width: q.width,
    height: q.height,
    fps: 30,
    lensFov,
    yawA,
    yawB,
  });

  // big-file handling: HEVC halves the size of large equirect masters
  const vcodec = quality === 'master' ? ['libx265', '-crf', q.crf, '-preset', q.preset] : ['libx264', '-crf', q.crf, '-preset', q.preset];

  return new Promise((resolve) => {
    let lastPct = -10;
    ffmpeg()
      .input(frontPath)
      .input(backPath)
      .on('progress', (p) => {
        if (typeof p.percent === 'number') {
          const pct = Math.min(99, p.percent);
          if (pct - lastPct >= 2) {
            lastPct = pct;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('stitch-progress', { percent: pct });
            }
          }
        }
      })
      .on('error', (err) => resolve({ ok: false, error: err.message }))
      .on('end', async () => {
        // big-file handling: remux the camera's own 1024x512 LRV as an
        // instant playback proxy for the stitched master (stream copy, ~1s)
        try {
          if (lrvPath && fs.existsSync(lrvPath)) {
            await new Promise((res2) => {
              ffmpeg(lrvPath)
                .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
                .on('error', () => res2())
                .on('end', () => res2())
                .save(path.join(parsed.dir, `${parsed.name}.aeroproxy.mp4`));
            });
          }
        } catch {
          // proxy is optional
        }
        resolve({ ok: true, outputPath });
      })
      .outputOptions([
        ...fcArgs,
        ...['-c:v', vcodec[0], '-preset', vcodec[1], '-crf', vcodec[2]],
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
      ])
      .save(outputPath);
  });
});

// Photos: normalize iPhone .heic/.heif to PNG so Chromium can display them.
ipcMain.handle('prepare-photo', async (_event, inputPath) => {
  const ext = path.extname(inputPath).slice(1).toLowerCase();
  if (!['heic', 'heif'].includes(ext)) return { ok: true, path: inputPath };
  const outDir = path.join(os.tmpdir(), 'aero-photos');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${path.parse(inputPath).name}-${crypto.randomBytes(3).toString('hex')}.png`);
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('sips', ['-s', 'format', 'png', inputPath, '--out', out], { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`sips exited ${code}`))));
    });
    if (!fs.existsSync(out)) throw new Error('conversion produced no file');
    return { ok: true, path: out, converted: true };
  } catch (err) {
    return { ok: false, error: err.message, path: inputPath };
  }
});

// Insta360 X3: merge the matched lens-file pair into one side-by-side
// dual-fisheye master — exactly the layout v360=dfisheye expects.
ipcMain.handle('combine-insv-pair', async (_event, opts) => {
  const { backPath, frontPath } = opts;
  try {
    const hash = crypto.createHash('md5').update(backPath + '|' + frontPath).digest('hex').slice(0, 12);
    const outDir = path.join(os.tmpdir(), 'aero-combined');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `x3-${hash}.mp4`);
    if (fs.existsSync(outPath)) return { ok: true, outputPath: outPath, cached: true };

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(backPath)
        .input(frontPath)
        .on('progress', (p) => {
          if (typeof p.percent === 'number' && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('stitch-progress', { percent: Math.min(99, p.percent) });
          }
        })
        .on('error', reject)
        .on('end', () => resolve())
        .outputOptions([
          '-filter_complex', '[0:v]fps=30,setpts=PTS-STARTPTS[a];[1:v]fps=30,setpts=PTS-STARTPTS[b];[a][b]hstack=inputs=2,format=yuv420p[v]',
          '-map', '[v]', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-c:a', 'aac', '-b:a', '160k',
          '-movflags', '+faststart',
        ])
        .save(outPath);
    });
    return { ok: true, outputPath: outPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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

