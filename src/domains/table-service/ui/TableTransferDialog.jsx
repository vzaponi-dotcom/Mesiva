import { useMemo, useRef, useState } from 'react'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Modal from '../../../shared/ui/Modal'
import { getTransferDestinations } from '../domain/tableTransfer.js'

function TableTransferDialog({ sourceTable, tables, disabled, onClose, onTransfer }) {
  const [destinationId, setDestinationId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [expectedTableTabId] = useState(() => sourceTable.openTableTab?.id ?? sourceTable.openTableTabId ?? '')
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const destinations = useMemo(
    () => getTransferDestinations(tables, sourceTable.id),
    [sourceTable.id, tables],
  )
  const destination = destinations.find((table) => table.id === destinationId) ?? null

  const confirmTransfer = async () => {
    const currentSource = tables.find((table) => table.id === sourceTable.id)
    const currentTableTabId = currentSource?.openTableTab?.id ?? currentSource?.openTableTabId ?? ''
    if (!destination || disabled || submittingRef.current) return
    if (!expectedTableTabId || currentTableTabId !== expectedTableTabId) {
      onClose()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const transferred = await onTransfer(sourceTable.id, destination.id, expectedTableTabId)
      if (transferred) onClose()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (confirming && destination) {
    return (
      <ConfirmationDialog
        title="Confirmar transferência"
        submitting={submitting} loadingLabel="Transferindo…"
        message={`Transferir ${sourceTable.name} → ${destination.name}?`}
        confirmLabel="Transferir comanda"
        confirmVariant="primary"
        onClose={() => setConfirming(false)}
        onConfirm={confirmTransfer}
        disabled={disabled}
      />
    )
  }

  return (
    <Modal title={`Transferir comanda · ${sourceTable.name}`} onClose={onClose}>
      <div className="form-stack">
        <p>Escolha uma mesa ativa e livre para receber a comanda.</p>
        <div className="table-transfer-options" role="radiogroup" aria-label="Mesa de destino">
          {destinations.map((table) => (
            <button key={table.id} type="button" className={destinationId === table.id ? 'table-transfer-option active' : 'table-transfer-option'} role="radio" aria-checked={destinationId === table.id} onClick={() => setDestinationId(table.id)} disabled={disabled}>
              <strong>{table.name}</strong><span>Livre · Ativa</span>
            </button>
          ))}
        </div>
        {!destinations.length && <p className="table-empty-note">Não há mesas ativas e livres disponíveis para transferência.</p>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Cancelar</Button>
          <Button type="button" onClick={() => setConfirming(true)} disabled={disabled || !destination}>Continuar</Button>
        </div>
      </div>
    </Modal>
  )
}

export default TableTransferDialog
