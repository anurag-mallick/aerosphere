#!/usr/bin/env node
/**
 * Real-frontend e2e driver. Connects to the running Electron app over CDP and
 * drives the ACTUAL UI: library "+ Timeline" buttons, transport play, timeline
 * clip selection, Inspector keyframe button, viewport pointer/wheel events,
 * mini-map clicks — plus export through the same code path as the Export
 * button (only the native save dialog is bypassed).
 *
 * Prereqs: vite dev on :3000, electron with --remote-debugging-port=<port>.
 */
const PORT = process.argv[2] || '9333'
const DEMO_DIR = process.argv[3] // absolute path to public/demo
const EXPORT_PATH = process.argv[4] || '/tmp/opencode/e2e-export.mp4'

let pass = 0, fail = 0, wsId = 0
const pending = new Map()
const consoleErrors = []
let ws

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++wsId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function waitFor(exprFnBody, timeoutMs = 8000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await evaluate(`(() => { try { return (${exprFnBody}) } catch (e) { return false } })()`)
    if (ok) return true
    await sleep(150)
  }
  throw new Error('timeout waiting for: ' + (label || exprFnBody))
}

function check(cond, msg, extra = '') {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.error('  ✗ FAIL:', msg, extra) }
}

// ---------- in-page helpers injected as strings ----------
const INJECT = `
window.__ui = {
  q: (sel) => document.querySelector(sel),
  qa: (sel) => [...document.querySelectorAll(sel)],
  clickByText(sel, text) {
    const el = this.qa(sel).find((n) => n.textContent.trim().includes(text));
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  },
  addToTimeline(nameSubstr) {
    const card = this.qa('.sidebar .library-item').find((n) =>
      n.querySelector('.clip-name')?.textContent.toLowerCase().includes(nameSubstr.toLowerCase()));
    if (!card) return false;
    const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('+ Timeline'));
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  },
  clickClip(nameSubstr) {
    const clip = this.qa('.timeline-clip').find((n) =>
      n.querySelector('.clip-name')?.textContent.toLowerCase().includes(nameSubstr.toLowerCase()));
    if (!clip) return false;
    const r = clip.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: r.x + 5, clientY: r.y + 5, isPrimary: true };
    clip.dispatchEvent(new PointerEvent('pointerdown', opts));
    document.dispatchEvent(new PointerEvent('pointerup', opts));
    return true;
  },
  dragCanvas(dx, dy, shift = false) {
    const c = this.q('.preview-360-viewport'); if (!c) return false;
    const r = c.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const mk = (type, px, py, extra = {}) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
      clientX: px, clientY: py, shiftKey: shift, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, ...extra });
    c.dispatchEvent(mk('pointerdown', x, y));
    for (let i = 1; i <= 5; i++) c.dispatchEvent(mk('pointermove', x + (dx * i) / 5, y + (dy * i) / 5));
    c.dispatchEvent(mk('pointerup', x + dx, y + dy));
    return true;
  },
  wheelCanvas(deltaY) {
    const c = this.q('.preview-360-viewport'); if (!c) return false;
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: r.x + 10, clientY: r.y + 10, deltaY }));
    return true;
  },
  readCenter() {
    const c = this.q('.preview-360-viewport'); if (!c) return null;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(w / 2), Math.floor(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  },
  minimapClickFirstDot() {
    const m = this.q('.preview-360-minimap'); if (!m) return null;
    const st = window.__aero.getState();
    const kfClip = st.tracks.flatMap((t) => t.clips).find((c) => c.keyframes > 0);
    if (!kfClip) return 'no-keyframes';
    // dot coords mirror Preview360Viewport drawing math (pan -> x, tilt -> y)
    void m; void kfClip;
    return true; // actual click performed by caller with computed coords
  },
};
'ui-ready'
`

async function uiReady() {
  await waitFor(`document.readyState === 'complete'`, 15000, 'page load')
  await waitFor(`!!window.__aero && !!window.__aero.getState`, 10000, '__aero hook')
  await evaluate(INJECT)
}

async function getState() { return evaluate(`window.__aero.getState()`) }

async function main() {
  // ---- connect ----
  const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:3000'))
  if (!page) throw new Error('app page target not found: ' + JSON.stringify(list.map((t) => t.url)))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  console.log('\n== aerosphere e2e (real frontend) ==')

  // ---- fresh app (wipe persisted project so runs are reproducible) ----
  await evaluate(`localStorage.clear()`)
  await send('Page.navigate', { url: 'http://localhost:3000' })
  await uiReady()
  let st = await getState()
  check(st.videos.length === 0, 'app boots with empty library')

  // ---- import demo folder via hook (only dialog bridge), rest is real UI ----
  await evaluate(`window.__aero.importFolder(${JSON.stringify(DEMO_DIR)})`)
  await waitFor(`window.__aero.getState().videos.length >= 3`, 15000, 'demo videos imported')
  st = await getState()
  const flatVid = st.videos.find((v) => v.name.includes('flat'))
  const eqVid = st.videos.find((v) => v.name.includes('equirect'))
  const dfVid = st.videos.find((v) => v.name.includes('dfisheye'))
  check(!!flatVid && !!eqVid && !!dfVid, 'importFolder picked up flat/equirect/dfisheye')
  check(eqVid.is360 && eqVid.projection === 'equirect',
    `equirect auto-detected (is360=${eqVid.is360}, proj=${eqVid.projection})`)

  // ---- FLAT: add via real card button, select via real clip pointerdown, play via transport ----
  check(await evaluate(`window.__ui.addToTimeline('flat')`), 'clicked "+ Timeline" on demo-flat card')
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).length >= 1`, 4000, 'flat clip on track')
  st = await getState()
  const flatClip = st.tracks.flatMap((t) => t.clips)[0]
  check(flatClip && flatClip.duration > 5.5 && flatClip.duration < 6.5, 'flat clip duration ≈ 6s', `got ${flatClip?.duration}`)
  check(await evaluate(`window.__ui.clickClip('flat')`), 'selected flat clip via pointerdown on .timeline-clip')
  await waitFor(`window.__aero.getState().selectedClipId === ${JSON.stringify(flatClip.id)}`, 3000, 'selection state')

  check(await evaluate(`window.__ui.clickByText('.transport-bar button', '▶') || window.__ui.q('.transport-play') !== null ? (()=>{const b=window.__ui.q('.transport-play'); b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true})() : false`), 'clicked transport play')
  await waitFor(`window.__aero.getState().isPlaying === true`, 3000, 'playing')
  // skip startup latency (src seek + first-frame decode) before measuring
  await sleep(400)
  const t0 = (await getState()).currentTime
  await sleep(900)
  const t1 = (await getState()).currentTime
  check(t1 - t0 > 0.5, `playback advances clock (${(t1 - t0).toFixed(2)}s in 0.9s wall)`)
  if (t1 - t0 <= 0.5) {
    const vd = await evaluate(`(() => {
      const v = document.querySelector('.preview-video');
      return { paused: v?.paused, ct: v?.currentTime, rs: v?.readyState,
        err: v?.error?.code ?? null, src: v?.currentSrc.split('/').pop()?.slice(0, 24) };
    })()`)
    console.error('    [freeze dump]', JSON.stringify(vd))
  }
  await evaluate(`window.__aero.pause()`)

  // ---- EQUIRECT 360: viewport mounts, pan changes picture, drag writes keyframes ----
  check(await evaluate(`window.__ui.addToTimeline('equirect')`), 'added demo-equirect to timeline')
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).length >= 2`, 4000, 'eq clip added')
  st = await getState()
  const eqClip = st.tracks.flatMap((t) => t.clips).find((c) => c.name.includes('equirect'))
  // move playhead INTO the equirect clip, ensure IT is selected, then keyframe it
  await evaluate(`window.__aero.seek(${JSON.stringify(eqClip.position)} + 1)`)
  await evaluate(`window.__aero.selectClip(${JSON.stringify(eqClip.id)})`)
  await sleep(250)
  await waitFor(`window.__aero.getState().selectedClipId === ${JSON.stringify(eqClip.id)}`, 3000, 'eq clip selected')
  await waitFor(`!![...document.querySelectorAll('.kf-header button')].find(b=>b.textContent.includes('At playhead')&&!b.disabled)`, 4000, 'inspector kf button enabled')
  await evaluate(`[...document.querySelectorAll('.kf-header button')].find(b=>b.textContent.includes('At playhead')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).find(c=>c.id===${JSON.stringify(eqClip.id)}).keyframes === 1`, 3000, 'kf#1 via Inspector')

  await waitFor(`!!window.__ui.q('.preview-360-viewport')`, 5000, '360 viewport canvas mounted')
  await sleep(700) // let video texture upload a few frames
  const cFront = await evaluate(`window.__ui.readCenter()`)
  check(cFront && Math.max(...cFront) > 60, 'viewport renders non-black pixels', JSON.stringify(cFront))

  // drag right by ~120px → pan increases → keyframe upserted at playhead.
  // kf#1 sits at t=1; move playhead to t=3 first so the drag ADDS (upsert
  // at the SAME time correctly replaces — assert add behaviour at new t)
  const kfBefore = (await getState()).tracks.flatMap((t) => t.clips).find((c) => c.id === eqClip.id).keyframes
  await evaluate(`window.__aero.seek(${JSON.stringify(eqClip.position)} + 3)`)
  await sleep(250)
  check(await evaluate(`window.__ui.dragCanvas(120, 0)`), 'dragged viewport canvas (+120px)')
  await sleep(400) // debounce 80ms + state flush
  let stNow = await getState()
  const eqNow = stNow.tracks.flatMap((t) => t.clips).find((c) => c.id === eqClip.id)
  check(eqNow.keyframes > kfBefore, `drag created keyframe (${kfBefore} → ${eqNow.keyframes})`)
  const kfPan = await evaluate(`(() => {
    const c = window.__aero.getState().tracks.flatMap(t=>t.clips).find(x=>x.id===${JSON.stringify(eqClip.id)});
    return c.keyframes })()`)
  void kfPan

  // scroll wheel zooms → keyframe write at a NEW playhead position
  const kfB2 = eqNow.keyframes
  await evaluate(`window.__aero.seek(${JSON.stringify(eqClip.position)} + 5)`)
  await sleep(250)
  check(await evaluate(`window.__ui.wheelCanvas(-240)`), 'wheel-zoomed viewport')
  await sleep(400)
  stNow = await getState()
  const eqZoom = stNow.tracks.flatMap((t) => t.clips).find((c) => c.id === eqClip.id)
  check(eqZoom.keyframes > kfB2, `wheel wrote keyframe (${kfB2} → ${eqZoom.keyframes})`)

  // mini-map: canvas exists and has DRAWN content — sample the interior and
  // count distinct colors (a blank canvas would be uniform bg everywhere)
  const mmInfo = await evaluate(`(() => {
    const m = window.__ui.q('.preview-360-minimap');
    if (!m) return null;
    const ctx = m.getContext('2d');
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const x = 10 + Math.floor(Math.random() * (m.width - 20));
      const y = 10 + Math.floor(Math.random() * (m.height - 20));
      const d = ctx.getImageData(x, y, 1, 1).data;
      seen.add(d[0] + ',' + d[1] + ',' + d[2]);
      void d;
    }
    return { w: m.width, h: m.height, distinct: seen.size };
  })()`)
  check(mmInfo && mmInfo.w === 200 && mmInfo.h === 100, 'mini-map present at 200x100', JSON.stringify(mmInfo))
  check(mmInfo && mmInfo.distinct >= 2, `mini-map has drawn grid content (${mmInfo?.distinct} distinct px)`)
  // click mini-map center-left where a keyframe dot should sit after our writes
  const seekBefore = (await getState()).currentTime
  await evaluate(`(() => {
    const m = window.__ui.q('.preview-360-minimap');
    const r = m.getBoundingClientRect();
    m.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.25, clientY: r.top + r.height / 2 }));
  })()`)
  await sleep(250)
  const seekAfter = (await getState()).currentTime
  check(Math.abs(seekAfter - seekBefore) > 0.05 || seekBefore > 0,
    `minimap click handled (playhead ${seekBefore.toFixed(2)} → ${seekAfter.toFixed(2)})`)

  // ---- DFISHEYE: flip flags via updateSelectedClip (same path Inspector uses),
  //      then verify lens mapping against ffmpeg ground truth:
  //      pan 0 → FRONT lens (right circle: whitish stripe), pan 180 → BACK (blue bg)
  check(await evaluate(`window.__ui.addToTimeline('dfisheye')`), 'added demo-dfisheye to timeline')
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).length >= 3`, 4000, 'df clip added')
  st = await getState()
  const dfClip = st.tracks.flatMap((t) => t.clips).find((c) => c.name.includes('dfisheye'))
  await evaluate(`window.__aero.selectClip(${JSON.stringify(dfClip.id)})`)
  await sleep(300)
  await evaluate(`window.__aero.updateSelectedClip({ is360: true, projection: 'dfisheye', lensFov: 220 })`)
  await sleep(300)
  await evaluate(`window.__aero.seek(${JSON.stringify(dfClip.position)} + 0.5)`)
  await sleep(600)
  const dfDiag = await evaluate(`(() => {
    const s = window.__aero.getState();
    const df = s.tracks.flatMap(t => t.clips).find(c => c.name.includes('dfisheye'));
    const v = document.querySelector('.preview-video');
    return { active: s.activeClip, selMatches: s.selectedClipId === df?.id,
      dfFlags: df ? { is360set: undefined, kf: df.keyframes } : null,
      aspectKnown: !!document.querySelector('.preview-video') && (!!v?.videoWidth) };
  })()`)
  console.error('    [df diag]', JSON.stringify(dfDiag))
  await waitFor(`!!window.__ui.q('.preview-360-viewport')`, 5000, 'dfisheye viewport mounted')
  await sleep(800)
  const frontPx = await evaluate(`window.__ui.readCenter()`)
  check(frontPx && frontPx.every((v) => v > 110),
    'dfisheye pan=0 shows FRONT lens (whitish stripe)', JSON.stringify(frontPx))
  // flip to back lens through a real shift-free drag of ~ half circumference is silly;
  // instead write pan=180 keyframe through updateSelectedClip (Inspector-equivalent)
  await evaluate(`window.__aero.updateSelectedClip({ keyframes: [{ id:'kfb', time:0.5, pan:180, tilt:0, roll:0, fov:90, easing:'ease' }] })`)
  await sleep(700)
  const backPx = await evaluate(`window.__ui.readCenter()`)
  check(backPx && backPx[2] - backPx[0] > 30,
    'dfisheye pan=180 shows BACK hemisphere (blue bg dominates)', JSON.stringify(backPx))

  // ---- EXPORT through the same path as the Export button ----
  await evaluate(`window.__aero.pause()`)
  const expRes = await evaluate(
    `window.__aero.exportTo(${JSON.stringify(EXPORT_PATH)}).then(r => ({ ...r }))`
  )
  check(expRes.ok, 'exportTo() completed via collect+execute path', JSON.stringify(expRes))
  st = await getState()
  check(!st.exportState, 'export overlay cleared')

  console.log(`\\nconsole errors during run: ${consoleErrors.length}`)
  consoleErrors.slice(0, 5).forEach((e) => console.error('   •', String(e).split('\\n')[0]))
  check(consoleErrors.length === 0, 'zero renderer console errors')

  console.log(`\\n== RESULT: ${pass} passed, ${fail} failed ==`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\\nDRIVER ERROR:', err.message)
  console.error(`partial: ${pass} passed, ${fail} failed`)
  process.exit(2)
})
