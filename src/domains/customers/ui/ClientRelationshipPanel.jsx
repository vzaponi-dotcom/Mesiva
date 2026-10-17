import {useScopedOrderSelection} from '../../../infrastructure/realtime/useScopedOrderSelection.js'
import { useEffect,useId,useRef, useState } from 'react'
import Modal from '../../../shared/ui/Modal'
import Button from '../../../shared/ui/Button'
import Icon from '../../../shared/ui/Icon'
import StatusBadge from '../../../shared/ui/StatusBadge'
import { clientOrderDate } from '../domain/clientList.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import {getPendingAmount} from '../../../../shared/orderPaymentRead.js'

const dateLabel = value => value ? value.split('-').reverse().join('/') : 'Sem compras'
const sourceFor = order => ['Finalizado', 'Cancelado', 'Entregue', 'Despachado'].includes(order.status) ? 'history' : 'orders'
const orderFilters = [['all', 'Todos'], ['pending', 'A receber'], ['finished', 'Finalizados'], ['cancelled', 'Cancelados']]

function ClientOrderRows({ orders, currency, onDetails, canReceive, onReceive, disabled, selection }) {
  return <div className="client-order-list">{orders.map(order => <div className="client-order-line" key={order.id}>
    {selection?.canSelect(order) && <label className="client-order-selection"><input type="checkbox" aria-label={`Selecionar ${formatOrderDisplayNumber(order)}`} checked={selection.ids.includes(order.id)} disabled={disabled || (!selection.ids.includes(order.id) && selection.ids.length >= 100)} onChange={() => selection.toggle(order.id)} /></label>}
    <div className="client-order-content">
    <button type="button" className="client-order-info" aria-label={`Ver detalhes do ${formatOrderDisplayNumber(order)}`} onClick={() => onDetails(order.id)}>
      <span className="client-order-identity"><strong>{formatOrderDisplayNumber(order)}</strong><small><span>{dateLabel(clientOrderDate(order))}</span><span> · {order.type}</span></small></span>
      <span className="client-order-value"><strong>{currency(order.total)}</strong></span>
      <span className="client-order-badges"><StatusBadge status={order.status} />{order.status !== 'Cancelado' && <span className={`payment-badge ${order.paymentStatus === 'Pago' ? 'payment-paid' : 'payment-pending'}`}>{order.paymentStatus === 'Pago' ? 'Pago' : 'Pendente'}</span>}</span>
    </button>
    {!selection && canReceive(order) && <button type="button" className="client-receive-link" disabled={disabled} aria-label={`Receber pagamento do ${formatOrderDisplayNumber(order)}`} onClick={() => onReceive(order)}>Receber</button>}
    {order.status !== 'Cancelado' && order.paymentStatus !== 'Pago' && (order.type === 'Local' || order.tableTabId) && <span className="client-order-payment-hint">Receber pela comanda</span>}
    </div>
  </div>)}</div>
}

export default function ClientRelationshipPanel({ readModel,client, profile, completeHistory, canViewOrders, tab, onTabChange, onClose, currency, disabled, onEdit, onDelete, onNewOrder, onRegisterPayment, onRegisterClientOrdersPayment, canReceiveOrder, renderOrderDetail }) {
  const [localOrderFilter,setLocalOrderFilter]=useState('all')
  const orderFilter=readModel?.filter ?? localOrderFilter
  const setOrderFilter=value=>{setLocalOrderFilter(value);readModel?.onFilterChange?.(value)}
  const [pointDetail,setPointDetail]=useState(null)
  const detailOwner=useRef(readModel?.ownerKey);detailOwner.current=readModel?.ownerKey
  const [limit, setLimit] = useState(6)
  const [detailId, setDetailId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [previousEligibleIds, setPreviousEligibleIds] = useState('')
  const panelId = useId()
  const canReceive = order => typeof onRegisterPayment === 'function' && Boolean(canReceiveOrder?.(order, sourceFor(order)))
  const receivable = profile.orders.filter(canReceive)
  const selectable = receivable.filter(order => order.clientId === client.id && order.customerIdentityType === 'registered_client' && Number(order.total) > 0)
  const scopedSelection=useScopedOrderSelection({scopeKey:JSON.stringify([readModel?.ownerKey,client.id]),refreshKey:readModel?.data,loadOrdersByIds:readModel?.loadOrdersByIds,onError:error=>{if(error?.status===401||error?.status===403||error?.code==='SESSION_CONTEXT_CHANGED')readModel?.onUnauthorized?.(error)},
    isEligible:order=>canReceive(order)&&order.clientId===client.id&&order.customerIdentityType==='registered_client'&&Number(order.total)>0})
  const clearSelection=()=>{setSelectedIds([]);scopedSelection.clear()}
  const eligibleIds = selectable.map(order => order.id).join('\n')
  if (!readModel && eligibleIds !== previousEligibleIds) {
    const eligible = new Set(eligibleIds.split('\n'))
    setPreviousEligibleIds(eligibleIds)
    setSelectedIds(current => current.filter(id => eligible.has(id)))
  }
  const selectedOrders = readModel?scopedSelection.records:selectable.filter(order => selectedIds.includes(order.id))
  const currentIds = selectedOrders.map(order => order.id)
  const selectedTotal = selectedOrders.reduce((sum, order) => sum + Math.round(getPendingAmount(order) * 100), 0) / 100
  const selectionEnabled = tab === 'orders' && orderFilter === 'pending' && typeof onRegisterClientOrdersPayment === 'function' && (selectable.length > 0 || scopedSelection.ids.length > 0)
  const toggleSelection = id => {if(readModel){if(disabled)return;return scopedSelection.toggle(profile.orders.find(order=>order.id===id))} if (disabled || !selectable.some(order => order.id === id)) return; setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 100 ? [...current, id] : current) }
  const receiveSelected = () => {
    if (disabled || !selectedOrders.length) return
    if (selectedOrders.length === 1) receive(selectedOrders[0])
    else onRegisterClientOrdersPayment?.({ clientId: client.id, orderIds: currentIds })
  }
  const receive = order => {
    if (disabled || !canReceive(order)) return
    setDetailId(null)
    onRegisterPayment(order.id, sourceFor(order))
  }
  const filtered = readModel?profile.orders:profile.orders.filter(order => orderFilter === 'pending' ? getPendingAmount(order)>0 && order.status !== 'Cancelado' : orderFilter === 'finished' ? ['Finalizado', 'Entregue', 'Despachado'].includes(order.status) : orderFilter === 'cancelled' ? order.status === 'Cancelado' : true)
  const visibleDetail=profile.orders.find(order=>order.id===detailId)
  const detail=visibleDetail || (readModel && pointDetail?.owner===readModel?.ownerKey&&pointDetail?.order?.id===detailId?pointDetail.order:null)
  const loadDetail=readModel?.loadOrderById,detailRevision=readModel?.data
  useEffect(()=>{
    if(!detailId || visibleDetail || !loadDetail)return undefined
    let cancelled=false
    const controller=typeof AbortController==='function'?new AbortController():null,owner=readModel?.ownerKey
    Promise.resolve(loadDetail(detailId,{signal:controller?.signal})).then(order=>{
      if(cancelled||detailOwner.current!==owner||order===false)return
      if(order)setPointDetail({owner,order});else{setDetailId(null);setPointDetail(null)}
    }).catch(error=>{if(!cancelled&&(error?.status===401||error?.status===403||error?.code==='SESSION_CONTEXT_CHANGED'))readModel?.onUnauthorized?.(error)})
    return()=>{cancelled=true;controller?.abort()}
  },[detailId,visibleDetail,loadDetail,detailRevision,readModel?.ownerKey,readModel?.onUnauthorized])
  const openPending = () => { setOrderFilter('pending'); setLimit(6); onTabChange('orders') }
  const rowProps = { currency, onDetails: id=>{const order=profile.orders.find(order=>order.id===id);if(order)setPointDetail({owner:readModel?.ownerKey,order});setDetailId(id)}, canReceive, onReceive: receive, disabled }
  const footer = selectionEnabled ? <div className="client-selection-footer"><div role="status"><span>{currentIds.length} {currentIds.length === 1 ? 'pedido selecionado' : 'pedidos selecionados'}</span><strong>{currency(selectedTotal)}</strong></div><Button icon="wallet" disabled={disabled || scopedSelection.validating || !currentIds.length} onClick={receiveSelected}>Receber selecionados</Button></div> : <div className="client-profile-footer">{onEdit && <Button variant="secondary" icon="edit" disabled={disabled} onClick={onEdit}>Editar cadastro</Button>}{onNewOrder && <Button icon="plus" disabled={disabled} onClick={onNewOrder}>Novo pedido</Button>}</div>
  return <>
    <Modal title={client.name} onClose={onClose} className="client-profile-drawer" backdropClassName="client-profile-backdrop" footer={footer}>
      <div className="client-profile-contact"><Icon name="phone" size={15} /><span>{client.phone || 'Telefone não informado'}</span></div>
      <div className="client-profile-tabs" role="tablist" aria-label="Seções do cliente">{[['summary', 'Resumo'], ['orders', 'Pedidos'], ['registration', 'Cadastro']].map(([id, label]) => <button type="button" role="tab" key={id} id={`${panelId}-${id}`} aria-controls={`${panelId}-content`} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => { clearSelection(); onTabChange(id) }}>{label}</button>)}</div>
      <div className="client-profile-content" role="tabpanel" id={`${panelId}-content`} aria-labelledby={`${panelId}-${tab}`}>
        {tab === 'summary' && <>
          <h3>Relacionamento com a loja</h3>
          {readModel&&!readModel.data?<p role="status">{readModel.error?'Não foi possível carregar os pedidos.':'Carregando cliente…'}{readModel.error&&<Button variant="secondary" onClick={readModel.reload}>Tentar novamente</Button>}</p>:!canViewOrders ? <p className="client-profile-muted">Sem permissão para consultar pedidos. O cadastro continua disponível.</p> : !completeHistory ? <p className="client-profile-muted">Você vê apenas os pedidos permitidos para sua conta. O resumo completo exige acesso a pedidos ativos e ao histórico.</p> : <>
            <div className="client-profile-kpis">
              <div><span>Pedidos</span><strong>{profile.orderCount}</strong><small>{profile.cancelledCount} cancelados</small></div>
              <div><span>Ticket médio</span><strong>{currency(profile.average)}</strong><small>Sem pedidos cancelados</small></div>
              <div><span>Total em pedidos</span><strong>{currency(profile.total)}</strong><small>Sem pedidos cancelados</small></div>
              <div><span>Saldo em aberto</span><strong>{currency(profile.pending)}</strong>{receivable.length > 0 ? <button type="button" className="client-profile-link" onClick={openPending}>Receber pagamento<Icon name="arrow-right" size={14} /></button> : readModel&&profile.pending>0?<button type="button" className="client-profile-link" onClick={openPending}>Ver pedidos pendentes</button>:<small>{profile.pending > 0 ? 'Consulte os pedidos pendentes' : 'Nenhum valor pendente'}</small>}</div>
            </div>
            <dl className="client-profile-facts"><div><dt>Última compra</dt><dd>{dateLabel(profile.lastPurchase)}</dd></div><div><dt>Frequência de compra</dt><dd>{profile.frequencyDays === null ? 'Ainda sem recorrência' : profile.frequencyDays === 0 ? 'Compras no mesmo dia' : `A cada ${profile.frequencyDays} dias`}</dd></div></dl>
            {profile.daysSincePurchase >= 30 && <p className="client-profile-insight"><Icon name="clock" size={16} />Sem compras há {profile.daysSincePurchase} dias. Pode ser um bom momento para retomar o contato.</p>}
            <section className="client-profile-section"><h3>Mais pedidos</h3>{profile.favorites.length ? <ul className="client-favorite-products">{profile.favorites.map(product => <li key={product.key}><span>{product.name}</span><small>{product.quantity}×</small></li>)}</ul> : <p className="client-profile-muted">Os produtos aparecerão após o primeiro pedido.</p>}</section>
          </>}
        </>}
        {tab === 'orders' && <>
          <h3>Pedidos de {client.name.split(' ')[0]}</h3>
          {readModel&&!readModel.data?<p role="status">{readModel.error?'Não foi possível carregar os pedidos.':'Carregando cliente…'}{readModel.error&&<Button variant="secondary" onClick={readModel.reload}>Tentar novamente</Button>}</p>:!canViewOrders ? <p className="client-profile-muted">Sem permissão para consultar pedidos.</p> : <>
            <p className="client-profile-muted">{completeHistory ? 'Histórico completo' : 'Pedidos conforme suas permissões'} · {profile.orderCount} registros</p>
            <div className="client-profile-orderfilters">{orderFilters.map(([id, label]) => <button type="button" key={id} aria-pressed={orderFilter === id} className={orderFilter === id ? 'is-active' : ''} onClick={() => { setOrderFilter(id); clearSelection(); setLimit(6) }}>{label}</button>)}</div>
            {selectionEnabled && <div className="client-selection-toolbar"><span>Selecione os pedidos para receber</span><button type="button" disabled={disabled} onClick={()=>{if(readModel){if(selectable.length&&selectable.every(order=>currentIds.includes(order.id)))scopedSelection.clear();else scopedSelection.selectVisible(selectable)}else setSelectedIds(currentIds.length===Math.min(selectable.length,100)?[]:selectable.slice(0,100).map(order=>order.id))}}>{(readModel?selectable.length>0&&selectable.every(order=>currentIds.includes(order.id)):currentIds.length===Math.min(selectable.length,100)) ? 'Desmarcar todos' : selectable.length > 100 ? 'Selecionar até 100' : readModel?'Selecionar carregados':'Selecionar todos'}</button></div>}
            {orderFilter === 'pending' && filtered.some(order => order.type === 'Local' || order.tableTabId) && <p className="client-order-table-note">Pedidos de mesa são recebidos pela comanda.</p>}
            <ClientOrderRows {...rowProps} orders={readModel?filtered:filtered.slice(0, limit)} selection={selectionEnabled ? { ids: currentIds, canSelect: order => selectable.some(value => value.id === order.id), toggle: toggleSelection } : undefined} />
            {!filtered.length && <p className="client-profile-muted">Nenhum pedido neste filtro.</p>}
            {readModel?.hasMore&&<button type="button" className="client-profile-link" disabled={readModel.status==='loading-next'} onClick={readModel.loadNext}>Carregar mais pedidos</button>}
            {!readModel && filtered.length > limit && <button type="button" className="client-profile-link" onClick={() => setLimit(limit + 6)}>Mostrar mais pedidos</button>}
          </>}
        </>}
        {tab === 'registration' && <><h3>Dados do cadastro</h3><dl className="client-profile-registration"><div><dt>Nome</dt><dd>{client.name}</dd></div><div><dt>Telefone</dt><dd>{client.phone || 'Não informado'}</dd></div><div><dt>Endereço</dt><dd>{client.address || 'Não informado'}</dd></div></dl>{onDelete && <div className="client-delete-link-container"><button type="button" className="client-delete-link" disabled={disabled} onClick={onDelete}>Excluir cliente</button></div>}</>}
      </div>
    </Modal>
    {detail && renderOrderDetail?.({ order: detail, currency, onClose: () => setDetailId(null), canCancelOrders: false, canRegisterPayment: canReceive(detail), onRegisterPayment: () => receive(detail), registerPaymentDisabled: disabled })}
  </>
}
