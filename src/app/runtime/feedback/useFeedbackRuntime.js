import { useCallback, useEffect, useRef, useState } from 'react'

export const TOAST_DURATIONS = { success: 4000, info: 4000, warning: 6000, error: 0 }

function createToastQueue(onChange) {
  let records = [], sequence = 0, alive = true, hidden = false
  const publish = () => { if (alive) onChange(records.filter(item => item.phase !== 'queued').map(({ id, type, title, message, phase }) => ({ id, type, title, message, phase }))) }
  const cancel = item => {
    if (item.timer !== null) clearTimeout(item.timer)
    if (item.exitTimer !== null) clearTimeout(item.exitTimer)
    item.timer = item.exitTimer = null
  }
  const schedule = item => {
    if (!alive || item.phase !== 'visible' || item.pauses.size || item.duration === 0 || item.timer !== null) return
    item.started = Date.now()
    item.timer = setTimeout(() => { item.timer = null; dismiss(item.id) }, Math.max(0, item.remaining))
  }
  const promote = () => {
    let slots = 3 - records.filter(item => item.phase !== 'queued').length
    for (const item of records) {
      if (slots <= 0) break
      if (item.phase !== 'queued') continue
      item.phase = 'visible'
      if (hidden) item.pauses.add('document')
      slots--
      schedule(item)
    }
  }
  const dismiss = id => {
    const item = records.find(item => item.id === id)
    if (!item || item.phase === 'exiting') return
    cancel(item)
    item.phase = 'exiting'
    item.exitTimer = setTimeout(() => { records = records.filter(item => item.id !== id); promote(); publish() }, 160)
    publish()
  }
  const pause = (id, reason, paused) => {
    const item = records.find(item => item.id === id)
    if (!item || item.phase === 'exiting') return
    if (paused) {
      if (item.timer !== null) {
        clearTimeout(item.timer)
        item.timer = null
        item.remaining = Math.max(0, item.remaining - (Date.now() - item.started))
      }
      item.pauses.add(reason)
    } else {
      item.pauses.delete(reason)
      schedule(item)
    }
  }
  const clear = () => { records.forEach(cancel); records = []; publish() }
  return {
    show(input) {
      if (!alive || !input?.message) return null
      const type = Object.hasOwn(TOAST_DURATIONS, input.type) ? input.type : 'info'
      const duration = TOAST_DURATIONS[type]
      const id = `feedback-${++sequence}`
      records.push({ id, type, title: input.title || '', message: String(input.message), duration, remaining: duration, started: 0, timer: null, exitTimer: null, pauses: new Set(), phase: 'queued' })
      promote(); publish()
      return id
    },
    dismiss, pause, clear,
    setHidden(value) { hidden = value; records.forEach(item => pause(item.id, 'document', value)) },
    activate() { alive = true },
    dispose() { alive = false; clear() },
  }
}

export function useFeedbackRuntime() {
  const [toasts, setToasts] = useState([])
  const queueRef = useRef(null)
  if (!queueRef.current) queueRef.current = createToastQueue(setToasts)
  const queue = queueRef.current
  useEffect(() => {
    queue.activate()
    const onVisibility = () => queue.setHidden(globalThis.document?.visibilityState === 'hidden')
    onVisibility()
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility)
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility)
      queue.dispose()
    }
  }, [queue])
  const showSuccessMessage = useCallback((message = 'Ação salva com sucesso') => queue.show({ type: 'success', message }), [queue])
  const showWarningMessage = useCallback(message => queue.show({ type: 'warning', message }), [queue])
  const showErrorMessage = useCallback(message => queue.show({ type: 'error', message }), [queue])
  const showContextMessage = useCallback((message, { type = 'info' } = {}) => queue.show({ type, message }), [queue])

  return {
    toasts,
    showToast: queue.show,
    dismissToast: queue.dismiss,
    setToastPaused: queue.pause,
    clearFeedback: queue.clear,
    showWarningMessage,
    showErrorMessage,
    showContextMessage,
    showSuccessMessage,
  }
}
