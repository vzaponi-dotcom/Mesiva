import Icon from './Icon'
import './button-feedback.css'

function Button({ variant = 'primary', icon, children, className = '', state, loadingLabel = 'Aguarde…', successLabel = 'Concluído', errorLabel = 'Falhou', disabled, onClick, ...props }) {
  const feedback = Boolean(state && state !== 'idle')
  const label = { loading: loadingLabel, success: successLabel, error: errorLabel }[state]
  const classes = ['button', `button-${variant}`, state !== undefined && 'button-stateful', feedback && 'button-feedback', feedback && `button-feedback-${state}`, className].filter(Boolean).join(' ')
  const handleClick = (event) => {
    if (disabled || feedback) { event?.preventDefault?.(); return }
    return onClick?.(event)
  }

  return (
    <button className={classes} aria-label={state !== undefined && typeof children === 'string' ? children : undefined} {...props} disabled={disabled || feedback} aria-busy={state === 'loading' || props['aria-busy'] || undefined} onClick={handleClick}>
      {state !== undefined ? <>
        <span className="button-feedback-sizer" aria-hidden="true">{[children, loadingLabel, successLabel, errorLabel].map((text, index) => <span key={index}>{text}</span>)}</span>
        <span className="button-feedback-content" key={state}>
          {state === 'loading' ? <svg className="button-feedback-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42 57" /></svg> : (feedback || icon) && <Icon name={state === 'success' ? 'check' : state === 'error' ? 'cancel' : icon} size={18} />}
          <span>{label || children}</span>
        </span>
      </> : <>{icon && <Icon name={icon} size={18} />}<span>{children}</span></>}
      {state !== undefined && <span className="button-feedback-announcement" role="status" aria-live="polite">{label || ''}</span>}
    </button>
  )
}

export default Button
