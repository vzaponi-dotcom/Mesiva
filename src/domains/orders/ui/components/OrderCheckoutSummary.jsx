import { useState } from 'react'
import Button from '../../../../shared/ui/Button'
import { formatBRLCurrencyInput } from '../../../../shared/utils/formFormatting.js'
import SystemSelect from '../../../../shared/ui/SystemSelect'

const ADJUSTMENT_OPTIONS = [
  { value: 'none', label: 'Sem ajuste' },
  { value: 'discount', label: 'Desconto' },
  { value: 'surcharge', label: 'Acréscimo' },
]
const ADJUSTMENT_MODE_OPTIONS = [
  { value: 'fixed', label: 'Valor em reais' },
  { value: 'percentage', label: 'Percentual' },
]
export function OrderCheckoutFields({ draft, disabled = false, canAdjustOrders = true, onDeliveryFeeChange, onAdjustmentChange }) {
  const adjustment = draft.adjustment
  const changeAdjustment = (patch) => {
    if (!canAdjustOrders) return false
    onAdjustmentChange?.(patch)
    return true
  }
  const adjustmentTypeField = (
    <div className="form-field">
      <span>Ajuste do pedido</span>
      <SystemSelect
        value={adjustment.type}
        options={ADJUSTMENT_OPTIONS}
        onChange={(type) => changeAdjustment({ type })}
        disabled={disabled}
        label="Ajuste do pedido"
      />
    </div>
  )

  return <div className="new-order-review-fields">
      {draft.type === 'Entrega' && (
        <div className="new-order-checkout-fields">
          <label className="form-field">
          <span>Taxa de entrega</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={draft.deliveryFee}
            onChange={(event) => onDeliveryFeeChange(formatBRLCurrencyInput(event.target.value))}
            disabled={disabled}
          />
          <small className="form-hint">Deixe R$ 0,00 quando não houver taxa.</small>
          </label>

        </div>
      )}

      {canAdjustOrders && <details className="new-order-adjustment" open={adjustment.type !== 'none' ? true : undefined}><summary>Desconto ou acréscimo</summary>
        <div className="new-order-adjustment-fields">{adjustmentTypeField}
          <div className="form-field"><span>Formato</span><SystemSelect value={adjustment.mode} options={ADJUSTMENT_MODE_OPTIONS} onChange={(mode) => changeAdjustment({ mode })} disabled={disabled} label="Formato" /></div>
        </div>


        {canAdjustOrders && adjustment.type !== 'none' && (
          <div className="new-order-adjustment-fields">
            <label className="form-field">
              <span>Valor</span>
              {adjustment.mode === 'fixed' ? (
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  value={adjustment.value}
                  onChange={(event) => changeAdjustment({ value: formatBRLCurrencyInput(event.target.value) })}
                  disabled={disabled}
                />
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={adjustment.value}
                  onChange={(event) => changeAdjustment({ value: event.target.value })}
                  disabled={disabled}
                />
              )}
            </label>
          </div>
        )}

        {canAdjustOrders && adjustment.type !== 'none' && (
          <label className="form-field">
            <span>Motivo (opcional)</span>
            <input
              type="text"
              maxLength={200}
              value={adjustment.reason}
              placeholder="Ex: cliente fidelidade"
              onChange={(event) => changeAdjustment({ reason: event.target.value })}
              disabled={disabled}
            />
          </label>
        )}
      </details>}

  </div>
}

function OrderCheckoutSummary({
  draft,
  preview,
  showFields = true,
  currency,
  disabled = false,
  canSubmit = false,
  canAdjustOrders = true,
  allowImmediatePayment = true,
  editOrderMode = false,
  orderContext = null,
  canReceivePayments = false,
  canRefundPayments = false,
  onSaveRefund,
  onDeliveryFeeChange,
  onAdjustmentChange,
  onSavePending,
  onSavePaid,
  renderPaymentComposition,
}) {
  const [showPayment, setShowPayment] = useState(false)
  const adjustment = draft.adjustment
  const totalCents = Math.round(Number(preview.total || 0) * 100)
  const netReceivedCents = orderContext?.netReceivedCents || 0
  const dueCents = Math.max(0, totalCents - netReceivedCents)
  const refundDueCents = Math.max(0, netReceivedCents - totalCents)
  // A payment against an open tab belongs to the comanda, not this order.
  const canReceiveEdit = editOrderMode && canReceivePayments && dueCents > 0
    && (!orderContext?.tableTabId || orderContext?.paid)
  const canRefundEdit = editOrderMode && canRefundPayments && refundDueCents > 0
  return (
    <section className="surface-card new-order-checkout">
      <div className="section-heading">
        <div>

          <h2>{editOrderMode ? 'Resumo da edição' : 'Resumo da venda'}</h2>
        </div>
      </div>

      {showFields && <OrderCheckoutFields {...{ draft, disabled, canAdjustOrders, onDeliveryFeeChange, onAdjustmentChange }} />}

      <div className="new-order-totals">
        <div><span>Produtos</span><strong>{currency(preview.subtotal)}</strong></div>
        {draft.type === 'Entrega' && <div><span>Taxa de entrega</span><strong>{currency(preview.deliveryFee)}</strong></div>}
        {adjustment.type !== 'none' && (
          <div>
            <span>{adjustment.type === 'discount' ? 'Desconto' : 'Acréscimo'}</span>
            <strong>{adjustment.type === 'discount' ? '− ' : '+ '}{currency(preview.adjustmentAmount)}</strong>
          </div>
        )}
        <div className="new-order-total-final"><span>Total</span><strong>{currency(preview.total)}</strong></div>
        {editOrderMode && <div className="new-order-settlement-preview" aria-label="Resumo financeiro da edição">
          <div><span>Total anterior</span><strong>{currency(Number(orderContext?.originalTotal || 0))}</strong></div>
          <div><span>Recebido líquido</span><strong>{currency(netReceivedCents / 100)}</strong></div>
          {dueCents > 0 && <div><span>Saldo a receber</span><strong>{currency(dueCents / 100)}</strong></div>}
          {refundDueCents > 0 && <div><span>Devolução pendente</span><strong>{currency(refundDueCents / 100)}</strong></div>}
        </div>}
      </div>

      {allowImmediatePayment && showPayment && (
        renderPaymentComposition?.({
          totalCents: Math.round(Number(preview.total || 0) * 100),
          disabled: disabled || !canSubmit,
          onCancel: () => setShowPayment(false),
          onConfirm: onSavePaid,
        })
      )}

      <p className="new-order-payment-hint">{editOrderMode
        ? 'Salvar mantém os recebimentos anteriores. Uma diferença a receber ou devolver só será movimentada após sua confirmação.'
        : allowImmediatePayment ? 'Salvar pedido mantém o pagamento pendente.' : 'O pagamento é registrado pela comanda.'}</p>
      {!showPayment && (
        <div className="new-order-checkout-actions">
          <Button type="button" onClick={onSavePending} disabled={disabled || !canSubmit}>{editOrderMode ? 'Salvar alterações' : draft.type === 'Local' && draft.scheduledFor ? 'Salvar reserva' : 'Salvar pedido'}</Button>
          {canReceiveEdit && <Button type="button" variant="secondary" onClick={() => onSavePaid?.()} disabled={disabled || !canSubmit}>Salvar e receber</Button>}
          {canRefundEdit && <Button type="button" variant="secondary" onClick={onSaveRefund} disabled={disabled || !canSubmit}>Salvar e registrar devolução</Button>}
          {!editOrderMode && allowImmediatePayment && renderPaymentComposition && <Button type="button" variant="secondary" onClick={() => setShowPayment(true)} disabled={disabled || !canSubmit}>Salvar e receber</Button>}
        </div>
      )}
      {!showPayment && <div className="new-order-mobile-checkout"><div><small>Total da venda</small><strong>{currency(preview.total)}</strong></div><Button type="button" onClick={onSavePending} disabled={disabled || !canSubmit}>{editOrderMode ? 'Salvar alterações' : draft.type === 'Local' && draft.scheduledFor ? 'Salvar reserva' : 'Salvar pedido'}</Button></div>}
    </section>
  )
}

export default OrderCheckoutSummary
