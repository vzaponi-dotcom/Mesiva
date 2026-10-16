import { useMutationOwner } from '../../../runtime/session/useMutationOwner.js'
import { useCallback, useRef, useState } from 'react'
import {
  createInitialPaymentComposition,
  summarizePaymentComposition,
  toPaymentAllocations,
} from '../paymentComposition.js'
import { paymentApi } from '../paymentApi.js'

const orderTotalCents = (order) => Math.max(0, Math.round((Number(order?.total) || 0) * 100))

const normalizeTarget = (target) => {
  const clientId = typeof target?.clientId === 'string' ? target.clientId.trim() : ''
  const rawIds = Array.isArray(target?.orderIds) ? target.orderIds : []
  const orderIds = rawIds.map((value) => typeof value === 'string' ? value.trim() : '')
  if (!clientId || orderIds.length < 2 || orderIds.length > 100 || orderIds.some((id) => !id)) return null
  if (new Set(orderIds).size !== orderIds.length) return null
  return { clientId, orderIds }
}

export function useClientOrdersPaymentWorkflow({
  api = paymentApi,
  orders = [],
  getOfficialOrders,
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

  const resolveSelection = useCallback((clientId, orderIds) => {
    if (!clientId || !Array.isArray(orderIds) || orderIds.length < 2 || orderIds.length > 100) return null
    const currentOrders=getOfficialOrders?.() ?? orders
    const byId = new Map((Array.isArray(currentOrders) ? currentOrders : []).map((order) => [order.id, order]))
    const selected = orderIds.map((orderId) => byId.get(orderId))
    if (selected.some((order) => (
      !order
      || order.clientId !== clientId
      || order.customerIdentityType !== 'registered_client'
      || Boolean(order.tableTabId)
      || order.status === 'Cancelado'
      || order.paymentStatus === 'Pago'
      || orderTotalCents(order) <= 0
    ))) return null
    return selected
  }, [orders,getOfficialOrders])

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

  const open = useCallback((target) => {
    if (writesBlocked || !canReceivePayments) return false
    const normalized = normalizeTarget(target)
    if (!normalized) return false
    const selected = resolveSelection(normalized.clientId, normalized.orderIds)
    if (!selected) return false
    const totalCents = selected.reduce((sum, order) => sum + orderTotalCents(order), 0)
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return false

    const owner = {
      token: ++sequenceRef.current,
      guard: getSyncGuard(),
      clientId: normalized.clientId,
      orderIds: [...normalized.orderIds],
      submitting: false,
      requestKey: null,
      allocations: null,
    }
    dialogOwnerRef.current = owner
    setDialogOwner(owner)
    setAllocations(createInitialPaymentComposition({
      totalCents,
      defaultPaymentMethod,
      paymentOptions,
    }))
    return true
  }, [
    canReceivePayments,
    defaultPaymentMethod,
    getSyncGuard,
    paymentOptions,
    resolveSelection,
    writesBlocked,
  ])

  const submit = useCallback(async () => {
    const owner = dialogOwnerRef.current
    const currentOrders = owner ? resolveSelection(owner.clientId, owner.orderIds) : null
    const totalCents = currentOrders
      ? currentOrders.reduce((sum, order) => sum + orderTotalCents(order), 0)
      : 0
    const submittedAllocations = toPaymentAllocations(allocations, totalCents, paymentOptions)

    if (
      !owner
      || owner.guard !== getSyncGuard()
      || owner.submitting
      || writesBlocked
      || !canReceivePayments
      || !currentOrders
      || !submittedAllocations
    ) return false

    owner.submitting = true
    owner.allocations = submittedAllocations.map((allocation) => ({ ...allocation }))
    owner.requestKey = `client-orders:payment:${owner.clientId}:${owner.token}`
    setRequestKey(owner.requestKey)
    forceRender((value) => value + 1)

    try {
      const result = await api.registerClientOrdersPayment(
        owner.clientId,
        [...owner.orderIds],
        owner.allocations,
      )
      if (!ownsMutation() || owner.guard !== getSyncGuard()) return false

      if (applyOfficialEffects(result) === false) return false

      if (dialogOwnerRef.current === owner) {
        const clientName = currentOrders[0]?.client || 'cliente'
        const count = owner.orderIds.length
        close(owner)
        onSuccess(`Recebimento registrado: ${count} pedidos de ${clientName} quitados`)
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
    canReceivePayments,
    clearRequestKey,
    close,
    getSyncGuard,
    onError,
    onSuccess,
    paymentOptions,
    refreshOfficialData,
    resolveSelection,
    setRequestKey,
    writesBlocked,
  ])

  const selectedOrders = dialogOwner
    ? resolveSelection(dialogOwner.clientId, dialogOwner.orderIds)
    : null
  const totalCents = selectedOrders
    ? selectedOrders.reduce((sum, order) => sum + orderTotalCents(order), 0)
    : 0
  const composition = summarizePaymentComposition(allocations, totalCents, paymentOptions)

  const dialog = dialogOwner && selectedOrders ? {
    clientId: dialogOwner.clientId,
    clientName: selectedOrders[0]?.client || 'Cliente',
    orderIds: [...dialogOwner.orderIds],
    orders: selectedOrders,
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
