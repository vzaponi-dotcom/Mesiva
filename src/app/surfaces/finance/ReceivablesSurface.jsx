import { useMemo } from 'react'
import { Receivables } from '../../../domains/finance/index.js'
import {
  OrderDetail,
  formatOrderDate,
  getPendingAmount,
  getOrderItemsSearchText,
  getOrderItemsSummary,
  isOrderCancelled,
  isOrderPaid,
  useOrderPaymentPromise,
} from '../../../domains/orders/index.js'

export default function ReceivablesSurface({
  orders,
  readContext,
  movements = [],
  currency,
  disabled = false,
  queryState,
  onQueryChange,
  onRegisterPayment,
  onRegisterClientOrdersPayment,
  onOpenClient,
  canReceivePayments = true,
  canManagePaymentPromises = true,
  canExecutePrinting = true,
  applyOfficialEffects,
  setRequestKey,
  onSuccess,
  onError,
}) {
  const paymentPromise = useOrderPaymentPromise({
    applyOfficialEffects,
    writesBlocked: disabled,
    canManagePaymentPromises,
    setRequestKey,
    onSuccess,
    onError,
  })

  const orderPresentation = useMemo(() => ({
    formatOrderDate,
    getOrderItemsSearchText,
    getOrderItemsSummary,
  }), [])

  const orderRules = useMemo(() => ({
    isOrderCancelled,
    isOrderPaid,
    getPendingAmount,
  }), [])

  return <Receivables
    orders={orders}
    readContext={readContext}
    movements={movements}
    currency={currency}
    disabled={disabled}
    canReceivePayments={canReceivePayments}
    canManagePaymentPromises={canManagePaymentPromises}
    canExecutePrinting={canExecutePrinting}
    onRegisterPayment={onRegisterPayment}
    onRegisterClientOrdersPayment={onRegisterClientOrdersPayment}
    onOpenClient={onOpenClient}
    onUpdatePaymentPromise={paymentPromise.updatePaymentPromise}
    queryState={queryState}
    onQueryChange={onQueryChange}
    orderPresentation={orderPresentation}
    orderRules={orderRules}
    renderOrderDetail={(order, onClose) => (
      <OrderDetail
        order={order}
        currency={currency}
        canExecutePrinting={canExecutePrinting}
        onClose={onClose}
      />
    )}
  />
}
