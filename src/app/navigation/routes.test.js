import test from 'node:test'
import assert from 'node:assert/strict'

import { NAVIGATION_DESTINATIONS } from './registry.js'

const EXPECTED_PATHS = Object.freeze({
  'my-account': '/minha-conta',
  'access-team': '/configuracoes/equipe',
  'access-activity': '/configuracoes/atividades',
  'settings-home': '/configuracoes',
  'settings-business-profile': '/configuracoes/identidade',
  'settings-operations': '/configuracoes/operacao',
  'settings-modalities': '/configuracoes/modalidades',
  'settings-payments': '/configuracoes/pagamentos',
  'settings-cancellations': '/configuracoes/cancelamentos',
  'settings-finance-categories': '/configuracoes/categorias-financeiras',
  'settings-kitchen-tv': '/configuracoes/tv-da-cozinha',
  orders: '/pedidos',
  history: '/pedidos/historico',
  'kitchen-tv-control': '/pedidos/controle-da-tv',
  'new-order': '/pedidos/novo',
  comandas: '/comandas',
  'print-queue': '/fila-de-impressao',
  dashboard: '/financeiro',
  'day-conference': '/financeiro/conferencia-do-dia',
  reports: '/relatorios',
  receivables: '/financeiro/a-receber',
  finance: '/financeiro/movimentacoes',
  clients: '/clientes',
  products: '/produtos',
  tables: '/mesas',
  'settings-printing': '/configuracoes/impressao',
  'settings-device': '/configuracoes/dispositivo',
})

test('Task 1 RED: every administrative destination owns its approved canonical path', () => {
  assert.deepEqual(
    Object.fromEntries(NAVIGATION_DESTINATIONS.map(({ id, path }) => [id, path])),
    EXPECTED_PATHS,
  )

  const paths = NAVIGATION_DESTINATIONS.map(({ path }) => path)
  assert.equal(paths.every((path) => typeof path === 'string' && path.startsWith('/')), true)
  assert.equal(new Set(paths).size, paths.length)
  assert.equal(paths.includes('/cozinha-tv'), false)
})

test('Task 1 RED: navigation exposes reversible pure route helpers', async () => {
  const {
    destinationForPath,
    pathForDestination,
    routeDefinitionsForImplemented,
  } = await import('./routes.js')

  for (const [id, path] of Object.entries(EXPECTED_PATHS)) {
    assert.equal(pathForDestination(id), path)
    assert.equal(destinationForPath(path), id)
  }

  assert.equal(destinationForPath('/clientes/'), 'clients')
  assert.equal(destinationForPath('/clientes?busca=maria#topo'), 'clients')
  assert.equal(destinationForPath('/cozinha-tv'), null)
  assert.equal(destinationForPath('/nao-existe'), null)
  assert.equal(pathForDestination('future-page'), null)

  const implemented = new Set(['orders', 'history', 'clients'])
  assert.deepEqual(
    routeDefinitionsForImplemented(implemented),
    [
      { id: 'orders', path: '/pedidos' },
      { id: 'history', path: '/pedidos/historico' },
      { id: 'clients', path: '/clientes' },
    ],
  )
})
