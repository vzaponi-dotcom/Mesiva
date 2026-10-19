import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import React, { useState } from 'react'
import { act } from 'react-test-renderer'
import { buildPrintQueueSummary } from './printQueueSummary.js'
import { filterPrintQueueJobs, getPrintQueueSearchText, PRINT_QUEUE_STATUS_FILTERS } from './printQueueFilters.js'
import { formatOrderCustomerIdentity } from '../../../../shared/orderPrintDocument.js'
import { getPrintJobDetails } from './printQueueDetails.js'
import { DEFAULT_PRINT_QUEUE_QUERY, sortPrintQueueJobsForDisplay } from './printQueueQuery.js'
import { buttonNamed, nodeText, workspaceHarness } from '../../../test-support/renderWorkspace.js'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('priority and force require management while skipping the second copy is routine execution', async (t) => {
  const harness = await workspaceHarness(t)
  const {default: PrintQueue} = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  for (const [job,label,disabled] of [
    [{status:'pending',priority:0},'Imprimir agora',true],
    [{status:'requires_attention',attentionReason:'ORDER_FINALIZED_BEFORE_PRINT'},'Imprimir mesmo assim',true],
    [{status:'awaiting_second_copy',copiesRequested:2,copiesPrinted:1},'Não imprimir 2ª via',false],
  ]) {
    globalThis.fetch = async path => ({ok:true,json:async()=>String(path).includes('/summary')?{summary:{}}:{jobs:[{id:'job1',type:'order',orderId:'o1',...job}],pageInfo:{page:1,pageSize:10,totalItems:1,totalPages:1}}})
    const renderer = await harness.render(PrintQueue,{canExecutePrinting:true,canDiscardPrinting:false,canForcePrinting:false,orders:[{id:'o1',status:'Em preparo'}],printing:{stations:[]},queryState:{...DEFAULT_PRINT_QUEUE_QUERY},onQueryChange(){}})
    await act(async()=>{await Promise.resolve(); await Promise.resolve()})
    const row = renderer.root.findAllByType('tr').find(node=>typeof node.props.onClick==='function')
    assert.ok(row)
    await act(async()=>row.props.onClick())
    const button = renderer.root.findAllByType('button').find(node=>nodeText(node)===label)
    assert.ok(button,label)
    assert.equal(button.props.disabled,disabled,label)
    await act(async()=>renderer.unmount())
  }
})

test('print queue page provides the initial structural heading', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /title="Fila de impressão"/)
  assert.match(page, /Acompanhe e gerencie as impressões da cozinha/)
  assert.match(page, /Configurações/)
  assert.match(page, /aria-label="Configurações, Impressão"/)
  assert.match(page, /Configurações &gt; Impressão/)
  assert.match(page, /icon="settings"/)
  assert.match(page, /onOpenPrintingSettings/)
})

test('print queue omits the printing settings shortcut when no administrative callback is provided', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: {} }) }
    throw new Error(`Unexpected request: ${url}`)
  }
  const renderer = await harness.render(PrintQueue, {
    orders: [],
    printing: { localStation: null, stations: [] },
    queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
    onQueryChange() {},
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Configurações, Impressão' }).length, 0)
})

test('desktop navigation opens the queue and its settings shortcut opens the printing section', async () => {
  const [app, sidebar, orders] = await Promise.all([
    readSource('../../../App.jsx'),
    readSource('../../../app/navigation/registry.js'),
    readSource('../../orders/ui/Orders.jsx'),
  ])

  assert.match(app, /PrintQueue[\s\S]*from '\.\/domains\/printing\/index\.js'/)
  assert.match(app, /activeTab === 'print-queue' && <PrintQueue/)
  assert.match(app, /onOpenPrintingSettings=\{canOpenPrintingSettings \? \(\) => requestNavigation\('settings-printing'\) : undefined\}/)
  assert.match(sidebar, /\{ id: 'print-queue', label: 'Fila de impressão', icon: 'printer' \}/)
  assert.match(orders, /onNavigatePrintQueue/)
  assert.match(orders, /className="kitchen-print-queue-button"/)
  assert.match(orders, /onClick=\{onNavigatePrintQueue\}/)
  assert.match(orders, />Fila de impressão\{activePrintJobs/)
})

test('mobile keeps five bottom tabs and exposes the print queue through Mais', async () => {
  const mobileNavigation = await readSource('../../../app/navigation/registry.js')

  assert.match(mobileNavigation, /MOBILE_DIRECT_ENTRIES = Object\.freeze\(\[[\s\S]*?\{ area: 'orders', label: 'Pedidos', icon: 'orders' \}[\s\S]*?\{ id: 'comandas', label: 'Comandas', icon: 'clipboard' \}[\s\S]*?\{ area: 'finance', label: 'Financeiro', icon: 'finance' \}/)
  assert.match(mobileNavigation, /MOBILE_MORE_ENTRIES = Object\.freeze\(\[[\s\S]*?\{ id: 'print-queue', icon: 'printer' \}[\s\S]*?\{ id: 'clients', icon: 'clients' \}[\s\S]*?\{ id: 'products', icon: 'products' \}/)
})

test('print queue summary uses the four server operational counters', () => {
  assert.deepEqual(buildPrintQueueSummary([
    { status: 'pending' },
    { status: 'awaiting_confirmation' },
    { status: 'awaiting_second_copy' },
    { status: 'requires_attention' },
    { status: 'processing' },
    { status: 'printed' },
    { status: 'discarded' },
  ]), {
    pending: 1,
    awaitingConfirmation: 1,
    waitingSecondCopy: 1,
    attention: 1,
    discardable: 3,
  })
})

test('print queue renders operational status and a responsive four-card summary', async () => {
  const [app, page, styles] = await Promise.all([
    readSource('../../../App.jsx'),
    readSource('./PrintQueue.jsx'),
    readSource('./print-queue.css'),
  ])

  for (const label of ['Aguardando impressão', 'Aguardando confirmação', 'Aguardando 2ª via', 'Requer atenção']) {
    assert.match(page, new RegExp(label))
  }
  assert.match(page, /print-queue-operational-card/)
  assert.match(app, /<PrintQueue orders=\{orders\} printing=\{printing\}/)
  assert.match(styles, /\.print-queue-summary[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-summary[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
})

test('print queue renders the empty state from the backend operational page', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /operationalJobs\.length === 0/)
  assert.match(page, /Os trabalhos de impressão aparecerão aqui\./)
  assert.match(page, /operationalJobs\.map/)
})

test('print queue job rows expose identity, origin, copies, status, time and station', async () => {
  const page = await readSource('./PrintQueue.jsx')

  for (const pattern of [
    /orderNumber/,
    /document\?\.customer\?\.name/,
    /job\?\.trigger/,
    /job\?\.copiesPrinted/,
    /job\?\.copiesRequested/,
    /job\?\.createdAt/,
    /job\?\.stationId/,
    /job\?\.attentionReason/,
    /getPrintQueueLabel/,
  ]) assert.match(page, pattern)
})

test('print queue keeps structured desktop rows and compact mobile cards without horizontal overflow', async () => {
  const [page, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('./print-queue.css'),
  ])

  assert.match(page, /print-queue-jobs-table/)
  assert.match(page, /print-queue-job-card/)
  assert.match(styles, /\.print-queue-jobs-table/)
  assert.match(styles, /\.print-queue-job-card/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-jobs-table[\s\S]*display: none/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-job-card[\s\S]*display: grid/)
})

test('print queue uses an operational order number and never treats a UUID suffix as one', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /formatOrderDisplayNumber/)
  assert.match(page, /displayNumber|operationalNumber|orderNumber/)
  assert.match(page, /ordersById/)
  assert.doesNotMatch(page, /String\(.*order.*\)\.slice\(-4\)/)
})

test('print queue preserves official table and customer identity with a neutral fallback', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /getCustomerOrTable/)
  assert.match(page, /tableIdentifier/)
  assert.match(page, /customerOrTable: getCustomerOrTable/)
  assert.match(page, /formatOrderDisplayNumber\(order\)/)
})

test('print queue reuses the operational local identity for table and customer', () => {
  assert.equal(formatOrderCustomerIdentity({ tableIdentifier: 'Mesa 3', customerName: 'Ana' }), 'Mesa 3 · Ana')
})

test('print queue keeps the table identity when no customer is present', () => {
  assert.equal(formatOrderCustomerIdentity({ tableIdentifier: 'Mesa 3', customerName: '' }), 'Mesa 3')
})

test('print queue keeps the customer identity when no table is present', () => {
  assert.equal(formatOrderCustomerIdentity({ tableIdentifier: '', customerName: 'Ana' }), 'Ana')
})

test('print queue uses the neutral fallback when table and customer are absent', () => {
  assert.equal(formatOrderCustomerIdentity({ tableIdentifier: '', customerName: '' }), null)
})

const filterJobs = [
  {
    id: 'customer-job',
    trigger: 'automatic',
    status: 'pending',
    orderId: 'order-104',
    document: { customer: { name: 'Ana Souza' }, tableIdentifier: 'Mesa 4', order: { number: '0000' } },
  },
  {
    id: 'table-job',
    trigger: 'manual',
    status: 'printed',
    orderId: 'order-205',
    document: { customer: { name: 'Bruno Lima' }, tableIdentifier: 'Mesa 12', order: { displayNumber: '0000' } },
  },
  {
    id: 'technical-id-job',
    trigger: 'automatic',
    status: 'attention',
    orderId: 'order-123',
    document: { customer: { name: 'Carla Dias' }, order: { id: '123e4567-e89b-12d3-a456-426614174000', number: '123e4567-e89b-12d3-a456-426614174000' } },
  },
]

const filterOrders = [
  { id: 'order-104', orderNumber: 104 },
  { id: 'order-205', orderNumber: 205 },
  { id: 'order-123', orderNumber: 123 },
]

test('print queue search matches customer case-insensitively', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: 'ANA SOUZA', orders: filterOrders }).map((job) => job.id), ['customer-job'])
})

test('print queue search matches table identifiers', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: 'mesa 12', orders: filterOrders }).map((job) => job.id), ['table-job'])
})

test('print queue search matches an available operational order number', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: 'Pedido 205', orders: filterOrders }).map((job) => job.id), ['table-job'])
})

test('print queue search does not match technical UUIDs', () => {
  assert.equal(getPrintQueueSearchText(filterJobs[2], filterOrders).includes('123e4567-e89b-12d3-a456-426614174000'), false)
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: '123e4567-e89b-12d3-a456-426614174000', orders: filterOrders }), [])
})

test('print queue filters by canonical status and combines status with search', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { status: 'printed' }).map((job) => job.id), ['table-job'])
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: 'mesa', status: 'printed', orders: filterOrders }).map((job) => job.id), ['table-job'])
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { status: 'queued' }).map((job) => job.id), ['customer-job'])
})

test('print queue filters by reliable origin values', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { origin: 'automatic' }).map((job) => job.id), ['customer-job', 'technical-id-job'])
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { origin: 'manual' }).map((job) => job.id), ['table-job'])
})

test('print queue returns no jobs when active filters match nothing', () => {
  assert.deepEqual(filterPrintQueueJobs(filterJobs, { search: 'inexistente', status: 'printed', orders: filterOrders }), [])
})

test('print queue exposes responsive filter controls without structural horizontal overflow', async () => {
  const [page, filters, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('./printQueueFilters.js'),
    readSource('./print-queue.css'),
  ])

  assert.match(page, /Buscar pedido, cliente ou mesa/)
  assert.match(filters, /Todos/)
  assert.match(filters, /WAITING_CONFIRMATION/)
  assert.match(filters, /Manual\/Reimpressão/)
  assert.match(styles, /\.print-queue-filters/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-filters[\s\S]*flex-direction: column/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-search[\s\S]*width: 100%/)
})

test('print queue resolves the official number from orders for jobs with legacy snapshots', async () => {
  const jobs = [{ id: 'job-1', orderId: 'order-1', document: { order: { id: 'order-1', number: '0000' } }, trigger: 'automatic', status: 'pending' }]
  const orders = [{ id: 'order-1', orderNumber: 58 }]

  assert.deepEqual(filterPrintQueueJobs(jobs, { search: 'Pedido 58', orders }).map((job) => job.id), ['job-1'])
  assert.deepEqual(filterPrintQueueJobs(jobs, { search: '550e8400-e29b-41d4-a716-446655440000', orders }), [])
})

test('print queue receives orders for current operational identity lookup', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /function PrintQueue\(\{[^}]*orders/)
  assert.match(page, /orderId/)
  assert.match(page, /orderNumber/)
})

test('print job details expose official identity, canonical status, origin, copies and station', () => {
  const details = getPrintJobDetails({
    orderId: 'order-1',
    trigger: 'automatic',
    status: 'pending',
    priority: 1,
    copiesRequested: 2,
    copiesPrinted: 1,
    stationId: 'station-1',
    document: { customer: { name: 'Ana' }, tableIdentifier: 'Mesa 3' },
  }, {
    order: { id: 'order-1', orderNumber: 42 },
    stations: [{ id: 'station-1', name: 'Cozinha PC' }],
    stationReady: true,
  })

  assert.equal(details.title, 'Pedido #42')
  assert.equal(details.identity, 'Mesa 3 · Ana')
  assert.equal(details.status, 'Na fila')
  assert.equal(details.origin, 'Automático')
  assert.equal(details.copies, '1/2')
  assert.equal(details.priority, 'Imprimir agora')
  assert.equal(details.station, 'Cozinha PC')
})

test('print job details include available timestamps, attention, error, reprint link and audit', () => {
  const details = getPrintJobDetails({
    orderId: 'order-1',
    parentJobId: 'job-previous-uuid',
    trigger: 'manual',
    status: 'requires_attention',
    attentionReason: 'A estação não confirmou',
    lastError: { code: 'QZ_PRINT_FAILED', message: 'Falha na impressora' },
    createdAt: '2026-09-08T10:00:00.000Z',
    availableAt: '2026-09-08T10:01:00.000Z',
    processingStartedAt: '2026-09-08T10:02:00.000Z',
    processedAt: null,
    discardedAt: null,
    actionActorLabel: 'Untrusted old label', attribution: { requestedBy: { type: 'user', displayName: 'Victor' }, lastActionBy: { type: 'user', displayName: 'Victor' } },
    actionAt: '2026-09-08T10:03:00.000Z',
    document: { customer: { name: 'Ana' }, tableIdentifier: 'Mesa 3' },
  }, { order: { id: 'order-1', orderNumber: 42 }, stationReady: true })

  assert.equal(details.status, 'Requer atenção')
  assert.equal(details.origin, 'Manual/Reimpressão')
  assert.equal(details.attentionReason, 'A estação não confirmou')
  assert.deepEqual(details.error, { code: 'QZ_PRINT_FAILED', message: 'Falha na impressora' })
  assert.equal(details.reprintOf, 'Reimpressão de trabalho anterior')
  assert.equal(details.audit.actor, 'Victor')
  assert.match(details.times.created.value, /08\/09\/2026/)
  assert.doesNotMatch(JSON.stringify(details), /job-previous-uuid/)
})

test('print job details omit absent values instead of rendering undefined or null', () => {
  const details = getPrintJobDetails({ status: 'printed', document: {} }, { stationReady: true })

  assert.equal(details.identity, null)
  assert.equal(details.station, null)
  assert.equal(details.priority, null)
  assert.deepEqual(details.times, {})
  assert.equal(details.attentionReason, null)
  assert.equal(details.error, null)
  assert.equal(details.reprintOf, null)
  assert.equal(JSON.stringify(details).includes('undefined'), false)
  assert.equal(JSON.stringify(details).includes('null'), true)
})

test('print queue opens details from desktop rows and mobile cards, with actions confined to the modal', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /onClick=\{\(\) => setSelectedJob\(operationalJobs\[index\]\)\}/)
  assert.match(page, /<Modal[\s\S]*selectedDetails\.title/)
  assert.match(page, /Fechar/)
  assert.match(page, /DISCARD_ACTIONS\.has\(action\.key\)/)
  const tableRows = page.slice(page.indexOf('<tbody>'), page.indexOf('</tbody>') + '</tbody>'.length)
  assert.doesNotMatch(tableRows, /<Button/)
})

test('print queue modal orders actions by primary, destructive, ticket, close on mobile and close, ticket, destructive, primary on desktop', async () => {
  const [page, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('./print-queue.css'),
  ])

  assert.match(page, /DISCARD_ACTIONS\.has\(action\.key\)/)
  assert.match(page, /!DISCARD_ACTIONS\.has\(action\.key\)/)
  assert.match(styles, /\.print-queue-detail-actions[\s\S]*\.print-queue-detail-close/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-detail-primary[\s\S]*order: 1[\s\S]*\.print-queue-detail-destructive[\s\S]*order: 2[\s\S]*\.print-queue-detail-ticket[\s\S]*order: 3[\s\S]*\.print-queue-detail-close[\s\S]*order: 4/)
})

test('7F-A queue messages use UTF-8 Portuguese strings', async () => {
  const page = await readSource('./PrintQueue.jsx')
  const manager = await readSource('../application/usePrintingManager.js')
  assert.match(page, /Trabalho de impressão descartado/)
  assert.match(page, /Impressão autorizada e enviada para a fila/)
  assert.doesNotMatch(page, /Ãƒ|Ã‚|ï¿½/)
  assert.doesNotMatch(manager, /Ãƒ|Ã‚|ï¿½/)
})

test('7F-B1 keeps reprint and ticket preview in the detail modal, using the immutable job snapshot', async () => {
  const [page, manager, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('../application/usePrintingManager.js'),
    readSource('./print-queue.css'),
  ])

  assert.match(page, /import OrderTicketPreview/)
  assert.match(page, /requestReprint/)
  assert.match(manager, /const requestReprint = useCallback/)
  assert.match(page, /title=\{`Reimprimir \$\{selectedDetails\.title\}`\}/)
  assert.match(page, /\[1, 2\]\.map\(\(copies\)/)
  assert.match(page, /copies === 1 \? 'via' : 'vias'/)
  assert.match(page, /disabled=\{!reprintCopies \|\| actionPending \|\| !isOnline\}/)
  assert.match(page, /Reimpressão adicionada à fila/)
  assert.match(page, /title=\{`Ticket do \$\{selectedDetails\.title\}`\}/)
  assert.match(page, /<OrderTicketPreview document=\{selectedJob\.document\} \/>/)
  assert.doesNotMatch(page, /getPreviewDocument/)
  assert.match(styles, /\.print-queue-detail-ticket \{ order: 3;/)
  assert.match(styles, /\.print-queue-detail-close \{ order: 4;/)
})

test('remote second-copy decisions use their approved toasts and confirmation variants', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /requestSecondCopy: '2ª via enviada para a fila'/)
  assert.match(page, /skipSecondCopy: '2ª via dispensada'/)
  assert.match(page, /confirmation === 'requestSecondCopy' \? 'primary'/)
  assert.match(page, /confirmation === 'skipSecondCopy' \? 'danger'/)
  assert.doesNotMatch(page, /printSecondCopy\(/)
})

test('print queue remains central-API-only for every operational action', async () => {
  const page = await readSource('./PrintQueue.jsx')

  for (const command of ['requestPrintNow', 'requestRetry', 'requestDiscard', 'requestForcePrint', 'requestReprint', 'requestSecondCopy', 'skipSecondCopy']) {
    assert.match(page, new RegExp(`printing\\?\\.${command}`))
  }
  assert.doesNotMatch(page, /printSecondCopy\(|claimPrintJob\(|claimNextPrintJob\(|dispatchRawBt|writeSerialBytes|\bqz\./)
})

test('print queue reads only the paginated main list and summary', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /getPrintJobs\(query, \{ signal: controller\.signal \}\)/)
  assert.match(page, /getPrintQueueSummary\(\{ signal: controller\.signal \}\)/)
  assert.match(page, /pageInfo/)
  assert.doesNotMatch(page, /filterPrintQueueJobs\(jobs/)
})

test('print queue status filter exposes operational follow-up plus retained terminal history', () => {
  assert.deepEqual(PRINT_QUEUE_STATUS_FILTERS.map(({ value, label }) => ({ value, label })), [
    { value: 'all', label: 'Todos' },
    { value: 'queued', label: 'Na fila' },
    { value: 'waiting_station', label: 'Aguardando estação' },
    { value: 'printing', label: 'Imprimindo' },
    { value: 'waiting_confirmation', label: 'Aguardando confirmação' },
    { value: 'waiting_second_copy', label: 'Aguardando 2ª via' },
    { value: 'attention', label: 'Requer atenção' },
    { value: 'printed', label: 'Impresso' },
    { value: 'discarded', label: 'Descartado' },
  ])
})

test('main panel exposes sortable backend columns and page-aware mobile cards without a recent section', async () => {
  const [page, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('./print-queue.css'),
  ])

  for (const label of ['Pedido', 'Job', 'Status', 'Origem', 'Data/Hora']) assert.match(page, new RegExp(label))
  assert.doesNotMatch(page, /Impressões recentes/)
  assert.match(page, /aria-sort/)
  assert.match(page, /togglePrintQueueSort/)
  assert.match(page, /operationalJobs\.map/)
  assert.doesNotMatch(page, /recentJobs/)
  assert.doesNotMatch(styles, /print-queue-recent-section|print-queue-recent-row/)
  assert.match(styles, /print-queue-pagination/)
})

test('print queue identifies and sorts consolidated comandas from their immutable document', () => {
  const comanda = {
    id: 'comanda-42', type: 'table-tab', tableTabId: 'tab-42', trigger: 'manual', status: 'pending',
    copiesRequested: 1, copiesPrinted: 0,
    document: { type: 'table-tab', tableTab: { id: 'tab-42', number: 42, tableName: 'Mesa 7' } },
  }
  const details = getPrintJobDetails(comanda)
  assert.equal(details.title, 'Comanda #42')
  assert.equal(details.identity, 'Mesa 7')
  assert.deepEqual(sortPrintQueueJobsForDisplay([
    comanda,
    { ...comanda, id: 'comanda-7', document: { type: 'table-tab', tableTab: { id: 'tab-7', number: 7, tableName: 'Varanda' } } },
  ], { sortBy: 'orderNumber', sortDir: 'asc' }).map((job) => job.id), ['comanda-7', 'comanda-42'])
})

test('clicking a column header immediately reorders the displayed jobs even when the backend response order is stale', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  const jobs = [
    { id: 'job-72', orderId: 'order-72', status: 'pending', trigger: 'automatic', copiesRequested: 1, copiesPrinted: 0, createdAt: '2026-09-10T22:42:00.000Z', document: { type: 'order', customer: {}, order: { id: 'order-72' } } },
    { id: 'job-71', orderId: 'order-71', status: 'pending', trigger: 'automatic', copiesRequested: 1, copiesPrinted: 0, createdAt: '2026-09-10T22:41:00.000Z', document: { type: 'order', customer: {}, order: { id: 'order-71' } } },
  ]
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs, pageInfo: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 2, awaitingConfirmation: 0, awaitingSecondCopy: 0, attention: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  function ControlledPrintQueue(props) {
    const [queryState, setQueryState] = useState(() => ({ ...DEFAULT_PRINT_QUEUE_QUERY }))
    return React.createElement(PrintQueue, { ...props, queryState, onQueryChange: setQueryState })
  }

  const renderer = await harness.render(ControlledPrintQueue, {
    orders: [{ id: 'order-72', orderNumber: 72 }, { id: 'order-71', orderNumber: 71 }],
    printing: { localStation: null, printerHealth: { state: 'verifying' }, stations: [] },
  })
  const displayedOrders = () => renderer.root.findAllByProps({ className: 'print-queue-job-row' })
    .map((row) => nodeText(row).match(/Pedido #\d+/)?.[0])
  assert.deepEqual(displayedOrders(), ['Pedido #72', 'Pedido #71'])

  const orderHeader = renderer.root.findAllByProps({ className: 'print-queue-sort' })[0]
  await act(async () => { orderHeader.props.onClick(); await Promise.resolve(); await Promise.resolve() })
  await act(async () => { orderHeader.props.onClick(); await Promise.resolve(); await Promise.resolve() })

  assert.deepEqual(displayedOrders(), ['Pedido #71', 'Pedido #72'])
})

test('operational summary and unknown physical outcome use the approved safety language', () => {
  assert.deepEqual(buildPrintQueueSummary([
    { status: 'pending' },
    { status: 'awaiting_confirmation' },
    { status: 'awaiting_second_copy' },
    { status: 'requires_attention' },
  ]), {
    pending: 1,
    awaitingConfirmation: 1,
    waitingSecondCopy: 1,
    attention: 1,
    discardable: 3,
  })

  const details = getPrintJobDetails({
    status: 'requires_attention',
    lastError: { code: 'PRINT_OUTCOME_UNKNOWN' },
  })
  assert.deepEqual(details.unknownOutcome, {
    title: 'Não foi possível confirmar esta impressão',
    message: 'Esta via pode ter sido impressa antes de a conexão ser interrompida.',
    duplicateRisk: 'Reenviar pode gerar uma impressão duplicada.',
  })
})


test('print queue exposes retained terminal history through printed and discarded filters', () => {
  assert.ok(PRINT_QUEUE_STATUS_FILTERS.some(({ value, label }) => value === 'printed' && label === 'Impresso'))
  assert.ok(PRINT_QUEUE_STATUS_FILTERS.some(({ value, label }) => value === 'discarded' && label === 'Descartado'))
})

test('print queue blocks server mutations while offline with friendly Portuguese feedback', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /isOnline = true/)
  assert.match(page, /Você está offline\. Reconecte para alterar a fila de impressão\./)
  assert.match(page, /!isOnline/)
})

test('print queue opens the exact job requested by the global recovery notice', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /reviewJobId/)
  assert.match(page, /printing\?\.jobs[\s\S]*job\?\.id === reviewJobId/)
  assert.match(page, /setSelectedJob\(target\)/)
  assert.match(page, /onReviewJobConsumed\?\.\(reviewJobId\)/)
})

test('print queue refreshes the selected job snapshot so unknown-attempt actions use current server data', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /setSelectedJob\(\(current\) => current \? nextPage\.jobs\.find\(\(job\) => job\?\.id === current\.id\) \?\? current : null\)/)
})

test('print queue debounces search input and aborts stale panel reads', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /SEARCH_DEBOUNCE_MS = 300/)
  assert.match(page, /searchInput/)
  assert.match(page, /AbortController/)
  assert.match(page, /refreshAbortRef\.current\?\.abort\(\)/)
  assert.match(page, /getPrintJobs\([^\n]+\{ signal:/)
  assert.match(page, /getPrintQueueSummary\(\{ signal:/)
})

test('print queue actions skip manager refresh because the panel refreshes once itself', async () => {
  const page = await readSource('./PrintQueue.jsx')
  for (const command of [
    'requestPrintNow', 'requestRetry', 'requestDiscard', 'requestForcePrint',
    'requestSecondCopy', 'skipSecondCopy',
  ]) {
    assert.match(page, new RegExp(`${command}\\?\\.\\(selectedJob, \\{ refreshManager: false \\}\\)`))
  }
  assert.match(page, /confirmUnknownPrinted\?\.\(selectedJob, getUnknownAttempt\(selectedJob\)\)/)
  assert.match(page, /confirmUnknownNotPrinted\?\.\(selectedJob, getUnknownAttempt\(selectedJob\)\)/)
  assert.match(page, /requestReprint\?\.\(selectedJob, reprintCopies, \{ refreshManager: false \}\)/)
})


test('print queue warms adjacent pages so pagination can render cached jobs immediately', async () => {
  const page = await readSource('./PrintQueue.jsx')
  assert.match(page, /pageCacheRef/)
  assert.match(page, /prefetchAdjacentPages/)
  assert.match(page, /pageInfo\.totalPages/)
  assert.match(page, /cacheKeyForQuery/)
})


test('task 2 queue source replaces local-station health with the shared operational projection', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /derivePrintOperationalStatus/)
  assert.match(page, /buildPrintOperationalView/)
  assert.match(page, /print-queue-operational-card/)
  assert.doesNotMatch(page, /Cozinha PC/)
  assert.doesNotMatch(page, /getPrintStationSummary/)
  assert.doesNotMatch(page, /print-queue-station-card/)
  assert.doesNotMatch(page, /!physicalReady && summary\.pending > 0/)
  for (const label of ['Aguardando impressão', 'Aguardando confirmação', 'Aguardando 2ª via', 'Requer atenção']) {
    assert.match(page, new RegExp(label))
  }
})

test('queue-only Android renders the healthy Windows primary instead of local QZ/offline state', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 3, awaitingConfirmation: 0, waitingSecondCopy: 0, attention: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  function ControlledPrintQueue(props) {
    const [queryState, setQueryState] = useState(() => ({ ...DEFAULT_PRINT_QUEUE_QUERY }))
    return React.createElement(PrintQueue, { ...props, queryState, onQueryChange: setQueryState })
  }

  const android = {
    id: 'android-secondary',
    name: 'PC Victor',
    platform: 'android',
    isPrimary: false,
    health: { online: false, qzReady: false, printerReady: false, ready: false },
  }
  const primary = {
    id: 'windows-primary',
    name: 'Cozinha Windows',
    platform: 'windows',
    isPrimary: true,
    physicalState: 'ready',
    health: { online: true, qzReady: true, printerReady: true, ready: true },
  }
  const renderer = await harness.render(ControlledPrintQueue, {
    printing: {
      localStation: android,
      stations: [android, primary],
      transportKind: 'queue-only',
      printerState: 'unsupported',
      qzConnected: false,
      configuredPrinterName: null,
      printerQueueFound: false,
      printerHealth: { state: 'verifying', ready: false },
    },
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const textContent = nodeText(renderer.root)

  assert.match(textContent, /Impressão disponível/)
  assert.match(textContent, /Gerenciada pela estação Cozinha Windows/)
  assert.doesNotMatch(textContent, /QZ desconectado|Offline|Fila indisponível/)
})

test('remote primary offline with pending jobs explains the operational impact', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 3, awaitingConfirmation: 0, waitingSecondCopy: 0, attention: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  function ControlledPrintQueue(props) {
    const [queryState, setQueryState] = useState(() => ({ ...DEFAULT_PRINT_QUEUE_QUERY }))
    return React.createElement(PrintQueue, { ...props, queryState, onQueryChange: setQueryState })
  }

  const local = { id: 'android-secondary', name: 'PC Victor', platform: 'android', isPrimary: false }
  const primary = {
    id: 'windows-primary',
    name: 'Cozinha Windows',
    platform: 'windows',
    isPrimary: true,
    health: { online: false, qzReady: false, printerReady: false, ready: false },
  }
  const renderer = await harness.render(ControlledPrintQueue, {
    printing: {
      localStation: local,
      stations: [local, primary],
      transportKind: 'queue-only',
      printerHealth: { state: 'verifying', ready: false },
    },
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const textContent = nodeText(renderer.root)

  assert.match(textContent, /Estação de impressão indisponível/)
  assert.match(textContent, /3 trabalhos aguardando a estação voltar/)
})


test('task 3 mobile hierarchy keeps operational status, summary emphasis and settings action queue-scoped', async () => {
  const [page, styles] = await Promise.all([
    readSource('./PrintQueue.jsx'),
    readSource('./print-queue.css'),
  ])

  assert.match(page, /className=\{\`print-queue-summary-card/)
  assert.match(page, /is-zero/)
  assert.match(page, /has-value/)
  assert.match(page, /has-attention/)
  assert.match(page, /aria-label="Configurações, Impressão"/)

  assert.match(styles, /\.print-queue-page\s*\{[^}]*max-width:\s*100%/)
  assert.match(styles, /\.print-queue-operational-card\s*\{/)
  for (const tone of ['success', 'warning', 'danger', 'neutral']) {
    assert.match(styles, new RegExp(`\\.print-queue-operational-card\\.is-${tone}`))
  }
  assert.match(styles, /\.print-queue-summary-card\.is-zero/)
  assert.match(styles, /\.print-queue-summary-card\.has-attention/)
  assert.match(styles, /\.print-queue-summary-card \.stat-copy strong\s*\{[^}]*order:\s*-1/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-page > \.page-header\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 40px/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-page > \.page-header \.page-actions \.print-queue-settings-button\s*\{[^}]*width:\s*40px/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.print-queue-summary\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)

  assert.doesNotMatch(styles, /\.print-queue-station-card/)
  assert.doesNotMatch(styles, /\.print-queue-offline-banner/)
  assert.doesNotMatch(styles, /(^|\n)\.page-actions \.button\s*\{[^}]*width:\s*40px/m)
})


test('task 5 preserves recovery controls, offline mutation guard, capabilities and terminal history', async () => {
  const page = await readSource('./PrintQueue.jsx')

  assert.match(page, /Recuperação de impressão em andamento/)
  assert.match(page, /runRecoveryAction\('resume'\)/)
  assert.match(page, /runRecoveryAction\('next'\)/)
  assert.match(page, /Você está offline\. Reconecte para alterar a fila de impressão\./)
  assert.match(page, /EXECUTE_ACTIONS/)
  assert.match(page, /DISCARD_ACTIONS/)
  assert.match(page, /canExecutePrinting/)
  assert.match(page, /canDiscardPrinting/)
  assert.ok(PRINT_QUEUE_STATUS_FILTERS.some(({ value, label }) => value === 'printed' && label === 'Impresso'))
  assert.ok(PRINT_QUEUE_STATUS_FILTERS.some(({ value, label }) => value === 'discarded' && label === 'Descartado'))
})

test('task 5 settings shortcut remains a real accessible button with queue-scoped semantics', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 0, awaitingConfirmation: 0, waitingSecondCopy: 0, attention: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }
  let opens = 0
  const renderer = await harness.render(PrintQueue, {
    orders: [],
    printing: { localStation: null, stations: [], printerHealth: { state: 'verifying' } },
    onOpenPrintingSettings: () => { opens += 1 },
    queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
    onQueryChange() {},
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const button = renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === 'Configurações, Impressão')
  assert.ok(button)
  assert.equal(button.props.type, 'button')
  assert.equal(typeof button.props.onClick, 'function')
  await act(async () => button.props.onClick())
  assert.equal(opens, 1)

  const text = nodeText(renderer.root)
  assert.doesNotMatch(text, /\bundefined\b|\bnull\b/)
  assert.match(text, /Estação de impressão não configurada/)
})


test('QA regression: server awaitingSecondCopy summary renders an explicit zero for the second-copy card', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 3, awaitingConfirmation: 0, awaitingSecondCopy: 0, attention: 8 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  const renderer = await harness.render(PrintQueue, {
    orders: [],
    printing: { localStation: null, stations: [], printerHealth: { state: 'verifying' } },
    queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
    onQueryChange() {},
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const summaryCards = renderer.root.findAll((node) => typeof node.props?.className === 'string' && node.props.className.includes('print-queue-summary-card'))
  const secondCopyCard = summaryCards.find((card) => nodeText(card).includes('AGUARDANDO 2ª VIA') || nodeText(card).includes('Aguardando 2ª via'))
  assert.ok(secondCopyCard)
  assert.match(nodeText(secondCopyCard), /0/)
})


test('bulk discard button confirms, respects discard capability and reports retained unsafe jobs', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  let bulkCalls = 0
  const toasts = []
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return {
      ok: true,
      json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
    }
    if (url === '/api/printing/jobs/summary') return {
      ok: true,
      json: async () => ({ summary: { pending: 3, awaitingConfirmation: 1, awaitingSecondCopy: 2, attention: 2, discardable: 6 } }),
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const renderer = await harness.render(PrintQueue, {
    orders: [],
    printing: {
      localStation: null,
      stations: [],
      printerHealth: { state: 'verifying' },
      requestDiscardPendingJobs: async () => {
        bulkCalls += 1
        return { jobs: [], discardedCount: 6, retainedCount: 2 }
      },
    },
    onToast: (message) => toasts.push(message),
    queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
    onQueryChange() {},
    canDiscardPrinting: true,
    isOnline: true,
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const bulkButton = renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Descartar pendências'))
  assert.ok(bulkButton)
  assert.equal(bulkButton.props.disabled, false)

  await act(async () => bulkButton.props.onClick())
  assert.match(nodeText(renderer.root), /Descartar pendências da fila\?/)
  assert.equal(bulkCalls, 0)

  const confirm = buttonNamed(renderer.root.findByProps({ role: 'dialog' }), 'Descartar pendências')
  assert.ok(confirm)
  await act(async () => { await confirm.props.onClick(); await Promise.resolve(); await Promise.resolve() })

  assert.equal(bulkCalls, 1)
  assert.ok(toasts.some((message) => String(message).includes('6 trabalhos descartados') && String(message).includes('2 mantidos')))
})

test('bulk discard button is disabled without printing.discard or while offline', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return { ok: true, json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }) }
    if (url === '/api/printing/jobs/summary') return { ok: true, json: async () => ({ summary: { pending: 1, awaitingConfirmation: 0, awaitingSecondCopy: 0, attention: 0 } }) }
    throw new Error(`Unexpected request: ${url}`)
  }

  for (const props of [
    { canDiscardPrinting: false, isOnline: true },
    { canDiscardPrinting: true, isOnline: false },
  ]) {
    const renderer = await harness.render(PrintQueue, {
      orders: [],
      printing: { localStation: null, stations: [], printerHealth: { state: 'verifying' } },
      queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
      onQueryChange() {},
      ...props,
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const button = renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Descartar pendências'))
    assert.ok(button)
    assert.equal(button.props.disabled, true)
    await act(async () => renderer.unmount())
  }
})


test('bulk discard stays disabled when attention exists but the server marks every job unsafe to discard', async (t) => {
  const harness = await workspaceHarness(t)
  const { default: PrintQueue } = await harness.load('/src/domains/printing/ui/PrintQueue.jsx')
  globalThis.fetch = async (path) => {
    const url = String(path)
    if (url.startsWith('/api/printing/jobs?')) return {
      ok: true,
      json: async () => ({ jobs: [], pageInfo: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
    }
    if (url === '/api/printing/jobs/summary') return {
      ok: true,
      json: async () => ({ summary: { pending: 0, awaitingConfirmation: 0, awaitingSecondCopy: 0, attention: 1, discardable: 0 } }),
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const renderer = await harness.render(PrintQueue, {
    orders: [],
    printing: { localStation: null, stations: [], printerHealth: { state: 'verifying' } },
    queryState: { ...DEFAULT_PRINT_QUEUE_QUERY },
    onQueryChange() {},
    canDiscardPrinting: true,
    isOnline: true,
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const button = renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Descartar pendências'))
  assert.ok(button)
  assert.equal(button.props.disabled, true)
})

test('realtime print queue refreshes the official panel without starting print actions or ten-second polling',async t=>{
  const h=await workspaceHarness(t),listeners=new Set(),actions=[]
  const realtime={state:'live',subscribeInvalidations(fn){listeners.add(fn);return()=>listeners.delete(fn)}}
  let reads=0
  globalThis.fetch=async path=>({ok:true,json:async()=>String(path).includes('/summary')?{summary:{active:0}}:(reads++,{jobs:[],pageInfo:{page:1,pageSize:10,totalItems:0,totalPages:1}})})
  const {default:PrintQueue}=await h.load('/src/domains/printing/ui/PrintQueue.jsx')
  await h.render(PrintQueue,{orders:[],realtime,printing:{stations:[],requestRetry:()=>actions.push('retry'),requestPrintNow:()=>actions.push('print')},queryState:{...DEFAULT_PRINT_QUEUE_QUERY},onQueryChange(){}})
  await act(async()=>{});const initial=reads
  await act(async()=>h.fireInterval(10000));assert.equal(reads,initial)
  await act(async()=>Promise.all([...listeners].map(fn=>fn({topics:['printing'],orderIds:[],requiresFullRefresh:false}))))
  assert.equal(reads,initial+1);assert.deepEqual(actions,[])
})
