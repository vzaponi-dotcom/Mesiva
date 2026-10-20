import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('touch feedback does not depend on hover', async () => {
  const interactions = await read('./mobile-interactions.css')
  const indexCss = await read('./index.css')

  assert.match(indexCss, /@import '\.\/mobile-interactions\.css'/)
  assert.match(interactions, /@media\s*\(hover:\s*none\)/)
  assert.match(interactions, /\.button:active/)
})

test('mobile toast is viewport anchored and cannot stretch between top and bottom', async () => {
  const appRoot = await read('./app/shell/AppRoot.jsx')
  const foundation = await read('./mobile-foundation.css')
  const interactions = await read('./mobile-interactions.css')
  const feedbackCss = await read('./shared/ui/toast-feedback.css')

  assert.match(appRoot, /import\s+\{\s*createPortal\s*\}\s+from\s+'react-dom'/)
  assert.match(appRoot, /const portal = .*createPortal\(node, document\.body\)/)
  assert.match(appRoot, /ToastRegion/)
  assert.match(feedbackCss, /@media\s*\(max-width:\s*640px\)[\s\S]*\.toast-region\s*\{[^}]*top:\s*calc\(70px/s)
  assert.doesNotMatch(foundation, /\.toast-region\s*\{[^}]*bottom:/s)
  assert.doesNotMatch(interactions, /\.toast-region\s*\{[^}]*bottom:/s)
  assert.match(feedbackCss, /z-index:\s*var\(--layer-toast/)
})

test('reduced motion remains available for mobile transitions', async () => {
  const nav = await read('./mobile-navigation.css')
  assert.match(nav, /prefers-reduced-motion:\s*reduce/)
  assert.match(nav, /animation:\s*none/)
})
