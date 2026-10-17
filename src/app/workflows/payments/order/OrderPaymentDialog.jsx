import Button from '../../../../shared/ui/Button.jsx'
import Modal from '../../../../shared/ui/Modal.jsx'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'
import PaymentCompositionEditor from '../PaymentCompositionEditor.jsx'

export default function OrderPaymentDialog({ dialog, currency }) {
  if (!dialog?.order) return null

  return (
    <Modal title={dialog.supplemental ? 'Receber saldo complementar' : 'Registrar pagamento'} onClose={dialog.onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          return dialog.submit()
        }}
      >
        <div className="payment-summary-card">
          <span>{dialog.order.client} · {formatOrderDisplayNumber(dialog.order)}</span>
          <strong>{currency(dialog.totalCents / 100)}</strong>
          <small>{dialog.supplemental ? 'Será recebido somente o saldo pendente, sem alterar o pagamento anterior.' : 'O pagamento será lançado automaticamente como entrada no Financeiro.'}</small>
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
            Confirmar pagamento
          </Button>
        </div>
      </form>
    </Modal>
  )
}
