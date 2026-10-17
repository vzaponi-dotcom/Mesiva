import { useCallback, useState } from 'react'
import Button from '../../../../shared/ui/Button'
import BottomSheet from '../../../../shared/ui/BottomSheet'
import NewOrderCartSummary from './NewOrderCartSummary'
import OrderProductCatalog from './OrderProductCatalog'
import NewOrderContext from './NewOrderContext'

function NewOrderProductsStep({ products, items, currency, disabled, customerSummary, itemCount, subtotal, onAdd, onDecrease, onBack, onReview, cartProps, contextProps, editOrderMode = false }) {
  const [cartOpen, setCartOpen] = useState(false)
  const closeCart = useCallback(() => setCartOpen(false), [])
  const summaryProps = { items, itemCount, subtotal, currency, disabled, cartProps, onReview }
  return <section className="new-order-step new-order-products-step">
    <NewOrderContext customerSummary={customerSummary} {...contextProps} onEdit={editOrderMode ? undefined : onBack} disabled={disabled} />
    <div className="new-order-products-layout">
      <OrderProductCatalog products={products} items={items} currency={currency} disabled={disabled} onAdd={onAdd} onDecrease={onDecrease} />
      <NewOrderCartSummary {...summaryProps} />
    </div>
    {!editOrderMode && <div className="new-order-products-navigation"><Button type="button" variant="secondary" onClick={onBack} disabled={disabled}>← Voltar ao atendimento</Button></div>}
    <div className="new-order-mobile-cart-action">
      <div><button type="button" className="new-order-view-cart" onClick={() => setCartOpen(true)}>Ver carrinho</button><span>{itemCount} itens · <strong>{currency(subtotal)}</strong></span></div>
      <Button type="button" onClick={onReview} disabled={disabled || !itemCount}>Revisar pedido →</Button>
    </div>
    {cartOpen && <BottomSheet open title="Seu pedido" onClose={closeCart}><div className="new-order-refined new-order-cart-sheet"><NewOrderCartSummary {...summaryProps} onReview={() => { closeCart(); onReview() }} /></div></BottomSheet>}
  </section>
}
export default NewOrderProductsStep
