import Icon from './Icon.jsx'
import './toast-feedback.css'

const icons = { success: 'check', error: 'cancel', warning: 'alert', info: 'info' }
const labels = { success: 'Sucesso', error: 'Erro', warning: 'Atenção', info: 'Informação' }
const announcement = toast => [toast.title, toast.message].filter(Boolean).join('. ')

export default function ToastRegion({ toasts = [], onDismiss, onPause }) {
  const visible = toasts.filter(toast => toast.phase === 'visible')
  return <section className="toast-region" aria-label="Avisos do sistema">
    <div className="toast-announcement" role="status" aria-live="polite" aria-atomic="true">{visible.filter(toast => toast.type !== 'error').map(announcement).join('. ')}</div>
    <div className="toast-announcement" role="alert" aria-atomic="true">{visible.filter(toast => toast.type === 'error').map(announcement).join('. ')}</div>
    <ol className="toast-list">
      {toasts.map(toast => <li key={toast.id} className={`feedback-toast feedback-toast-${toast.type}${toast.phase === 'exiting' ? ' is-exiting' : ''}`} aria-label={labels[toast.type]} aria-hidden={toast.phase === 'exiting' || undefined}
        onMouseEnter={() => onPause(toast.id, 'hover', true)} onMouseLeave={() => onPause(toast.id, 'hover', false)}
        onFocusCapture={() => onPause(toast.id, 'focus', true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) onPause(toast.id, 'focus', false) }}>
        <span className="feedback-toast-icon"><Icon name={icons[toast.type]} size={20} /></span>
        <div className="feedback-toast-copy">{toast.title && <strong>{toast.title}</strong>}<p>{toast.message}</p></div>
        <button type="button" className="feedback-toast-close" aria-label="Fechar aviso" disabled={toast.phase === 'exiting'} onClick={() => onDismiss(toast.id)}><Icon name="close" size={18} /></button>
      </li>)}
    </ol>
  </section>
}
