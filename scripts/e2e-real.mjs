#!/usr/bin/env node
/**
 * Real-footage e2e: drives the actual UI with the user's Insta360 X3 .insv
 * pair (Demo video/). Content-agnostic assertions — real lens footage has no
 * synthetic color markers, so we assert on signal properties instead:
 * non-uniform frames, pan changes the picture, export animates the reframe.
 *
 * Prereqs: vite on :3000, electron --remote-debugging-port. Args:
 *   node scripts/e2e-real.mjs <cdpPort> <absPathToDemoVideoDir> <exportOut>
 */
const PORT = process.argv[2] || '9333'
const FOOTAGE_DIR = process.argv[3]
const EXPORT_PATH = process.argv[4] || '/tmp/opencode/real-export.mp4'

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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(body, timeoutMs = 15000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(`(()=>{try{return ${body}}catch(e){return false}})()`)) return
    await sleep(200)
  }
  throw new Error('timeout: ' + label)
}
function check(cond, msg, extra = '') {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.error('  ✗ FAIL:', msg, extra) }
}

const INJECT = `
window.__ui = {
  q: (s) => document.querySelector(s),
  qa: (s) => [...document.querySelectorAll(s)],
  addToTimeline(nameSubstr) {
    const card = this.qa('.sidebar .library-item').find((n) =>
      n.querySelector('.clip-name')?.textContent.toLowerCase().includes(nameSubstr.toLowerCase()));
    if (!card) return false;
    const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('+ Timeline'));
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  },
  dragCanvas(dx, dy) {
    const c = this.q('.preview-360-viewport'); if (!c) return false;
    const r = c.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const mk = (t, px, py) => new PointerEvent(t, { bubbles: true, cancelable: true,
      pointerId: 7, pointerType: 'mouse', clientX: px, clientY: py,
      buttons: t === 'pointerup' ? 0 : 1, isPrimary: true });
    c.dispatchEvent(mk('pointerdown', x, y));
    for (let i = 1; i <= 5; i++) c.dispatchEvent(mk('pointermove', x + dx * i / 5, y + dy * i / 5));
    c.dispatchEvent(mk('pointerup', x + dx, y + dy));
    return true;
  },
  // sample a grid of pixels from the WebGL canvas — returns stats
  sampleFrame() {
    const c = this.q('.preview-360-viewport'); if (!c) return null;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, sum2 = 0, n = 0;
    const lums = [];
    for (let i = 0; i < px.length; i += 4 * 97) { // sparse stride
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lums.push(l); sum += l; sum2 += l * l; n++;
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    return { mean: Math.round(mean * 10) / 10, std: Math.round(Math.sqrt(Math.max(0, variance)) * 10) / 10, w, h };
  },
  frameSignature() {
    const c = this.q('.preview-360-viewport'); if (!c) return null;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let acc = 0;
    for (let i = 0; i < px.length; i += 4 * 53) acc = (acc * 31 + px[i] + px[i + 1] + px[i + 2]) | 0;
    return acc;
  },
}
'ui-ready'
`

async function getState() { return evaluate(`window.__aero.getState()`) }

async function main() {
  const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:3000'))
  if (!page) throw new Error('app page not found')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 140))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || '').slice(0, 140))
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  console.log('\n== aerosphere e2e — REAL X3 footage ==')

  await evaluate(`localStorage.clear()`)
  await send('Page.navigate', { url: 'http://localhost:3000' })
  await waitFor(`document.readyState === 'complete'`, 15000, 'load')
  await waitFor(`!!window.__aero && !!window.__aero.getState`, 10000, 'hook')
  await evaluate(INJECT)

  // ---- import the user's footage folder ----
  await evaluate(`window.__aero.importFolder(${JSON.stringify(FOOTAGE_DIR)})`)
  await waitFor(`window.__aero.getState().videos.length >= 1`, 30000, 'footage imported')
  await sleep(1500) // let pair-detection settle
  const st = await getState()
  const insv = st.videos.find((v) => v.name.endsWith('.insv'))
  check(!!insv, 'X3 .insv imported')
  check(insv?.is360 === true && insv?.projection === 'dfisheye',
    `.insv detected as 360° dual-fisheye (is360=${insv?.is360}, proj=${insv?.projection})`)
  // pairing collapses the _00_/_10_ pair into ONE entry pointing at its sibling
  check(st.videos.filter((v) => v.name.endsWith('.insv')).length === 1,
    'lens pair collapsed into a single library entry')
  check(!!insv?.pairedPath && insv.pairedPath.includes('_10_'),
    `paired with back lens (pairedPath=${insv?.pairedPath?.split('/').pop()})`)

  // ---- add to timeline ----
  check(await evaluate(`window.__ui.addToTimeline('.insv')`), 'added .insv via "+ Timeline"')
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).length >= 1`, 8000, 'clip on track')
  const clip = (await getState()).tracks.flatMap((t) => t.clips)[0]
  check(clip && Math.abs(clip.duration - 77.477) < 1,
    `clip duration ≈ 77.5s (${clip?.duration?.toFixed(1)}s)`)
  check(clip?.keyframes === 0, 'starts with no keyframes')

  // ---- playback (proxy-served) ----
  const playBtn = await evaluate(`(() => { const b = window.__ui.q('.transport-play'); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  check(playBtn, 'clicked transport play')
  await waitFor(`window.__aero.getState().isPlaying === true`, 4000, 'playing')
  await sleep(600)
  const t0 = (await getState()).currentTime
  await sleep(1200)
  const t1 = (await getState()).currentTime
  check(t1 - t0 > 0.5, `5.7K footage plays smoothly via proxy (${(t1 - t0).toFixed(2)}s/1.2s)`)
  if (t1 - t0 <= 0.5) {
    const vd = await evaluate(`(() => {
      const v = document.querySelector('.preview-video');
      const a = [...document.querySelectorAll('audio')];
      return { paused: v?.paused, ct: v?.currentTime, rs: v?.readyState,
        err: v?.error?.code ?? null, w: v?.videoWidth,
        srcTail: v ? decodeURIComponent(v.currentSrc).split('/').pop().slice(0, 44) : null,
        audioEls: a.length };
    })()`)
    console.error('    [freeze dump]', JSON.stringify(vd))
  }
  await evaluate(`window.__aero.pause()`)

  // ---- dfisheye viewport on REAL lens footage ----
  await evaluate(`window.__aero.seek(${JSON.stringify(clip.position)} + 5)`)
  await sleep(400)
  await waitFor(`!!window.__ui.q('.preview-360-viewport')`, 8000, 'viewport mounted on real .insv')
  await sleep(900)
  const f1 = await evaluate(`window.__ui.sampleFrame()`)
  check(f1 && f1.std > 8, `real footage renders with detail (mean=${f1?.mean}, σ=${f1?.std})`, JSON.stringify(f1))

  // pan changes the picture on real content
  const sigBefore = await evaluate(`window.__ui.frameSignature()`)
  await evaluate(`window.__ui.dragCanvas(160, 0)`)
  await sleep(500)
  const sigAfter = await evaluate(`window.__ui.frameSignature()`)
  check(sigBefore !== sigAfter, 'drag-pan changes the rendered view (signatures differ)')

  // ---- keyframes via Inspector on real clip ----
  await evaluate(`window.__aero.selectClip(${JSON.stringify(clip.id)})`)
  await sleep(250)
  await waitFor(`!![...document.querySelectorAll('.kf-header button')].find(b=>b.textContent.includes('At playhead')&&!b.disabled)`, 5000, 'kf button enabled')
  await evaluate(`[...document.querySelectorAll('.kf-header button')].find(b=>b.textContent.includes('At playhead')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await waitFor(`window.__aero.getState().tracks.flatMap(t=>t.clips).find(c=>c.id===${JSON.stringify(clip.id)}).keyframes === 1`, 4000, 'kf#1 on real clip')

  // second keyframe with a pan offset, then export a SHORT trimmed window —
  // exporting the full 77.5s 5.7K clip would take many minutes
  await evaluate(`window.__aero.seek(${JSON.stringify(clip.position)} + 8)`)
  await sleep(250)
  await evaluate(`window.__aero.updateSelectedClip({ keyframes: [
    { id: 'r1', time: 4.5, pan: 0, tilt: 0, roll: 0, fov: 90, easing: 'ease' },
    { id: 'r2', time: 8, pan: 90, tilt: 0, roll: 0, fov: 80, easing: 'ease' },
  ] })`)
  await sleep(300)
  await evaluate(`window.__aero.updateSelectedClip({ duration: 6 })`)
  await sleep(300)

  // ---- full-quality preview toggle (playhead must sit INSIDE the clip) ----
  await evaluate(`window.__aero.seek(${JSON.stringify(clip.position)} + 3)`)
  await sleep(250)
  const srcBefore = await evaluate(`document.querySelector('.preview-video').currentSrc`)
  await evaluate(`[...document.querySelectorAll('.quality-toggle')][0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(1200) // src swap + reload + seek
  const srcAfter = await evaluate(`document.querySelector('.preview-video').currentSrc`)
  check(srcBefore.includes('q=full') === false && srcAfter.includes('q=full') === true,
    '⚡→🎞 toggle switches to full-quality source')
  const qState = await evaluate(`localStorage.getItem('aero.previewQuality')`)
  check(qState === 'full', 'full-quality preference persisted')
  // playback still works at full quality
  await evaluate(`window.__aero.play()`)
  await sleep(900)
  const fqT = (await getState()).currentTime
  await sleep(900)
  const fqT2 = (await getState()).currentTime
  check(fqT2 - fqT > 0.4, `full-quality playback advances (${(fqT2 - fqT).toFixed(2)}s/0.9s)`)
  await evaluate(`window.__aero.pause()`)
  // restore proxy for the export step (faster) — toggle back
  await evaluate(`[...document.querySelectorAll('.quality-toggle')][0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(800)

  await evaluate(`window.__aero.pause()`)
  const expRes = await evaluate(`window.__aero.exportTo(${JSON.stringify(EXPORT_PATH)})`)
  check(expRes?.ok, 'export of keyframed real footage completed', JSON.stringify(expRes))

  console.log(`\\nconsole errors: ${consoleErrors.length}`)
  consoleErrors.slice(0, 4).forEach((e) => console.error(' •', e))
  check(consoleErrors.length === 0, 'zero renderer console errors on real footage')

  console.log(`\\n== REAL-FOOTAGE RESULT: ${pass} passed, ${fail} failed ==`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\\nDRIVER ERROR:', err.message)
  console.error(`partial: ${pass} passed, ${fail} failed`)
  process.exit(2)
})
