import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DragDropProvider, DragOverlay, useDragOperation } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { FINANCE_TIME_ZONE } from '../../../../shared/finance.js'
import '../../../table-management.css'
import '../../../table-management-refined.css'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Icon from '../../../shared/ui/Icon'
import Modal from '../../../shared/ui/Modal'
import PageHeader from '../../../shared/ui/PageHeader'

const searchable = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const restriction = table => !table ? 'Esta mesa não está mais disponível.' : table.occupancy === 'occupied'
  ? 'Feche a comanda antes de renomear/desativar.' : table.nextReservation
    ? 'Mova ou cancele a reserva antes de renomear/desativar.' : ''
const reservationTime = value => value && Number.isFinite(new Date(value).getTime())
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: FINANCE_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(',', ' ·') : 'Horário a confirmar'

function TableManagementRow({ table, index, count, organizing, locked, canManageTables, canOpenComanda, onOpenComanda, onEdit, onDeactivate, onActivate, onMove }) {
  const occupied = table.occupancy === 'occupied'
  const sortableLocked = !organizing || locked || occupied
  const { ref, handleRef, isDragSource, isDropping } = useSortable({ id: table.id, index, disabled: { draggable: sortableLocked, droppable: !organizing || locked }, transition: { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)', idle: true } })
  const { source } = useDragOperation()
  const live = source && isSortable(source) ? source : null
  const marker = organizing && live && live.initialIndex !== live.index && live.index === index
  const reason = restriction(table)
  const closeMenu = event => {
    const details = event?.currentTarget?.closest?.('details')
    if (details) { details.open = false; details.querySelector('summary')?.focus() }
  }
  return <article ref={organizing ? ref : undefined} data-table-id={table.id} className={`table-management-card${occupied ? ' occupied' : ''}${table.isActive ? '' : ' inactive'}${isDragSource ? ' is-dnd-source' : ''}${isDropping ? ' is-dnd-dropping' : ''}`}
    onKeyDown={sortableLocked ? undefined : event => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      return onMove(table.id, index + (event.key === 'ArrowUp' ? -1 : 1))
    }}>
    {marker && <span className={`table-insertion-marker ${live.initialIndex < live.index ? 'is-after' : 'is-before'}`} aria-hidden="true" />}
    <div className="table-management-identity">
      {organizing ? <><button ref={handleRef} type="button" className="table-drag-handle" aria-label={`Reordenar ${table.name}`} aria-describedby="table-order-help" disabled={sortableLocked}><span aria-hidden="true">⠿</span></button><span className="table-order-number">{index + 1}</span></> : <span className="table-management-symbol"><Icon name="table" size={20} /></span>}
      <strong>{table.name}</strong>
    </div>
    <div className="table-management-status"><span className={`table-status ${!table.isActive ? 'inactive' : occupied ? 'occupied' : 'free'}`}>{!table.isActive ? 'Inativa' : occupied ? 'Ocupada' : 'Livre agora'}</span></div>
    <div className={`table-management-context${table.nextReservation ? ' has-reservation' : ''}`}>
      {table.nextReservation ? <div className="table-management-reservation"><span>Reserva</span><strong title={table.nextReservation.clientName}>{table.nextReservation.clientName || 'Cliente'}</strong><time dateTime={table.nextReservation.scheduledFor}>{reservationTime(table.nextReservation.scheduledFor)}</time></div>
        : !table.isActive ? 'Fora da operação' : occupied ? `Comanda ${table.openTableTab?.number ?? ''} em andamento` : 'Disponível para atendimento'}
    </div>
    <div className="table-management-row-actions">
      {!organizing && occupied && canOpenComanda && table.openTableTab?.id && <Button type="button" variant="secondary" onClick={() => onOpenComanda?.({ tableId: table.id, tableTabId: table.openTableTab.id })}>Ver comanda</Button>}
      {!organizing && !table.isActive && canManageTables && <Button type="button" variant="secondary" onClick={() => onActivate(table.id)} disabled={locked || Boolean(reason)}>Reativar</Button>}
      {canManageTables && <details className="table-management-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
        <summary aria-label={`Opções de ${table.name}`}>···</summary>
        <div>
          {organizing ? <><button type="button" disabled={sortableLocked || index === 0} onClick={event => { closeMenu(event); void onMove(table.id, index - 1) }}>Mover {table.name} para cima</button><button type="button" disabled={sortableLocked || index === count - 1} onClick={event => { closeMenu(event); void onMove(table.id, index + 1) }}>Mover {table.name} para baixo</button></>
            : <><button type="button" disabled={locked || Boolean(reason)} onClick={event => { closeMenu(event); onEdit(table) }}><Icon name="edit" size={16} />Renomear</button>{table.isActive && <button type="button" className="table-management-danger" disabled={locked || Boolean(reason)} onClick={event => { closeMenu(event); onDeactivate(table) }}>Desativar</button>}{reason && <p>{reason}</p>}</>}
        </div>
      </details>}
    </div>
  </article>
}

function Tables({ tables, disabled, canOpenComanda = false, canManageTables = true, onCreate, onRename, onSetActive, onReorder, onOpenComanda }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [ordering, setOrdering] = useState(false)
  const [editor, setEditor] = useState(null)
  const [name, setName] = useState('')
  const [deactivatingTable, setDeactivatingTable] = useState(null)
  const [pending, setPending] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [sortEpoch, setSortEpoch] = useState(0)
  const sortFocus = useRef(null)
  const pendingRef = useRef(false)
  const dragOrder = useRef(null)
  const orderedTables = useMemo(() => [...tables].sort((left, right) => left.sortOrder - right.sortOrder), [tables])
  const latest = useRef({ tables: orderedTables, disabled, canManageTables, ordering })
  useLayoutEffect(() => { latest.current = { tables: orderedTables, disabled, canManageTables, ordering } }, [orderedTables, disabled, canManageTables, ordering])
  useLayoutEffect(() => {
    if (!sortFocus.current || typeof document === 'undefined') return
    const row = Array.from(document.querySelectorAll('[data-table-id]')).find(node => node.getAttribute('data-table-id') === String(sortFocus.current))
    row?.querySelector('.table-drag-handle')?.focus({ preventScroll: true })
    sortFocus.current = null
  }, [sortEpoch])
  const organizing = ordering && canManageTables
  const locked = disabled || pending || !canManageTables
  const visible = organizing ? orderedTables : orderedTables.filter(table => (filter === 'all' || (filter === 'active' ? table.isActive : !table.isActive)) && searchable(table.name).includes(searchable(query)))
  const editingTable = editor?.type === 'rename' ? orderedTables.find(table => table.id === editor.id) : null
  const editReason = editor?.type === 'rename' ? restriction(editingTable) : ''
  const canWrite = () => latest.current.canManageTables && !latest.current.disabled && !pendingRef.current
  const runWrite = async action => {
    if (!canWrite()) return false
    pendingRef.current = true
    setPending(true)
    try { return await action() } catch { setAnnouncement('Não foi possível salvar. Tente novamente.'); return false }
    finally { pendingRef.current = false; setPending(false) }
  }
  const moveTable = async (id, destinationIndex, fromDrag = false) => {
    const current = latest.current.tables
    const index = current.findIndex(table => table.id === id)
    if (!latest.current.ordering || !canWrite() || index < 0 || current[index].occupancy === 'occupied' || !Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= current.length || destinationIndex === index) return false
    const next = [...current]
    const [item] = next.splice(index, 1)
    next.splice(destinationIndex, 0, item)
    const saved = await runWrite(() => onReorder(next.map(table => table.id)))
    setAnnouncement(saved ? `${item.name} movida para a posição ${destinationIndex + 1}.` : 'Ordem não salva. A ordem confirmada foi mantida.')
    if (!fromDrag) { sortFocus.current = id; setSortEpoch(value => value + 1) }
    return saved
  }
  const beginRename = table => {
    if (!canWrite() || restriction(latest.current.tables.find(item => item.id === table.id))) return
    setName(table.name)
    setEditor({ type: 'rename', id: table.id })
  }
  const saveName = async event => {
    event.preventDefault()
    if (!editor || !canWrite() || !name.trim() || (editor.type === 'rename' && restriction(latest.current.tables.find(table => table.id === editor.id)))) return false
    const saved = await runWrite(() => editor.type === 'create' ? onCreate(name.trim()) : onRename(editor.id, name.trim()))
    if (saved) setEditor(null)
    return saved
  }
  const deactivateTable = async () => {
    if (!deactivatingTable || restriction(latest.current.tables.find(table => table.id === deactivatingTable.id))) return false
    const saved = await runWrite(() => onSetActive(deactivatingTable.id, false))
    if (saved) setDeactivatingTable(null)
    return saved
  }
  const activateTable = id => restriction(latest.current.tables.find(table => table.id === id)) ? false : runWrite(() => onSetActive(id, true))
  const toggleOrdering = () => {
    if (locked) return
    setOrdering(!ordering)
    setQuery('')
    setFilter('all')
  }
  const handleDragEnd = async event => {
    const startingOrder = dragOrder.current
    dragOrder.current = null
    const { source } = event.operation
    try {
      if (event.canceled || !startingOrder || !canWrite() || !source || !isSortable(source)) return
      if (startingOrder !== JSON.stringify(latest.current.tables.map(table => table.id))) { setAnnouncement('A lista foi atualizada. Refaça o movimento.'); return }
      await moveTable(source.id, source.index, true)
    } finally {
      // The sortable plugin moves DOM nodes optimistically. Remount from official
      // data after every drop, including rejected/stale moves, to restore its order.
      sortFocus.current = source?.id
      setSortEpoch(value => value + 1)
    }
  }

  return <div className={`tables-page tables-refined${organizing ? ' is-organizing' : ''}`}>
    <PageHeader eyebrow="Seu salão, organizado" title="Mesas" description="Cadastre, renomeie e organize as mesas da sua operação." actions={canManageTables && <><Button type="button" variant="secondary" icon={organizing ? 'check' : 'transfer'} onClick={toggleOrdering} disabled={locked || orderedTables.length < 2}>{organizing ? 'Concluir ordem' : 'Organizar ordem'}</Button><Button type="button" icon="plus" disabled={locked || organizing} onClick={() => { setName(''); setEditor({ type: 'create' }) }}>Nova mesa</Button></>} />
    <section className="table-management-panel" aria-label="Cadastro de mesas">
      <div className="table-management-toolbar"><label className="table-management-search"><Icon name="search" size={18} /><input type="search" aria-label="Buscar pelo nome da mesa" placeholder="Buscar pelo nome da mesa" value={query} onChange={event => setQuery(event.target.value)} disabled={organizing} /></label><div className="table-management-filters" role="group" aria-label="Filtrar cadastro">{[['all', 'Todas'], ['active', 'Ativas'], ['inactive', 'Inativas']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} disabled={organizing} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      {organizing && <p className="table-order-help" id="table-order-help">Arraste pela alça ⠿ até a posição desejada. Pelo teclado, use Alt + ↑ / ↓ na alça. Mesas ocupadas não podem ser movidas diretamente. Cada movimento é salvo ao soltar.</p>}
      <div className="table-management-columns" aria-hidden="true"><span>Mesa</span><span>Situação</span><span>Atendimento / reserva</span><span>Ações</span></div>
      <DragDropProvider key={sortEpoch} onDragStart={() => { dragOrder.current = JSON.stringify(latest.current.tables.map(table => table.id)) }} onDragEnd={handleDragEnd}>
        <div className="table-management-list" aria-label="Lista de mesas" aria-busy={pending}>{visible.map((table, index) => <TableManagementRow key={table.id} table={table} index={index} count={orderedTables.length} organizing={organizing} locked={locked} canManageTables={canManageTables} canOpenComanda={canOpenComanda} onOpenComanda={onOpenComanda} onMove={moveTable} onEdit={beginRename} onDeactivate={table => { if (canWrite() && !restriction(table)) setDeactivatingTable(table) }} onActivate={activateTable} />)}</div>
        <DragOverlay>{source => { const table = orderedTables.find(table => table.id === source?.id); return table ? <div className="table-drag-preview"><span aria-hidden="true">⠿</span><Icon name="table" size={22} /><div><strong>{table.name}</strong><small>Solte na linha para reposicionar</small></div></div> : null }}</DragOverlay>
      </DragDropProvider>
      {!visible.length && <div className="empty-state"><Icon name={orderedTables.length ? 'search' : 'table'} size={28} /><strong>{orderedTables.length ? 'Nenhuma mesa encontrada' : 'Nenhuma mesa cadastrada'}</strong><span>{orderedTables.length ? 'Experimente outro nome ou filtro.' : canManageTables ? 'Cadastre a primeira mesa para iniciar a operação.' : 'As mesas cadastradas aparecerão aqui.'}</span>{orderedTables.length > 0 && <Button type="button" variant="secondary" onClick={() => { setQuery(''); setFilter('all') }}>Limpar busca e filtros</Button>}</div>}
      <footer className="table-management-footer">{visible.length} de {orderedTables.length} mesas cadastradas</footer>
    </section>
    <p className="table-management-helper"><Icon name="info" size={16} />Para lançar pedidos e acompanhar os atendimentos, acesse Comandas.</p>
    <span className="table-management-announcement" role="status">{announcement}</span>
    {canManageTables && editor && <Modal title={editor.type === 'create' ? 'Nova mesa' : 'Renomear mesa'} className="table-name-modal" initialFocusSelector="#table-name" onClose={() => { if (!pendingRef.current) setEditor(null) }}>
      <form className="table-name-form" onSubmit={saveName}><p>{editor.type === 'create' ? 'Escolha um nome fácil de identificar durante o atendimento.' : 'Atualize o nome usado para identificar esta mesa.'}</p><label className="form-field"><span>Nome da mesa</span><input id="table-name" value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Varanda 1" maxLength={60} disabled={locked || Boolean(editReason)} required /></label>{editReason && <p role="alert">{editReason}</p>}<div className="form-actions"><Button type="button" variant="secondary" disabled={pending} onClick={() => setEditor(null)}>Cancelar</Button><Button type="submit" state={pending ? 'loading' : 'idle'} loadingLabel="Salvando…" disabled={locked || Boolean(editReason) || !name.trim()}>{editor.type === 'create' ? 'Adicionar mesa' : 'Salvar nome'}</Button></div></form>
    </Modal>}
    {canManageTables && deactivatingTable && <ConfirmationDialog submitting={pending} loadingLabel="Desativando…" title="Confirmar desativação" message={`Desativar ${deactivatingTable.name}? Ela continuará disponível para reativação e no histórico.`} details={restriction(orderedTables.find(table => table.id === deactivatingTable.id)) || undefined} confirmLabel="Desativar mesa" onClose={() => { if (!pendingRef.current) setDeactivatingTable(null) }} onConfirm={deactivateTable} disabled={locked || Boolean(restriction(orderedTables.find(table => table.id === deactivatingTable.id)))} />}
  </div>
}

export default Tables
