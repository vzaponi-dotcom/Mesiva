import PageSkeleton from '../../../shared/ui/PageSkeleton.jsx'
import { useMemo } from 'react'
import {useFinanceReadModel} from '../application/useFinanceReadModel.js'
import './finance-mobile.css'
import { calculateCurrentBalance } from '../domain/cashFlow.js'
import { useFinanceCommands } from '../application/useFinanceCommands.js'
import Finance from './Finance.jsx'
import MovementDialog from './MovementDialog.jsx'
import OpeningBalanceDialog from './OpeningBalanceDialog.jsx'

export default function FinanceWorkspace({
  movements = [],
  readContext,
  financeSettings = null,
  today,
  currency,
  pendingRefundOrders = [],
  paymentOptions = [],
  categoryOptions = [],
  categoryRevision = null,
  writesBlocked = false,
  canManageMovements = true,
  canRefundPayments = true,
  applyOfficialEffects,
  setRequestKey,
  onSuccess,
  onError,
  formatCancellationDate,
  onRequestRefund,
}) {
  const legacyTotals = useMemo(() => {
    const entries = movements
      .filter((movement) => movement.type === 'entrada')
      .reduce((total, movement) => total + Number(movement.value), 0)
    const exits = movements
      .filter((movement) => movement.type === 'saida')
      .reduce((total, movement) => total + Number(movement.value), 0)
    return { entries, exits, balance: entries - exits }
  }, [movements])
  const legacyCurrentBalance = useMemo(
    () => calculateCurrentBalance(movements, financeSettings),
    [financeSettings, movements],
  )
  const commands = useFinanceCommands({
    applyOfficialEffects,
    writesBlocked,
    canManageMovements,
    setRequestKey,
    onSuccess,
    onError,
  })

  const scoped=Boolean(readContext?.enabled)
  const reads=useFinanceReadModel({...readContext,surface:'finance'})
  const totals=scoped?reads.main.data?.totals:legacyTotals
  const currentBalance=scoped?reads.main.data?.currentBalance:legacyCurrentBalance
  if(scoped&&!reads.main.data)return reads.main.error?<div role="alert">Não foi possível carregar o fluxo de caixa.<button type="button" onClick={reads.main.reload}>Tentar novamente</button></div>:<PageSkeleton layout="dashboard" label="Carregando fluxo de caixa" />
  return (
    <>
      <Finance
        totals={totals}
        movements={scoped?reads.main.data.movements:movements}
        movementReadModel={scoped?reads.main:undefined}
        refundReadModel={scoped?reads.refunds:undefined}
        currency={currency}
        onAddMovement={commands.openNewMovement}
        onEditMovement={commands.openEditMovement}
        onDeleteMovement={commands.deleteMovement}
        onConfigureOpeningBalance={commands.openOpeningBalance}
        pendingRefundOrders={scoped?(reads.refunds.data?.orders || []):pendingRefundOrders}
        onRequestRefund={onRequestRefund}
        formatCancellationDate={formatCancellationDate}
        canManageMovements={canManageMovements}
        canRefundPayments={canRefundPayments}
      />
      <MovementDialog
        open={canManageMovements && commands.movementDialog.open}
        movement={commands.movementDialog.movement}
        today={today}
        disabled={writesBlocked}
        paymentOptions={paymentOptions}
        categoryOptions={categoryOptions}
        categoryRevision={categoryRevision}
        onClose={commands.closeMovementDialog}
        onSubmit={commands.saveMovement}
      />
      <OpeningBalanceDialog
        open={canManageMovements && commands.openingBalanceOpen}
        settings={scoped?reads.main.data.financeSettings:financeSettings}
        today={today}
        currentBalance={currentBalance}
        disabled={writesBlocked}
        onClose={commands.closeOpeningBalance}
        onSubmit={commands.saveOpeningBalance}
      />
    </>
  )
}
