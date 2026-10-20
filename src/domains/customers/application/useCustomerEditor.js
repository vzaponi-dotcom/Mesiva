import { useCallback,useEffect,useRef, useState } from 'react'
import { findClientDuplicates } from '../domain/clientDuplicates.js'

const emptyDraft = () => ({ name: '', phone: '', address: '' })

export function useCustomerEditor({
  clients = [],
  lookupDuplicates,ownerKey=null,onError=()=>{},
  canCreateClients = false,
  canUpdateClients = false,
  writesBlocked = false,
  createClient = async () => null,
  updateClient = async () => null,
  onDuplicatePhone = () => {},
  onUseExistingClient = () => {},
} = {}) {
  const generation=useRef(0),pendingCheck=useRef(null),currentOwner=useRef(ownerKey),allowed=useRef(null)
  currentOwner.current=ownerKey;allowed.current={writesBlocked,canCreateClients,canUpdateClients}
  const [checkingDuplicates,setCheckingDuplicates]=useState(false)
  const pendingSubmit = useRef(null)
  const [submitting, setSubmitting] = useState(false)
  useEffect(()=>()=>{generation.current+=1;pendingCheck.current=null;pendingSubmit.current=null},[])
  const [draft, setDraft] = useState(emptyDraft)
  const [editingClientId, setEditingClientId] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [duplicateDialog, setDuplicateDialog] = useState(null)

  const reset = useCallback(() => {
    pendingSubmit.current=null;setSubmitting(false)
    generation.current+=1;pendingCheck.current=null;setCheckingDuplicates(false)
    setEditingClientId(null)
    setDraft(emptyDraft())
    setDuplicateDialog(null)
    setIsOpen(false)
  }, [])

  const openNewClient = useCallback(() => {
    if (!canCreateClients || writesBlocked) return false
    pendingSubmit.current=null;setSubmitting(false)
    generation.current+=1;pendingCheck.current=null;setCheckingDuplicates(false)
    setDuplicateDialog(null)
    setEditingClientId(null)
    setDraft(emptyDraft())
    setIsOpen(true)
    return true
  }, [canCreateClients, writesBlocked])

  const editClient = useCallback((client) => {
    if (!canUpdateClients || writesBlocked || !client) return false
    pendingSubmit.current=null;setSubmitting(false)
    generation.current+=1;pendingCheck.current=null;setCheckingDuplicates(false)
    setDuplicateDialog(null)
    setEditingClientId(client.id)
    setDraft({ name: client.name, phone: client.phone, address: client.address })
    setIsOpen(true)
    return true
  }, [canUpdateClients, writesBlocked])

  const updateDraft = useCallback((patch) => {
    generation.current+=1
    setDraft((current) => ({ ...current, ...patch }))
  }, [])

  const payload = useCallback(() => ({
    name: draft.name.trim(),
    phone: draft.phone || '',
    address: draft.address || 'Sem endereço',
  }), [draft])

  const persist = useCallback(async (action) => {
    if (pendingSubmit.current || !(action === 'update' ? canUpdateClients : canCreateClients) || writesBlocked || !draft.name.trim()) return false
    const draftGeneration=generation.current,owner=currentOwner.current
    const nextPayload = payload()
    const attempt = { generation: draftGeneration, owner }
    pendingSubmit.current = attempt; setSubmitting(true)
    try {
      const client = action === 'update'
        ? await updateClient(editingClientId, nextPayload)
        : await createClient(nextPayload)
      if (!client || draftGeneration!==generation.current || owner!==currentOwner.current) return false
      reset()
      return true
    } finally {
      if (pendingSubmit.current === attempt) { pendingSubmit.current = null; setSubmitting(false) }
    }
  }, [canCreateClients, canUpdateClients, createClient, draft.name, editingClientId, payload, reset, updateClient, writesBlocked])

  const submit = useCallback(async () => {
    const action = editingClientId !== null ? 'update' : 'create'
    if (!(action === 'update' ? canUpdateClients : canCreateClients) || writesBlocked || !draft.name.trim()) return false
    if(pendingCheck.current || pendingSubmit.current)return false
    const draftGeneration=generation.current,owner=currentOwner.current,check={}
    const stillCurrent=()=>draftGeneration===generation.current&&owner===currentOwner.current&&!allowed.current.writesBlocked&&(action==='update'?allowed.current.canUpdateClients:allowed.current.canCreateClients)
    let duplicate
    if(lookupDuplicates){
      pendingCheck.current=check;setCheckingDuplicates(true)
      try{
        duplicate=await lookupDuplicates(draft,editingClientId)
        if(!stillCurrent() || duplicate===false)return false
      }catch(error){if(stillCurrent())onError(error);return false}
      finally{if(pendingCheck.current===check){pendingCheck.current=null;setCheckingDuplicates(false)}}
    }else duplicate=findClientDuplicates(clients,draft,editingClientId)

    if (duplicate.phone) {
      onDuplicatePhone('Telefone já cadastrado para ' + duplicate.phone.name + '.')
      return false
    }
    if (duplicate.name) {
      setDuplicateDialog({ client: duplicate.name, action })
      return false
    }
    return persist(action)
  }, [canCreateClients, canUpdateClients, clients, draft, editingClientId, onDuplicatePhone, persist, writesBlocked,lookupDuplicates,onError])

  const dismissDuplicate = useCallback(() => {
    setDuplicateDialog(null)
  }, [])

  const useExistingDuplicate = useCallback(() => {
    const existing = duplicateDialog?.client
    setDuplicateDialog(null)
    if (existing) onUseExistingClient(existing)
    reset()
    return Boolean(existing)
  }, [duplicateDialog, onUseExistingClient, reset])

  const confirmDuplicate = useCallback(async () => {
    const action = duplicateDialog?.action
    setDuplicateDialog(null)
    if (action !== 'create' && action !== 'update') return false
    return persist(action)
  }, [duplicateDialog, persist])

  const cancel = useCallback(() => {
    reset()
    return true
  }, [reset])

  const closeIfEditing = useCallback((clientId) => {
    if (editingClientId !== clientId) return false
    reset()
    return true
  }, [editingClientId, reset])

  return {
    draft,checkingDuplicates,submitting,
    editing: editingClientId !== null,
    editingClientId,
    isOpen,
    duplicateDialog,
    openNewClient,
    editClient,
    updateDraft,
    submit,
    dismissDuplicate,
    useExistingDuplicate,
    confirmDuplicate,
    cancel,
    closeIfEditing,
  }
}
