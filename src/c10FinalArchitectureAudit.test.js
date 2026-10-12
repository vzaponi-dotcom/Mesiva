import test from 'node:test'
import assert from 'node:assert/strict'

test('C10 exposes only Orders contracts consumed outside the Orders domain', async () => {
  const orders = await import('./domains/orders/index.js')

  assert.deepEqual(Object.keys(orders).sort(), [
    'createOrdersApi', 'createOperationsPolicy', 'createCancellationReasonsPolicy',
    'NewOrderRoute',
    'OrderDetail',
    'OrderEditChanges',
    'OrderHistory',
    'Orders',
    'buildKitchenQueueModel',
    'cancellationOptionsFromEffective',
    'cancellationReasonsPolicy',
    'cancellationRevisionFromEffective',
    'canReceiveStandaloneOrder',
    'detectOperationalArrivals',
    'filterOrdersByPeriod',
    'formatCancellationDate',
    'formatOrderDate',
    'getDashboardDateRange',
    'getOperationalOrderCount',
    'getOrderItemDisplayName',
    'getOrderItems',
    'getOrderItemsSearchText',
    'getOrderItemsSummary',
    'getOrderRefundState',
    'getPendingAmount',
    'isOrderCancelled',
    'isOrderPaid',
    'operationsPolicy',
    'ordersApi',
    'toLocalDateValue',
    'useKitchenClock',
    'useNewOrderDraft',
    'useOrderArrivals',
    'useOrderCommands',
    'useOrderPaymentPromise',
  ].sort())
})

test('C10 exposes only Customers contracts consumed outside the Customers domain', async () => {
  const customers = await import('./domains/customers/index.js')

  assert.deepEqual(Object.keys(customers).sort(), [
    'createCustomersApi',
    'ClientDuplicateModal',
    'CustomersWorkspace',
    'findClientDuplicates',
    'useQuickCreateCustomerCommand',
  ].sort())
})
