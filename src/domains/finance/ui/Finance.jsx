import { useState } from 'react'
import Button from '../../../shared/ui/Button'
import Icon from '../../../shared/ui/Icon'
import PageHeader from '../../../shared/ui/PageHeader'
import AreaNavigation from '../../../app/navigation/AreaNavigation.jsx'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import StatCard from '../../../shared/ui/StatCard'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { groupFinanceMovementsForDisplay } from '../domain/movementPresentation.js'

function Finance({ movementReadModel,refundReadModel,totals, movements, currency, onAddMovement, onEditMovement, onDeleteMovement, onConfigureOpeningBalance, pendingRefundOrders = [], onRequestRefund, formatCancellationDate = () => 'Data não informada', canManageMovements = true, canRefundPayments = true }) {
  const [movementPendingDelete, setMovementPendingDelete] = useState(null)
  const writeDisabled = typeof navigator !== 'undefined' && !navigator.onLine
  const displayMovements = groupFinanceMovementsForDisplay(movements)

  return (
    <>
      <AreaNavigation area="finance" />
      <PageHeader
        eyebrow="Financeiro"
        title="Fluxo de caixa"
        description="Visualize entradas, saídas e saldo. Pagamentos de pedidos entram automaticamente quando forem confirmados em A Receber."
        actions={canManageMovements ? (
          <>
            <Button variant="secondary" icon="wallet" onClick={() => { if (canManageMovements) onConfigureOpeningBalance?.() }} disabled={writeDisabled}>Saldo inicial</Button>
            <Button icon="plus" onClick={() => { if (canManageMovements) onAddMovement?.() }} disabled={writeDisabled}>Novo movimento</Button>
          </>
        ) : null}
      />
      <section className="stats-grid stats-grid-three" aria-label="Resumo financeiro">
        <StatCard label="Entradas" value={currency(totals.entries)} helper="Receita registrada" icon="arrow-up" tone="success" />
        <StatCard label="Saídas" value={currency(totals.exits)} helper="Despesas registradas" icon="arrow-down" tone="danger" />
        <StatCard label="Saldo" value={currency(totals.balance)} helper="Entradas menos saídas" icon="wallet" tone={totals.balance >= 0 ? 'neutral' : 'danger'} />
      </section>
      {refundReadModel?.status==='loading'&&<p role="status">Carregando estornos…</p>}
      {refundReadModel?.error&&<p role="alert">Não foi possível carregar os estornos.<button type="button" onClick={refundReadModel.reload}>Tentar novamente</button></p>}
      {pendingRefundOrders.length > 0 && (
        <section className="surface-card pending-refunds-surface">
          <div className="section-heading"><div><span className="section-kicker">Atenção</span><h2>Estornos pendentes</h2></div><span className="toolbar-count">{refundReadModel?refundReadModel.data.matchingCount:pendingRefundOrders.length} pendente(s)</span></div>
          <div className="pending-refund-list">
            {pendingRefundOrders.map((order) => (
              <article className="pending-refund-row" key={order.id}>
                <div className="pending-refund-main"><strong>{formatOrderDisplayNumber(order)} · {order.client}</strong>
                  <span>{order.status === 'Cancelado'
                    ? `Cancelado em ${formatCancellationDate(order.cancelledAt)}`
                    : 'Devolução pendente após edição'}</span></div>
                <strong className="pending-refund-value">{currency(order.status !== 'Cancelado'
                  ? Number(order.refundDueCents || 0) / 100
                  : Number.isSafeInteger(order.netReceivedCents) ? order.netReceivedCents / 100 : (order.paidAmount || order.total || 0))}</strong>
                {canRefundPayments && <Button type="button" variant="secondary" className="button-danger-outline" onClick={() => { if (canRefundPayments) onRequestRefund?.(order) }} disabled={writeDisabled}>{order.status === 'Cancelado' ? 'Registrar estorno' : 'Registrar devolução'}</Button>}
              </article>
            ))}
          </div>
          {refundReadModel?.hasMore&&<button type="button" disabled={refundReadModel.status==='loading-next'} onClick={refundReadModel.loadNext}>Carregar mais estornos</button>}
        </section>
      )}
      <section className="surface-card">
        <div className="section-heading"><div><span className="section-kicker">Histórico</span><h2>Movimentações</h2></div><span className="toolbar-count">{movementReadModel?movementReadModel.data.summary.count:displayMovements.length} registro(s)</span></div>
        <div className="movement-list">
          {displayMovements.map((movement) => (
            <article className="movement-row" key={movement.id}>
              <div className={movement.type === 'entrada' ? 'movement-icon incoming' : 'movement-icon outgoing'}><Icon name={movement.type === 'entrada' ? 'arrow-up' : 'arrow-down'} size={18} /></div>
              <div className="movement-main">
                <div className="movement-title-line">
                  <strong>{movement.description}</strong>
                  <span className={movement.type === 'entrada' ? 'movement-tag incoming' : 'movement-tag outgoing'}>{movement.type === 'entrada' ? 'Entrada' : 'Saída'}</span>
                  {movement.source === 'order-payment' && <span className="movement-tag incoming">Pedido recebido</span>}
                  {movement.source === 'order-refund' && <span className="movement-tag outgoing">Estorno de pedido</span>}
                </div>
                <span>
                  {movement.categoryLabel || movement.category} · {movement.date}
                  {movement.paymentBreakdown?.length > 1 ? ` · ${movement.paymentBreakdown.length} formas` : movement.paymentMethod ? ` · ${movement.paymentMethod}` : ''}
                </span>
                {movement.paymentBreakdown?.length > 1 && (
                  <div className="movement-payment-breakdown" aria-label="Formas de pagamento">
                    {movement.paymentBreakdown.map((part) => (
                      <span className="movement-payment-part" key={part.movementId}>
                        <strong>{part.methodLabel}</strong>
                        <span>{currency(part.value)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {canManageMovements && movement.source === 'manual' && (
                  <div className="entity-actions movement-actions">
                    <Button type="button" variant="secondary" aria-label={`Editar ${movement.description}`} disabled={writeDisabled} onClick={() => onEditMovement?.(movement)}>Editar</Button>
                    <Button type="button" variant="secondary" className="button-danger-outline" aria-label={`Excluir ${movement.description}`} disabled={writeDisabled} onClick={() => setMovementPendingDelete(movement)}>Excluir</Button>
                  </div>
                )}
              </div>
              <strong className={movement.type === 'entrada' ? 'movement-value positive' : 'movement-value negative'}>{movement.type === 'entrada' ? '+' : '-'}{currency(movement.value)}</strong>
            </article>
          ))}
        </div>
        {movementReadModel?.error&&<p role="alert">Não foi possível atualizar as movimentações.<button type="button" onClick={movementReadModel.reload}>Tentar novamente</button></p>}
        {movementReadModel?.hasMore&&<button type="button" disabled={movementReadModel.status==='loading-next'} onClick={movementReadModel.loadNext}>Carregar mais movimentações</button>}
        {!displayMovements.length && <div className="empty-state"><Icon name="finance" size={28} /><strong>Nenhuma movimentação registrada</strong><span>Registre uma entrada ou saída para começar o controle.</span></div>}
      </section>
      {movementPendingDelete && <ConfirmationDialog title="Excluir movimentação?" message={`A movimentação “${movementPendingDelete.description}” será removida do histórico visível.`} confirmLabel="Excluir movimentação" onConfirm={async () => { const deleted = await onDeleteMovement?.(movementPendingDelete.id); if (deleted !== false) setMovementPendingDelete(null) }} onClose={() => setMovementPendingDelete(null)} disabled={writeDisabled} />}
    </>
  )
}

export default Finance
