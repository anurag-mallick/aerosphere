// Dev launcher: starts the vite dev server, waits for it to accept
// connections on port 3000, then starts Electron. No extra dependencies.
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3000
const isWin = process.platform === 'win32'

let viteProc = null
let electronProc = null
let shuttingDown = false

function waitForPort(port, timeoutMs = 30000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`vite dev server did not start within ${timeoutMs}ms`))
        } else {
          setTimeout(attempt, 250)
        }
      })
    }
    attempt()
  })
}

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  try { viteProc && viteProc.kill() } catch {}
  try { electronProc && electronProc.kill() } catch {}
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

const npx = isWin ? 'npx.cmd' : 'npx'

viteProc = spawn(npx, ['vite'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
})

waitForPort(PORT)
  .then(() => {
    electronProc = spawn(npx, ['electron', '.'], {
      cwd: root,
      stdio: 'inherit',
      shell: isWin,
    })
    electronProc.on('exit', cleanup)
  })
  .catch((err) => {
    console.error(err.message)
    cleanup()
  })

if (viteProc) {
  viteProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`vite exited unexpectedly (code ${code})`)
      cleanup()
    }
  })
}
