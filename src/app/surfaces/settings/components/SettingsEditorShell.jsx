import { useEffect, useRef, useState } from 'react'
import Button from '../../../../shared/ui/Button'
import '../../../../settings.css'
import '../../../../settings-table-polish.css'
import '../../../../settings-save-feedback.css'

const stateMessage = (state) => ({
  saving: 'Salvando alterações…',
  unconfirmed: 'O resultado do salvamento ainda precisa de confirmação.',
  conflict: 'Há alterações concorrentes para revisar.',
}[state?.status])

function SettingsEditorShell({ title, description, scope, effectiveNotice, state, readOnly, saveBlocked = false, saveBlockedMessage = '', onSave, onDiscard, onReconcile, onReload, onReviewConflict, className = '', discardLabel = 'Descartar', footerNote, headerAction, children, feedbackScopeKey = title }) {
  const [saveFeedback, setSaveFeedback] = useState('')
  const [buttonFeedback, setButtonFeedback] = useState(null)
  const [sending, setSending] = useState(null)
  const pending = useRef(null), mounted = useRef(true), latest = useRef(null)
  const snapshotKey = JSON.stringify([feedbackScopeKey, state?.draft])
  latest.current = { snapshotKey, feedbackScopeKey, status: state?.status, error: state?.error }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null } }, [])
  useEffect(() => {
    if (buttonFeedback && buttonFeedback.snapshotKey !== snapshotKey) setButtonFeedback(null)
  }, [snapshotKey, buttonFeedback])
  useEffect(() => {
    pending.current = null; setSending(null); setButtonFeedback(null)
  }, [feedbackScopeKey])
  useEffect(() => {
    if (!buttonFeedback || (state?.status || 'ready') !== 'ready') return undefined
    const timer = setTimeout(() => setButtonFeedback(null), 1800)
    return () => clearTimeout(timer)
  }, [buttonFeedback, state?.status])
  const status = state?.status || 'ready'
  const message = stateMessage(state)
  const errorMessage = typeof state?.error === 'string' ? state.error : state?.error?.message
  const readFailed = status === 'error' && !state?.draft && !state?.confirmed?.data
  const inFlight = sending?.feedbackScopeKey === feedbackScopeKey
  const discardDisabled = inFlight || ['saving', 'loading', 'unconfirmed'].includes(status) || readFailed
  const saveDisabled = discardDisabled || status === 'conflict' || saveBlocked

  useEffect(() => {
    if (!saveFeedback) return undefined
    const timer = setTimeout(() => setSaveFeedback(''), 2600)
    return () => clearTimeout(timer)
  }, [saveFeedback])

  useEffect(() => {
    if (state?.dirty) setSaveFeedback('')
  }, [state?.dirty])

  const runConfirmedAction = async action => {
    if (pending.current || !action) return false
    const attempt = { snapshotKey, feedbackScopeKey }
    pending.current = attempt; setSending(attempt); setButtonFeedback(null)
    try {
      const confirmed = await action()
      if (mounted.current && pending.current === attempt && latest.current.snapshotKey === attempt.snapshotKey
        && !['conflict', 'error'].includes(latest.current.status)) {
        if (confirmed === true) setButtonFeedback({ snapshotKey, state: 'success' })
        else if (latest.current.error) setButtonFeedback({ snapshotKey, state: 'error' })
      }
      return confirmed
    } catch {
      if (mounted.current && pending.current === attempt) setSaveFeedback('Não foi possível confirmar o salvamento. Reconsulte o estado antes de tentar novamente.')
      return false
    } finally {
      if (pending.current === attempt) { pending.current = null; if (mounted.current) setSending(null) }
    }
  }

  const handleSave = () => {
    if (saveBlocked || saveDisabled) return false
    if (state?.dirty === false) {
      setSaveFeedback('Não há alterações para salvar.')
      return false
    }
    setSaveFeedback('')
    return runConfirmedAction(onSave)
  }

  return <section className={['settings-editor-shell', className].filter(Boolean).join(' ')} aria-labelledby="settings-editor-title">
    <header className="settings-editor-header">
      <div><p className="section-kicker">{scope}</p><h1 id="settings-editor-title">{title}</h1><p>{description}</p></div>
      {(readOnly || headerAction) && <div className="settings-editor-header-actions">
        {readOnly && <span className="settings-readonly-badge">Somente leitura</span>}
        {!readOnly && headerAction}
      </div>}
    </header>
    {effectiveNotice && <p className="settings-effective-notice">{effectiveNotice}</p>}
    {status === 'loading' && <p className="settings-state-message" aria-live="polite">Carregando configurações…</p>}
    {status === 'error' && <p className="settings-state-message settings-state-error" role="alert">{errorMessage || 'Não foi possível carregar estas configurações.'}</p>}
    {message && <p className={status === 'conflict' ? 'settings-state-message settings-state-error' : 'settings-state-message'} {...(status === 'conflict' ? { role: 'alert' } : { 'aria-live': 'polite' })}>{message}</p>}
    {state?.dirty && <p className="settings-state-message" role="status">Há alterações pendentes no rascunho.</p>}
    {!readOnly && saveBlocked && saveBlockedMessage && <p className="settings-state-message" aria-live="polite">{saveBlockedMessage}</p>}
    {(status === 'unconfirmed' || readFailed) && <div><Button type="button" variant="secondary" disabled={inFlight} onClick={status === 'unconfirmed' ? () => runConfirmedAction(onReconcile) : onReload}>Reconsultar</Button></div>}
    {status === 'conflict' && !readOnly && <div><Button type="button" variant="secondary" onClick={onReviewConflict}>Revisar alterações</Button></div>}
    <div className="settings-editor-content">{children}</div>
    {!readOnly && status !== 'loading' && <footer className="settings-editor-footer">
      {footerNote && <small className="settings-editor-footer-note">{footerNote}</small>}
      <div className="settings-editor-footer-actions">
        <Button type="button" variant="secondary" onClick={onDiscard} disabled={discardDisabled}>{discardLabel}</Button>
        <Button type="button" onClick={handleSave} disabled={saveDisabled} state={status === 'saving' || inFlight ? 'loading' : status === 'ready' && buttonFeedback?.snapshotKey === snapshotKey ? buttonFeedback.state : 'idle'} loadingLabel="Salvando…" successLabel="Salvo">Salvar alterações</Button>
      </div>
    </footer>}
    {saveFeedback && <div className="settings-save-feedback" role="status" aria-live="polite">{saveFeedback}</div>}
  </section>
}

export default SettingsEditorShell
