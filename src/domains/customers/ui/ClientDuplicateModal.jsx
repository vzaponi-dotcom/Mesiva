import Button from '../../../shared/ui/Button'
import Modal from '../../../shared/ui/Modal'

function ClientDuplicateModal({
  client,
  onCancel,
  onUseExisting,
  onConfirm,
  disabled = false,
  submitting = false,
  cancelLabel = 'Cancelar',
  useExistingLabel = 'Usar cliente existente',
  confirmLabel = 'Cadastrar mesmo assim',
}) {
  if (!client) return null

  return (
    <Modal
      title="Encontramos um cliente com este nome"
      onClose={submitting ? () => {} : onCancel}
      footer={(
        <div className="duplicate-client-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onConfirm} disabled={disabled} state={submitting ? 'loading' : 'idle'} loadingLabel="Cadastrando…">
            {confirmLabel}
          </Button>
          <Button type="button" onClick={onUseExisting} disabled={disabled}>
            {useExistingLabel}
          </Button>
        </div>
      )}
    >
      <div className="duplicate-client-content">
        <p className="duplicate-client-copy">
          Pode ser a mesma pessoa. Confira o cadastro encontrado antes de criar outro cliente.
        </p>
        <div className="duplicate-client-summary">
          <span className="duplicate-client-avatar" aria-hidden="true">
            {client.name?.trim()?.charAt(0)?.toUpperCase() || '?'}
          </span>
          <div className="duplicate-client-details">
            <strong>{client.name}</strong>
            <span>{client.phone || 'Sem telefone cadastrado'}</span>
            {client.address && client.address !== 'Sem endereço' && <small>{client.address}</small>}
          </div>
        </div>
        <p className="duplicate-client-hint">
          Se for outra pessoa com o mesmo nome, você ainda pode cadastrar normalmente.
        </p>
      </div>
    </Modal>
  )
}

export default ClientDuplicateModal
