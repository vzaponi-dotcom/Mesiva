import { useEffect, useMemo, useRef, useState } from 'react'
import '../../../order-operations.css'
import '../../../order-operations-compact.css'
import './history-redesigned.css'
import Button from '../../../shared/ui/Button'
import Modal from '../../../shared/ui/Modal'
import CancelOrderDialog from './components/CancelOrderDialog'
import Icon from '../../../shared/ui/Icon'
import OrderDetail from './components/OrderDetail'
import OrderPaymentStatus from './components/OrderPaymentStatus.jsx'
import useHistoryPrinting from './components/useHistoryPrinting.jsx'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import PageHeader from '../../../shared/ui/PageHeader'
import StatusBadge from '../../../shared/ui/StatusBadge'
import { getOrderItemsSummary } from '../domain/orderCart.js'
import { getOrderRefundState, isOrderFinished } from '../domain/orderLifecycle.js'
import { canReceiveStandaloneOrder } from '../domain/orderPaymentEligibility.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import { formatHistoryTime, getHistoryView, historyTimestamp } from '../domain/historyQuery.js'

const periods = [{ value: 'today', label: 'Hoje' }, { value: 'yesterday', label: 'Ontem' }, { value: '7d', label: 'Últimos 7 dias' }, { value: 'custom', label: 'Escolher período' }, { value: 'all', label: 'Todo o período' }]
const EMPTY_ORDERS=Object.freeze([])
const defaultCurrency = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))

function OrderHistory({ orders = [], readModel, currency = defaultCurrency, onCancelOrder, onRegisterPayment, paymentDisabled = false, paymentOptions, cancellationOptions = [], cancellationRevision = null, actionKey = null, printing, onToast, queryState = {}, onQueryChange, granted, canCancelOrders = true, canRefundPayments = true, canForcePrinting = false, canExecutePrinting = true, now = new Date() }) {
  const pageOrders=readModel?(Array.isArray(readModel.data?.orders)?readModel.data.orders:EMPTY_ORDERS):orders
  const readOwner=readModel?.ownerKey ?? null
  const detailOwner=useRef(readOwner),cancelOwner=useRef(readOwner)
  const [pointDetail,setPointDetail]=useState(null)
  const filter = queryState.filter || 'all'
  const period = queryState.period || 'all'
  const [detailOrderId, setDetailOrderId] = useState(null)
  const [cancelOrder, setCancelOrder] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [paymentPreparing,setPaymentPreparing]=useState(false)
  const closeDetails=()=>{detailOwner.current=Symbol('closed');setDetailOrderId(null);setPaymentPreparing(false)}
  const [periodOpen, setPeriodOpen] = useState(false)
  const [menuOrderId, setMenuOrderId] = useState(null)
  const menuTrigger = useRef(null)
  const printingOrders=useMemo(()=>readModel && pointDetail?.owner===readOwner && !pageOrders.some(order=>order.id===pointDetail.order.id)
    ? [...pageOrders,pointDetail.order]:pageOrders,[pageOrders,pointDetail,readModel,readOwner])
  const historyPrinting = useHistoryPrinting({ orders:printingOrders, printing, canExecutePrinting, canForcePrinting, onToast })
  const view = useMemo(() => {
    const local=getHistoryView(pageOrders.filter(isOrderFinished),queryState,now)
    return readModel?.data?.summary?{...local,counts:readModel.data.summary,validRange:readModel.data.validRange!==false}:local
  }, [pageOrders,queryState,now,readModel])
  const terminalOrders = view.orders
  const selectedDetailId=detailOwner.current===readOwner?detailOrderId:null
  const visibleDetail=selectedDetailId?pageOrders.find(order=>order.id===selectedDetailId):null
  const detailOrder=visibleDetail || (readModel && pointDetail?.owner===readOwner && pointDetail.order.id===selectedDetailId?pointDetail.order:null)
  const loadHistoryOrder=readModel?.loadOrderById,onHistoryUnauthorized=readModel?.onUnauthorized,officialRevision=readModel?.officialRevision
  useEffect(()=>{
    detailOwner.current=readOwner;cancelOwner.current=readOwner
    setDetailOrderId(null);setPointDetail(null);setCancelOrder(null);setMenuOrderId(null)
  },[readOwner])
  useEffect(()=>{
    if(!selectedDetailId || visibleDetail || !loadHistoryOrder)return undefined
    let cancelled=false
    const controller=typeof AbortController==='function'?new AbortController():null
    Promise.resolve().then(()=>cancelled?false:loadHistoryOrder(selectedDetailId,{signal:controller?.signal})).then(order=>{
      if(cancelled || order===false)return
      if(order)setPointDetail({owner:readOwner,order})
      else {setDetailOrderId(null);setPointDetail(null);onToast?.('Este pedido não está disponível no seu acesso atual.')}
    }).catch(error=>{
      if(cancelled || error?.name==='AbortError')return
      if(error?.status===401 || error?.status===403 || error?.code==='SESSION_CONTEXT_CHANGED'){setDetailOrderId(null);setPointDetail(null);onHistoryUnauthorized?.(error)}
      else onToast?.(error?.message || 'Não foi possível atualizar os detalhes do pedido.')
    })
    return()=>{cancelled=true;controller?.abort()}
  },[selectedDetailId,visibleDetail,loadHistoryOrder,readOwner,officialRevision,onHistoryUnauthorized,onToast])
  const closeMenu = () => setMenuOrderId(null)

  useEffect(() => { if (!readModel && detailOrderId && !detailOrder) setDetailOrderId(null) }, [detailOrder, detailOrderId, readModel])
  useEffect(() => {
    if (!menuOrderId) return undefined
    const outside = event => { if (!event.target?.closest?.('.history-order-menu')) setMenuOrderId(null) }
    const escape = event => { if (event.key === 'Escape') { setMenuOrderId(null); menuTrigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOrderId])
  const openDetails = order => { closeMenu();setPaymentPreparing(false); detailOwner.current=readOwner; if(readModel)setPointDetail({owner:readOwner,order}); setDetailOrderId(order.id) }
  const selectCancellation=order=>{cancelOwner.current=readOwner;setCancelOrder(order)}
  const confirmCancellation = async payload => {
    if (cancelOwner.current!==readOwner || !canCancelOrders || (payload?.refundNow && !canRefundPayments) || !cancelOrder || submitting || !onCancelOrder) return false
    setSubmitting(true)
    try { const saved = await onCancelOrder(cancelOrder.id, payload); if (saved !== false) setCancelOrder(null) } finally { setSubmitting(false) }
  }
  const registerPaymentFromDetail = async () => {
    if(paymentPreparing || !canReceiveStandaloneOrder(detailOrder, granted, 'history'))return
    const owner=readOwner,isCurrent=()=>detailOwner.current===owner
    setPaymentPreparing(true)
    try{if(await onRegisterPayment?.(detailOrder.id,'history',{isCurrent}) && isCurrent())closeDetails()}
    finally{if(isCurrent())setPaymentPreparing(false)}
  }
  useEffect(()=>()=>{detailOwner.current=Symbol('disposed')},[])
  const choosePeriod = value => {
    onQueryChange?.({ period: value, ...(value === 'custom' ? { startDate: queryState.startDate || getBusinessDate(now), endDate: queryState.endDate || getBusinessDate(now) } : {}) })
    setPeriodOpen(false)
  }
  return <>
    <PageHeader eyebrow="Pedidos" title="Histórico" description="Consulte pedidos finalizados e cancelados" />
    <AreaNavigation area="orders" />
    <section className="history-redesigned" aria-label="Histórico de pedidos">
      <div className="history-controls">
        <div className="history-search-row">
          <label className="search-control history-search"><Icon name="search" size={18} /><input type="search" aria-label="Buscar no histórico" placeholder="Buscar cliente, nº do pedido ou produto" value={queryState.search || ''} onChange={event => onQueryChange?.({ search: event.target.value })} /></label>
          <Button type="button" variant="secondary" icon="calendar" aria-haspopup="dialog" onClick={() => setPeriodOpen(true)}>{periods.find(p => p.value === period)?.label || 'Hoje'}<Icon name="arrow-down" size={14} /></Button>
        </div>
        {period === 'custom' && <div className="history-custom-dates"><label>De<input type="date" aria-label="Data inicial do histórico" value={queryState.startDate || ''} onChange={event => onQueryChange?.({ startDate: event.target.value })} /></label><label>Até<input type="date" aria-label="Data final do histórico" min={queryState.startDate || undefined} value={queryState.endDate || ''} onChange={event => onQueryChange?.({ endDate: event.target.value })} /></label></div>}
        {!view.validRange && <p className="history-date-error" role="alert">Informe um período válido, com a data inicial anterior ou igual à final.</p>}
        <div className="history-filter" role="group" aria-label="Filtrar histórico">{[['all', 'Todos'], ['finalized', 'Finalizados'], ['cancelled', 'Cancelados']].map(([key, label]) => <button type="button" key={key} aria-label={label} aria-pressed={filter === key} className={filter === key ? 'history-filter-button active' : 'history-filter-button'} onClick={() => onQueryChange?.({ filter: key })}><span>{label}</span><span className="history-filter-count">{view.counts[key]}</span></button>)}</div>
        <small className="history-date-hint">Período pela data de finalização ou cancelamento</small>
      </div>
      <div className="history-results-heading"><span className="toolbar-count" aria-live="polite">{readModel?Number(view.counts[filter] || 0):terminalOrders.length} registro(s)</span><span>Mais recentes primeiro</span></div>
      <div className="order-history-list history-group-list">
        {view.groups.map(group => <section className="history-day-group" key={group.date || 'unknown'} aria-label={group.label}>
          <h2>{group.label}<span>{readModel?.data?.summary?.days?.[group.date || 'unknown'] ?? group.orders.length} {(readModel?.data?.summary?.days?.[group.date || 'unknown'] ?? group.orders.length) === 1 ? 'pedido' : 'pedidos'}</span></h2>
          <div className="history-day-list">
            <div className="history-column-labels" aria-hidden="true"><span>Cliente / pedido</span><span>Status</span><span>Pagamento</span><span>Valor</span><span>Ações</span></div>
            {group.orders.map(order => {
              const refundState = getOrderRefundState(order)
              const cancelReason = order.cancelReasonLabel || order.cancelReason || ''
              const printAction = historyPrinting.getPrintAction(order)
              return <article className="history-order-row" key={order.id} tabIndex={0} aria-label={`Ver detalhes do ${formatOrderDisplayNumber(order)}`} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openDetails(order) } }} onClick={event => { if (!event.target.closest('button, a, input, summary, [role="menu"]')) openDetails(order) }}>
                <div className="history-order-identity"><strong>{order.client || 'Cliente não identificado'}</strong><div className="history-order-meta"><span>{formatOrderDisplayNumber(order)}</span><span>·</span><span>{order.type}</span><span>·</span><time dateTime={historyTimestamp(order)} aria-label={`${order.status === 'Cancelado' ? 'Cancelado' : 'Finalizado'} às ${formatHistoryTime(historyTimestamp(order))}`}>{formatHistoryTime(historyTimestamp(order))}</time></div><span className="history-order-products">{getOrderItemsSummary(order)}</span>{order.status === 'Cancelado' && cancelReason && <small className="history-cancel-reason">Motivo: {cancelReason}{order.cancelReasonNote ? ` · ${order.cancelReasonNote}` : ''}</small>}</div>
                <div className="history-order-status"><StatusBadge status={order.status} /></div>
                <div className="history-order-payment" aria-label={refundState === 'pending' ? 'Estorno pendente' : refundState === 'refunded' ? 'Estornado' : 'Pagamento'}><OrderPaymentStatus order={order} /></div>
                <strong className="history-order-value">{currency(order.total)}</strong>
                <div className="history-order-actions">
                  <div className="history-order-menu"><button type="button" className="icon-button history-more-button" aria-label={`Mais ações do ${formatOrderDisplayNumber(order)}`} aria-haspopup="menu" aria-expanded={menuOrderId === order.id} onClick={event => { menuTrigger.current = event?.currentTarget; setMenuOrderId(menuOrderId === order.id ? null : order.id) }}><Icon name="more" size={18} /></button>
                    {menuOrderId === order.id && <div className="history-action-menu" role="menu" aria-label={`Ações do ${formatOrderDisplayNumber(order)}`}>
                      <button type="button" role="menuitem" onClick={() => openDetails(order)}><Icon name="eye" size={16} />Ver detalhes</button>
                      {printAction && <button type="button" role="menuitem" disabled={!printAction.enabled || Boolean(historyPrinting.busyOrderId)} onClick={() => { closeMenu(); return historyPrinting.requestPrint(order) }}><Icon name="printer" size={16} />{printAction.label}</button>}
                      <button type="button" role="menuitem" disabled={!canExecutePrinting || Boolean(historyPrinting.busyOrderId) || !printing?.getPreviewDocument || !printing?.downloadOrderPdf} onClick={() => { closeMenu(); return historyPrinting.generatePdf(order) }}><Icon name="note" size={16} />Gerar PDF</button>
                      {canCancelOrders && order.status === 'Finalizado' && <button type="button" role="menuitem" className="history-cancel-menu-action" disabled={Boolean(actionKey) || submitting} onClick={() => { if (canCancelOrders) { closeMenu(); selectCancellation(order) } }}><Icon name="close" size={16} />Cancelar pedido</button>}
                    </div>}
                  </div>
                </div>
              </article>
            })}
          </div>
        </section>)}
        {readModel?.status==='loading' && !terminalOrders.length && <p role="status">Carregando histórico…</p>}
        {readModel?.error && <div role="alert"><p>{readModel.error.message || 'Não foi possível carregar o histórico.'}</p><Button type="button" variant="secondary" onClick={()=>readModel.reload?.()}>Tentar novamente</Button></div>}
        {readModel?.hasMore && <Button type="button" variant="secondary" disabled={readModel.status==='loading'} onClick={()=>readModel.loadNext?.()}>Carregar mais pedidos</Button>}
        {!terminalOrders.length && !(readModel && (readModel.status==='loading' || readModel.error)) && <div className="empty-state history-empty"><Icon name="search" size={28} /><strong>Nenhum pedido encontrado</strong><span>Tente outra busca ou ajuste o período e o status.</span><Button type="button" variant="secondary" onClick={() => onQueryChange?.({ filter: 'all', search: '', period: 'all', startDate: '', endDate: '' })}>Limpar filtros</Button></div>}
      </div>
    </section>
    {periodOpen && <Modal title="Filtrar período" className="history-period-modal" onClose={() => setPeriodOpen(false)}><div className="history-period-options">{periods.map(option => <button type="button" key={option.value} className={option.value === period ? 'history-period-option active' : 'history-period-option'} aria-pressed={option.value === period} onClick={() => choosePeriod(option.value)}>{option.label}{option.value === period && <Icon name="check" size={18} />}</button>)}</div></Modal>}
    {detailOrder && <OrderDetail order={detailOrder} currency={currency} printing={printing} printJob={printing?.latestJobByOrderId?.get(detailOrder.id)} onClose={closeDetails} onRequestCancel={canCancelOrders && detailOrder.status === 'Finalizado' ? () => { if (!canCancelOrders) return; closeDetails(); selectCancellation(detailOrder) } : undefined} canCancelOrders={canCancelOrders} canForcePrinting={canForcePrinting} canExecutePrinting={canExecutePrinting} canRegisterPayment={canReceiveStandaloneOrder(detailOrder, granted, 'history')} registerPaymentDisabled={paymentDisabled || Boolean(actionKey) || submitting || paymentPreparing} onRegisterPayment={registerPaymentFromDetail} onToast={onToast} />}
    {historyPrinting.confirmationDialog}
    <CancelOrderDialog open={canCancelOrders && cancelOwner.current===readOwner && Boolean(cancelOrder)} order={cancelOrder} paymentOptions={paymentOptions} reasonOptions={cancellationOptions} reasonRevision={cancellationRevision} onClose={() => setCancelOrder(null)} onConfirm={confirmCancellation} submitting={submitting} canRefundPayments={canRefundPayments} />
  </>
}
export default OrderHistory
