export const NAVIGATION_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'my-account', path: '/minha-conta', area: 'account', label: 'Minha conta', mobileEntry: 'more', authenticatedOnly: true }),
  Object.freeze({ id: 'access-team', path: '/configuracoes/equipe', area: 'access', label: 'Equipe e acessos', mobileEntry: 'more', capability: 'access.users.view' }),
  Object.freeze({ id: 'access-activity', path: '/configuracoes/atividades', area: 'access', label: 'Atividades', mobileEntry: 'more', capability: 'access.audit.view' }),
  Object.freeze({ id: 'settings-home', path: '/configuracoes', area: 'settings', label: 'Configurações', mobileEntry: 'more', anyCapability: Object.freeze(['business.profile.view', 'operations.settings.view', 'payments.settings.view', 'orders.settings.view', 'finance.categories.view', 'printing.settings.view', 'printing.settings', 'printing.station.configure', 'preferences.local', 'access.users.view', 'access.audit.view']) }),
  Object.freeze({ id: 'settings-business-profile', path: '/configuracoes/identidade', area: 'settings', label: 'Identidade da operação', mobileEntry: 'more', capability: 'business.profile.view' }),
  Object.freeze({ id: 'settings-operations', path: '/configuracoes/operacao', area: 'settings', label: 'Operação', mobileEntry: 'more', capability: 'operations.settings.view' }),
  Object.freeze({ id: 'settings-modalities', path: '/configuracoes/modalidades', area: 'settings', label: 'Modalidades de pedido', mobileEntry: 'more', capability: 'operations.settings.view' }),
  Object.freeze({ id: 'settings-payments', path: '/configuracoes/pagamentos', area: 'settings', label: 'Formas de pagamento', mobileEntry: 'more', capability: 'payments.settings.view' }),
  Object.freeze({ id: 'settings-cancellations', path: '/configuracoes/cancelamentos', area: 'settings', label: 'Motivos de cancelamento', mobileEntry: 'more', capability: 'orders.settings.view' }),
  Object.freeze({ id: 'settings-finance-categories', path: '/configuracoes/categorias-financeiras', area: 'settings', label: 'Categorias financeiras', mobileEntry: 'more', capability: 'finance.categories.view' }),
  Object.freeze({ id: 'settings-kitchen-tv', path: '/configuracoes/tv-da-cozinha', area: 'settings', label: 'TV da Cozinha', mobileEntry: 'more', capability: 'orders.settings.view' }),
  Object.freeze({ id: 'orders', path: '/pedidos', area: 'orders', label: 'Cozinha', mobileEntry: 'orders', capability: 'orders.view' }),
  Object.freeze({ id: 'history', path: '/pedidos/historico', area: 'orders', label: 'Histórico', mobileEntry: 'orders', capability: 'orders.history' }),
  Object.freeze({ id: 'kitchen-tv-control', path: '/pedidos/controle-da-tv', area: 'orders', label: 'Controle da TV', mobileEntry: 'orders', capability: 'orders.view' }),
  Object.freeze({ id: 'new-order', path: '/pedidos/novo', area: 'orders', label: 'Novo pedido', mobileEntry: null, capability: 'orders.create' }),
  Object.freeze({ id: 'comandas', path: '/comandas', area: 'comandas', label: 'Comandas', mobileEntry: 'comandas', capability: 'comandas.view' }),
  Object.freeze({ id: 'print-queue', path: '/fila-de-impressao', area: 'print-queue', label: 'Fila de impressão', mobileEntry: 'more', capability: 'printing.queue' }),
  Object.freeze({ id: 'dashboard', path: '/financeiro', area: 'finance', label: 'Visão geral', mobileEntry: 'finance', capability: 'finance.overview' }),
  Object.freeze({ id: 'day-conference', path: '/financeiro/conferencia-do-dia', area: 'finance', label: 'Conferência do dia', mobileEntry: 'finance', capability: 'finance.movements' }),
  Object.freeze({ id: 'reports', path: '/relatorios', area: 'finance', label: 'Relatórios', mobileEntry: null, capability: 'reports.view' }),
  Object.freeze({ id: 'receivables', path: '/financeiro/a-receber', area: 'finance', label: 'A receber', mobileEntry: 'finance', capability: 'finance.receivables' }),
  Object.freeze({ id: 'finance', path: '/financeiro/movimentacoes', area: 'finance', label: 'Movimentações', mobileEntry: 'finance', capability: 'finance.movements' }),
  Object.freeze({ id: 'clients', path: '/clientes', area: 'clients', label: 'Clientes', mobileEntry: 'more', capability: 'clients.view' }),
  Object.freeze({ id: 'products', path: '/produtos', area: 'products', label: 'Produtos e preços', mobileEntry: 'more', capability: 'products.view' }),
  Object.freeze({ id: 'tables', path: '/mesas', area: 'tables', label: 'Mesas', mobileEntry: 'more', capability: 'tables.view' }),
  Object.freeze({ id: 'settings-printing', path: '/configuracoes/impressao', area: 'settings', label: 'Impressão', mobileEntry: 'more', anyCapability: Object.freeze(['printing.settings.view', 'printing.settings', 'printing.station.configure']) }),
  Object.freeze({ id: 'settings-device', path: '/configuracoes/dispositivo', area: 'settings', label: 'Preferências deste dispositivo', mobileEntry: 'more', capability: 'preferences.local' }),
])

export const destinationById = new Map(NAVIGATION_DESTINATIONS.map((item) => [item.id, item]))

export const AREA_DESTINATION_IDS = Object.freeze({
  access: Object.freeze(['access-team', 'access-activity']),
  orders: Object.freeze(['orders', 'history', 'kitchen-tv-control']),
  finance: Object.freeze(['dashboard', 'day-conference', 'reports', 'receivables', 'finance']),
  settings: Object.freeze(['settings-home', 'settings-business-profile', 'settings-operations', 'settings-modalities', 'settings-payments', 'settings-cancellations', 'settings-finance-categories', 'settings-kitchen-tv', 'settings-printing', 'settings-device', 'access-team', 'access-activity']),
})

export const HOME_AREA_ORDER = Object.freeze(['orders', 'finance', 'settings', 'access'])
export const AREA_LABELS = Object.freeze({ orders: 'Pedidos', finance: 'Financeiro', settings: 'Configurações' })

export const DESKTOP_NAV_GROUPS = Object.freeze([
  Object.freeze({ label: 'OPERAÇÃO', items: Object.freeze([{ area: 'orders', label: 'Pedidos', icon: 'orders' }, { id: 'comandas', label: 'Comandas', icon: 'clipboard' }, { id: 'print-queue', label: 'Fila de impressão', icon: 'printer' }]) }),
  Object.freeze({ label: 'FINANCEIRO', items: Object.freeze([{ id: 'dashboard', label: 'Visão geral', icon: 'dashboard' }, { id: 'day-conference', label: 'Conferência do dia', icon: 'clipboard' }, { id: 'reports', label: 'Relatórios', icon: 'chart' }, { id: 'receivables', label: 'A receber', icon: 'wallet' }, { id: 'finance', label: 'Movimentações', icon: 'finance' }]) }),
  Object.freeze({ label: 'CADASTROS', items: Object.freeze([{ id: 'clients', label: 'Clientes', icon: 'clients' }, { id: 'products', label: 'Produtos e preços', icon: 'products' }, { id: 'tables', label: 'Mesas', icon: 'table' }]) }),
])

export const MOBILE_DIRECT_ENTRIES = Object.freeze([
  Object.freeze({ area: 'orders', label: 'Pedidos', icon: 'orders' }),
  Object.freeze({ id: 'comandas', label: 'Comandas', icon: 'clipboard' }),
  Object.freeze({ area: 'finance', label: 'Financeiro', icon: 'finance' }),
])

export const MOBILE_MORE_ENTRIES = Object.freeze([
  Object.freeze({ id: 'print-queue', icon: 'printer' }),
  Object.freeze({ id: 'clients', icon: 'clients' }),
  Object.freeze({ id: 'products', icon: 'products' }),
  Object.freeze({ id: 'tables', icon: 'table' }),
  Object.freeze({ area: 'settings', icon: 'settings', label: 'Configurações' }),
])

export const MOBILE_SECTION_IDS = Object.freeze([
  'orders', 'history', 'kitchen-tv-control', 'comandas', 'dashboard', 'day-conference', 'receivables', 'finance',
  'print-queue', 'clients', 'products', 'tables', 'settings-kitchen-tv', 'settings-printing', 'settings-device',
])
