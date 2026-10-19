import PageSkeleton from '../../../shared/ui/PageSkeleton.jsx'
import {useCustomerReadModel} from '../application/useCustomerReadModel.js'
import { useEffect,useMemo,useRef, useState } from 'react'
import '../../../clients-phonebook.css'
import './client-relationship.css'
import Button from '../../../shared/ui/Button'
import Icon from '../../../shared/ui/Icon'
import PageHeader from '../../../shared/ui/PageHeader'
import Modal from '../../../shared/ui/Modal'
import SystemSelect from '../../../shared/ui/SystemSelect'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import { hasCapability } from '../../../app/access.js'
import { buildClientRelationships, filterAndSortClients } from '../domain/clientList.js'
import ClientRelationshipPanel from './ClientRelationshipPanel.jsx'

const FILTERS = [['all', 'Todos'], ['pending', 'Com saldo'], ['inactive', 'Sem comprar há 30 dias'], ['empty', 'Sem pedidos']]
const SORT_OPTIONS = [{ value: 'name-asc', label: 'Nome A–Z' }, { value: 'name-desc', label: 'Nome Z–A' }, { value: 'recent', label: 'Compra mais recente' }, { value: 'orders', label: 'Mais pedidos' }]
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
const dateLabel = value => value ? value.split('-').reverse().join('/') : 'Sem compras'

function Clients({ readContext,clients = [], orders = [], search = '', sort = 'name-asc', onSearchChange = () => {}, onSortChange = () => {}, onAdd, onEdit, onDelete, canCreateClients = false, canUpdateClients = false, canDeleteClients = false, granted = new Set(), currency = money, writesBlocked = false, onRegisterPayment, onRegisterClientOrdersPayment, onNewOrder, canReceiveOrder, renderOrderDetail }) {
  const [selectedId, setSelectedId] = useState(null)
  const [selectedSeed,setSelectedSeed]=useState(null),selectionOwner=useRef(null)
  const [relationshipFilter,setRelationshipFilter]=useState('all')
  const [tab, setTab] = useState('summary')
  const [filter, setFilter] = useState('all')
  const [filterDraft, setFilterDraft] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [pendingId, setPendingId] = useState(null)
  const canViewActive = hasCapability(granted, 'orders.view')
  const canViewHistory = hasCapability(granted, 'orders.history')
  const completeHistory = canViewActive && canViewHistory
  const canViewOrders = canViewActive || canViewHistory
  const scoped=Boolean(readContext?.enabled),ownerKey=readContext?.accessContextId ?? null
  const ownsSelection=selectionOwner.current===ownerKey
  const model=useCustomerReadModel({...readContext,enabled:scoped,search,sort,filter:completeHistory?filter:'all',clientId:ownsSelection?selectedId:null,orderFilter:relationshipFilter})
  const pageClients=scoped?(model.list.data?.clients || []):clients
  const readableOrders = useMemo(() => orders.filter(order => ['Finalizado', 'Cancelado', 'Entregue', 'Despachado'].includes(order.status) ? canViewHistory : canViewActive), [orders, canViewActive, canViewHistory])
  const legacyRelationships=useMemo(()=>buildClientRelationships(clients,readableOrders),[clients,readableOrders])
  const relationships=scoped?new Map(pageClients.map(client=>[client.id,client.profile])):legacyRelationships
  const selected=ownsSelection?(model.relationship.data?.client || pageClients.find(client=>client.id===selectedId) || selectedSeed):null
  const emptyProfile={orders:[],favorites:[],orderCount:0,cancelledCount:0,total:0,pending:0,average:0,lastPurchase:null,daysSincePurchase:null,frequencyDays:null}
  const profile=scoped?{...emptyProfile,...model.relationship.data?.profile,orders:model.relationship.data?.orders || []}:relationships.get(selectedId)
  const visible=scoped?pageClients:filterAndSortClients(clients,{search,sort,relationships,filter:completeHistory?filter:'all'})
  const panelModel=scoped?{...model.relationship,filter:relationshipFilter,onFilterChange:setRelationshipFilter,
    loadOrdersByIds:readContext.loadOrdersByIds,loadOrderById:readContext.loadOrderById,onUnauthorized:readContext.onUnauthorized}:undefined
  useEffect(()=>{setSelectedId(null);setSelectedSeed(null);setDeleteConfirm(false);setRelationshipFilter('all')},[ownerKey])
  const actionsDisabled = writesBlocked || pendingId !== null || (typeof navigator !== 'undefined' && !navigator.onLine)
  const openProfile = client => {selectionOwner.current=ownerKey;setSelectedSeed(client);setSelectedId(client.id);setRelationshipFilter('all');setTab('summary')}
  const closeProfile = () => {setSelectedId(null);setSelectedSeed(null);setDeleteConfirm(false)}
  const confirmDelete = async () => {
    if (!selected || !canDeleteClients || actionsDisabled) return
    setPendingId(selected.id)
    try { if (await onDelete?.(selected.id)) closeProfile() } finally { setPendingId(null) }
  }
  const allowedSort = completeHistory ? SORT_OPTIONS : SORT_OPTIONS.slice(0, 2)
  const activeFilter = completeHistory ? filter : 'all'

  return <>
    <PageHeader eyebrow="Relacionamento" title="Clientes" description="Cadastro, pedidos e contexto para atender melhor." actions={canCreateClients ? <Button icon="plus" onClick={onAdd} disabled={actionsDisabled}>Novo cliente</Button> : null} />
    <section className="surface-card client-relationship-list">
      <div className="client-list-toolbar">
        <label className="search-control"><Icon name="search" size={18} /><input type="search" aria-label="Buscar cliente" placeholder="Buscar nome, telefone ou endereço" value={search} onChange={event => onSearchChange(event.target.value)} /></label>
        <Button variant="secondary" icon="filter" onClick={() => setFilterDraft({ filter: activeFilter, sort: allowedSort.some(option => option.value === sort) ? sort : 'name-asc' })}>Filtros{activeFilter !== 'all' ? ' · 1' : ''}</Button>
      </div>
      {activeFilter !== 'all' && <div className="client-filter-summary"><span>Filtro aplicado</span><button type="button" className="client-filter-chip" onClick={() => setFilter('all')} aria-label="Remover filtro de clientes">{FILTERS.find(([id]) => id === activeFilter)?.[1]}<Icon name="close" size={14} /></button></div>}
      <div className="client-list-caption"><span>{scoped?(model.list.data?.summary?.count || 0):visible.length} {(scoped?model.list.data?.summary?.count:visible.length) === 1 ? 'cliente' : 'clientes'}</span>{canViewOrders && !completeHistory && <span>Pedidos conforme suas permissões</span>}</div>
      <div className="client-phonebook-list client-relationship-table">
        <div className="client-relationship-tablehead" aria-hidden="true"><span>Cliente / contato</span><span className="client-last-purchase">Última compra</span><span className="client-orders-count">Pedidos</span><span className="client-open-balance">Saldo em aberto</span><span /></div>
        {visible.map(client => {
          const profile = relationships.get(client.id)
          return <button type="button" className="client-phonebook-row client-relationship-row" key={client.id} aria-label={`Abrir perfil de ${client.name}`} onClick={() => openProfile(client)}>
            <span className="client-phonebook-main"><strong>{client.name}</strong><span>{client.phone || 'Sem telefone'}</span></span>
            <span className="client-last-purchase">{completeHistory ? dateLabel(profile.lastPurchase) : '—'}<span className="client-mobile-orders">{completeHistory && ` · ${profile.orderCount} ${profile.orderCount === 1 ? 'pedido' : 'pedidos'}`}</span></span>
            <span className="client-orders-count">{completeHistory ? profile.orderCount : '—'}</span>
            <span className={`client-open-balance ${profile.pending > 0 && completeHistory ? 'has-balance' : ''}`}>{completeHistory ? profile.pending > 0 ? currency(profile.pending) : 'Sem saldo' : '—'}</span>
            <span className="client-phonebook-chevron" aria-hidden="true">›</span>
          </button>
        })}
      </div>
      {!visible.length && !(scoped&&model.list.status==='loading') && !model.list.error && <div className="empty-state"><Icon name="clients" size={28} /><strong>Nenhum cliente encontrado</strong><span>Cadastre um cliente ou ajuste os filtros.</span></div>}
      {scoped&&model.list.status==='loading'&&!model.list.data&&<PageSkeleton label="Carregando clientes" heading={false} />}
      {scoped&&model.list.error&&<div role="alert"><p>Não foi possível carregar os clientes.</p><Button variant="secondary" onClick={model.list.reload}>Tentar novamente</Button></div>}
      {scoped&&model.list.hasMore&&<Button variant="secondary" disabled={model.list.status==='loading-next'} onClick={model.list.loadNext}>Carregar mais clientes</Button>}
    </section>
    {filterDraft && <Modal title="Filtrar clientes" onClose={() => setFilterDraft(null)} className="client-filter-modal" footer={<div className="form-actions"><Button variant="secondary" onClick={() => setFilterDraft({ filter: 'all', sort: 'name-asc' })}>Limpar</Button><Button onClick={() => { setFilter(filterDraft.filter); onSortChange(filterDraft.sort); setFilterDraft(null) }}>Aplicar filtros</Button></div>}>
      <div className="form-stack"><span className="client-filter-label">Situação do cliente</span><div className="client-filter-options">
        {FILTERS.filter(([id]) => completeHistory || id === 'all').map(([id, label]) => <label key={id}><input type="radio" name="client-situation" value={id} checked={filterDraft.filter === id} onChange={() => setFilterDraft({ ...filterDraft, filter: id })} /><span>{label}</span><small>{scoped?(model.list.data?.summary?.filters?.[id] || 0):filterAndSortClients(clients, { relationships, filter: id }).length}</small></label>)}
      </div><label className="field"><span>Ordenar por</span><SystemSelect value={filterDraft.sort} options={allowedSort} label="Ordenar clientes" onChange={value => setFilterDraft({ ...filterDraft, sort: value })} /></label></div>
    </Modal>}
    {selected && <ClientRelationshipPanel key={`${ownerKey}:${selected.id}`} readModel={panelModel} client={selected} profile={profile} completeHistory={completeHistory} canViewOrders={canViewOrders} tab={tab} onTabChange={setTab} onClose={closeProfile} currency={currency} disabled={actionsDisabled} onEdit={canUpdateClients ? () => onEdit?.(selected) : undefined} onDelete={canDeleteClients ? () => setDeleteConfirm(true) : undefined} onNewOrder={hasCapability(granted, 'orders.create') && onNewOrder ? () => onNewOrder(selected) : undefined} onRegisterPayment={onRegisterPayment} onRegisterClientOrdersPayment={onRegisterClientOrdersPayment} canReceiveOrder={canReceiveOrder} renderOrderDetail={renderOrderDetail} />}
    {deleteConfirm && selected && <ConfirmationDialog submitting={pendingId !== null} loadingLabel="Excluindo…" title="Excluir cliente" message={`Tem certeza que deseja excluir ${selected.name}? Esta ação não pode ser desfeita.`} confirmLabel="Excluir cliente" onClose={() => setDeleteConfirm(false)} onConfirm={confirmDelete} disabled={pendingId !== null} />}
  </>
}

export default Clients
