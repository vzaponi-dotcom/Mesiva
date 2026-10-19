import { useEffect, useState } from 'react'
import Button from '../../../../shared/ui/Button'
import Modal from '../../../../shared/ui/Modal'
import SystemSelect from '../../../../shared/ui/SystemSelect'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'
import {
  PAYMENT_METHOD_OPTIONS,
  hasMixedPayment,
  paymentOptionsWithSelection,
  paymentSelectionNeedsReview,
} from '../../../finance/index.js'

import {
  cancellationOptionsWithSelection,
  cancellationSelectionNeedsReview,
} from '../../domain/cancellationReasonOptions.js'

const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
const originalRefundMethod = (order) => {
  if (hasMixedPayment(order?.paymentAllocations)) return ''
  return order?.paymentAllocations?.[0]?.methodLabel || order?.paymentMethod || ''
}

function CancelOrderDialog({
  open,
  order,
  onClose,
  onConfirm,
  submitting = false,
  canRefundPayments = true,
  paymentOptions = PAYMENT_METHOD_OPTIONS,
  reasonOptions = [],
  reasonRevision = null,
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [refundNow, setRefundNow] = useState(false)
  const [refundMethod, setRefundMethod] = useState('')
  const [error, setError] = useState('')
  const [reviewPayload, setReviewPayload] = useState(null)

  useEffect(() => {
    if (!open || !order) return
    setReason(''); setNote(''); setRefundNow(false); setRefundMethod(originalRefundMethod(order)); setError(''); setReviewPayload(null)
  }, [open, order])

  if (!open || !order) return null
  const isPaid = order.paymentStatus === 'Pago'
  const originalMethodInactive = paymentSelectionNeedsReview(paymentOptions, refundMethod)
  const preservingOriginalMethod = Boolean(originalRefundMethod(order)) && refundMethod === originalRefundMethod(order)
  const mixedPayment = hasMixedPayment(order.paymentAllocations)
  const reviewedMethodInactive = Boolean(reviewPayload?.refundNow
    && paymentSelectionNeedsReview(paymentOptions, reviewPayload.refundMethod))
  const visiblePaymentOptions = paymentOptionsWithSelection(paymentOptions, refundMethod)
  const reasonNeedsReview = cancellationSelectionNeedsReview(reasonOptions, reason)
  const selectedReason = reasonOptions.find((option) => option.value === reason)
  const visibleReasonOptions = cancellationOptionsWithSelection(reasonOptions, reason, selectedReason?.label)
  const reasonConfigAvailable = Number.isSafeInteger(reasonRevision) && reasonRevision >= 0 && reasonOptions.length > 0
  const reviewedReasonInactive = Boolean(reviewPayload
    && (reviewPayload.expectedRevision !== reasonRevision
      || cancellationSelectionNeedsReview(reasonOptions, reviewPayload.reason)))
  const reasonLabel = reasonOptions.find((option) => option.value === reviewPayload?.reason)?.label || reviewPayload?.reason

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!reasonConfigAvailable) return setError('Os motivos de cancelamento estão indisponíveis. Atualize os dados e tente novamente.')
    if (!reason || reasonNeedsReview) return setError('Selecione um motivo ativo para cancelar o pedido.')
    if (selectedReason?.requiresNote && !note.trim()) return setError('Descreva o motivo do cancelamento.')
    if (note.trim().length > 240) return setError('A descrição do motivo deve ter no máximo 240 caracteres.')
    if (isPaid && canRefundPayments && refundNow && !refundMethod) return setError('Selecione a forma usada no estorno.')
    if (isPaid && canRefundPayments && refundNow && originalMethodInactive) return setError('Escolha uma forma de estorno ativa antes de continuar.')
    setError('')
    setReviewPayload({ reason, note: selectedReason?.requiresNote ? note.trim() : '', expectedRevision: reasonRevision, refundNow: isPaid && canRefundPayments ? refundNow : false, refundMethod: isPaid && canRefundPayments && refundNow ? refundMethod : '' })
  }

  const handleFinalConfirm = async () => {
    if (!reviewPayload || (reviewPayload.refundNow && !canRefundPayments)) return false
    if (reviewedReasonInactive) {
      setReviewPayload(null)
      setError('O motivo escolhido não está mais ativo. Escolha outro motivo ativo para continuar.')
      return false
    }
    if (reviewPayload.refundNow && paymentSelectionNeedsReview(paymentOptions, reviewPayload.refundMethod)) {
      setReviewPayload(null)
      setError('A forma de estorno ficou inativa. Escolha outra forma ativa para continuar.')
      return false
    }
    await onConfirm?.(reviewPayload)
  }

  if (reviewPayload) {
    return (
      <Modal title="Revisar cancelamento" onClose={submitting ? () => {} : () => setReviewPayload(null)}>
        <div className="form-stack cancel-order-form">
          <div className="cancel-order-warning"><strong>{formatOrderDisplayNumber(order)} · {order.client}</strong><span>Esta ação cancela o pedido e o mantém somente no histórico.</span></div>
          <div className="payment-summary-card">
            <span>Motivo: {reasonLabel}{reviewPayload.note ? ` · ${reviewPayload.note}` : ''}</span>
            {isPaid && <span>{reviewPayload.refundNow ? `Estorno já realizado via ${reviewPayload.refundMethod}` : 'Estorno ficará pendente no Financeiro'}</span>}
            {reviewedMethodInactive && <small className="form-error" role="alert">A forma de estorno ficou inativa. Volte e escolha outra forma ativa.</small>}
            {reviewedReasonInactive && <small className="form-error" role="alert">O motivo escolhido não está mais ativo. Volte e escolha outro motivo.</small>}
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setReviewPayload(null)} disabled={submitting}>Voltar e revisar</Button>
            <Button type="button" variant="danger" onClick={handleFinalConfirm} state={submitting ? 'loading' : 'idle'} loadingLabel="Cancelando…" disabled={submitting || reviewedMethodInactive || reviewedReasonInactive}>{submitting ? 'Cancelando…' : 'Confirmar cancelamento definitivamente'}</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Cancelar pedido" onClose={submitting ? () => {} : onClose}>
      <form className="form-stack cancel-order-form" onSubmit={handleSubmit}>
          <div className="cancel-order-warning"><strong>{formatOrderDisplayNumber(order)} · {order.client}</strong><span>O pedido continuará no histórico e deixará de participar das vendas e da operação.</span></div>
        <div className="form-field"><span>Motivo do cancelamento</span><SystemSelect value={reason} options={visibleReasonOptions} onChange={(value) => { setReason(value); setError('') }} placeholder="Selecione um motivo" label="Motivo do cancelamento" disabled={submitting || !reasonConfigAvailable} /></div>
        {!reasonConfigAvailable && <small className="form-error" role="alert">Os motivos de cancelamento estão indisponíveis. Aguarde a atualização antes de cancelar.</small>}
        {reasonNeedsReview && <small className="form-error" role="alert">O motivo escolhido não está mais ativo. Escolha outro motivo.</small>}
        {selectedReason?.requiresNote && <label className="form-field"><span>Descreva o motivo</span><textarea value={note} maxLength={240} onChange={(event) => { setNote(event.target.value); setError('') }} placeholder="Explique brevemente o motivo" disabled={submitting} /></label>}
        {isPaid && canRefundPayments && (
          <div className="cancel-refund-panel">
            <div><strong>Este pedido já foi pago.</strong><span>O valor já foi devolvido ao cliente?</span></div>
            {mixedPayment && <div className="payment-summary-card"><strong>Composição original da venda</strong>{order.paymentAllocations.map((allocation) => <span key={`${allocation.methodCode}-${allocation.amountCents}`}>{allocation.methodLabel} · {currency(Number(allocation.amountCents || 0) / 100)}</span>)}<small>O estorno continua integral e exige uma única forma ativa.</small></div>}
            <div className="cancel-refund-choice" role="group" aria-label="Situação do estorno">
              <button type="button" className={!refundNow ? 'button button-secondary active' : 'button button-secondary'} aria-pressed={!refundNow} onClick={() => { setRefundNow(false); setError('') }} disabled={submitting}>Ainda não</button>
              <button type="button" className={refundNow ? 'button button-secondary active' : 'button button-secondary'} aria-pressed={refundNow} onClick={() => { setRefundNow(true); setError('') }} disabled={submitting}>Sim</button>
            </div>
            {refundNow && <div className="form-field"><span>Forma do estorno</span><SystemSelect value={refundMethod} options={visiblePaymentOptions} onChange={(value) => { setRefundMethod(value); setError('') }} label="Forma do estorno" disabled={submitting} />{originalMethodInactive && <small className="form-error" role="alert">{preservingOriginalMethod
              ? 'O método original está inativo hoje e foi preservado como referência. Escolha uma forma ativa para continuar.'
              : 'A forma escolhida ficou inativa. Escolha outra forma ativa para continuar.'}</small>}</div>}
            {!refundNow && <small>O cancelamento ficará com estorno pendente para ser registrado no Financeiro depois.</small>}
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Voltar</Button><Button type="submit" disabled={submitting || !reasonConfigAvailable || reasonNeedsReview || (isPaid && canRefundPayments && refundNow && (!refundMethod || originalMethodInactive))}>Revisar cancelamento</Button></div>
      </form>
    </Modal>
  )
}

export default CancelOrderDialog
