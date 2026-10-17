import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useCustomerEditor } from './useCustomerEditor.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const clients = [
  { id: 'ana', name: 'Ana Souza', phone: '(11) 99999-9999', address: 'Centro' },
  { id: 'maria', name: 'Maria Silva', phone: '(11) 98888-8888', address: 'Jardim' },
]

async function mount(overrides = {}) {
  let current
  const calls = {
    created: [],
    updated: [],
    duplicatePhone: [],
    usedExisting: [],
  }
  const props = {
    clients,
    canCreateClients: true, canUpdateClients: true, canDeleteClients: true,
    writesBlocked: false,
    createClient: async (payload) => { calls.created.push(payload); return { id: 'new', ...payload } },
    updateClient: async (id, payload) => { calls.updated.push({ id, payload }); return { id, ...payload } },
    onDuplicatePhone: (message) => calls.duplicatePhone.push(message),
    onUseExistingClient: (client) => calls.usedExisting.push(client),
    ...overrides,
  }
  function Probe() {
    current = useCustomerEditor(props)
    return null
  }
  let renderer
  await act(async () => { renderer = create(React.createElement(Probe)) })
  return { get editor() { return current }, calls, renderer }
}

test('new editor opens blank and edit preloads the existing customer', async () => {
  const h = await mount()

  await act(async () => { h.editor.openNewClient() })
  assert.equal(h.editor.isOpen, true)
  assert.equal(h.editor.editingClientId, null)
  assert.deepEqual(h.editor.draft, { name: '', phone: '', address: '' })

  await act(async () => { h.editor.editClient(clients[0]) })
  assert.equal(h.editor.isOpen, true)
  assert.equal(h.editor.editingClientId, 'ana')
  assert.deepEqual(h.editor.draft, { name: 'Ana Souza', phone: '(11) 99999-9999', address: 'Centro' })

  h.renderer.unmount()
})

test('normal editor payload trims name and preserves current blank phone/address semantics', async () => {
  const h = await mount()

  await act(async () => { h.editor.openNewClient() })
  await act(async () => { h.editor.updateDraft({ name: '  Joana Lima  ', phone: '', address: '' }) })
  await act(async () => { await h.editor.submit() })

  assert.deepEqual(h.calls.created, [{ name: 'Joana Lima', phone: '', address: 'Sem endereço' }])
  assert.equal(h.editor.isOpen, false)
  assert.deepEqual(h.editor.draft, { name: '', phone: '', address: '' })

  h.renderer.unmount()
})

test('duplicate phone uses global feedback while duplicate name opens the Customers modal', async () => {
  const h = await mount()

  await act(async () => { h.editor.openNewClient() })
  await act(async () => { h.editor.updateDraft({ name: 'Outra pessoa', phone: clients[0].phone, address: '' }) })
  await act(async () => { await h.editor.submit() })
  assert.deepEqual(h.calls.duplicatePhone, ['Telefone já cadastrado para Ana Souza.'])
  assert.equal(h.calls.created.length, 0)
  assert.equal(h.editor.duplicateDialog, null)

  await act(async () => { h.editor.updateDraft({ name: 'Maria Silva', phone: '', address: '' }) })
  await act(async () => { await h.editor.submit() })
  assert.equal(h.editor.duplicateDialog.client.id, 'maria')
  assert.equal(h.editor.duplicateDialog.action, 'create')

  h.renderer.unmount()
})

test('confirm duplicate continues the original create/update and use existing clears editor state', async () => {
  const h = await mount()

  await act(async () => { h.editor.openNewClient() })
  await act(async () => { h.editor.updateDraft({ name: 'Maria Silva', phone: '', address: '' }) })
  await act(async () => { await h.editor.submit() })
  await act(async () => { await h.editor.confirmDuplicate() })
  assert.deepEqual(h.calls.created, [{ name: 'Maria Silva', phone: '', address: 'Sem endereço' }])
  assert.equal(h.editor.isOpen, false)

  await act(async () => { h.editor.editClient(clients[0]) })
  await act(async () => { h.editor.updateDraft({ name: 'Maria Silva', phone: clients[0].phone, address: 'Centro' }) })
  await act(async () => { await h.editor.submit() })
  assert.equal(h.editor.duplicateDialog.action, 'update')
  await act(async () => { h.editor.useExistingDuplicate() })
  assert.equal(h.calls.usedExisting.at(-1).id, 'maria')
  assert.equal(h.editor.isOpen, false)
  assert.equal(h.editor.duplicateDialog, null)
  assert.deepEqual(h.editor.draft, { name: '', phone: '', address: '' })

  h.renderer.unmount()
})

test('cancel clears both editor and duplicate state', async () => {
  const h = await mount()

  await act(async () => { h.editor.openNewClient() })
  await act(async () => { h.editor.updateDraft({ name: 'Maria Silva', phone: '', address: 'Centro' }) })
  await act(async () => { await h.editor.submit() })
  assert.ok(h.editor.duplicateDialog)

  await act(async () => { h.editor.cancel() })
  assert.equal(h.editor.isOpen, false)
  assert.equal(h.editor.editingClientId, null)
  assert.equal(h.editor.duplicateDialog, null)
  assert.deepEqual(h.editor.draft, { name: '', phone: '', address: '' })

  h.renderer.unmount()
})

test('scoped editor consults authoritative duplicate names outside the loaded page before persisting',async()=>{
  const h=await mount({clients:[],lookupDuplicates:async()=>({name:clients[0],phone:null})})
  try{
    await act(async()=>h.editor.openNewClient())
    await act(async()=>h.editor.updateDraft({name:'Ana Souza'}))
    await act(async()=>assert.equal(await h.editor.submit(),false))
    assert.equal(h.calls.created.length,0);assert.equal(h.editor.duplicateDialog.client.id,'ana')
  }finally{h.renderer.unmount()}
})
test('closing a draft during duplicate lookup never persists or reopens its obsolete confirmation',async()=>{
  let release
  const h=await mount({clients:[],lookupDuplicates:()=>new Promise(resolve=>{release=resolve})})
  try{
    await act(async()=>h.editor.openNewClient());await act(async()=>h.editor.updateDraft({name:'New'}))
    let pending;await act(async()=>{pending=h.editor.submit()})
    await act(async()=>h.editor.cancel())
    await act(async()=>{release({name:null,phone:null});await pending})
    assert.equal(h.calls.created.length,0);assert.equal(h.editor.isOpen,false)
  }finally{h.renderer.unmount()}
})
