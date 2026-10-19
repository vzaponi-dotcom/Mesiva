import Button from './Button'
import Modal from './Modal'

function ConfirmationDialog({
  title,
  message,
  details,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Voltar',
  confirmVariant = 'danger',
  onConfirm,
  onClose,
  disabled = false,
  submitting = false,
  loadingLabel = 'Confirmando…',
}) {
  return (
    <Modal title={title} onClose={submitting ? () => {} : onClose}>
      <div className="form-stack confirmation-dialog-content">
        {message && <p>{message}</p>}
        {details && <div className="payment-summary-card">{details}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={disabled || submitting}>{cancelLabel}</Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm} disabled={disabled} state={submitting ? 'loading' : 'idle'} loadingLabel={loadingLabel}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmationDialog
