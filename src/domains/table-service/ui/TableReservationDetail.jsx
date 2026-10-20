import { useMemo, useState } from 'react'
import { FINANCE_TIME_ZONE, getBusinessDate } from '../../../../shared/finance.js'
import { getOperationalStartAt } from '../../../../shared/orderTiming.js'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Icon from '../../../shared/ui/Icon'
import Modal from '../../../shared/ui/Modal'
import SystemSelect from '../../../shared/ui/SystemSelect'

const itemLabel = (count) => `${count} ${count === 1 ? 'item' : 'itens'}`

const formatServiceDate = (value) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: FINANCE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(value))

const formatServiceTime = (value) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: FINANCE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).format(new Date(value))

function ReservationClosureDialog({
  submitting = false,
  mode,
  reservation,
  reasonOptions,
  reasonRevision,
  disabled,
  onClose,
  onConfirm,
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const selectedReason = reasonOptions.find((option) => option.value === reason)
  const configured = Number.isSafeInteger(reasonRevision) && reasonRevision >= 0 && reasonOptions.length > 0
  const requiresNote = Boolean(selectedReason?.requiresNote)
  const title = mode === 'no-show' ? 'Registrar não comparecimento' : 'Cancelar reserva'
  const confirmLabel = mode === 'no-show' ? 'Registrar não comparecimento' : 'Confirmar cancelamento'

  const submit = async () => {
    if (!configured) {
      setError('Os motivos de cancelamento estão indisponíveis. Atualize os dados e tente novamente.')
      return false
    }
    if (!selectedReason) {
      setError('Selecione um motivo ativo para continuar.')
      return false
    }
    if (requiresNote && !note.trim()) {
      setError('Descreva o motivo para continuar.')
      return false
    }
    if (note.trim().length > 240) {
      setError('A descrição do motivo deve ter no máximo 240 caracteres.')
      return false
    }
    setError('')
    await onConfirm?.(reservation.id, {
      expectedRevision: reservation.revision,
      reason,
      note: requiresNote ? note.trim() : '',
      cancelReasonRevision: reasonRevision,
      refundNow: false,
    })
    onClose?.()
    return true
  }

  return (
    <Modal title={title} onClose={disabled ? () => {} : onClose}>
      <div className="form-stack reservation-closure-dialog">
        <div className="reservation-closure-summary">
          <strong>{reservation.tableName}</strong>
          <span>{formatServiceDate(reservation.scheduledFor)} · {formatServiceTime(reservation.scheduledFor)}</span>
        </div>
        <div className="form-field">
          <span>Motivo</span>
          <SystemSelect
            value={reason}
            options={reasonOptions}
            onChange={(value) => { setReason(value); setError('') }}
            placeholder="Selecione um motivo"
            label="Motivo"
            disabled={disabled || !configured}
          />
        </div>
        {requiresNote && (
          <label className="form-field">
            <span>Descreva o motivo</span>
            <textarea
              value={note}
              maxLength={240}
              onChange={(event) => { setNote(event.target.value); setError('') }}
              disabled={disabled}
            />
          </label>
        )}
        {!configured && <small className="form-error" role="alert">Os motivos de cancelamento estão indisponíveis.</small>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>Voltar</Button>
          <Button type="button" variant={mode === 'no-show' ? 'secondary' : 'danger'} onClick={submit} disabled={disabled || !configured} state={submitting ? 'loading' : 'idle'} loadingLabel="Registrando…">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TableReservationDetail({
  detail,
  tableOccupied,
  currency,
  disabled = false,
  actionKey = null,
  canCreateOrders = false,
  canCancelOrders = false,
  cancellationOptions = [],
  cancellationRevision = null,
  currentTiming,
  now = new Date(),
  headingId = 'reservation-heading',
  headingRef,
  onEdit,
  onConfirmArrival,
  onCancel,
  onNoShow,
}) {
  const [arrivalOpen, setArrivalOpen] = useState(false)
  const [closureMode, setClosureMode] = useState(null)
  const reservation = detail?.reservation
  const order = detail?.order
  const items = order?.items || []
  const total = Number(order?.total ?? (reservation?.totalCents || 0) / 100)
  const operationalStartAt = useMemo(() => order && reservation
    ? getOperationalStartAt({
        createdAt: order.createdAt,
        scheduledFor: reservation.scheduledFor,
      }, currentTiming)
    : null, [currentTiming, order, reservation])

  if (!reservation || !order) return null

  const active = reservation.status === 'reserved'
  const editable = active && canCreateOrders && operationalStartAt && now < operationalStartAt
  const arrivalAllowed = active
    && canCreateOrders
    && getBusinessDate(now) >= getBusinessDate(new Date(reservation.scheduledFor))
  const busy = disabled || Boolean(actionKey)
  const count = Number(reservation.itemCount || items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))

  return (
    <section className="reservation-detail" aria-labelledby={headingId}>
      <div className="reservation-detail-hero">
        <div className="reservation-detail-identity">
          <span className="reservation-detail-eyebrow">RESERVA</span>
          <h2 id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{reservation.tableName}</h2>
        </div>
        <div className="reservation-detail-hero-info">
          <div className="reservation-detail-chips">
            <span className="reservation-status-chip"><span aria-hidden="true" />Reservada</span>
            {reservation.clientName && <span className="reservation-client-chip"><Icon name="user" size={18} />{reservation.clientName}</span>}
          </div>
        </div>
      </div>

      <time className="reservation-schedule" dateTime={reservation.scheduledFor}>
        <span><small>Data da reserva</small><strong>{formatServiceDate(reservation.scheduledFor)}</strong></span>
        <span><small>Horário</small><strong>{formatServiceTime(reservation.scheduledFor)}</strong></span>
      </time>
      {typeof tableOccupied === 'boolean' && <p className="reservation-occupancy-note">{tableOccupied ? 'Esta mesa está ocupada. O consumo da comanda atual é separado desta reserva.' : 'Esta mesa está livre agora. A reserva só ocupa a mesa após a confirmação da chegada.'}</p>}

      <div className="reservation-detail-order-summary">
        <Icon name="meal" size={22} />
        <strong>Pedido {reservation.orderNumber} · {itemLabel(count)}</strong>
      </div>

      <section className="reservation-detail-items-section" aria-labelledby="reservation-items-heading">
        <header className="reservation-detail-section-heading">
          <span className="reservation-detail-section-title"><Icon name="receipt" size={22} /><strong id="reservation-items-heading">Itens reservados</strong></span>
          <span>{itemLabel(count)}</span>
        </header>
        <ul className="reservation-detail-items">
          {items.map((item, index) => (
            <li key={item.id || index}>
              <span className="reservation-detail-quantity">{item.quantity}x</span>
              <div className="reservation-detail-item-copy">
                <strong>{item.name}</strong>
                {item.size && <span>{item.size}</span>}
                {item.note && <span className="reservation-detail-note">Obs: {item.note}</span>}
              </div>
              <strong>{currency(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</strong>
            </li>
          ))}
        </ul>

        <div className="reservation-detail-total">
          <span><strong>Total previsto</strong><small>{itemLabel(count)}</small></span>
          <strong>{currency(total)}</strong>
        </div>

        {!editable && active && <p className="reservation-detail-note-card">A reserva já entrou na janela operacional e não pode mais ser editada.</p>}
        {detail.hasManualPrintHistory && editable && <p className="reservation-detail-note-card">Esta reserva já possui impressão manual. O editor pedirá confirmação antes de salvar alterações.</p>}

        <div className="reservation-detail-actions">
          {canCreateOrders && <Button type="button" icon="check" className="reservation-action-primary" disabled={busy || !arrivalAllowed} onClick={() => setArrivalOpen(true)}>Confirmar chegada</Button>}
          {canCreateOrders && <Button type="button" variant="secondary" icon="edit" disabled={busy || !editable} onClick={() => { if (editable) onEdit?.(detail) }}>Editar reserva</Button>}
          {canCancelOrders && (
            <div className="reservation-detail-secondary-actions">
              <Button type="button" variant="secondary" disabled={busy || !active} onClick={() => setClosureMode('no-show')}>Não compareceu</Button>
              <Button type="button" variant="danger" disabled={busy || !active} onClick={() => setClosureMode('cancel')}>Cancelar reserva</Button>
            </div>
          )}
        </div>
      </section>

      {arrivalOpen && (
        <ConfirmationDialog
          title="Confirmar chegada" submitting={Boolean(actionKey)} loadingLabel="Confirmando…"
          message={`A ${reservation.tableName} passará para Ocupada e a reserva será convertida em comanda.`}
          details={<><strong>{reservation.clientName || reservation.tableName}</strong><span>{formatServiceDate(reservation.scheduledFor)} · {formatServiceTime(reservation.scheduledFor)}</span></>}
          confirmLabel="Confirmar chegada e abrir comanda"
          cancelLabel="Voltar"
          confirmVariant="primary"
          disabled={busy}
          onClose={() => setArrivalOpen(false)}
          onConfirm={async () => {
            await onConfirmArrival?.(reservation.id, reservation.revision)
            setArrivalOpen(false)
          }}
        />
      )}

      {closureMode && (
        <ReservationClosureDialog
          mode={closureMode} submitting={Boolean(actionKey)}
          reservation={reservation}
          reasonOptions={cancellationOptions}
          reasonRevision={cancellationRevision}
          disabled={busy}
          onClose={() => setClosureMode(null)}
          onConfirm={closureMode === 'no-show' ? onNoShow : onCancel}
        />
      )}
    </section>
  )
}

export default TableReservationDetail
