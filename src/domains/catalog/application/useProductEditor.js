import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createProductDraft,
  productPayloadFromDraft,
  productToDraft,
} from '../domain/productDraft.js'

export function useProductEditor({
  createProduct,
  updateProduct,
  writesBlocked = false,
  canManageProducts = false,
  ownerKey,
} = {}) {
  const generation = useRef(0), pending = useRef(null), owner = useRef(ownerKey), mounted = useRef(true)
  owner.current = ownerKey
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  const [editingId, setEditingId] = useState(null)
  const [isOpen, setOpen] = useState(false)
  const [draft, replaceDraft] = useState(createProductDraft)

  const cancel = useCallback(() => {
    generation.current++; pending.current = null; setSubmitting(false)
    setEditingId(null)
    replaceDraft(createProductDraft())
    setOpen(false)
  }, [])
  useEffect(() => { cancel() }, [ownerKey, cancel])

  const openNewProduct = useCallback(() => {
    if (!canManageProducts || writesBlocked) return false
    generation.current++; pending.current = null; setSubmitting(false)
    setEditingId(null)
    replaceDraft(createProductDraft())
    setOpen(true)
    return true
  }, [canManageProducts, writesBlocked])

  const editProduct = useCallback((product) => {
    if (!canManageProducts || writesBlocked) return false
    generation.current++; pending.current = null; setSubmitting(false)
    setEditingId(product.id)
    replaceDraft(productToDraft(product))
    setOpen(true)
    return true
  }, [canManageProducts, writesBlocked])

  const submit = useCallback(async () => {
    if (!canManageProducts || writesBlocked || pending.current !== null || !draft.name.trim()) return false
    const token = { generation: generation.current, owner: owner.current }
    pending.current = token; setSubmitting(true)
    try {
      const result = editingId !== null
        ? await updateProduct(editingId, productPayloadFromDraft(draft))
        : await createProduct(productPayloadFromDraft(draft))
      if (!result || !mounted.current || token.generation !== generation.current || token.owner !== owner.current) return false
      cancel()
      return true
    } finally {
      if (pending.current === token) { pending.current = null; if (mounted.current) setSubmitting(false) }
    }
  }, [canManageProducts, cancel, createProduct, draft, editingId, updateProduct, writesBlocked])

  const closeIfEditing = useCallback((productId) => {
    if (editingId !== productId) return false
    cancel()
    return true
  }, [cancel, editingId])

  return {
    isOpen,
    submitting,
    editing: editingId !== null,
    draft,
    replaceDraft,
    openNewProduct,
    editProduct,
    submit,
    cancel,
    closeIfEditing,
  }
}
