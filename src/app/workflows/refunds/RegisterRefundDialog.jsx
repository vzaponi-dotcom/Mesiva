import { useEffect, useState } from 'react'
import Button from '../../../shared/ui/Button'
import Modal from '../../../shared/ui/Modal'
import SystemSelect from '../../../shared/ui/SystemSelect'
import { PAYMENT_METHOD_OPTIONS, hasMixedPayment, paymentOptionsWithSelection, paymentSelectionNeedsReview } from '../../../domains/finance/index.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'

const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
const originalRefundMethod = (order) => {
  if (hasMixedPayment(order?.paymentAllocations)) return ''
  return order?.paymentAllocations?.[0]?.methodLabel || order?.paymentMethod || ''
}

function RegisterRefundDialog({ open, order, onClose, onConfirm, submitting = false, paymentOptions = PAYMENT_METHOD_OPTIONS }) {
  const [refundMethod, setRefundMethod] = useState('')

  useEffect(() => {
    if (!open || !order) return
    setRefundMethod(originalRefundMethod(order))
  }, [open, order])

  if (!open || !order) return null
  const originalMethodInactive = paymentSelectionNeedsReview(paymentOptions, refundMethod)
  const preservingOriginalMethod = Boolean(originalRefundMethod(order)) && refundMethod === originalRefundMethod(order)
  const visibleOptions = paymentOptionsWithSelection(paymentOptions, refundMethod)
  const mixedPayment = hasMixedPayment(order.paymentAllocations)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!refundMethod || originalMethodInactive || submitting) return
    await onConfirm?.({ refundMethod })
  }

  const amount = Number(order.paidAmount || order.total || 0)

  return (
    <Modal title="Registrar estorno" onClose={submitting ? () => {} : onClose}>
      <form className="form-stack refund-order-form" onSubmit={handleSubmit}>
        <div className="refund-order-summary">
          <span>{formatOrderDisplayNumber(order)} · {order.client}</span>
          <strong>{currency(amount)}</strong>
          <small>O valor integral pago será registrado como estorno e aparecerá como saída no Financeiro.</small>
        </div>
        {mixedPayment && (
          <div className="payment-summary-card">
            <strong>Composição original da venda</strong>
            {order.paymentAllocations.map((allocation) => (
              <span key={`${allocation.methodCode}-${allocation.amountCents}`}>{allocation.methodLabel} · {currency(Number(allocation.amountCents || 0) / 100)}</span>
            ))}
            <small>Escolha uma única forma ativa para registrar o estorno integral deste pedido.</small>
          </div>
        )}
        <div className="form-field">
          <span>Forma de estorno</span>
          <SystemSelect value={refundMethod} options={visibleOptions} onChange={setRefundMethod} placeholder="Selecione a forma do estorno" label="Forma de estorno" disabled={submitting} />
          {originalMethodInactive && <small className="form-error" role="alert">{preservingOriginalMethod
            ? 'O método original está inativo hoje e foi preservado como referência. Escolha uma forma ativa para registrar o estorno.'
            : 'A forma escolhida ficou inativa. Escolha outra forma ativa para registrar o estorno.'}</small>}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Voltar</Button>
          <Button type="submit" state={submitting ? 'loading' : 'idle'} loadingLabel="Registrando…" disabled={submitting || !refundMethod || originalMethodInactive}>{submitting ? 'Registrando…' : 'Confirmar estorno'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default RegisterRefundDialog
