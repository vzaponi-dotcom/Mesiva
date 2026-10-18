import { useRef } from 'react'
import { getBusinessDate } from '../../../../shared/finance.js'
import Button from '../../../shared/ui/Button.jsx'
import Icon from '../../../shared/ui/Icon.jsx'
import SystemSelect from '../../../shared/ui/SystemSelect.jsx'
import { formatBRLCurrencyInput, formatBRLCurrencyValue, parseBRLCurrencyInput } from '../../../shared/utils/formFormatting.js'
import { paymentLabel } from '../../../../shared/businessPolicies.js'
import {
  addPaymentAllocation,
  autofillPaymentRemainder,
  paymentMethodCode,
  paymentOptionsForAllocation,
  removePaymentAllocation,
  summarizePaymentComposition,
  isValidReceivedDate,
  updatePaymentAllocation,
} from './paymentComposition.js'
import './payment-composition.css'

const centsToDisplay = (cents) => formatBRLCurrencyValue((Number(cents) || 0) / 100)
const optionValue = (paymentOptions, methodCode) => paymentOptions.find((option) => option.code === methodCode)?.value || paymentLabel(methodCode) || methodCode || ''

const paymentIcon = (methodCode) => ({
  pix: 'pix',
  cash: 'cash',
  debit_card: 'card',
  credit_card: 'card',
  transfer: 'transfer',
  other: 'wallet',
}[methodCode] || 'wallet')

export default function PaymentCompositionEditor({
  totalCents,
  allocations = [],
  onChange,
  paymentOptions = [],
  disabled = false,
  receivedDate,
  onReceivedDateChange,
}) {
  const summary = summarizePaymentComposition(allocations, totalCents, paymentOptions)
  const today = getBusinessDate()
  const dateValid = isValidReceivedDate(receivedDate, today)
  const autoRemainderIndexRef = useRef(null)

  const changeRow = (index, patch) => {
    let next = updatePaymentAllocation(allocations, index, patch)
    const autoIndex = autoRemainderIndexRef.current

    if (Object.hasOwn(patch, 'amountCents') && index === autoIndex) {
      autoRemainderIndexRef.current = null
    } else if (Number.isInteger(autoIndex) && autoIndex >= 0 && autoIndex < next.length && index !== autoIndex) {
      next = autofillPaymentRemainder(next, totalCents, autoIndex)
    }

    onChange?.(next)
  }

  const add = () => {
    const next = addPaymentAllocation(allocations, totalCents)
    autoRemainderIndexRef.current = next.length - 1
    onChange?.(next)
  }

  const remove = (index) => {
    const next = removePaymentAllocation(allocations, index)
    const autoIndex = autoRemainderIndexRef.current
    if (index === autoIndex) autoRemainderIndexRef.current = null
    else if (Number.isInteger(autoIndex) && index < autoIndex) autoRemainderIndexRef.current = autoIndex - 1
    onChange?.(next)
  }

  return (
    <div className="payment-composition-editor">
      <div className="payment-composition-summary" aria-label="Resumo do pagamento">
        <div className="payment-composition-summary-total">
          <span className="payment-composition-summary-icon"><Icon name="receipt" size={20} /></span>
          <div>
            <span>Total a receber</span>
            <strong>{centsToDisplay(summary.totalCents)}</strong>
          </div>
        </div>
        <div className="payment-composition-summary-row">
          <span>Total informado</span>
          <strong>{centsToDisplay(summary.enteredCents)}</strong>
        </div>
        <div className="payment-composition-summary-row payment-composition-summary-remaining">
          <span>Restante</span>
          <strong className={summary.remainingCents === 0 && summary.overageCents === 0 ? 'is-complete' : ''}>
            {centsToDisplay(summary.remainingCents)}
          </strong>
        </div>
      </div>

      <div className="payment-composition-heading">
        <strong>Como o cliente vai pagar?</strong>
        <span>A 1ª forma começa com o valor total. Ao dividir, o restante é preenchido automaticamente.</span>
      </div>

      {onReceivedDateChange && <label className="payment-received-date form-field">
        <span>Data do recebimento</span>
        <input type="date" aria-label="Data do recebimento" value={receivedDate || ''}
          max={today} required aria-invalid={!dateValid}
          onChange={(event) => onReceivedDateChange(event.target.value)} disabled={disabled} />
        <small className="form-hint">{dateValid ? 'Use hoje ou uma data anterior ao lançamento.' : 'Informe uma data válida, sem ultrapassar hoje.'}</small>
      </label>}

      <div className="payment-composition-lines">
        {allocations.map((allocation, index) => {
          const available = paymentOptionsForAllocation(paymentOptions, allocations, index)
          const selectOptions = available.map((option) => ({
            value: option.value,
            label: option.label,
            code: option.code,
            icon: paymentIcon(option.code),
          }))
          const currentValue = optionValue(paymentOptions, allocation.methodCode)
          const currentInactive = allocation.methodCode && !paymentOptions.some((option) => option.code === allocation.methodCode)
          if (currentInactive) selectOptions.unshift({
            value: currentValue,
            label: `${currentValue} (inativo)`,
            code: null,
            inactive: true,
            icon: paymentIcon(allocation.methodCode),
          })

          const label = index === 0 ? 'Forma de pagamento' : `Forma de pagamento ${index + 1}`

          return (
            <div className="payment-composition-line" key={`${index}:${allocation.methodCode}`}>
              <div className="payment-composition-line-header">
                <div className="payment-composition-line-title">
                  <span className="payment-composition-method-icon">
                    <Icon name={paymentIcon(allocation.methodCode)} size={18} />
                  </span>
                  <strong>Forma de pagamento {index + 1}</strong>
                  {index === 0 && allocations.length === 1 && <span className="payment-composition-primary-badge">Principal</span>}
                </div>
                {allocations.length > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    icon="trash"
                    className="payment-composition-remove"
                    aria-label={`Remover forma de pagamento ${index + 1}`}
                    onClick={() => remove(index)}
                    disabled={disabled}
                  >
                    Remover
                  </Button>
                )}
              </div>

              <div className="payment-composition-line-fields">
                <div className="form-field">
                  <span>Método de pagamento</span>
                  <SystemSelect
                    value={currentValue}
                    options={selectOptions}
                    onChange={(value) => changeRow(index, { methodCode: paymentMethodCode(paymentOptions, value) || allocation.methodCode })}
                    disabled={disabled}
                    label={label}
                  />
                </div>

                <label className="form-field">
                  <span>Valor</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Valor da forma de pagamento ${index + 1}`}
                    value={centsToDisplay(allocation.amountCents)}
                    onChange={(event) => changeRow(index, {
                      amountCents: Math.round(parseBRLCurrencyInput(formatBRLCurrencyInput(event.target.value)) * 100),
                    })}
                    disabled={disabled}
                  />
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        icon="plus"
        className="payment-composition-add"
        onClick={add}
        disabled={disabled || allocations.length >= paymentOptions.length}
      >
        Adicionar outra forma
      </Button>

      {summary.overageCents > 0 && <p className="form-error" role="alert">O valor informado ultrapassa o total em {centsToDisplay(summary.overageCents)}.</p>}
      {summary.hasDuplicateMethods && <p className="form-error" role="alert">Cada forma de pagamento pode ser usada apenas uma vez.</p>}
      {summary.needsReview && <p className="form-error" role="alert">Uma forma escolhida não está mais ativa. Revise a composição antes de confirmar.</p>}
    </div>
  )
}
