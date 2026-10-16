import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import Icon from '../../../shared/ui/Icon.jsx'

const paymentPromiseLabel = (order, formatOrderDate) => order?.promisedPaymentDate
  ? `Prometido para ${formatOrderDate(order.promisedPaymentDate)} · Alterar`
  : 'Definir data prometida'

const groupTimingLabel = (group, formatOrderDate) => {
  const timing = group?.timing || {}
  if (timing.status === 'overdue') {
    const days = Number(timing.daysOverdue) || 0
    return `Atrasado há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (timing.status === 'today') return 'Pagamento esperado hoje'
  if (timing.status === 'upcoming') return `Previsto para ${formatOrderDate(timing.expectedDate || group?.earliestExpectedDate)}`
  return 'Pendente'
}

export default function ReceivableClientGroup({
  group,
  readModel,
  expanded = false,
  selectedOrderIds = [],
  currency,
  formatOrderDate,
  getOrderItemsSummary,
  onToggle,
  onToggleOrder,
  onSelectAll,
  onEditPaymentPromise,
  promiseDisabled = false,
  selectionLimit = 100,
  selectionLimitReached = false,
  disabled = false,
}) {
  if (!group) return null
  const selected = new Set(selectedOrderIds)
  const orderIds = group.orders.map((order) => order.id)
  const selectionTargetCount = Math.min(orderIds.length, selectionLimit)
  const limitedGroup = orderIds.length > selectionLimit
  const allSelected = selectionTargetCount > 0 && orderIds.slice(0,selectionLimit).every(id=>selected.has(id))

  return (
    <article className="receivable-client-card" data-expanded={expanded ? 'true' : 'false'}>
      <button
        type="button"
        className="receivable-client-card-header"
        aria-expanded={expanded}
        onClick={() => onToggle?.(group)}
      >
        <span className="receivable-client-avatar">{group.label.charAt(0).toUpperCase()}</span>
        <span className="receivable-client-card-main">
          <strong>{group.label}</strong>
          <span>{group.phone || (group.kind === 'single' ? 'Cliente avulso' : 'Telefone não informado')}</span>
          <small className={`receivable-timing receivable-timing-${group.timing?.status || 'today'}`}>
            {groupTimingLabel(group, formatOrderDate)}
          </small>
        </span>
        <span className="receivable-client-card-summary">
          <strong>{currency(group.total)}</strong>
          <small>{group.count} {group.count === 1 ? 'pedido' : 'pedidos'}</small>
        </span>
        <Icon name={expanded ? 'arrow-up' : 'arrow-down'} size={18} />
      </button>

      {expanded && (
        <div className="receivable-client-inline-orders">
          <div className="receivable-client-inline-toolbar">
            <span>{group.count} {group.count === 1 ? 'pedido pendente' : 'pedidos pendentes'}</span>
            <button
              type="button"
              onClick={() => onSelectAll?.(group)}
              disabled={disabled || !orderIds.length}
            >
              {allSelected ? `${selectionTargetCount} selecionados` : limitedGroup ? 'Selecionar até 100' : readModel ? 'Selecionar carregados' : 'Selecionar todos'}
            </button>
          </div>
          {(limitedGroup || selectionLimitReached) && (
            <p className="receivable-client-limit-note" role="status">
              Limite de 100 pedidos por recebimento.
            </p>
          )}
          {readModel?.status==='loading'&&<p role="status">Carregando pedidos…</p>}
          {readModel?.error&&<p role="alert">Não foi possível carregar os pedidos.<button type="button" onClick={readModel.reload}>Tentar novamente</button></p>}
          {readModel?.hasMore&&<button type="button" disabled={readModel.status==='loading-next'} onClick={readModel.loadNext}>Carregar mais pedidos</button>}
          <div className="receivable-client-orders-list">
            {group.entries.map((entry) => {
              const order = entry.order
              const checked = selected.has(order.id)
              const checkboxId = `receivable-group-order-${order.id}`
              return (
                <div className="receivable-client-order-select" key={order.id}>
                  <label className="receivable-client-order-selection-hitbox" htmlFor={checkboxId}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleOrder?.(order.id)}
                      aria-label={`Selecionar ${formatOrderDisplayNumber(order)} no valor de ${currency(entry.total)}`}
                    />
                    <span className="receivable-client-order-main">
                      <strong>{formatOrderDisplayNumber(order)}</strong>
                      <span>{getOrderItemsSummary(order)}</span>
                      <small>{groupTimingLabel(entry, formatOrderDate)}</small>
                    </span>
                    <strong className="receivable-client-order-amount">{currency(entry.total)}</strong>
                  </label>
                  {onEditPaymentPromise && (
                    <button
                      type="button"
                      className="receivable-client-promise-action"
                      onClick={() => onEditPaymentPromise(order)}
                      disabled={promiseDisabled}
                    >
                      <Icon name="calendar" size={15} />
                      <span>{paymentPromiseLabel(order, formatOrderDate)}</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </article>
  )
}
