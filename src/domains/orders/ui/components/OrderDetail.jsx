import { useState } from 'react'
import Button from '../../../../shared/ui/Button'
import ConfirmationDialog from '../../../../shared/ui/ConfirmationDialog'
import Modal from '../../../../shared/ui/Modal'
import OrderDetailTiming from './OrderDetailTiming.jsx'
import { OrderTicketPreview, PrintStatusBadge } from '../../../printing/index.js'
import PaymentBadge from '../PaymentBadge.jsx'
import OrderPaymentStatus from './OrderPaymentStatus.jsx'
import Icon from '../../../../shared/ui/Icon.jsx'
import OrderEditedBadge from '../../../../shared/ui/OrderEditedBadge.jsx'
import OrderEditChanges from './OrderEditChanges.jsx'
import './order-detail-redesigned.css'
import { actorLabel } from '../../../../shared/actorLabel.js'
import StatusBadge from '../../../../shared/ui/StatusBadge'
import { getOrderItemDisplayName, getOrderItems } from '../../domain/orderCart.js'
import { formatOrderDate, formatOrderTime } from '../../domain/orderWorkflow.js'
import { FINANCE_TIME_ZONE } from '../../../../../shared/finance.js'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'
import { getPrintJobActions } from '../../../../../shared/printQueueActions.js'
import { formatPaymentSummary } from '../../../finance/index.js'

const adjustmentLabel = (adjustment, currency) => {
  if (!adjustment || adjustment.type === 'none') return ''
  const prefix = adjustment.type === 'discount' ? 'Desconto' : 'Acréscimo'
  const value = adjustment.mode === 'percentage'
    ? `${Number(adjustment.value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
    : currency(adjustment.amount || adjustment.value || 0)
  return `${prefix} ${value}`
}

const formatPrintTimestamp = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: FINANCE_TIME_ZONE,
  }).format(date)
}

const PHYSICAL_PRINT_ACTIONS = new Set(['print', 'preview', 'pdf', 'second-copy', 'retry', 'reprint', 'historical-reprint'])

function OrderDetail({ order, currency, printing, printJob, onClose, onRequestCancel, onEditOrder, canEditOrders = false, canCancelOrders = true, canExecutePrinting = true, canForcePrinting = false, canRegisterPayment = false, registerPaymentDisabled = false, onRegisterPayment, onToast, initialPrintingOpen = false }) {
  const [previewDocument, setPreviewDocument] = useState(null)
  const [showTicketPreview, setShowTicketPreview] = useState(false)
  const [confirmReprint, setConfirmReprint] = useState(false)
  const [printingAction, setPrintingAction] = useState(null)

  if (!order) return null
  const items = getOrderItems(order)
  const adjustment = order.adjustment || { type: 'none' }
  const defaultCopies = printing?.localStation?.defaultCopies === 1 ? 1 : 2
  const reprintCopies = printJob?.copiesRequested === 1 ? 1 : defaultCopies
  const isHistoricalOrder = ['Finalizado', 'Cancelado'].includes(order.status)
  const showPaymentAction = canRegisterPayment && order.status !== 'Cancelado' && order.paymentStatus !== 'Pago'
  const stationName = printing?.stations?.find((station) => station.id === printJob?.stationId)?.name || printJob?.stationId || '—'
  const printingDisabled = Boolean(printingAction)
  const now = new Date()
  const scheduledPrintPending = printJob?.trigger === 'automatic' && printJob?.status === 'pending' && printJob?.availableAt && new Date(printJob.availableAt) > now
  const awaitingSecondCopy = ['awaiting_second_copy', 'printed'].includes(printJob?.status)
    && Number(printJob?.copiesRequested) === 2
    && Number(printJob?.copiesPrinted) === 1
  const primaryQueueAction = getPrintJobActions(printJob, { order })[0]?.key || null

  const runPrintingAction = async (key, action, successMessage) => {
    if ((['print-now', 'force-print'].includes(key) && !canForcePrinting) || (PHYSICAL_PRINT_ACTIONS.has(key) && !canExecutePrinting) || printingAction || typeof action !== 'function') return false
    setPrintingAction(key)
    try {
      await action()
      if (successMessage) onToast?.(successMessage, { type: 'info' })
      return true
    } catch (error) {
      onToast?.(error?.message || 'Não foi possível concluir a ação de impressão.', { type: 'error' })
      return false
    } finally {
      setPrintingAction(null)
    }
  }

  const loadCurrentPrintDocument = async () => {
    if (!printing?.getPreviewDocument) throw new Error('Visualização do ticket indisponível.')
    return printing.getPreviewDocument(order.id)
  }

  const handlePreview = () => runPrintingAction('preview', async () => {
    const document = await loadCurrentPrintDocument()
    setPreviewDocument(document)
    setShowTicketPreview(true)
  })

  const handlePdf = () => runPrintingAction('pdf', async () => {
    const document = await loadCurrentPrintDocument()
    if (!printing?.downloadOrderPdf) throw new Error('Download de PDF indisponível neste ambiente.')
    printing.downloadOrderPdf(document)
  })

  const handleFirstPrint = () => runPrintingAction('print', () => printing?.printOrder?.(order.id, defaultCopies), 'Pedido enviado para a fila da cozinha')

  const handlePrintNow = () => runPrintingAction('print-now', () => printing?.requestPrintNow?.(printJob), 'Pedido priorizado na fila')

  const handleSecondCopy = () => runPrintingAction('second-copy', () => printing?.requestSecondCopy?.(printJob), '2ª via enviada para a fila')

  const handleRetry = () => runPrintingAction('retry', () => printing?.requestRetry?.(printJob), 'Nova tentativa enviada para a fila')

  const handleForcePrint = () => runPrintingAction('force-print', () => printing?.requestForcePrint?.(printJob), 'Impressão autorizada e enviada para a fila')

  const handleConfirmedReprint = async () => {
    if (!canExecutePrinting) return false
    const printed = await runPrintingAction('reprint', () => printing?.requestReprint?.(printJob, reprintCopies), 'Reimpressão adicionada à fila')
    if (printed) setConfirmReprint(false)
  }

  const handleHistoricalReprint = () => runPrintingAction('historical-reprint', () => printing?.printOrder?.(order.id, reprintCopies), 'Reimpressão adicionada à fila')
  const reprintAction = printJob ? handleConfirmedReprint : handleHistoricalReprint

  const actionButton = (() => {
    if (!printJob && !isHistoricalOrder) return <Button type="button" onClick={handleFirstPrint} disabled={printingDisabled || !canExecutePrinting}>Imprimir pedido</Button>
    if (scheduledPrintPending) return <Button type="button" onClick={handlePrintNow} disabled={printingDisabled || !canForcePrinting}>Imprimir agora</Button>
    if (awaitingSecondCopy) return <Button type="button" onClick={handleSecondCopy} disabled={printingDisabled || !canExecutePrinting}>Imprimir 2ª via</Button>
    if (printJob?.status === 'printed') return <Button type="button" onClick={() => { if (canExecutePrinting) setConfirmReprint(true) }} disabled={printingDisabled || !canExecutePrinting}>Reimprimir</Button>
    if (primaryQueueAction === 'retry') return <Button type="button" onClick={handleRetry} disabled={printingDisabled || !canExecutePrinting}>Tentar novamente</Button>
    if (primaryQueueAction === 'reprint') return <Button type="button" onClick={() => { if (canExecutePrinting) setConfirmReprint(true) }} disabled={printingDisabled || !canExecutePrinting}>Reimprimir</Button>
    if (primaryQueueAction === 'forcePrint') return <Button type="button" onClick={handleForcePrint} disabled={printingDisabled || !canForcePrinting}>Imprimir mesmo assim</Button>
    if (!printJob && isHistoricalOrder) return <Button type="button" onClick={() => { if (canExecutePrinting) setConfirmReprint(true) }} disabled={printingDisabled || !canExecutePrinting}>Reimprimir</Button>
    return null
  })()

  const showEditAction = canEditOrders && order.status === 'Em preparo'
    && order.tableReservationStatus !== 'reserved' && Boolean(onEditOrder)
  const showCancelAction = canCancelOrders && order.status !== 'Cancelado' && Boolean(onRequestCancel)
  const latestItemChanges = Array.isArray(order.editSummary?.items) ? order.editSummary.items : []

  return (
    <>
      <Modal title={`Detalhes do ${formatOrderDisplayNumber(order)}`} className="order-detail-modal" onClose={onClose} footer={<div className={`order-detail-dialog-actions${showEditAction ? ' has-edit-action' : ''}${showCancelAction ? ' has-cancel-action' : ''}`}>
        {showEditAction && <Button type="button" variant="secondary" className="order-detail-edit-action" icon="edit" onClick={() => onEditOrder(order)}>Editar pedido</Button>}
        {showCancelAction && <Button type="button" variant="secondary" className="order-detail-cancel-action" onClick={() => { if (canCancelOrders) onRequestCancel?.() }}>Cancelar pedido</Button>}
        <div className="order-detail-dialog-primary-actions">{!showPaymentAction && <Button type="button" variant="secondary" onClick={onClose}>Fechar detalhes</Button>}
          {showPaymentAction && <Button type="button" disabled={registerPaymentDisabled} onClick={() => { if (!registerPaymentDisabled) onRegisterPayment?.() }}>Registrar pagamento</Button>}
        </div>
      </div>}>
        <div className="order-detail order-detail-redesigned">
          <section className="order-detail-section order-detail-summary-section">
            <div className="section-heading compact-section-heading"><h3>Resumo</h3></div>
            <div className="order-detail-heading">
              <div>
                <span>Cliente</span>
                <strong>{order.client}</strong>
                <span>{formatOrderDisplayNumber(order)} · {order.type}</span>
              </div>
              <div className="order-detail-hero-value"><span>Total do pedido</span><strong>{currency(order.total)}</strong></div>
            </div>
              <div className="order-detail-badges">
                <StatusBadge status={order.status} />
                {Number(order.operationalRevision) > 0 && <OrderEditedBadge />}
                {order.status === 'Cancelado' ? <OrderPaymentStatus order={order} /> : <PaymentBadge order={order} />}
                {printJob && <PrintStatusBadge job={printJob} />}
              </div>
            {Number(order.operationalRevision) > 0 && latestItemChanges.length > 0 && (
              <OrderEditChanges changes={latestItemChanges} />
            )}
            <div className="order-detail-meta">
              <div><span>Criado em</span><strong>{formatPrintTimestamp(order.createdAt)}</strong></div>
              {order.finishedAt && order.status !== 'Cancelado' && <div><span>Finalizado em</span><strong>{formatPrintTimestamp(order.finishedAt)}</strong></div>}
              {order.cancelledAt && order.status === 'Cancelado' && <div><span>Cancelado em</span><strong>{formatPrintTimestamp(order.cancelledAt)}</strong></div>}
              {order.isBackdated && <div><span>Data do pedido</span><strong>{formatOrderDate(order.orderDate)}</strong></div>}
              <div><span>Criado por</span><strong>{actorLabel(order.attribution?.createdBy)}</strong></div>
              {order.status === 'Finalizado' && <div><span>Finalizado por</span><strong>{actorLabel(order.attribution?.finalizedBy)}</strong></div>}
              {order.paymentStatus === 'Pago' && <div><span>Recebido por</span><strong>{actorLabel(order.attribution?.paidBy)}</strong></div>}
              <div><span>Forma de pagamento</span><strong>{order.paymentStatus === 'Pago' ? formatPaymentSummary(order.paymentAllocations, order.paymentMethod) : order.status === 'Cancelado' ? 'Não recebido' : 'Pendente'}</strong></div>
              {order.status === 'Cancelado' && <div><span>Motivo do cancelamento</span><strong>{order.cancelReasonLabel || order.cancelReason || 'Não informado'}{order.cancelReasonNote ? ` · ${order.cancelReasonNote}` : ''}</strong></div>}
              {order.clientPhone && <div><span>Telefone</span><strong>{order.clientPhone}</strong></div>}
              {order.clientAddress && <div><span>Endereço</span><strong>{order.clientAddress}</strong></div>}
            </div>
          </section>

          <section className="order-detail-section">
            <div className="section-heading compact-section-heading">
              <div>
                <h3>Itens</h3>
              </div>
            </div>
            <div className="order-detail-items">
              {items.map((item) => (
                <div className="order-detail-item" key={item.id || item.lineId || `${item.productId}-${item.name}-${item.note}`}>
                  <div>
                    <div className="order-detail-item-copy"><span className="order-detail-item-quantity">{item.quantity}×</span><strong>{getOrderItemDisplayName(item)}</strong></div>
                    {item.note && <span className="order-detail-item-note"><Icon name="arrow-right" size={14} />{item.note}</span>}
                  </div>
                  <strong>{currency(Number(item.unitPrice ?? item.catalogPrice ?? 0) * Number(item.quantity || 1))}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="order-detail-section order-detail-values-section">
            <div className="section-heading compact-section-heading"><h3>Valores</h3></div>
            <div className="order-detail-totals">
            <div><span>Subtotal</span><strong>{currency(order.subtotal ?? order.total ?? 0)}</strong></div>
            {Number(order.deliveryFee || 0) > 0 && <div><span>Taxa de entrega</span><strong>{currency(order.deliveryFee)}</strong></div>}
            {adjustment.type !== 'none' && (
              <>
                <div>
                  <span>{adjustmentLabel(adjustment, currency)}</span>
                  <strong>{adjustment.type === 'discount' ? '− ' : '+ '}{currency(adjustment.amount || 0)}</strong>
                </div>
                {adjustment.reason && <div className="order-detail-reason"><span>Motivo</span><strong>{adjustment.reason}</strong></div>}
              </>
            )}
            <div className="order-detail-total-final"><span>Total</span><strong>{currency(order.total)}</strong></div>
            </div>
          </section>
          <details className="order-detail-section order-timing-section">
            <summary className="order-detail-disclosure"><h3><Icon name="clock" size={16} />Horários</h3><Icon name="arrow-down" size={16} /></summary>
            <OrderDetailTiming order={order} />
          </details>
          <details className="order-detail-section order-printing-section" open={initialPrintingOpen || Boolean(printJob?.lastError?.message)}>
            <summary className="order-detail-disclosure">
              <h3><Icon name="printer" size={16} />Impressão</h3>
              {printJob && <PrintStatusBadge job={printJob} />}
              <Icon name="arrow-down" size={16} />
            </summary>

            <div className="order-printing-content">
            <div className="order-detail-print-tools">
              {actionButton && <div className="order-detail-print-primary">{actionButton}</div>}
              <Button type="button" variant="secondary" icon="eye" onClick={handlePreview} disabled={Boolean(printingAction)}>Visualizar ticket</Button>
              <Button type="button" variant="secondary" icon="note" onClick={handlePdf} disabled={Boolean(printingAction)}>Gerar PDF</Button>
            </div>

            {!printJob && <p className="order-printing-helper">Este pedido ainda não possui histórico de impressão. Isso é esperado quando a impressão automática estava desligada.</p>}
            {scheduledPrintPending && <p className="order-printing-helper">Impressão programada para {formatOrderTime(printJob.availableAt)}</p>}
            {awaitingSecondCopy && <p className="order-printing-helper">1ª via impressa. A 2ª via continua pendente na fila da cozinha.</p>}
            {!scheduledPrintPending && !awaitingSecondCopy && ['pending', 'processing'].includes(printJob?.status) && <p className="order-printing-helper">A impressão já está na fila ou em andamento. Aguarde o resultado antes de gerar outra cópia física.</p>}

            {printJob && (
              <>
                <dl className="order-detail-print-facts">
                  <div><dt>Cópias</dt><dd>{printJob.copiesPrinted || 0}/{printJob.copiesRequested}</dd></div>
                  <div><dt>Estação</dt><dd>{stationName}</dd></div>
                  <div className="order-detail-print-processed"><dt>Processado em</dt><dd>{formatPrintTimestamp(printJob.processedAt)}</dd></div>
                </dl>
                {printJob.lastError?.message && <div className="order-detail-print-notice"><Icon name="alert" size={16} /><div><span>Diagnóstico</span><p>{printJob.lastError.message}</p></div></div>}
              </>
            )}
            </div>
          </details>
        </div>
      </Modal>

      {showTicketPreview && previewDocument && (
        <Modal title={`Visualização do ticket #${previewDocument.order?.number || ''}`} onClose={() => setShowTicketPreview(false)}>
          <OrderTicketPreview document={previewDocument} />
        </Modal>
      )}

      {canExecutePrinting && confirmReprint && (
        <ConfirmationDialog
          title="Confirmar reimpressão"
          message={`Este pedido já foi enviado para impressão. Deseja imprimir mais ${reprintCopies} ${reprintCopies === 1 ? 'cópia' : 'cópias'}?`}
          confirmLabel="Reimprimir"
          confirmVariant="primary"
          onClose={() => setConfirmReprint(false)}
          onConfirm={reprintAction}
          disabled={Boolean(printingAction) || !canExecutePrinting}
        />
      )}
    </>
  )
}

export default OrderDetail
