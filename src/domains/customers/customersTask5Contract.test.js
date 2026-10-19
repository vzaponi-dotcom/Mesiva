import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const fileUrl = (relativePath) => new URL(relativePath, import.meta.url)
const source = (relativePath) => readFileSync(fileUrl(relativePath), 'utf8')

test('Task 5 exposes a public CustomersWorkspace that owns customer composition', () => {
  assert.equal(existsSync(fileUrl('./ui/CustomersWorkspace.jsx')), true)

  const publicEntry = source('./index.js')
  const surfaces = source('./ui/customerSurfaces.js')
  const workspace = source('./ui/CustomersWorkspace.jsx')

  assert.match(publicEntry, /CustomersWorkspace/)
  assert.match(surfaces, /CustomersWorkspace/)

  for (const token of [
    'useCustomerCommands',
    'useCustomerEditor',
    '<Clients',
    '<CustomerEditorDialog',
    '<ClientDuplicateModal',
    'applyOfficialEffects',
    'setRequestKey',
    'onSuccess',
    'onError',
    'onDuplicatePhone',
  ]) {
    assert.equal(workspace.includes(token), true, token)
  }

  assert.match(workspace, /closeIfEditing/)
  assert.match(source('./ui/Clients.jsx'), /filterAndSortClients/)
})

test('Task 5 removes customer list/editor/CRUD composition ownership from App', () => {
  const app = source('../../App.jsx')

  for (const token of [
    'filterAndSortClients',
    'useCustomerEditor',
    'ClientDuplicateModal',
    'CustomerEditorDialog',
    'customerEditor',
    'handleDeleteClient',
  ]) {
    assert.equal(app.includes(token), false, token)
  }

  assert.match(app, /CustomersWorkspace/)
  assert.doesNotMatch(app, /updateCollection\(['"]clients['"]/)
})

test('Task 5 keeps capability and navigation query ownership in App while injecting runtime dependencies', () => {
  const app = source('../../App.jsx')

  assert.match(app, /query\.clients\.search/)
  assert.match(app, /query\.clients\.sort/)
  assert.match(app, /patchQuery\(['"]clients['"]/)
  assert.match(app, /applyOfficialEffects/)
  assert.match(app, /setRequestKey/)
  assert.match(app, /showSuccessMessage/)
  assert.match(app, /showApiError/)
  assert.match(app, /showWarningMessage/)
})
