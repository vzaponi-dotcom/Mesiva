import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import Button from '../../../shared/ui/Button.jsx'
import Icon from '../../../shared/ui/Icon.jsx'

const paymentPromiseLabel = (order, formatOrderDate) => order?.promisedPaymentDate
  ? `Prometido para ${formatOrderDate(order.promisedPaymentDate)} · Alterar`
  : 'Definir data prometida'

const timingText = (group, formatOrderDate) => {
  const timing = group?.timing || {}
  if (timing.status === 'overdue') {
    const days = Number(timing.daysOverdue) || 0
    return `Atrasado há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (timing.status === 'today') return 'Pagamento esperado hoje'
  if (timing.status === 'upcoming') return `Previsto para ${formatOrderDate(timing.expectedDate || group?.earliestExpectedDate)}`
  return 'Pendente'
}

export default function ReceivableClientPanel({
  group,
  readModel,
  selectedOrderIds = [],
  currency,
  formatOrderDate,
  getOrderItemsSummary,
  onToggleOrder,
  onSelectAll,
  onDeselectAll,
  onReceive,
  onOpenClient,
  onEditPaymentPromise,
  promiseDisabled = false,
  selectionLimit = 100,
  selectionLimitReached = false,
  disabled = false,
}) {
  if (!group) return <div className="receivable-detail-empty">Selecione um cliente para ver os pedidos pendentes.</div>

  const selected = new Set(selectedOrderIds)
  const selectedEntries = group.entries.filter((entry) => selected.has(entry.order.id))
  const selectedTotal = readModel?readModel.selectedTotal:selectedEntries.reduce((sum, entry) => sum + (Number(entry.total) || 0), 0)
  const selectionTargetCount = Math.min(group.entries.length, selectionLimit)
  const limitedGroup = group.entries.length > selectionLimit
  const allSelected = selectionTargetCount > 0 && group.entries.slice(0,selectionLimit).every(entry=>selected.has(entry.order.id))

  const selectedCount=readModel?readModel.selectedCount:selectedEntries.length
  return (
    <section className="receivables-client-panel">
      <header className="receivables-client-panel-heading">
        <span className="receivable-client-avatar">{group.label.charAt(0).toUpperCase()}</span>
        <div>
          <strong>{group.label}</strong>
          <span>{group.phone || (group.kind === 'single' ? 'Cliente avulso' : 'Telefone não informado')}</span>
        </div>
        {group.clientId && onOpenClient && (
          <button
            type="button"
            className="receivables-client-open"
            onClick={() => onOpenClient?.({ id: group.clientId, name: group.label })}
          >
            Ver cliente
          </button>
        )}
      </header>

      <div className="receivables-client-panel-metrics">
        <div><span>Total pendente</span><strong>{currency(group.total)}</strong></div>
        <div><span>Pedidos</span><strong>{group.count}</strong></div>
      </div>

      <div className={`receivable-client-status receivable-client-status-${group.timing?.status || 'today'}`}>
        <Icon name={group.timing?.status === 'overdue' ? 'alert' : 'clock'} size={17} />
        <span>{timingText(group, formatOrderDate)}</span>
      </div>

      <div className="receivables-client-panel-toolbar">
        <strong>Pedidos pendentes</strong>
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : () => onSelectAll?.(group)}
          disabled={disabled || !group.entries.length}
        >
          {allSelected ? 'Desmarcar todos' : limitedGroup ? 'Selecionar até 100' : readModel ? 'Selecionar carregados' : 'Selecionar todos'}
        </button>
      </div>

      {(limitedGroup || selectionLimitReached) && (
        <p className="receivable-client-limit-note" role="status">
          Limite de 100 pedidos por recebimento.
        </p>
      )}

      <div className="receivables-client-panel-orders">
        {group.entries.map((entry) => {
          const order = entry.order
          const checkboxId = `receivable-panel-order-${order.id}`
          return (
            <div className="receivable-client-order-select" key={order.id}>
              <label className="receivable-client-order-selection-hitbox" htmlFor={checkboxId}>
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={selected.has(order.id)}
                  disabled={disabled}
                  onChange={() => onToggleOrder?.(order.id)}
                  aria-label={`Selecionar pedido ${formatOrderDisplayNumber(order)} no valor de ${currency(entry.total)}`}
                />
                <span className="receivable-client-order-main">
                  <strong>{formatOrderDisplayNumber(order)}</strong>
                  <span>{getOrderItemsSummary(order)}</span>
                  <small>{formatOrderDate(entry.expectedDate)}</small>
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

      {readModel?.status==='loading'&&<p role="status">Carregando pedidos…</p>}
      {readModel?.error&&<p role="alert">Não foi possível carregar os pedidos.<button type="button" onClick={readModel.reload}>Tentar novamente</button></p>}
      {readModel?.hasMore&&<button type="button" disabled={readModel.status==='loading-next'} onClick={readModel.loadNext}>Carregar mais pedidos</button>}
      <footer className="receivables-client-panel-footer">
        <div>
          <span>{selectedCount} {selectedCount === 1 ? 'pedido selecionado' : 'pedidos selecionados'}</span>
          <strong>{currency(selectedTotal)}</strong>
        </div>
        <Button
          type="button"
          className="receivables-client-receive-button"
          onClick={() => onReceive?.(group)}
          disabled={disabled || selectedCount === 0}
        >
          Receber selecionados
        </Button>
      </footer>
    </section>
  )
}
