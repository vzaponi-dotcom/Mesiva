import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import viteConfig from '../../vite.config.js'

const productionFiles = [
  'KitchenDisplayRoot.jsx', 'KitchenDisplayApp.jsx', 'KitchenDisplayBoard.jsx', 'KitchenDisplayCard.jsx',
  'kitchenDisplayApi.js', 'kitchenDisplayAudio.js', 'kitchenDisplayPresentation.js', 'kitchenDisplaySession.js',
  'kitchenDisplayPaging.js', 'kitchenDisplayLegacyCompat.js', 'kitchenDisplayFullscreen.js',
]

test('Kitchen TV production source stays read-only and isolated behind public boundaries', async () => {
  const sources = await Promise.all(productionFiles.map(async (file) => [file, await readFile(new URL(file, import.meta.url), 'utf8')]))
  const combined = sources.map(([, source]) => source).join('\n')
  assert.match(combined, /domains\/orders\/index\.js/)
  assert.doesNotMatch(combined, /domains\/orders\/(?:domain|application|infrastructure|ui)\//)
  assert.doesNotMatch(combined, /domains\/(?:printing|finance|customers|catalog|table-service)\//)
  assert.doesNotMatch(combined, /(?:from\s+['"]\.\.\/App\.jsx|AdminBootstrap|qz-tray|jspdf|app\/surfaces\/settings)/)
  assert.doesNotMatch(combined, /\/api\/bootstrap|\/api\/orders|\/api\/printing|\/api\/settings/)

  const api = sources.find(([file]) => file === 'kitchenDisplayApi.js')[1]
  assert.deepEqual([...api.matchAll(/['"](\/api\/[^'"]+)['"]/g)].map((match) => match[1]).sort(), [
    '/api/kitchen-tv/pairing-request', '/api/kitchen-tv/pairing-status', '/api/kitchen-tv/realtime', '/api/kitchen-tv/report', '/api/kitchen-tv/state',
  ])
})

test('production build keeps the TV route graph free of admin and heavy business chunks', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'kitchen-tv-build-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))
  await build({ ...viteConfig, logLevel: 'silent', build: { ...viteConfig.build, outDir, emptyOutDir: true, manifest: true } })
  const manifest = JSON.parse(await readFile(join(outDir, '.vite', 'manifest.json'), 'utf8'))
  const rootKey = Object.keys(manifest).find((key) => key.endsWith('src/kitchen-display/KitchenDisplayRoot.jsx'))
  assert.ok(rootKey, 'dedicated Kitchen TV entry must exist')

  const reachable = new Set()
  const visit = (key) => {
    if (!key || reachable.has(key)) return
    reachable.add(key)
    for (const dependency of [...(manifest[key]?.imports || []), ...(manifest[key]?.dynamicImports || [])]) visit(dependency)
  }
  visit(rootKey)
  const forbidden = [...reachable].filter((key) => {
    const normalized = key.toLowerCase()
    return normalized.includes('adminbootstrap')
      || normalized.includes('domains/orders/ui')
      || normalized.includes('domains/printing')
      || normalized.includes('domains/finance')
      || normalized.includes('domains/customers')
      || normalized.includes('domains/catalog')
      || normalized.includes('domains/table-service')
      || normalized.includes('qz-tray')
      || normalized.includes('jspdf')
  })
  assert.deepEqual(forbidden, [])
  for (const key of reachable) {
    if (manifest[key]?.name !== 'kitchenQueue') continue
    assert.deepEqual(manifest[key].css || [], [])
    assert.equal((manifest[key].imports || []).some((dependency) => /react-dom/i.test(dependency)), false)
  }
  assert.ok(viteConfig.plugins.some((plugin) => plugin?.name === 'kitchen-tv-orders-public-contract'))
  assert.equal(viteConfig.build.target, 'chrome69')
  assert.equal(viteConfig.build.cssTarget, 'chrome69')
})


test('smaller Smart TV viewports stay scroll-free without a 1280px floor', async () => {
  const css = await readFile(new URL('./kitchen-display.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /min-width:\s*1280px/)
  assert.match(css, /html, body, #root \{[^}]*min-width:\s*0/s)
  assert.match(css, /@media \(max-width: 1279px\)/)
  assert.match(css, /@media \(max-width: 960px\), \(max-height: 600px\)/)
  assert.match(css, /\.kds-pairing-card \{[^}]*width:\s*min\(720px, calc\(100vw - 28px\)\)/s)
})


test('kitchen card typography and chef icon remain readable on compact TVs', async () => {
  const css = await readFile(new URL('./kitchen-display.css', import.meta.url), 'utf8')
  const iconSource = await readFile(new URL('../shared/ui/Icon.jsx', import.meta.url), 'utf8')
  assert.match(css, /--kds-item-size:\s*clamp\(1\.02rem, 1\.28vw, 1\.5rem\)/)
  assert.match(css, /@media \(max-width: 960px\), \(max-height: 600px\)[\s\S]*--kds-item-size:\s*clamp\(\.82rem, 1\.62vw, \.94rem\)/)
  assert.match(css, /\.kds-brand__icon svg \{\s*overflow:\s*visible;/)
  assert.match(iconSource, /'chef-hat':[\s\S]*M6\.5 10\.5/)
})


test('customer hierarchy and explicit start action remain visible', async () => {
  const css = await readFile(new URL('./kitchen-display.css', import.meta.url), 'utf8')
  assert.match(css, /--kds-customer:\s*#c5d8ea/)
  assert.match(css, /--kds-divider:\s*rgba\(201, 216, 232, \.38\)/)
  assert.match(css, /\.kds-card__customer \{[^}]*color:\s*var\(--kds-customer\)/s)
  assert.match(css, /\.kds-card__main \{[^}]*border-bottom:\s*1px solid var\(--kds-divider\)/s)
  assert.match(css, /\.kds-start-card button,/)
})
