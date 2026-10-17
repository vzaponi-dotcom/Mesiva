import Button from '../../../../shared/ui/Button'
import OrderCart from './OrderCart'
import OrderCheckoutSummary, { OrderCheckoutFields } from './OrderCheckoutSummary'
import NewOrderContext from './NewOrderContext'

function NewOrderReviewStep({ customerSummary, itemCount, cartProps, checkoutProps, contextProps, disabled, canAdjustOrders = true, onBack, onEditCustomer, editOrderMode = false }) {
  // NewOrderContext presents Reserva / Agendado using the business timezone.
  return <section className="new-order-step new-order-review-step" aria-label={`Revisão de ${itemCount} itens`}>
    <NewOrderContext customerSummary={customerSummary} {...(contextProps || checkoutProps.draft)} onEdit={editOrderMode ? undefined : onEditCustomer} disabled={disabled} />
    <div className="new-order-review-layout">
      <div className="new-order-review-cart"><div className="surface-card new-order-review-panel">
        <OrderCart {...cartProps} onAddProducts={onBack} />
        <OrderCheckoutFields {...checkoutProps} canAdjustOrders={canAdjustOrders} />
      </div><Button type="button" variant="secondary" onClick={onBack} disabled={disabled}>← Voltar aos produtos</Button></div>
      <OrderCheckoutSummary {...checkoutProps} showFields={false} canAdjustOrders={canAdjustOrders} />
    </div>
  </section>
}
export default NewOrderReviewStep
