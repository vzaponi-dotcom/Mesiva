import { FINANCE_TIME_ZONE } from '../../../../shared/finance.js'

const formatScheduledTime = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: FINANCE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]))
  return `${values.hour || ''}:${values.minute || ''}`
}

const cloneItems = (items = []) => items.map((item, index) => ({
  lineId: item.lineId || `reservation:item:${index}`,
  productId: item.productId,
  name: item.name || '',
  category: item.category || '',
  size: item.size || '',
  unitPrice: Number(item.unitPrice || 0),
  quantity: Math.max(1, Number(item.quantity) || 1),
  note: item.note || '',
  ...(Object.hasOwn(item,'persistedItemId') ? { persistedItemId: item.persistedItemId } : {}),
}))

export const createOrderEditDraftContext = (order, {returnDestination='orders'}={}) => {
  if (!order?.id || order.status !== 'Em preparo' || order.tableReservationStatus === 'reserved') return null
  return {
    mode:'edit-order', returnDestination, tableId:'', expectedTableTabId:'',
    orderContext:{
      id:order.id,orderNumber:Number(order.orderNumber),
      expectedContentRevision:Number(order.contentRevision || 0),
      originalTotal:Number(order.total || 0),
      totalCents:Number.isSafeInteger(order.totalCents) ? order.totalCents : Math.round(Number(order.total || 0)*100),
      netReceivedCents:Number.isSafeInteger(order.netReceivedCents) ? order.netReceivedCents : Math.round(Number(order.paidAmount || 0)*100),
      paid:Boolean(order.paymentId),
      paymentId:order.paymentId || null,
      tableTabId:order.tableTabId || null,
      customerLabel:order.client || 'Cliente',
    },
    initialDraft:{
      clientId:order.clientId || '', localClientId:order.clientId || '',
      selectedTableId:'', customerLabel:order.client || 'Cliente',
      type:order.type, orderDate:order.orderDate || '',
      scheduleMode:order.scheduledFor ? 'scheduled' : 'now',
      scheduledTime:order.scheduledFor ? formatScheduledTime(order.scheduledFor) : '',
      items:(order.items || []).map(item=>({
        lineId:item.id,persistedItemId:item.id,productId:item.productId,
        name:item.name,category:item.category || '',size:item.size || '',
        unitPrice:Number(item.unitPrice || 0),quantity:Math.max(1,Number(item.quantity) || 1),
        note:item.note || '',
      })),
      deliveryFee:Number(order.deliveryFee || 0),
      adjustment:{
        type:order.adjustment?.type || 'none',mode:order.adjustment?.mode || 'fixed',
        value:Number(order.adjustment?.value || 0),reason:order.adjustment?.reason || '',
      },
    },
  }
}

export const createReservationEditDraftContext = (detail, {
  returnDestination = 'comandas',
} = {}) => {
  const reservation = detail?.reservation
  const order = detail?.order
  if (!reservation?.id || !order?.id) return null

  return {
    mode: 'edit-reservation',
    returnDestination,
    tableId: reservation.tableId || order.reservationTableId || '',
    expectedTableTabId: '',
    reservationContext: {
      id: reservation.id,
      orderId: order.id,
      orderNumber: Number(order.orderNumber),
      expectedRevision: Number(reservation.revision),
      hasManualPrintHistory: Boolean(detail?.hasManualPrintHistory),
    },
    initialDraft: {
      clientId: order.clientId || '',
      type: 'Local',
      selectedTableId: reservation.tableId || order.reservationTableId || '',
      localClientId: order.clientId || '',
      orderDate: order.orderDate || '',
      scheduleMode: 'scheduled',
      scheduledTime: formatScheduledTime(reservation.scheduledFor || order.scheduledFor),
      items: cloneItems(order.items),
      deliveryFee: Number(order.deliveryFee || 0),
      adjustment: {
        type: order.adjustment?.type || 'none',
        mode: order.adjustment?.mode || 'fixed',
        value: Number(order.adjustment?.value || 0),
        reason: order.adjustment?.reason || '',
      },
    },
  }
}

const cloneContext = (context) => context ? ({
  ...context,
  reservationContext: context.reservationContext ? { ...context.reservationContext } : null,
  orderContext: context.orderContext ? { ...context.orderContext } : null,
  initialDraft: context.initialDraft ? {
    ...context.initialDraft,
    items: cloneItems(context.initialDraft.items),
    adjustment: { ...(context.initialDraft.adjustment || {}) },
  } : null,
}) : null

const normalizeContext = ({
  mode = 'create',
  returnDestination = 'orders',
  tableId = '',
  expectedTableTabId = '',
  reservationContext = null,
  orderContext = null,
  initialDraft = null,
} = {}) => {
  if (mode === 'edit-order') {
    return cloneContext({mode,returnDestination,tableId:'',expectedTableTabId:'',orderContext,
      reservationContext:null,initialDraft})
  }
  if (mode === 'edit-reservation') {
    return cloneContext({
      mode: 'edit-reservation',
      returnDestination,
      tableId: tableId || initialDraft?.selectedTableId || '',
      expectedTableTabId: '',
      reservationContext: reservationContext ? { ...reservationContext } : null,
      initialDraft: initialDraft ? {
        ...initialDraft,
        items: cloneItems(initialDraft.items),
        adjustment: { ...(initialDraft.adjustment || {}) },
      } : null,
    })
  }
  return {
    mode: 'create',
    returnDestination,
    tableId,
    expectedTableTabId,
    reservationContext: null,
    orderContext: null,
    initialDraft: initialDraft?.clientId ? { clientId: initialDraft.clientId, localClientId: initialDraft.localClientId || initialDraft.clientId } : null,
  }
}

export const createNewOrderDraftController = ({ randomUUID = () => crypto.randomUUID() } = {}) => {
  let generation = 0
  let current = null
  const snapshot = () => ({
    context: current ? cloneContext(current.context) : null,
    dirty: Boolean(current?.dirty),
    renderKey: current ? `new-order:${current.context.mode}:${current.generation}` : null,
  })
  const invalidate = () => { generation += 1; current = null }
  return Object.freeze({
    snapshot,
    open(context) {
      generation += 1
      const normalized = normalizeContext(context)
      current = {
        generation,
        context: normalized,
        dirty: false,
        idempotencyKey: ['create','edit-order'].includes(normalized.mode) ? randomUUID() : null,
      }
      return snapshot()
    },
    discard() { invalidate(); return snapshot() },
    setDirty(value) { if (current) current.dirty = Boolean(value); return snapshot() },
    beginSubmit() {
      if (!current) return null
      return Object.freeze({
        generation: current.generation,
        idempotencyKey: current.idempotencyKey,
        context: cloneContext(current.context),
      })
    },
    isCurrent(token) { return Boolean(current && token?.generation === current.generation) },
    renewIdempotencyKey(token) {
      if (!current || token?.generation !== current.generation || current.context.mode !== 'create') return false
      current.idempotencyKey = randomUUID()
      return true
    },
    replaceCurrent(token, context) {
      if (!current || token?.generation !== current.generation) return null
      generation += 1
      const normalized = normalizeContext(context)
      current = {
        generation,
        context: normalized,
        dirty: false,
        idempotencyKey: ['create','edit-order'].includes(normalized.mode) ? randomUUID() : null,
      }
      return snapshot()
    },
    complete(token) {
      if (!current || token?.generation !== current.generation) return false
      invalidate()
      return true
    },
  })
}
