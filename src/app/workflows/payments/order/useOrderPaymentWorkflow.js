import { useMutationOwner } from '../../../runtime/session/useMutationOwner.js'
import { useCallback, useRef, useState } from 'react'
import {
  canReceiveStandaloneOrder,
  isOrderCancelled,
} from '../../../../domains/orders/index.js'
import {
  createInitialPaymentComposition,
  paymentMethodLabel,
  summarizePaymentComposition,
  toPaymentAllocations,
} from '../paymentComposition.js'
import { paymentApi } from '../paymentApi.js'

const operationalSources = new Set(['orders', 'history'])
const orderTotalCents = (order) => Math.max(0, Math.round((Number(order?.total) || 0) * 100))

export function useOrderPaymentWorkflow({
  api = paymentApi,
  orders = [],
  getOfficialOrders,
  granted = new Set(),
  canReceivePayments = false,
  writesBlocked = false,
  paymentOptions = [],
  defaultPaymentMethod = '',
  getSyncGuard = () => null,
  applyOfficialEffects = () => {},
  refreshOfficialData = async () => false,
  setRequestKey = () => {},
  onSuccess = () => {},
  onError = () => {},
} = {}) {
  const ownsMutation = useMutationOwner(applyOfficialEffects)
  const sequenceRef = useRef(0)
  const dialogOwnerRef = useRef(null)
  const [dialogOwner, setDialogOwner] = useState(null)
  const [allocations, setAllocations] = useState([])
  const [, forceRender] = useState(0)

  const getOrder = useCallback(
    (orderId) => (getOfficialOrders?.() ?? orders).find((order) => order.id === orderId) ?? null,
    [orders,getOfficialOrders],
  )

  const isEligible = useCallback((order, source) => {
    if (!order || !canReceivePayments) return false
    if (operationalSources.has(source)) return canReceiveStandaloneOrder(order, granted, source)
    return order.paymentStatus !== 'Pago' && !isOrderCancelled(order)
  }, [canReceivePayments, granted])

  const clearRequestKey = useCallback((owner) => {
    if (!owner?.requestKey) return
    setRequestKey((current) => current === owner.requestKey ? null : current)
  }, [setRequestKey])

  const close = useCallback((expectedOwner = dialogOwnerRef.current) => {
    if (expectedOwner && dialogOwnerRef.current !== expectedOwner) return false
    const owner = dialogOwnerRef.current
    dialogOwnerRef.current = null
    setDialogOwner(null)
    setAllocations([])
    clearRequestKey(owner)
    return true
  }, [clearRequestKey])

  const open = useCallback((orderId, source) => {
    if (writesBlocked || !canReceivePayments) return false
    const order = getOrder(orderId)
    const operational = operationalSources.has(source)
    if (!isEligible(order, operational ? source : null)) return false
    const owner = {
      token: ++sequenceRef.current,
      guard: getSyncGuard(),
      orderId,
      source: operational ? source : null,
      submitting: false,
      requestKey: null,
      allocations: null,
    }
    dialogOwnerRef.current = owner
    setDialogOwner(owner)
    setAllocations(createInitialPaymentComposition({
      totalCents: orderTotalCents(order),
      defaultPaymentMethod,
      paymentOptions,
    }))
    return true
  }, [canReceivePayments, defaultPaymentMethod, getOrder, getSyncGuard, isEligible, paymentOptions, writesBlocked])

  const submit = useCallback(async () => {
    const owner = dialogOwnerRef.current
    const currentOrder = owner ? getOrder(owner.orderId) : null
    const totalCents = orderTotalCents(currentOrder)
    const submittedAllocations = toPaymentAllocations(allocations, totalCents, paymentOptions)
    if (
      !owner
      || owner.guard !== getSyncGuard()
      || owner.submitting
      || writesBlocked
      || !isEligible(currentOrder, owner.source)
      || !submittedAllocations
    ) return false

    owner.submitting = true
    owner.allocations = submittedAllocations.map((allocation) => ({ ...allocation }))
    owner.requestKey = `payment:${owner.orderId}:${owner.token}`
    setRequestKey(owner.requestKey)
    forceRender((value) => value + 1)

    try {
      const result = await api.registerOrderPayment(owner.orderId, owner.allocations)
      if (!ownsMutation() || owner.guard !== getSyncGuard()) return false

      if (applyOfficialEffects(result) === false) return false

      if (dialogOwnerRef.current === owner) {
        const accepted = owner.allocations
        const message = accepted.length === 1
          ? `Pagamento recebido via ${paymentMethodLabel(paymentOptions, accepted[0].methodCode)}`
          : `Pagamento recebido em ${accepted.length} formas`
        close(owner)
        onSuccess(message)
      }
      return true
    } catch (error) {
      if (!ownsMutation() || owner.guard !== getSyncGuard()) return false
      if (error?.status === 409 || !Number.isInteger(error?.status) || error.status >= 500) {
        await refreshOfficialData()
      }
      if (!ownsMutation() || owner.guard !== getSyncGuard()) return false
      if (dialogOwnerRef.current === owner) onError(error)
      return false
    } finally {
      if (ownsMutation()) {
        owner.submitting = false
        clearRequestKey(owner)
        if (dialogOwnerRef.current === owner) forceRender((value) => value + 1)
      }
    }
  }, [
    ownsMutation,
    allocations,
    api,
    applyOfficialEffects,
    clearRequestKey,
    close,
    getOrder,
    getSyncGuard,
    isEligible,
    onError,
    onSuccess,
    paymentOptions,
    refreshOfficialData,
    setRequestKey,
    writesBlocked,
  ])

  const order = dialogOwner ? getOrder(dialogOwner.orderId) : null
  const eligible = dialogOwner ? isEligible(order, dialogOwner.source) : false
  const totalCents = orderTotalCents(order)
  const composition = summarizePaymentComposition(allocations, totalCents, paymentOptions)

  const dialog = dialogOwner && eligible ? {
    order,
    totalCents,
    allocations,
    setAllocations,
    paymentOptions,
    composition,
    submitting: Boolean(dialogOwner.submitting),
    writesBlocked,
    onClose: () => close(dialogOwner),
    submit,
  } : null

  return { open, close, dialog }
}
