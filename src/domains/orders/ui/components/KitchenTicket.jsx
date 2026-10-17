import Button from '../../../../shared/ui/Button.jsx'
import Icon from '../../../../shared/ui/Icon.jsx'
import OrderEditedBadge from '../../../../shared/ui/OrderEditedBadge.jsx'
import KitchenTicketNotes from './KitchenTicketNotes.jsx'
import StatusBadge from '../../../../shared/ui/StatusBadge.jsx'
import { buildKitchenItemSummary, buildKitchenTimingCopy } from '../../domain/kitchenTicket.js'
import { getFinalActionLabel } from '../../domain/orderWorkflow.js'
import { formatOrderDisplayNumber } from '../../../../../shared/orderDisplayNumber.js'
import { getOrderItems, getOrderItemDisplayName } from '../../domain/orderCart.js'
import './kitchen-ticket-organized.css'

const attendanceIcons = { Entrega: 'delivery', Retirada: 'pickup', Local: 'local' }
function KitchenTicket({ entry, now, currentTiming, disabled = false, highlighted = false, onDetails, onFinalize, onCancel }) {
  const order = entry.order
  const timing = buildKitchenTimingCopy(entry, now, currentTiming)
  const scheduled = entry.phase === 'scheduled'
  const status = scheduled ? 'Agendado' : 'Em preparo'
  const statusLabel = entry.isLate ? 'Fora do prazo' : (scheduled ? 'Agendado para preparo' : 'Em preparo')
  const activeReservation = order.type === 'Local'
    && Boolean(order.tableReservationId)
    && order.tableReservationStatus === 'reserved'
  const cancelLabel = activeReservation ? 'Cancelar reserva' : 'Cancelar pedido'
  const canFinalize = !scheduled && Boolean(onFinalize)
  const actionCount = 1 + Number(canFinalize) + Number(Boolean(onCancel))

  return <article className={`kitchen-ticket kitchen-ticket-organized${scheduled ? ' kitchen-ticket-scheduled' : ''}${entry.isLate ? ' kitchen-ticket-overdue' : ''}${highlighted ? ' kitchen-ticket-highlighted' : ''}`} aria-label={formatOrderDisplayNumber(order)}>
    <header className="kitchen-ticket-header">
      <div className="kitchen-ticket-identity">
        <strong className="kitchen-ticket-customer-name">{order.client || 'Cliente não identificado'}</strong>
        <div className="kitchen-ticket-customer"><span className="kitchen-ticket-id">{formatOrderDisplayNumber(order)}</span>{Number(order.operationalRevision) > 0 && <OrderEditedBadge />}<span><Icon name={attendanceIcons[order.type] || 'local'} size={14} />{order.type}</span></div>
      </div>
      <div className="kitchen-ticket-timing">
        <StatusBadge status={status} label={statusLabel} />
        <strong aria-label={timing.primary}>
          <span className="ticket-label-wide">{timing.primary}</span>
          <span className="ticket-label-short">{entry.isLate ? timing.primary.replace(/^Fora do prazo há /, 'Atraso: ') : timing.primary}</span>
        </strong>
        {timing.secondary && <span>{timing.secondary}</span>}
      </div>
    </header>
    <ul className="kitchen-ticket-items" aria-label={buildKitchenItemSummary(order)}>
      {getOrderItems(order).map((item, index) => <li className="kitchen-ticket-item" key={item.id || item.lineId || `${item.productId || 'item'}-${index}`}>
        <span className="kitchen-ticket-quantity">{Math.max(1, Number(item.quantity) || 1)}×</span>
        <div className="kitchen-ticket-item-copy">
          <span>{getOrderItemDisplayName(item)}</span>
          <KitchenTicketNotes item={item} />
        </div>
      </li>)}
    </ul>
    <footer className="kitchen-ticket-actions" style={{ '--ticket-action-count': actionCount }}>
      {onCancel && <button type="button" className="kitchen-ticket-cancel-action" aria-label={cancelLabel} onClick={() => onCancel(order)} disabled={disabled}><span className="ticket-label-wide">{cancelLabel}</span><span className="ticket-label-short">Cancelar</span></button>}
      <Button type="button" variant="secondary" icon="note" aria-label="Exibir detalhes" onClick={() => onDetails?.(order)} disabled={disabled}><span className="ticket-label-wide">Exibir detalhes</span><span className="ticket-label-short">Detalhes</span></Button>
      {!scheduled && onFinalize && <Button type="button" icon={order.type === 'Entrega' ? 'delivery' : 'check'} aria-label={getFinalActionLabel(order)} onClick={() => onFinalize(order)} disabled={disabled}><span className="ticket-label-wide">{getFinalActionLabel(order)}</span><span className="ticket-label-short">{order.type === 'Entrega' ? 'Despachar' : 'Finalizar'}</span></Button>}
    </footer>
  </article>
}

export default KitchenTicket
