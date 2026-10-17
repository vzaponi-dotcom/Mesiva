const LEGACY_CAPABILITIES = [
  'orders.view', 'orders.history', 'orders.analysis', 'orders.edit', 'comandas.view', 'printing.queue',
  'finance.overview', 'finance.receivables', 'finance.movements', 'reports.view', 'reports.export', 'clients.view', 'products.view',
  'tables.view', 'printing.settings', 'preferences.local', 'orders.create', 'orders.finalize',
  'orders.kitchen.control', 'orders.cancel', 'orders.discount', 'orders.backdate', 'payments.receive', 'payments.refund', 'comandas.transfer',
  'clients.create', 'clients.update', 'clients.delete', 'products.manage', 'tables.manage', 'finance.movements.manage',
  'finance.promises.manage', 'printing.execute', 'printing.force', 'printing.discard', 'printing.station.configure',
  'access.users.view', 'access.users.manage', 'access.audit.view',
]

export const SETTINGS_CAPABILITIES = Object.freeze([
  'operations.settings.view', 'operations.settings.manage',
  'payments.settings.view', 'payments.settings.manage',
  'orders.settings.view', 'orders.settings.manage',
  'finance.categories.view', 'finance.categories.manage',
  'business.profile.view', 'business.profile.manage',
  'printing.settings.view', 'printing.station.view',
])

export const APPLICATION_CAPABILITIES = Object.freeze([...LEGACY_CAPABILITIES, ...SETTINGS_CAPABILITIES])

export const SETTINGS_MANAGE_TO_VIEW = Object.freeze({
  'operations.settings.manage': 'operations.settings.view',
  'payments.settings.manage': 'payments.settings.view',
  'orders.settings.manage': 'orders.settings.view',
  'finance.categories.manage': 'finance.categories.view',
  'business.profile.manage': 'business.profile.view',
  'printing.settings': 'printing.settings.view',
  'printing.station.configure': 'printing.station.view',
})
