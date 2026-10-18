import Button from '../../../../shared/ui/Button.jsx'
import Modal from '../../../../shared/ui/Modal.jsx'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'
import PaymentCompositionEditor from '../PaymentCompositionEditor.jsx'
import {getPendingAmount} from '../../../../../shared/orderPaymentRead.js'
import './client-orders-payment.css'

export default function ClientOrdersPaymentDialog({ dialog, currency }) {
  if (!dialog?.orders?.length) return null

  return (
    <Modal title="Registrar pagamento" onClose={dialog.onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          return dialog.submit()
        }}
      >
        <div className="payment-summary-card">
          <span>{dialog.clientName} · {dialog.orders.length} pedidos selecionados</span>
          <strong>{currency(dialog.totalCents / 100)}</strong>
          <small>O recebimento será lançado uma única vez no Financeiro, com os pedidos quitados juntos.</small>
          <div className="client-orders-payment-summary">
            <span className="client-orders-payment-summary-label">Pedidos incluídos</span>
            <ul className="client-orders-payment-summary-list" aria-label="Pedidos selecionados">
              {dialog.orders.map((order) => (
                <li key={order.id} className="client-orders-payment-summary-item">
                  <span className="client-orders-payment-summary-order">{formatOrderDisplayNumber(order)}</span>
                  <span className="client-orders-payment-summary-amount">{currency(getPendingAmount(order))}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <PaymentCompositionEditor
          totalCents={dialog.totalCents}
          allocations={dialog.allocations}
          onChange={dialog.setAllocations}
          paymentOptions={dialog.paymentOptions}
          disabled={dialog.writesBlocked || dialog.submitting}
          receivedDate={dialog.receivedDate}
          onReceivedDateChange={dialog.setReceivedDate}
        />

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={dialog.onClose}>Cancelar</Button>
          <Button
            type="submit"
            disabled={dialog.writesBlocked || dialog.submitting || !dialog.composition.valid || !dialog.dateValid}
          >
            Confirmar recebimento
          </Button>
        </div>
      </form>
    </Modal>
  )
}
