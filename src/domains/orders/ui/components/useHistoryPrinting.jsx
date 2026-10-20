import { useRef, useState } from 'react'
import ConfirmationDialog from '../../../../shared/ui/ConfirmationDialog.jsx'
import { getPrintJobActions } from '../../../../../shared/printQueueActions.js'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'

const commands = {
  print: 'printOrder', reprint: 'requestReprint', retry: 'requestRetry',
  requestSecondCopy: 'requestSecondCopy', printNow: 'requestPrintNow', forcePrint: 'requestForcePrint',
}

export default function useHistoryPrinting({ orders, printing, canExecutePrinting, canForcePrinting, onToast }) {
  const [busyOrderId, setBusyOrderId] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const busy = useRef(false)
  const getPrintAction = order => {
    const job = printing?.latestJobByOrderId?.get(order.id)
    const defaultCopies = printing?.localStation?.defaultCopies === 1 ? 1 : 2
    const secondCopy = ['awaiting_second_copy', 'printed'].includes(job?.status) && Number(job?.copiesRequested) === 2 && Number(job?.copiesPrinted) === 1
    const action = !job ? { key: 'print', label: 'Imprimir pedido' }
      : secondCopy ? { key: 'requestSecondCopy', label: 'Imprimir 2ª via' }
        : getPrintJobActions(job, { order }).find(action => commands[action.key])
    if (!action) return null
    const permitted = ['printNow', 'forcePrint'].includes(action.key) ? canForcePrinting : canExecutePrinting
    return { ...action, job, copies: job?.copiesRequested === 1 ? 1 : defaultCopies, enabled: permitted && typeof printing?.[commands[action.key]] === 'function' }
  }
  const run = async (orderId, action, message) => {
    if (busy.current) return false
    busy.current = true
    setBusyOrderId(orderId)
    try {
      await action()
      if (message) onToast?.(message, { type: 'info' })
      return true
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível concluir a ação de impressão.', { type: 'error' })
      return false
    } finally {
      busy.current = false
      setBusyOrderId(null)
    }
  }
  const executePrint = async (order, expectedKey) => {
    const action = getPrintAction(order)
    if (!action?.enabled || action.key !== expectedKey) {
      onToast?.('A impressão mudou de estado. Confira as opções atuais do pedido.', { type: 'warning' })
      setConfirmation(null)
      return false
    }
    const command = printing[commands[action.key]]
    const completed = await run(order.id, () => action.key === 'print' ? command(order.id, action.copies)
      : action.key === 'reprint' ? command(action.job, action.copies) : command(action.job),
    action.key === 'reprint' ? 'Reimpressão adicionada à fila' : 'Pedido enviado para a fila da cozinha')
    if (completed) setConfirmation(null)
    return completed
  }
  const requestPrint = order => {
    const action = getPrintAction(order)
    if (busy.current || !action?.enabled) return false
    if (['print', 'reprint', 'forcePrint'].includes(action.key)) {
      setConfirmation({ orderId: order.id, key: action.key })
      return true
    }
    return executePrint(order, action.key)
  }
  const generatePdf = order => {
    if (!canExecutePrinting || busy.current) return false
    return run(order.id, async () => {
      if (!printing?.getPreviewDocument || !printing?.downloadOrderPdf) throw new Error('Download de PDF indisponível neste ambiente.')
      const document = await printing.getPreviewDocument(order.id)
      await printing.downloadOrderPdf(document)
    })
  }
  const confirmedOrder = orders.find(order => order.id === confirmation?.orderId)
  const action = confirmedOrder ? getPrintAction(confirmedOrder) : null
  const confirmationDialog = confirmation && confirmedOrder && <ConfirmationDialog
    title={confirmation.key === 'reprint' ? 'Confirmar reimpressão' : confirmation.key === 'forcePrint' ? 'Imprimir mesmo assim?' : 'Confirmar impressão'}
    message={confirmation.key === 'forcePrint' ? `${formatOrderDisplayNumber(confirmedOrder)} já foi finalizado ou cancelado. Autorizar a impressão original?` : `${formatOrderDisplayNumber(confirmedOrder)} será enviado para a fila com ${action?.copies || 2} ${(action?.copies || 2) === 1 ? 'cópia' : 'cópias'}.`}
    confirmLabel={confirmation.key === 'reprint' ? 'Reimprimir' : confirmation.key === 'forcePrint' ? 'Imprimir mesmo assim' : 'Imprimir'}
    confirmVariant="primary"
    onClose={() => { if (!busy.current) setConfirmation(null) }}
    onConfirm={() => executePrint(confirmedOrder, confirmation.key)}
    disabled={Boolean(busyOrderId) || !action?.enabled || action.key !== confirmation.key}
  />
  return { busyOrderId, getPrintAction, requestPrint, generatePdf, confirmationDialog }
}
