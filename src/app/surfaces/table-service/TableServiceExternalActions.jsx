import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../../../shared/ui/Modal'
import TableTabPaymentDialog from '../../workflows/payments/table-tab/TableTabPaymentDialog.jsx'
import { TableTabTicketPreview } from '../../../domains/printing/index.js'

export default function TableServiceExternalActions({
  selection,
  selectionGeneration = 0,
  disabled = false,
  paymentOptions,
  defaultPaymentMethod,
  currency,
  onPay,
  onApiError,
  onToast,
  printing,
  children,
}) {
  const currentVisualOwnerRef = useRef({ selection, selectionGeneration })
  const actionRef = useRef(null)
  const sequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const [paymentIntent, setPaymentIntent] = useState(null)
  const [previewState, setPreviewState] = useState(null)
  const [activeAction, setActiveAction] = useState(null)
  const [printingFeedbackState, setPrintingFeedbackState] = useState(null)

  currentVisualOwnerRef.current = { selection, selectionGeneration }

  const isCurrentOwner = useCallback((intent) => {
    const current = currentVisualOwnerRef.current
    return Boolean(
      intent
      && intent.selectionGeneration === current.selectionGeneration
      && intent.tableId === current.selection?.tableId
      && intent.tableTabId === current.selection?.tableTabId
    )
  }, [])

  useEffect(() => () => {
    mountedRef.current = false
    actionRef.current = null
    sequenceRef.current += 1
  }, [])

  useEffect(() => {
    setPaymentIntent((current) => current && !isCurrentOwner(current) ? null : current)
    setPreviewState((current) => current && !isCurrentOwner(current.owner) ? null : current)
    setPrintingFeedbackState((current) => current && !isCurrentOwner(current.owner) ? null : current)

    const action = actionRef.current
    if (action && !isCurrentOwner(action)) {
      actionRef.current = null
      setActiveAction((current) => current === action ? null : current)
    }
  }, [isCurrentOwner, selection?.tableId, selection?.tableTabId, selectionGeneration])

  const requestPayment = useCallback((intent) => {
    if (disabled || !intent?.detail || !isCurrentOwner(intent)) return false
    setPaymentIntent(intent)
    return true
  }, [disabled, isCurrentOwner])

  const runPrintingAction = useCallback(async (kind, intent, operation) => {
    if (!isCurrentOwner(intent) || actionRef.current || disabled || typeof operation !== 'function') return false
    const owner = { token: ++sequenceRef.current, ...intent, kind }
    actionRef.current = owner
    setActiveAction(owner)
    setPrintingFeedbackState(null)

    const ownsVisualAction = () => mountedRef.current
      && actionRef.current === owner
      && isCurrentOwner(owner)

    try {
      const result = await operation(intent.tableTabId)
      if (!ownsVisualAction()) return false
      if (kind === 'preview') {
        if (result?.type !== 'table-tab' || result.tableTab?.id !== intent.tableTabId) {
          throw new Error('O ticket recebido não corresponde à comanda selecionada. Tente novamente.')
        }
        setPreviewState({ owner, document: result })
      } else {
        onToast?.('Impressão enviada para a fila')
      }
      return true
    } catch (error) {
      if (!ownsVisualAction()) return false
      setPrintingFeedbackState({
        owner,
        type: 'error',
        message: error?.message || 'Não foi possível concluir a impressão da comanda. Tente novamente.',
      })
      if (error?.status === 401) onApiError?.(error)
      return false
    } finally {
      if (actionRef.current === owner) {
        actionRef.current = null
        setActiveAction((current) => current === owner ? null : current)
      }
    }
  }, [disabled, isCurrentOwner, onApiError, onToast])

  const requestPreview = useCallback(
    (intent) => runPrintingAction('preview', intent, printing?.getTableTabPreviewDocument),
    [printing?.getTableTabPreviewDocument, runPrintingAction],
  )
  const requestPrint = useCallback(
    (intent) => runPrintingAction('print', intent, printing?.printTableTab),
    [printing?.printTableTab, runPrintingAction],
  )

  const printingAvailable = Boolean(
    printing?.getTableTabPreviewDocument
    && printing?.printTableTab
  )
  const printingFeedback = printingFeedbackState && isCurrentOwner(printingFeedbackState.owner)
    ? { type: printingFeedbackState.type, message: printingFeedbackState.message }
    : null

  const actions = {
    requestPayment,
    requestPreview,
    requestPrint,
    printingBusy: Boolean(activeAction),
    printingFeedback,
    printingAvailable,
  }

  return (
    <>
      {typeof children === 'function' ? children(actions) : children}
      <TableTabPaymentDialog
        open={Boolean(paymentIntent && isCurrentOwner(paymentIntent))}
        detail={paymentIntent?.detail}
        currency={currency}
        disabled={disabled}
        paymentOptions={paymentOptions}
        defaultPaymentMethod={defaultPaymentMethod}
        onClose={() => setPaymentIntent(null)}
        onConfirm={(tableTabId, allocations, options) => onPay?.(tableTabId, allocations, paymentIntent, options) ?? false}
      />
      {previewState && isCurrentOwner(previewState.owner) && (
        <Modal
          title={`Visualização da comanda ${previewState.document.tableTab.number}`}
          onClose={() => setPreviewState(null)}
        >
          <TableTabTicketPreview document={previewState.document} />
        </Modal>
      )}
    </>
  )
}
