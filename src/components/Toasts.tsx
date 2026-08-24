import { useSyncExternalStore } from 'react'
import { isSoundEnabled, subscribeSoundEnabled, sounds } from '../utils/sounds'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

let nextId = 1
let items: Toast[] = []
const toastListeners = new Set<() => void>()

function emit() {
  toastListeners.forEach((l) => l())
}

export function subscribeToasts(l: () => void) {
  toastListeners.add(l)
  return () => toastListeners.delete(l)
}

export function getToasts() {
  return items
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

const KIND_SOUND = {
  success: 'success',
  error: 'error',
  info: 'info',
  warn: 'warn',
} as const

export function pushToast(kind: ToastKind, text: string, opts?: { silent?: boolean }) {
  const toast: Toast = { id: nextId++, kind, text }
  items = [...items.slice(-4), toast] // keep at most 5 visible
  emit()
  if (!opts?.silent && isSoundEnabled()) {
    sounds[KIND_SOUND[kind]]()
  }
  const ttl = kind === 'error' ? 7000 : 4200
  window.setTimeout(() => dismissToast(toast.id), ttl)
  return toast.id
}

export const toasts = {
  success: (text: string) => pushToast('success', text),
  error: (text: string) => pushToast('error', text),
  info: (text: string) => pushToast('info', text),
  warn: (text: string) => pushToast('warn', text),
}

const ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warn: '⚠',
}

export function ToastStack() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  const soundOn = useSyncExternalStore(subscribeSoundEnabled, isSoundEnabled, isSoundEnabled)
  void soundOn // resubscribe not needed; kept for future muted-toast styling

  if (items.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">{ICONS[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
          <button
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
