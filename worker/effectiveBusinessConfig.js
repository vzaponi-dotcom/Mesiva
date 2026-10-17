import { paymentLabel } from '../shared/businessPolicies.js'
import { loadOperations } from './operationSettingsRepository.js'
import { loadPaymentMethods } from './paymentSettingsRepository.js'
import { loadCancellationReasons } from './cancellationSettingsRepository.js'
import { loadFinanceCategories } from './financeCategoryRepository.js'
import { loadPrintingPolicy } from './printSettingsRepository.js'
import { settingsError } from './settingsTransactions.js'

const DOMAIN_NEEDS = Object.freeze({
  operations: ['orders.view', 'orders.create', 'orders.history', 'orders.analysis'],
  paymentMethods: ['payments.receive', 'payments.refund', 'finance.movements.manage'],
  cancellationReasons: ['orders.cancel'],
  financeCategories: ['finance.movements', 'finance.movements.manage'],
  printingPolicy: ['printing.execute', 'printing.queue'],
})
const REVISION_SQL = Object.freeze({
  operations: 'SELECT revision FROM business_operation_settings WHERE business_id = ?',
  paymentMethods: 'SELECT revision FROM business_payment_settings WHERE business_id = ?',
  cancellationReasons: 'SELECT revision FROM business_cancellation_settings WHERE business_id = ?',
  financeCategories: 'SELECT revision FROM business_finance_category_settings WHERE business_id = ?',
  printingPolicy: 'SELECT revision FROM business_print_settings WHERE business_id = ?',
})
const LOADERS = Object.freeze({ operations: loadOperations, paymentMethods: loadPaymentMethods,
  cancellationReasons: loadCancellationReasons, financeCategories: loadFinanceCategories, printingPolicy: loadPrintingPolicy })

const selectedDomains = (granted) => Object.entries(DOMAIN_NEEDS)
  .filter(([, needs]) => needs.some((capability) => granted?.has(capability))).map(([domain]) => domain)
const capabilityIdentity = (granted) => [...(granted instanceof Set ? granted : [])].sort()
const digestVersion = async (revisions, granted, businessId, userId) => {
  const payload = JSON.stringify({ businessId, userId, revisions: Object.entries(revisions).sort(([a], [b]) => a.localeCompare(b)), granted: capabilityIdentity(granted) })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return `v1-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)}`
}

export async function readEffectiveConfigVersion(db, businessId, granted, userId = null) {
  const domains = selectedDomains(granted)
  const results = domains.length ? await db.batch(domains.map((domain) => db.prepare(REVISION_SQL[domain]).bind(businessId))) : []
  const revisions = {}
  domains.forEach((domain, index) => {
    const revision = results[index]?.results?.[0]?.revision ?? 0
    if (!Number.isSafeInteger(revision) || revision < 0) throw settingsError('SETTINGS_UNAVAILABLE', 503)
    revisions[domain] = revision
  })
  return { version: await digestVersion(revisions, granted, businessId, userId), revisions }
}

const project = (domain, resource) => {
  if (domain === 'operations' || domain === 'printingPolicy') return resource.data
  if (domain === 'paymentMethods') return {
    methods: resource.data.methods.filter(({ active }) => active).sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ code }) => ({ code, label: paymentLabel(code), value: paymentLabel(code) })),
    defaultMethod: resource.data.defaultMethod,
  }
  if (domain === 'cancellationReasons') return { items: resource.data.items.filter(({ active }) => active)
    .sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, label }) => ({ id, label, requiresNote: resource.meta.items[id].requiresNote })) }
  return { items: resource.data.items.filter(({ active }) => active).sort((a, b) => a.type.localeCompare(b.type) || a.sortOrder - b.sortOrder)
    .map(({ id, type, label }) => ({ id, type, label })) }
}

export async function loadEffectiveBusinessConfig(db, businessId, granted, userId = null) {
  const domains = selectedDomains(granted)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resources = await Promise.all(domains.map((domain) => LOADERS[domain](db, businessId)))
    const after = await readEffectiveConfigVersion(db, businessId, granted, userId)
    if (domains.some((domain, index) => resources[index].revision !== after.revisions[domain])) continue
    const effective = { version: after.version, revisions: after.revisions }
    domains.forEach((domain, index) => { effective[domain] = project(domain, resources[index]) })
    return effective
  }
  throw settingsError('SETTINGS_UNAVAILABLE', 503)
}
