import {useEffect,useState} from 'react'
import Modal from '../../../../shared/ui/Modal.jsx'
import Button from '../../../../shared/ui/Button.jsx'
import SystemSelect from '../../../../shared/ui/SystemSelect.jsx'
import CheckoutPaymentComposition from '../CheckoutPaymentComposition.jsx'
import {formatBRLCurrencyInput,formatBRLCurrencyValue,parseBRLCurrencyInput} from '../../../../shared/utils/formFormatting.js'

const amount = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100)

// Post-save phase. The order was already committed: closing this dialog must
// never undo edits or imply that a payment/refund was completed.
export default function OrderEditSettlementDialog({
  order,stage='offer',source='edit',onStageChange,onClose,onReceive,onRefund,
  paymentOptions=[],defaultPaymentMethod='',canReceivePayments=false,
  canRefundPayments=false,submitting=false,writesBlocked=false,error='',
}) {
  const [refundMethod,setRefundMethod]=useState('')
  const [refundAmount,setRefundAmount]=useState('')
  useEffect(()=>{
    setRefundAmount(formatBRLCurrencyValue((Number(order?.refundDueCents)||0)/100))
    setRefundMethod('')
  },[order?.id,order?.refundDueCents])

  if(!order)return null
  const dueCents=Number(order.dueCents)||0
  const refundDueCents=Number(order.refundDueCents)||0
  const canReceive=canReceivePayments && dueCents>0 && (!order.tableTabId || order.paymentId)
  const canRefund=canRefundPayments && refundDueCents>0
  const refundCents=Math.round(parseBRLCurrencyInput(refundAmount)*100)
  const selected=paymentOptions.find(m=>m.value===refundMethod && m.code)
  const busy=submitting||writesBlocked
  const step=(stage==='receive' && canReceive)?'receive':(stage==='refund' && canRefund)?'refund':'offer'

  return <Modal title="Pedido atualizado — situação financeira" onClose={busy ? ()=>{} : onClose}>
    <div className="form-stack order-edit-settlement-dialog">
      <p role="status"><strong>{source === 'finance'
        ? 'Devolução pendente após edição anterior.'
        : 'As alterações do pedido foram salvas.'}</strong> O pagamento e a devolução são operações separadas.</p>
      <div className="payment-summary-card">
        <div><span>Pedido atualizado</span><strong>{amount(order.totalCents)}</strong></div>
        <div><span>Recebido líquido</span><strong>{amount(order.netReceivedCents)}</strong></div>
        {dueCents>0 && <div><span>Saldo a receber</span><strong>{amount(dueCents)}</strong></div>}
        {refundDueCents>0 && <div><span>Devolução pendente</span><strong>{amount(refundDueCents)}</strong></div>}
      </div>
      {error && <p className="form-error" role="alert">Pedido salvo, mas a operação financeira não foi confirmada. {error} O saldo permanece registrado. Consulte o pedido antes de tentar novamente.</p>}
      {step==='receive' && <CheckoutPaymentComposition
        key={order.id+':'+order.contentRevision+':'+dueCents}
        totalCents={dueCents} paymentOptions={paymentOptions}
        defaultPaymentMethod={defaultPaymentMethod}
        disabled={busy}
        onCancel={()=>onStageChange('offer')}
        onConfirm={onReceive}
      />}
      {step==='refund' && <form className="form-stack" onSubmit={e=>{
        e.preventDefault()
        if(!busy && selected && Number.isSafeInteger(refundCents) && refundCents>0 && refundCents<=refundDueCents)
          onRefund({amountCents:refundCents,refundMethod:refundMethod})
      }}>
        <p className="form-hint">Registre a devolução somente depois que o valor tiver sido efetivamente entregue ao cliente. Nenhum Pix ou estorno bancário é realizado automaticamente.</p>
        <label className="form-field">
          <span>Valor efetivamente devolvido</span>
          <input aria-label="Valor da devolução" inputMode="decimal" value={refundAmount}
            onChange={e=>setRefundAmount(formatBRLCurrencyInput(e.target.value))} disabled={busy}/>
        </label>
        <div className="form-field">
          <span>Forma utilizada na devolução</span>
          <SystemSelect label="Forma utilizada na devolução" placeholder="Selecione"
            value={refundMethod} options={paymentOptions.map(m=>({value:m.value,label:m.label}))}
            onChange={setRefundMethod} disabled={busy}/>
        </div>
        {refundCents>refundDueCents && <p className="form-error" role="alert">O valor informado supera a devolução pendente.</p>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={()=>onStageChange('offer')} disabled={busy}>Voltar</Button>
          <Button type="submit" disabled={busy||!selected||!Number.isSafeInteger(refundCents)||refundCents<=0||refundCents>refundDueCents}>
            {submitting?'Registrando…':'Confirmar devolução registrada'}
          </Button>
        </div>
      </form>}
      {step==='offer' && <div className="form-actions">
        {canReceive && <Button type="button" onClick={()=>onStageChange('receive')} disabled={busy}>Receber saldo</Button>}
        {canRefund && <Button type="button" onClick={()=>onStageChange('refund')} disabled={busy}>Registrar devolução</Button>}
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Agora não</Button>
      </div>}
    </div>
  </Modal>
}
