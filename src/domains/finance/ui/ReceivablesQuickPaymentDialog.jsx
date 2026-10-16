import { useMemo, useState } from 'react'
import Icon from '../../../shared/ui/Icon'
import Modal from '../../../shared/ui/Modal'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'


function ReceivablesQuickPaymentDialog({
  open,
  entries = [],
  readModel,
  currency,
  disabled = false,
  onClose,
  onSelect,
  orderPresentation,
}) {
  const { formatOrderDate, getOrderItemsSearchText, getOrderItemsSummary } = orderPresentation
  const [localSearch, setLocalSearch] = useState('')
  const search=readModel?readModel.search:localSearch,setSearch=readModel?readModel.onSearchChange:setLocalSearch
  const normalizedSearch = search.trim().toLowerCase()

  const visibleEntries = useMemo(() => readModel?entries:entries.filter((entry) => {
    const order = entry.order
    if (!order) return false
    if (!normalizedSearch) return true
    const searchText = [
      entry.label,
      order.client,
      String(order.id),
      order.type,
      order.orderDate,
      getOrderItemsSearchText(order),
    ].join(' ').toLowerCase()
    return searchText.includes(normalizedSearch)
  }), [entries, normalizedSearch,readModel])

  if (!open) return null

  const selectEntry = (entry) => {
    if (disabled || !entry?.order?.id || !onSelect) return
    onSelect(entry.order.id)
    onClose?.()
  }

  return (
    <Modal title="Registrar recebimento" onClose={onClose}>
      <div className="receivables-quick-payment">
        <label className="search-control receivables-quick-payment-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Buscar cliente, pedido ou produto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
        </label>

        <p className="receivables-quick-payment-helper">
          Selecione um pedido pendente. A forma de pagamento será escolhida na próxima etapa.
        </p>

        <div className="receivables-quick-payment-list" aria-label="Pedidos disponíveis para recebimento">
          {visibleEntries.map((entry) => (
            <button
              type="button"
              className="receivables-quick-payment-row"
              key={entry.key}
              onClick={() => selectEntry(entry)}
              disabled={disabled || !onSelect}
            >
              <span className="receivables-quick-payment-main">
                <strong>{entry.label || 'Pedido sem identificação'}</strong>
                <span>{formatOrderDisplayNumber(entry.order)} · {getOrderItemsSummary(entry.order)}</span>
                <small>{entry.expectedDate ? `Pagamento esperado em ${formatOrderDate(entry.expectedDate)}` : 'Pagamento pendente'}</small>
              </span>
              <strong className="receivables-quick-payment-amount">{currency(entry.total)}</strong>
              <Icon name="details" size={18} />
            </button>
          ))}

          {readModel?.status==='loading'&&<p role="status">Carregando pedidos…</p>}
          {readModel?.error&&<p role="alert">Não foi possível carregar os pedidos.<button type="button" onClick={readModel.reload}>Tentar novamente</button></p>}
          {readModel?.hasMore&&<button type="button" disabled={readModel.status==='loading-next'} onClick={readModel.loadNext}>Carregar mais pedidos</button>}
          {!visibleEntries.length && (!readModel||readModel.status==='ready') && (
            <div className="empty-state receivables-quick-payment-empty">
              <Icon name="wallet" size={26} />
              <strong>Nenhum pedido pendente encontrado.</strong>
              <span>{entries.length ? 'Ajuste a busca para localizar outro pedido.' : 'As comandas continuam sendo recebidas pela ação própria de pagamento agregado.'}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default ReceivablesQuickPaymentDialog
