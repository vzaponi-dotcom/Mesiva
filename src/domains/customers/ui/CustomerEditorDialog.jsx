import Button from '../../../shared/ui/Button'
import Modal from '../../../shared/ui/Modal'
import { formatPhone } from '../../../shared/utils/formFormatting.js'

function CustomerEditorDialog({
  submitting = false,
  open,
  editing,
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
}) {
  if (!open) return null

  return (
    <Modal title={editing ? 'Editar cliente' : 'Novo cliente'} onClose={submitting ? () => {} : onCancel}>
      <div className="form-stack">
        <label className="form-field">
          <span>Nome</span>
          <input
            type="text"
            autoComplete="name"
            placeholder="Ex: Maria Silva"
            value={value.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Telefone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 99999-9999"
            value={value.phone}
            onChange={(event) => onChange({ phone: formatPhone(event.target.value) })}
          />
        </label>
        <label className="form-field">
          <span>Endereço</span>
          <input
            type="text"
            autoComplete="street-address"
            placeholder="Bairro ou endereço"
            value={value.address}
            onChange={(event) => onChange({ address: event.target.value })}
          />
        </label>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button type="button" disabled={disabled || !value.name.trim()} onClick={onSubmit} state={submitting ? 'loading' : 'idle'} loadingLabel="Salvando…">
            {editing ? 'Salvar alterações' : 'Adicionar cliente'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default CustomerEditorDialog
