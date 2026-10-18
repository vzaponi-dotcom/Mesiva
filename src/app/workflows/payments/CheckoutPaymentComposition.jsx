import { useState } from 'react'
import { getBusinessDate } from '../../../../shared/finance.js'
import Button from '../../../shared/ui/Button.jsx'
import PaymentCompositionEditor from './PaymentCompositionEditor.jsx'
import { createInitialPaymentComposition, toPaymentAllocations, isValidReceivedDate } from './paymentComposition.js'

export default function CheckoutPaymentComposition({
  totalCents,
  paymentOptions,
  defaultPaymentMethod,
  disabled = false,
  onCancel,
  onConfirm,
}) {
  const [allocations, setAllocations] = useState(() => createInitialPaymentComposition({
    totalCents,
    paymentOptions,
    defaultPaymentMethod,
  }))
  const [receivedDate, setReceivedDate] = useState(() => getBusinessDate())
  const payload = toPaymentAllocations(allocations, totalCents, paymentOptions)
  const dateValid = isValidReceivedDate(receivedDate)

  return (
    <div className="new-order-payment-choice">
      <PaymentCompositionEditor
        totalCents={totalCents}
        allocations={allocations}
        onChange={setAllocations}
        paymentOptions={paymentOptions}
        disabled={disabled}
        receivedDate={receivedDate}
        onReceivedDateChange={setReceivedDate}
      />
      <div className="form-actions">
        <Button type="button" onClick={() => payload && dateValid && onConfirm?.(payload, receivedDate)} disabled={disabled || !payload || !dateValid}>Confirmar recebimento</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={disabled}>Voltar</Button>
      </div>
    </div>
  )
}
