import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Icon from '../../../shared/ui/Icon'
import PageHeader from '../../../shared/ui/PageHeader'
import SystemSelect from '../../../shared/ui/SystemSelect'
import {
  CATEGORY_ICON_NAMES,
  PRODUCT_CATEGORY_OPTIONS,
} from '../domain/catalogPresentation.js'
import { projectCatalogList } from '../domain/catalogList.js'
import { formatProductPresentation } from '../../../../shared/productCatalog.js'

const CATEGORY_FILTER_OPTIONS = [{ value: 'Todos', label: 'Todos' }, ...PRODUCT_CATEGORY_OPTIONS]
const LONG_PRESS_MS = 550

function Products({ products, search, currency, onSearchChange, onAdd, onEdit, onDelete, queryState, onQueryChange, canManageProducts = true }) {
  const [pendingId, setPendingId] = useState(null)
  const [deleteCandidate, setDeleteCandidate] = useState(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const categoryFilter = queryState.categoryFilter
  const [expandedCategories, setExpandedCategories] = useState(() => new Set())
  const [actionMenuProductId, setActionMenuProductId] = useState(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedProductIds, setSelectedProductIds] = useState(() => new Set())
  const longPressTimerRef = useRef(null)
  const longPressTriggeredRef = useRef(false)
  const writeDisabled = typeof navigator !== 'undefined' && !navigator.onLine
  const actionsDisabled = writeDisabled || pendingId !== null

  const { normalizedSearch, visibleProducts, groupedProducts } = projectCatalogList(products, {
    search,
    categoryFilter,
  })

  const clearLongPress = () => {
    if (!longPressTimerRef.current) return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  const toggleCategory = (category) => {
    setExpandedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const toggleProductSelection = (productId) => {
    if (!canManageProducts) return false
    setSelectedProductIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const enterSelectionMode = (productId = null) => {
    if (!canManageProducts) return false
    setSelectionMode(true)
    setActionMenuProductId(null)
    if (productId !== null) setSelectedProductIds((current) => new Set([...current, productId]))
  }

  const cancelSelection = () => {
    setSelectionMode(false)
    setSelectedProductIds(new Set())
    setBulkDeleteOpen(false)
  }

  const handleLongPressStart = (productId, event) => {
    if (!canManageProducts || actionsDisabled || selectionMode || event.pointerType === 'mouse') return
    clearLongPress()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      longPressTriggeredRef.current = true
      enterSelectionMode(productId)
    }, LONG_PRESS_MS)
  }

  const handleRowClick = (productId) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    if (selectionMode) toggleProductSelection(productId)
  }

  const handleDelete = async () => {
    if (!canManageProducts || actionsDisabled || !deleteCandidate) return false
    const productId = deleteCandidate.id
    setPendingId(productId)
    try {
      await onDelete(productId)
      setDeleteCandidate(null)
    } finally {
      setPendingId(null)
    }
  }

  const handleBulkDelete = async () => {
    if (!canManageProducts || actionsDisabled || !selectedProductIds.size) return false
    setPendingId('bulk')
    try {
      for (const productId of selectedProductIds) await onDelete(productId)
      cancelSelection()
    } finally {
      setPendingId(null)
    }
  }

  const selectionActions = (className) => (
    <div className={className} aria-live="polite">
      <strong>{selectedProductIds.size} selecionado(s)</strong>
      <div>
        <button type="button" className="product-bulk-delete" onClick={() => setBulkDeleteOpen(true)} disabled={actionsDisabled || !selectedProductIds.size}>Excluir selecionados</button>
        <button type="button" className="product-selection-cancel" onClick={cancelSelection} disabled={actionsDisabled}>Cancelar seleção</button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        eyebrow="Cardápio"
        title="Produtos e preços"
        description="Mantenha seu cardápio organizado e os valores sempre atualizados."
        actions={canManageProducts ? <Button icon="plus" onClick={() => { if (canManageProducts) onAdd?.() }} disabled={actionsDisabled}>Adicionar produto</Button> : null}
      />

      <section className="surface-card">
        <div className="toolbar product-toolbar">
          <label className="search-control">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Buscar produto, categoria, apresentação ou preço" value={search} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
          <div className="product-category-filter"><SystemSelect value={categoryFilter} options={CATEGORY_FILTER_OPTIONS} onChange={(value) => onQueryChange({ categoryFilter: value })} label="Filtrar categoria" /></div>
          <div className="product-toolbar-meta">
            <span className="toolbar-count">{visibleProducts.length} produto(s)</span>
            {canManageProducts && !selectionMode && <button type="button" className="product-select-mode-button" onClick={() => enterSelectionMode()} disabled={actionsDisabled || !visibleProducts.length}>Selecionar</button>}
          </div>
        </div>

        {selectionMode && selectionActions('product-selection-toolbar')}

        <div className={selectionMode ? 'product-list product-accordion-list has-selection-actions' : 'product-list product-accordion-list'}>
          {groupedProducts.map(({ category, products: categoryProducts }) => {
            const expanded = Boolean(normalizedSearch) || categoryFilter !== 'Todos' || expandedCategories.has(category)
            return (
              <section className="product-category-accordion" key={category}>
                <button type="button" className="product-category-accordion-header" aria-expanded={expanded} onClick={() => toggleCategory(category)}>
                  <span className="product-category-accordion-icon"><Icon name={CATEGORY_ICON_NAMES[category]} size={19} /></span>
                  <span className="product-category-accordion-copy"><strong>{category}</strong><small>{categoryProducts.length} produto(s)</small></span>
                  <span className={expanded ? 'product-category-chevron expanded' : 'product-category-chevron'} aria-hidden="true">›</span>
                </button>

                {expanded && (
                  <div className="product-category-items">
                    {categoryProducts.map((product) => {
                      const selected = selectedProductIds.has(product.id)
                      const menuOpen = actionMenuProductId === product.id && !selectionMode
                      return (
                        <article
                          className={selected ? 'product-compact-row selected' : 'product-compact-row'}
                          key={product.id}
                          onPointerDown={(event) => handleLongPressStart(product.id, event)}
                          onPointerUp={clearLongPress}
                          onPointerCancel={clearLongPress}
                          onPointerLeave={clearLongPress}
                          onClick={() => handleRowClick(product.id)}
                        >
                          {selectionMode ? (
                            <button
                              type="button"
                              className={selected ? 'product-select-checkbox selected' : 'product-select-checkbox'}
                              aria-label={`${selected ? 'Desmarcar' : 'Selecionar'} ${product.name}`}
                              aria-pressed={selected}
                              onClick={(event) => { event.stopPropagation(); toggleProductSelection(product.id) }}
                              disabled={actionsDisabled}
                            >
                              <span className="product-select-checkbox-mark" aria-hidden="true">
                                {selected && <Icon name="check" size={13} />}
                              </span>
                            </button>
                          ) : (
                            <div className="product-icon"><Icon name={CATEGORY_ICON_NAMES[category]} size={18} /></div>
                          )}

                          <div className="product-compact-main">
                            <strong>{product.name}</strong>
                            <small>{formatProductPresentation(product)}</small>
                          </div>
                          <strong className="product-compact-price">{currency(product.price)}</strong>

                          {canManageProducts && !selectionMode && (
                            <button
                              type="button"
                              className="product-overflow-button"
                              aria-label={`Ações de ${product.name}`}
                              aria-expanded={menuOpen}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                setActionMenuProductId((current) => current === product.id ? null : product.id)
                              }}
                              disabled={actionsDisabled}
                            >⋮</button>
                          )}

                          {menuOpen && (
                            <div className="product-item-menu" onClick={(event) => event.stopPropagation()}>
                              <button type="button" onClick={() => { setActionMenuProductId(null); onEdit(product) }} disabled={actionsDisabled}><Icon name="edit" size={16} />Editar</button>
                              <button type="button" className="danger" onClick={() => { setActionMenuProductId(null); setDeleteCandidate(product) }} disabled={actionsDisabled}><Icon name="trash" size={16} />Excluir</button>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {!visibleProducts.length && <div className="empty-state"><Icon name="products" size={28} /><strong>Nenhum produto encontrado</strong><span>Adicione um item ao cardápio ou ajuste a busca e os filtros.</span></div>}
      </section>

      {selectionMode && typeof document !== 'undefined' && createPortal(
        selectionActions('product-selection-mobile-toolbar'),
        document.body,
      )}

      {canManageProducts && deleteCandidate && (
        <ConfirmationDialog submitting={pendingId !== null} loadingLabel="Excluindo…"
          title="Confirmar exclusão"
          message={`Excluir ${deleteCandidate.name}? Esta ação remove o produto do cardápio e não pode ser desfeita.`}
          confirmLabel="Confirmar exclusão"
          onClose={() => setDeleteCandidate(null)}
          onConfirm={handleDelete}
          disabled={actionsDisabled}
        />
      )}

      {canManageProducts && bulkDeleteOpen && (
        <ConfirmationDialog submitting={pendingId !== null} loadingLabel="Excluindo…"
          title="Excluir produtos selecionados?"
          message={`Excluir ${selectedProductIds.size} produto(s)? Esta ação remove os itens do cardápio e não pode ser desfeita.`}
          confirmLabel="Excluir selecionados"
          onClose={() => setBulkDeleteOpen(false)}
          onConfirm={handleBulkDelete}
          disabled={actionsDisabled}
        />
      )}
    </>
  )
}

export default Products
