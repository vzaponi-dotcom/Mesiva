import { useState } from 'react'
import { getMovementCategoryLabel } from '../../../../shared/finance.js'
import {
  formatBRLCurrencyInput,
  formatBRLCurrencyValue,
  parseBRLCurrencyInput,
} from '../../../shared/utils/formFormatting.js'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Modal from '../../../shared/ui/Modal'
import SystemSelect from '../../../shared/ui/SystemSelect'
import { PAYMENT_METHOD_OPTIONS, paymentOptionsWithSelection, paymentSelectionNeedsReview } from '../domain/paymentMethods.js'
import { financeCategoryOptionsWithSelection, financeCategorySelectionNeedsReview } from '../domain/financeCategories.js'

const TYPE_OPTIONS = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'saida', label: 'Saída' },
]

const buildDraft = (movement, today) => ({
  type: movement?.type || 'entrada',
  category: movement?.source === 'manual' ? movement.category || '' : '',
  description: movement?.description || '',
  value: formatBRLCurrencyValue(movement?.value ?? 0),
  movementDate: movement?.movementDate || movement?.date || today,
  paymentMethod: movement?.paymentMethod || '',
})

function MovementDialogContent({ movement, today, disabled, onClose, onSubmit, paymentOptions, categoryOptions, categoryRevision }) {
  const [draft, setDraft] = useState(() => buildDraft(movement, today))
  const [review, setReview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const editing = Boolean(movement?.id)
  const locked = disabled || submitting
  const paymentNeedsReview = paymentSelectionNeedsReview(paymentOptions, draft.paymentMethod)
  const retainingPersistedPayment = editing && draft.paymentMethod === (movement?.paymentMethod || '')
  const paymentRequiresReview = paymentNeedsReview && !retainingPersistedPayment
  const visiblePaymentOptions = paymentOptionsWithSelection(paymentOptions, draft.paymentMethod)
  const retainingPersistedCategory = editing && draft.type === movement.type && draft.category === movement.category
  const categoryNeedsReview = financeCategorySelectionNeedsReview(categoryOptions, draft.type, draft.category)
  const categoryRequiresReview = categoryNeedsReview && !retainingPersistedCategory
  const visibleCategoryOptions = financeCategoryOptionsWithSelection(
    categoryOptions, draft.type, draft.category, retainingPersistedCategory ? movement.categoryLabel : draft.category,
  )
  const activeCategoryCount = categoryOptions.filter((option) => option.type === draft.type).length
  const categoryConfigAvailable = Number.isSafeInteger(categoryRevision) && categoryRevision >= 0
  const parsedValue = parseBRLCurrencyInput(draft.value)
  const canReview = Boolean(
    draft.category
    && draft.description.trim()
    && parsedValue > 0
    && draft.movementDate
    && draft.paymentMethod
    && !paymentRequiresReview
    && !categoryRequiresReview
    && (retainingPersistedCategory || categoryConfigAvailable),
  )

  const updateField = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  const changeType = (nextType) => setDraft((current) => ({
    ...current,
    type: nextType,
    category: categoryOptions.some((option) => option.type === nextType && option.value === current.category) ? current.category : '',
  }))

  const handleReview = (event) => {
    event.preventDefault()
    if (!canReview || locked) return
    setReview({
      type: draft.type,
      category: draft.category,
      description: draft.description.trim(),
      value: parsedValue,
      movementDate: draft.movementDate,
      paymentMethod: draft.paymentMethod,
      ...(!retainingPersistedCategory ? { expectedRevision: categoryRevision } : {}),
    })
  }

  const handleConfirm = async () => {
    if (!review || locked) return
    const retainingReviewedPayment = editing && review.paymentMethod === (movement?.paymentMethod || '')
    if (paymentSelectionNeedsReview(paymentOptions, review.paymentMethod) && !retainingReviewedPayment) return
    const retainingReviewedCategory = editing && review.type === movement.type && review.category === movement.category
    if (!retainingReviewedCategory && (!Number.isSafeInteger(categoryRevision) || categoryRevision < 0
      || financeCategorySelectionNeedsReview(categoryOptions, review.type, review.category))) return
    setSubmitting(true)
    try {
      const result = await onSubmit?.(review)
      if (result === false) return
      setReview(null)
      onClose?.()
    } finally {
      setSubmitting(false)
    }
  }

  if (review) {
    const retainingReviewedPayment = editing && review.paymentMethod === (movement?.paymentMethod || '')
    const reviewedPaymentRequiresReview = paymentSelectionNeedsReview(paymentOptions, review.paymentMethod) && !retainingReviewedPayment
    const retainingReviewedCategory = editing && review.type === movement.type && review.category === movement.category
    const reviewedCategoryRequiresReview = !retainingReviewedCategory
      && financeCategorySelectionNeedsReview(categoryOptions, review.type, review.category)
    const reviewCategoryLabel = retainingReviewedCategory
      ? movement.categoryLabel || getMovementCategoryLabel(movement)
      : categoryOptions.find((option) => option.type === review.type && option.value === review.category)?.label || review.category
    return (
      <ConfirmationDialog submitting={submitting} loadingLabel="Salvando…"
        title={editing ? 'Confirmar alterações' : 'Confirmar movimentação'}
        message={editing ? 'Revise os dados antes de salvar as alterações.' : 'Revise os dados antes de registrar este movimento.'}
        details={(
          <div className="form-stack compact-stack">
            <strong>{review.type === 'entrada' ? 'Entrada' : 'Saída'} · {reviewCategoryLabel}</strong>
            <span>{formatBRLCurrencyValue(review.value)}</span>
            <small>{review.description}</small>
            <small>{review.movementDate} · {review.paymentMethod}</small>
            {reviewedPaymentRequiresReview && <small className="form-error" role="alert">A forma escolhida não está mais ativa. Volte e escolha uma forma ativa.</small>}
            {reviewedCategoryRequiresReview && <small className="form-error" role="alert">A categoria escolhida não está mais ativa. Volte e escolha uma categoria ativa.</small>}
          </div>
        )}
        confirmLabel={editing ? 'Salvar alterações' : 'Salvar movimento'}
        confirmVariant="primary"
        onConfirm={handleConfirm}
        onClose={() => setReview(null)}
        disabled={locked || reviewedPaymentRequiresReview || reviewedCategoryRequiresReview}
      />
    )
  }

  return (
    <Modal title={editing ? 'Editar movimento' : 'Registrar movimento'} onClose={locked ? () => {} : onClose}>
      <form className="form-stack movement-form" onSubmit={handleReview}>
        <label className="form-field">
          <span>Tipo</span>
          <SystemSelect
            value={draft.type}
            options={TYPE_OPTIONS}
            onChange={changeType}
            label="Tipo do movimento"
            disabled={locked}
          />
        </label>

        <label className="form-field">
          <span>Categoria</span>
          <SystemSelect
            value={draft.category}
            options={visibleCategoryOptions}
            onChange={(value) => updateField('category', value)}
            placeholder="Selecione uma categoria"
            label="Categoria"
            disabled={locked}
          />
          {!retainingPersistedCategory && activeCategoryCount === 0 && <small className="form-error" role="alert">Nenhuma categoria ativa de {draft.type === 'entrada' ? 'entrada' : 'saída'} está disponível. Configure uma categoria antes de criar este movimento.</small>}
          {categoryNeedsReview && retainingPersistedCategory && <small className="form-error" role="status">{movement.categoryLabel || getMovementCategoryLabel(movement)} está inativa hoje e será preservada enquanto a categoria não for alterada.</small>}
          {categoryRequiresReview && <small className="form-error" role="alert">A categoria escolhida não está mais ativa. Escolha uma categoria ativa antes de continuar.</small>}
        </label>

        <label className="form-field">
          <span>Descrição</span>
          <input
            value={draft.description}
            onChange={(event) => updateField('description', event.target.value)}
            placeholder="Ex.: Compra de embalagens"
            disabled={locked}
          />
        </label>

        <label className="form-field">
          <span>Valor</span>
          <input
            inputMode="decimal"
            value={draft.value}
            onChange={(event) => updateField('value', formatBRLCurrencyInput(event.target.value))}
            placeholder="R$ 0,00"
            disabled={locked}
          />
        </label>

        <label className="form-field">
          <span>Data do movimento</span>
          <input
            type="date"
            value={draft.movementDate}
            max={today}
            onChange={(event) => updateField('movementDate', event.target.value)}
            disabled={locked}
          />
        </label>

        <label className="form-field">
          <span>Forma / Meio</span>
          <SystemSelect
            value={draft.paymentMethod}
            options={visiblePaymentOptions}
            onChange={(value) => updateField('paymentMethod', value)}
            placeholder="Selecione a forma / meio"
            label="Forma ou meio"
            disabled={locked}
          />
          {paymentNeedsReview && <small className="form-error" role="alert">{retainingPersistedPayment
            ? 'A forma registrada está inativa hoje e será preservada enquanto não for alterada.'
            : 'A forma escolhida não está mais ativa. Escolha uma forma ativa antes de continuar.'}</small>}
        </label>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={locked}>Cancelar</Button>
          <Button type="submit" disabled={locked || !canReview}>
            {editing ? 'Revisar alterações' : 'Revisar movimento'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function MovementDialog({ open, movement = null, today, disabled = false, onClose, onSubmit, paymentOptions = PAYMENT_METHOD_OPTIONS, categoryOptions = [], categoryRevision = null }) {
  if (!open) return null
  return (
    <MovementDialogContent
      key={`${movement?.id || 'new'}:${today}`}
      movement={movement}
      today={today}
      disabled={disabled}
      onClose={onClose}
      onSubmit={onSubmit}
      paymentOptions={paymentOptions}
      categoryOptions={categoryOptions}
      categoryRevision={categoryRevision}
    />
  )
}

export default MovementDialog
