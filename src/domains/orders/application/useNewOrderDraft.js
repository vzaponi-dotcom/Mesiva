import { useCallback, useRef, useState } from 'react'
import {
  createNewOrderDraftController,
  createReservationEditDraftContext,
  createOrderEditDraftContext,
} from './newOrderDraft.js'

export function useNewOrderDraft({
  getAccessOwner = () => null,
  submitOrder,
  submitReservationEdit,
  submitOrderEdit,
  refreshReservation,
  canSubmit,
  commitOfficialEffects,
  onCommitted,
  onSuccess,
  onError,
  onConflict,
}) {
  const controllerRef = useRef(null)
  if (!controllerRef.current) controllerRef.current = createNewOrderDraftController()

  const [draft, setDraft] = useState(() => controllerRef.current.snapshot())
  const [checkoutPending, setCheckoutPending] = useState(false)
  const pendingRef = useRef(false)
  const accessOwnerRef = useRef(getAccessOwner)
  accessOwnerRef.current = getAccessOwner
  const submitOrderRef = useRef(submitOrder)
  const submitReservationEditRef = useRef(submitReservationEdit)
  const submitOrderEditRef = useRef(submitOrderEdit)
  const refreshReservationRef = useRef(refreshReservation)
  const canSubmitRef = useRef(canSubmit)
  const commitOfficialEffectsRef = useRef(commitOfficialEffects)
  const onCommittedRef = useRef(onCommitted)
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  const onConflictRef = useRef(onConflict)

  submitOrderRef.current = submitOrder
  submitReservationEditRef.current = submitReservationEdit
  submitOrderEditRef.current = submitOrderEdit
  refreshReservationRef.current = refreshReservation
  canSubmitRef.current = canSubmit
  commitOfficialEffectsRef.current = commitOfficialEffects
  onCommittedRef.current = onCommitted
  onSuccessRef.current = onSuccess
  onErrorRef.current = onError
  onConflictRef.current = onConflict

  const publish = useCallback(() => {
    const next = controllerRef.current.snapshot()
    setDraft(next)
    return next
  }, [])

  const clearPending = useCallback(() => {
    pendingRef.current = false
    setCheckoutPending(false)
  }, [])

  const open = useCallback((context) => {
    clearPending()
    const next = controllerRef.current.open(context)
    setDraft(next)
    return next
  }, [clearPending])

  const openReservationEdit = useCallback((detail, options) => {
    const context = createReservationEditDraftContext(detail, options)
    if (!context) return null
    return open(context)
  }, [open])

  const openOrderEdit = useCallback((order, options) => {
    const context=createOrderEditDraftContext(order,options)
    return context ? open(context) : null
  },[open])

  const discard = useCallback(() => {
    clearPending()
    const next = controllerRef.current.discard()
    setDraft(next)
    return next
  }, [clearPending])

  const setDirty = useCallback((value) => {
    const next = controllerRef.current.setDirty(value)
    setDraft(next)
    return next
  }, [])

  const reset = useCallback(() => {
    clearPending()
    const next = controllerRef.current.discard()
    setDraft(next)
    return next
  }, [clearPending])

  const submit = useCallback(async (payload, { intent = 'save' } = {}) => {
    const accessOwner = accessOwnerRef.current()
    const token = controllerRef.current.beginSubmit()
    const ownsSubmit = () => accessOwner === accessOwnerRef.current() && controllerRef.current.isCurrent(token)
    if (!token || pendingRef.current || !canSubmitRef.current(payload, token.context)) return false

    const editMode = token.context.mode === 'edit-reservation'
    const editOrderMode = token.context.mode === 'edit-order'
    const reservationContext = token.context.reservationContext
    if (editMode && (!reservationContext?.id || !submitReservationEditRef.current)) return false
    if (editOrderMode && (!token.context.orderContext?.id || !submitOrderEditRef.current)) return false
    if (!editMode && !editOrderMode && !submitOrderRef.current) return false

    pendingRef.current = true
    setCheckoutPending(true)
    try {
      const result = editMode
        ? await submitReservationEditRef.current(
            reservationContext.id,
            { ...payload, expectedRevision: reservationContext.expectedRevision },
          )
        : editOrderMode
          ? await submitOrderEditRef.current(token.context.orderContext.id,{
              ...payload,mutationId:token.idempotencyKey,
              expectedContentRevision:token.context.orderContext.expectedContentRevision,
            })
          : await submitOrderRef.current(payload, token.idempotencyKey)

      if (!ownsSubmit()) return false
      if (commitOfficialEffectsRef.current(result) === false) return false
      await onCommittedRef.current(result, token.context, intent)
      if (!ownsSubmit()) return false
      onSuccessRef.current(result.order, token.context, intent)
      pendingRef.current = false
      setCheckoutPending(false)
      controllerRef.current.complete(token)
      publish()
      return true
    } catch (error) {
      if (!ownsSubmit()) return false

      if (error?.code === 'POLICY_CHANGED') {
        onErrorRef.current(error)
        return { ok: false, code: 'POLICY_CHANGED' }
      }

      const retryableCreateConflict = error?.status === 409
        && !editMode
        && !editOrderMode
        && !token.context.expectedTableTabId
        && payload?.type === 'Local'
        && Boolean(payload?.scheduledFor)

      if (error?.status === 409) {
        if (editOrderMode) {
          await onConflictRef.current?.(token.context,error)
        } else if (editMode && refreshReservationRef.current) {
          const refreshed = await refreshReservationRef.current(reservationContext.id)
          if (accessOwner !== accessOwnerRef.current()) return false
          if (ownsSubmit() && refreshed) {
            const nextContext = createReservationEditDraftContext(refreshed, {
              returnDestination: token.context.returnDestination,
            })
            if (nextContext) {
              controllerRef.current.replaceCurrent(token, nextContext)
              publish()
            }
          }
          await onConflictRef.current?.(token.context, error)
        } else if (token.context.expectedTableTabId) {
          await onConflictRef.current?.(token.context, error)
        } else if (retryableCreateConflict) {
          controllerRef.current.renewIdempotencyKey(token)
        }
      }

      if (accessOwner === accessOwnerRef.current() && (ownsSubmit() || editMode || editOrderMode)) onErrorRef.current(error)
      if (retryableCreateConflict) {
        return {
          ok: false,
          code: error?.code || 'CONFLICT',
          message: error?.message || 'Os dados mudaram. Revise e tente novamente.',
        }
      }
      return false
    } finally {
      if (ownsSubmit()) {
        pendingRef.current = false
        setCheckoutPending(false)
      } else if ((editMode || editOrderMode) && accessOwner === accessOwnerRef.current()) {
        pendingRef.current = false
        setCheckoutPending(false)
      }
    }
  }, [publish])

  return {
    context: draft.context,
    renderKey: draft.renderKey,
    dirty: draft.dirty,
    checkoutPending,
    open,
    openReservationEdit,
    openOrderEdit,
    discard,
    setDirty,
    submit,
    reset,
  }
}
