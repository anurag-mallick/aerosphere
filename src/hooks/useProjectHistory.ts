import { useCallback, useEffect, useRef, useState } from 'react'

const COALESCE_MS = 400

interface HistoryState<T> {
  past: T[]
  future: T[]
  current: T | null
  lastT: number
}

function sameRefs<T>(a: T, b: T): boolean {
  return a === b
}

/**
 * Reference-based undo/redo for a state object whose fields are replaced
 * immutably. Rapid successive changes (<400ms) coalesce into one entry.
 */
export function useProjectHistory<T extends object>(
  current: T,
  applySnapshot: (snap: T) => void
) {
  const hist = useRef<HistoryState<T>>({ past: [], future: [], current: null, lastT: 0 })
  const [, bump] = useState(0)

  useEffect(() => {
    const h = hist.current
    if (h.current === null) {
      h.current = current
      return
    }
    if (sameRefs(current, h.current)) return

    const now = Date.now()
    if (now - h.lastT > COALESCE_MS) {
      // new burst: remember the state just before it started
      h.past.push(h.current)
      if (h.past.length > 80) h.past.shift()
      h.future = []
    }
    h.current = current
    h.lastT = now
    bump((v) => v + 1)
  }, [current])

  const restore = useCallback(
    (snap: T) => {
      applySnapshot(snap)
      hist.current.current = snap
      hist.current.lastT = Date.now()
      bump((v) => v + 1)
    },
    [applySnapshot]
  )

  const undo = useCallback(() => {
    const h = hist.current
    if (h.past.length === 0 || h.current === null) return
    h.future.push(h.current)
    const prev = h.past.pop()!
    restore(prev)
  }, [restore])

  const redo = useCallback(() => {
    const h = hist.current
    if (h.future.length === 0) return
    const next = h.future.pop()!
    if (h.current !== null) h.past.push(h.current)
    restore(next)
  }, [restore])

  return {
    undo,
    redo,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
  }
}
