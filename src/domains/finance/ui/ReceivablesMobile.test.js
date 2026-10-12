import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('receivables ledger keeps comfortable touch targets and wraps mobile filters inside the card', async () => {
  const css = await read('../../../receivables.css')

  assert.match(css, /\.receivable-ledger-row\s*\{[^}]*min-height:\s*(?:44px|[4-9]\dpx)/s)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-filter-strip\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*overflow-x:\s*visible/s)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-filter-strip button\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%[^}]*white-space:\s*nowrap/s)
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.receivable-ledger-table-action\s*\{[^}]*min-height:\s*44px/s)
})

test('receivables ledger labels and order summaries wrap instead of clipping at narrow widths', async () => {
  const css = await read('../../../receivables.css')

  assert.match(css, /\.receivable-ledger-main strong\s*\{[^}]*overflow-wrap:\s*anywhere/s)
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.receivable-ledger-main > span[^}]*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s)
})

test('shared modal footer stacks safely on mobile', async () => {
  const foundation = await read('../../../mobile-foundation.css')

  assert.match(foundation, /@media\s*\(max-width:\s*640px\)[\s\S]*\.modal-footer\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr/s)
  assert.match(foundation, /\.modal-footer \.button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*48px/s)
})

test('ordinary payment flow keeps the shared modal composition and select architecture', async () => {
  const dialog = await read('../../../app/workflows/payments/order/OrderPaymentDialog.jsx')
  const editor = await read('../../../app/workflows/payments/PaymentCompositionEditor.jsx')

  assert.match(dialog, /<Modal title=\{dialog\.supplemental \? 'Receber saldo complementar' : 'Registrar pagamento'\}[\s\S]*<PaymentCompositionEditor/)
  assert.match(editor, /<SystemSelect[\s\S]*label=\{label\}/)
})

test('receivables mobile detail reuses the portal-backed shared BottomSheet', async () => {
  const page = await read('./Receivables.jsx')
  const sheet = await read('../../../shared/ui/BottomSheet.jsx')

  assert.match(page, /import BottomSheet/)
  assert.match(page, /<BottomSheet[\s\S]*Detalhes do recebimento/)
  assert.match(sheet, /createPortal/)
  assert.match(sheet, /role="dialog"/)
})

test('quick payment FAB stays above the mobile navigation and safe area', async () => {
  const css = await read('../../../receivables.css')
  const page = await read('./Receivables.jsx')

  assert.match(page, /className="receivables-payment-fab"/)
  assert.match(page, /aria-label="Registrar recebimento"/)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-payment-fab\s*\{[^}]*position:\s*fixed[^}]*right:\s*var\(--mobile-page-inline\)[^}]*bottom:\s*calc\(var\(--mobile-bottom-nav-height\)\s*\+\s*var\(--mobile-safe-bottom\)\s*\+\s*var\(--mobile-floating-gap\)\)[^}]*z-index:\s*var\(--layer-floating-action\)[^}]*min-height:\s*48px/s)
  assert.match(css, /@media\s*\(min-width:\s*821px\)[\s\S]*\.receivables-payment-fab\s*\{[^}]*display:\s*none/s)
})

test('receivables hardens desktop detail, money wrapping, focus and reduced motion', async () => {
  const css = await read('../../../receivables.css')

  assert.match(css, /@media\s*\(min-width:\s*960px\)[\s\S]*\.receivables-detail-panel\s*\{[^}]*position:\s*sticky[^}]*max-height:\s*calc\(100dvh\s*-\s*36px\)[^}]*overflow-y:\s*auto/s)
  assert.match(css, /\.receivable-ledger-amount\s*\{[^}]*white-space:\s*nowrap/s)
  assert.match(css, /\.receivable-ledger-row:focus-visible[\s\S]*\.receivables-summary-card:focus-visible[\s\S]*\.receivables-filter-strip button:focus-visible[\s\S]*\.receivables-payment-fab:focus-visible[\s\S]*\.receivables-forecast-row:focus-visible\s*\{/s)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.receivable-ledger-row[\s\S]*\.receivables-summary-card[\s\S]*\.receivables-payment-fab[\s\S]*\.receivables-forecast-bar[\s\S]*transition:\s*none\s*!important/s)
})


test('client grouped receivables expand orders inline on mobile and keep checkbox targets usable', async () => {
  const group = await read('./ReceivableClientGroup.jsx')
  const css = await read('../../../receivables.css')

  assert.match(group, /receivable-client-inline-orders/)
  assert.match(group, /type="checkbox"/)
  assert.match(group, /onToggleOrder/)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivable-client-inline-orders\s*\{[^}]*display:\s*grid/s)
  assert.match(css, /\.receivable-client-order-select\s*\{[^}]*min-height:\s*(?:44px|4[4-9]px|[5-9]\dpx)/s)
})

test('mobile client selection bar stays above bottom navigation and exposes count total and receive action', async () => {
  const page = await read('./Receivables.jsx')
  const css = await read('../../../receivables.css')

  assert.match(page, /className="receivables-client-selection-bar"/)
  assert.match(page, /clientSelection\.selectedCount/)
  assert.match(page, /selectedClientTotal/)
  assert.match(page, />\s*Receber\s*</)
  assert.match(page, /!overlayOpen/)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-client-selection-bar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(var\(--mobile-bottom-nav-height\)\s*\+\s*var\(--mobile-safe-bottom\)\s*\+\s*var\(--mobile-floating-gap\)\)[^}]*z-index:\s*var\(--layer-floating-action\)/s)
  assert.match(css, /\.receivables-client-selection-bar \.button\s*\{[^}]*min-height:\s*48px/s)
})

test('desktop client panel is hidden on mobile while inline group details remain visible', async () => {
  const css = await read('../../../receivables.css')
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-client-panel\s*\{[^}]*display:\s*none/s)
  assert.match(css, /@media\s*\(min-width:\s*821px\)[\s\S]*\.receivable-client-inline-orders\s*\{[^}]*display:\s*none/s)
})

test('mobile grouped receivables reserve scroll space for the sticky selection bar and prevent horizontal overflow', async () => {
  const page = await read('./Receivables.jsx')
  const css = await read('../../../receivables.css')

  assert.match(page, /receivables-client-list.*has-selection/s)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-client-list\.has-selection\s*\{[^}]*padding-bottom:/s)
  assert.match(css, /\.receivable-client-card\s*\{[^}]*max-width:\s*100%/s)
  assert.match(css, /\.receivables-client-selection-bar\s*\{[^}]*box-sizing:\s*border-box/s)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.receivable-client-card-header[\s\S]*\.receivables-client-selection-bar[\s\S]*transition:\s*none\s*!important/s)
})



test('mobile receivables summary currency stays inside narrow cards', async () => {
  const css = await read('../../../receivables.css')

  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-summary-card\s*\{[^}]*grid-template-columns:\s*32px\s+minmax\(0,\s*1fr\)[^}]*padding:\s*12px\s+10px/s)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-summary-icon\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivables-summary-card strong\s*\{[^}]*max-width:\s*100%[^}]*font-size:\s*clamp\([^}]*white-space:\s*nowrap/s)
})


test('mobile grouped orders keep payment promise action touch-friendly without nesting it inside the checkbox label', async () => {
  const group = await read('./ReceivableClientGroup.jsx')
  const css = await read('../../../receivables.css')

  assert.match(group, /className="receivable-client-promise-action"/)
  assert.match(group, /<div className="receivable-client-order-select"/)
  assert.doesNotMatch(group, /<label className="receivable-client-order-select"[\s\S]*receivable-client-promise-action/)
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*\.receivable-client-promise-action\s*\{[^}]*min-height:\s*44px/s)
})
