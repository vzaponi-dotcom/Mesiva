import { useState } from 'react'
import {
  formatSignedBRLCurrencyInput,
  formatSignedBRLCurrencyValue,
  parseSignedBRLCurrencyInput,
} from '../../../shared/utils/formFormatting.js'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Modal from '../../../shared/ui/Modal'

const buildDraft = (settings, today) => ({
  value: formatSignedBRLCurrencyValue(settings?.openingBalance ?? 0),
  openingDate: settings?.openingDate || today,
})

function OpeningBalanceDialogContent({ settings, today, currentBalance, disabled, onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => buildDraft(settings, today))
  const [review, setReview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const editing = Boolean(settings?.openingDate)
  const locked = disabled || submitting
  const hasValue = draft.value !== '' && draft.value !== '-'
  const canReview = Boolean(hasValue && draft.openingDate)

  const handleReview = (event) => {
    event.preventDefault()
    if (!canReview || locked) return
    setReview({
      openingBalance: parseSignedBRLCurrencyInput(draft.value),
      openingDate: draft.openingDate,
    })
  }

  const handleConfirm = async () => {
    if (!review || locked) return
    setSubmitting(true)
    try {
      const result = await onSubmit?.(review)
      if (result === false) return
      setReview(null)
      onClose?.()
    } finally {
      setSubmitting(false)
    }
  }

  if (review) {
    return (
      <ConfirmationDialog submitting={submitting} loadingLabel="Salvando…"
        title={editing ? 'Confirmar alteração do saldo inicial' : 'Confirmar saldo inicial'}
        message="O saldo atual será recalculado a partir da nova configuração de abertura."
        details={(
          <div className="form-stack compact-stack">
            {editing && (
              <>
                <span>Valor atual: <strong>{formatSignedBRLCurrencyValue(settings?.openingBalance ?? 0)}</strong></span>
                <small>Data atual: {settings?.openingDate}</small>
              </>
            )}
            <span>Novo valor: <strong>{formatSignedBRLCurrencyValue(review.openingBalance)}</strong></span>
            <small>Nova data de abertura: {review.openingDate}</small>
            {currentBalance !== null && currentBalance !== undefined && (
              <small>Saldo atual antes da alteração: {formatSignedBRLCurrencyValue(currentBalance)}</small>
            )}
          </div>
        )}
        confirmLabel={editing ? 'Salvar nova abertura' : 'Configurar abertura'}
        confirmVariant="primary"
        onConfirm={handleConfirm}
        onClose={() => setReview(null)}
        disabled={locked}
      />
    )
  }

  return (
    <Modal title={editing ? 'Editar saldo inicial' : 'Configurar saldo inicial'} onClose={locked ? () => {} : onClose}>
      <form className="form-stack opening-balance-form" onSubmit={handleReview}>
        <p className="form-helper">
          O saldo inicial representa o valor disponível na data em que o controle financeiro começa. Ele não será registrado como entrada.
        </p>

        <label className="form-field">
          <span>Saldo inicial</span>
          <input
            inputMode="decimal"
            value={draft.value}
            onChange={(event) => setDraft((current) => ({
              ...current,
              value: formatSignedBRLCurrencyInput(event.target.value),
            }))}
            placeholder="R$ 0,00"
            disabled={locked}
          />
        </label>

        <label className="form-field">
          <span>Data de abertura</span>
          <input
            type="date"
            value={draft.openingDate}
            max={today}
            onChange={(event) => setDraft((current) => ({ ...current, openingDate: event.target.value }))}
            disabled={locked}
          />
        </label>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={locked}>Cancelar</Button>
          <Button type="submit" disabled={locked || !canReview}>
            {editing ? 'Revisar alteração' : 'Revisar saldo inicial'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function OpeningBalanceDialog({ open, settings = null, today, currentBalance = null, disabled = false, onClose, onSubmit }) {
  if (!open) return null
  return (
    <OpeningBalanceDialogContent
      key={`${settings?.updatedAt || settings?.openingDate || 'new'}:${today}`}
      settings={settings}
      today={today}
      currentBalance={currentBalance}
      disabled={disabled}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}

export default OpeningBalanceDialog
