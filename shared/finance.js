import { DEFAULT_PAYMENT_METHODS, paymentLabel } from './businessPolicies.js'

export const FINANCE_TIME_ZONE = 'America/Sao_Paulo'

// Preserve the legacy UI order while sourcing labels from the canonical payment mapping.
export const PAYMENT_METHODS = ['cash', ...DEFAULT_PAYMENT_METHODS.methods
  .map(({ code }) => code).filter((code) => code !== 'cash')].map(paymentLabel)

export const MANUAL_MOVEMENT_CATEGORIES = {
  entrada: [
    { value: 'contribution', label: 'Aporte' },
    { value: 'other_income', label: 'Outros recebimentos' },
  ],
  saida: [
    { value: 'supplies', label: 'Insumos' },
    { value: 'packaging', label: 'Embalagens' },
    { value: 'delivery_costs', label: 'Delivery / Frete' },
    { value: 'gas', label: 'Gás' },
    { value: 'water', label: 'Água' },
    { value: 'electricity', label: 'Energia' },
    { value: 'rent', label: 'Aluguel' },
    { value: 'maintenance', label: 'Manutenção' },
    { value: 'fees', label: 'Taxas' },
    { value: 'owner_draw', label: 'Retirada' },
    { value: 'other_expense', label: 'Outros' },
  ],
}

const AUTOMATIC_CATEGORY_LABELS = {
  sales: 'Vendas',
  refunds: 'Estornos',
}

const categoryLabelByCode = new Map([
  ...Object.values(MANUAL_MOVEMENT_CATEGORIES).flat().map(({ value, label }) => [value, label]),
  ...Object.entries(AUTOMATIC_CATEGORY_LABELS),
])

const legacyCategoryCodes = {
  Vendas: 'sales',
  Estornos: 'refunds',
  Insumos: 'supplies',
  Delivery: 'delivery_costs',
  Despesas: 'other_expense',
}

export const getManualMovementCategoryOptions = (type) => MANUAL_MOVEMENT_CATEGORIES[type] ?? []

export const isManualMovementCategory = (type, category) => getManualMovementCategoryOptions(type)
  .some((option) => option.value === category)

export const normalizeMovementCategory = (movement = {}) => {
  const category = String(movement.category ?? '').trim()
  if (!category) return ''
  if (category === 'Outros') return movement.type === 'entrada' ? 'other_income' : 'other_expense'
  return legacyCategoryCodes[category] ?? category
}

export const getMovementCategoryLabel = (movement = {}, categoryLabels = new Map()) => {
  const normalized = normalizeMovementCategory(movement)
  const historicalLabel = categoryLabels instanceof Map ? categoryLabels.get(normalized) : categoryLabels?.[normalized]
  return historicalLabel ?? categoryLabelByCode.get(normalized) ?? String(movement.category ?? '')
}

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: FINANCE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export const getBusinessDate = (date = new Date()) => {
  const parts = businessDateFormatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
