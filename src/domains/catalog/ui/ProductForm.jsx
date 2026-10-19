import { useEffect, useRef } from 'react'
import Button from '../../../shared/ui/Button'
import Icon from '../../../shared/ui/Icon'
import {
  CATEGORY_ICON_NAMES,
  categoryForUi,
  suggestPresentationType,
} from '../domain/catalogPresentation.js'
import {
  PRODUCT_CATEGORIES,
  formatProductPresentation,
  validateProductPresentation,
} from '../../../../shared/productCatalog.js'
import { formatBRLCurrencyInput, formatBRLCurrencyValue } from '../../../shared/utils/formFormatting.js'

const PRESENTATION_OPTIONS = [
  { value: 'unit', label: 'Unidade' },
  { value: 'size', label: 'Tamanho' },
  { value: 'volume', label: 'Volume' },
  { value: 'weight', label: 'Peso' },
]
const SIZE_PRESETS = ['P', 'M', 'G']

function ProductForm({ value, onChange, onSubmit, onCancel, disabled = false, editing = false, submitting = false }) {
  const initializedNewPriceRef = useRef(false)

  useEffect(() => {
    if (editing || initializedNewPriceRef.current) return
    initializedNewPriceRef.current = true
    const zeroPrice = formatBRLCurrencyValue(0)
    if (value.price !== zeroPrice) onChange({ ...value, price: zeroPrice })
  }, [editing, onChange, value])

  const validation = validateProductPresentation(value)
  const normalizedPresentation = validation.ok ? validation.value : value
  const previewPresentation = validation.ok ? formatProductPresentation(normalizedPresentation) : ''
  const sizePreset = SIZE_PRESETS.includes(value.presentationValue) ? value.presentationValue : 'Outro'

  const patch = (next) => onChange({ ...value, ...next })

  const changeCategory = (category) => {
    const presentationType = suggestPresentationType(category)
    onChange({
      ...value,
      category,
      presentationType,
      presentationValue: presentationType === 'size' ? 'P' : '',
      presentationUnit: presentationType === 'volume' ? 'ml' : presentationType === 'weight' ? 'g' : '',
    })
  }

  const changePresentationType = (presentationType) => patch({
    presentationType,
    presentationValue: presentationType === 'size' ? 'P' : '',
    presentationUnit: presentationType === 'volume' ? 'ml' : presentationType === 'weight' ? 'g' : '',
  })

  const changeSizePreset = (preset) => patch({ presentationValue: preset === 'Outro' ? '' : preset, presentationUnit: '' })
  const canSubmit = !disabled && Boolean(value.name?.trim()) && validation.ok

  return (
    <div className="product-form">
      <div className="product-form-identification">
        <label className="form-field">
          <span>Nome do produto</span>
          <input
            type="text"
            placeholder="Ex: Marmita executiva"
            value={value.name}
            onChange={(event) => patch({ name: event.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
        <label className="form-field">
          <span>Preço</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={value.price}
            onChange={(event) => patch({ price: formatBRLCurrencyInput(event.target.value) })}
            disabled={disabled}
          />
        </label>
      </div>

      <fieldset className="product-form-section product-category-fieldset" disabled={disabled}>
        <legend>Categoria</legend>
        <div className="product-category-grid">
          {PRODUCT_CATEGORIES.map((category) => {
            const selected = categoryForUi(value.category) === category
            return (
              <button
                type="button"
                key={category}
                className={selected ? 'product-category-option selected' : 'product-category-option'}
                aria-pressed={selected}
                onClick={() => changeCategory(category)}
              >
                <Icon name={CATEGORY_ICON_NAMES[category]} size={19} />
                <span>{category}</span>
                {selected && (
                  <span className="product-selection-check" aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="product-form-section" disabled={disabled}>
        <legend>Apresentação</legend>
        <div className="product-presentation-segmented" role="group" aria-label="Apresentação do produto">
          {PRESENTATION_OPTIONS.map((option) => {
            const selected = value.presentationType === option.value
            return (
              <button
                type="button"
                key={option.value}
                className={selected ? 'product-presentation-option selected' : 'product-presentation-option'}
                aria-pressed={selected}
                onClick={() => changePresentationType(option.value)}
              >
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
        <small className="product-presentation-helper">Escolha como este produto será apresentado no cardápio.</small>
      </fieldset>

      {value.presentationType === 'size' && (
        <div className="product-presentation-detail">
          <span className="product-detail-label">Tamanho</span>
          <div className="product-size-scroll" role="group" aria-label="Tamanho do produto">
            {[...SIZE_PRESETS, 'Outro'].map((preset) => {
              const selected = sizePreset === preset
              return (
                <button
                  type="button"
                  key={preset}
                  className={selected ? 'product-size-option selected' : 'product-size-option'}
                  aria-pressed={selected}
                  onClick={() => changeSizePreset(preset)}
                  disabled={disabled}
                >
                  <span>{preset}</span>
                  {selected && (
                    <span className="product-selection-check" aria-hidden="true">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {sizePreset === 'Outro' && (
            <label className="form-field product-custom-size">
              <span>Nome do tamanho</span>
              <input
                type="text"
                maxLength={24}
                placeholder="Ex: Família"
                value={value.presentationValue}
                onChange={(event) => patch({ presentationValue: event.target.value, presentationUnit: '' })}
                disabled={disabled}
              />
            </label>
          )}
        </div>
      )}

      {['volume', 'weight'].includes(value.presentationType) && (
        <div className="product-presentation-detail product-measure-detail">
          <label className="form-field">
            <span>{value.presentationType === 'volume' ? 'Volume' : 'Peso'}</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={value.presentationType === 'volume' ? 'Ex: 350' : 'Ex: 500'}
              value={value.presentationValue}
              onChange={(event) => patch({ presentationValue: event.target.value })}
              disabled={disabled}
            />
          </label>
          <div className="form-field">
            <span>Unidade</span>
            <div className="product-measure-unit-segmented" role="group" aria-label="Unidade de medida">
              {(value.presentationType === 'volume' ? ['ml', 'L'] : ['g', 'kg']).map((unit) => {
                const selected = value.presentationUnit === unit
                return (
                  <button
                    type="button"
                    key={unit}
                    className={selected ? 'product-unit-option selected' : 'product-unit-option'}
                    aria-pressed={selected}
                    onClick={() => patch({ presentationUnit: unit })}
                    disabled={disabled}
                  >
                    <span>{unit}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!validation.ok && value.presentationType !== 'unit' && (
        <div className="product-form-error" role="alert">{validation.message}</div>
      )}

      <div className="product-preview" aria-label="Prévia do produto">
        <span>Pré-visualização</span>
        <strong>{value.name?.trim() || 'Nome do produto'}</strong>
        <small>{categoryForUi(value.category)}{previewPresentation ? ` · ${previewPresentation}` : ''}</small>
        <b>{value.price || 'R$ 0,00'}</b>
      </div>

      <div className="form-actions product-form-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={disabled}>Cancelar</Button>
        <Button type="button" onClick={onSubmit} disabled={!canSubmit} state={submitting ? 'loading' : 'idle'} loadingLabel="Salvando…">{editing ? 'Salvar alterações' : 'Salvar produto'}</Button>
      </div>
    </div>
  )
}

export default ProductForm
