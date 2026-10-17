import { calculateCheckoutTotals, validateOrderAdjustment } from './orderCheckout.js'
import { moneyToCents, optionalTextMax, requireNonEmpty, validatePositiveInteger } from './validation.js'
import { formatProductPresentation } from '../shared/productCatalog.js'

const error = (status, code, message) => Object.assign(new Error(message), {status,code})
const invalid = message => error(400,'ORDER_EDIT_INVALID',message)
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const only = (obj, keys) => Object.keys(obj).every(key => keys.includes(key))
const note = (value,field) => optionalTextMax(value,300,field).replace(/\s+/g,' ')
const snapshot = item => ({
  id:item.id,productId:item.product_id,name:item.name_snapshot,category:item.category_snapshot || '',
  size:item.size_snapshot || '',quantity:item.quantity,unitPriceCents:item.unit_price_cents,
  catalogPriceCents:item.catalog_price_cents,priceReason:item.price_reason || '',note:item.note || '',
})
export function validateOrderEditInput(raw) {
  if (!plain(raw) || !only(raw,['expectedContentRevision','mutationId','items','deliveryFee','adjustment']))
    throw invalid('A edição contém campos não permitidos.')
  if (!Number.isSafeInteger(raw.expectedContentRevision) || raw.expectedContentRevision < 0)
    throw invalid('Informe uma revisão válida do pedido.')
  if (typeof raw.mutationId !== 'string' || !raw.mutationId.trim() || raw.mutationId.trim().length > 128)
    throw invalid('Identificador da edição inválido.')
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 200)
    throw invalid('Inclua pelo menos um item.')
  const items = raw.items.map((item,index) => {
    if (!plain(item) || !only(item,['id','productId','quantity','note'])) throw invalid('Item inválido.')
    const id = item.id == null ? null : requireNonEmpty(item.id,'items.id')
    const productId = item.productId == null ? null : requireNonEmpty(item.productId,'items.productId')
    if (!id && !productId) throw invalid('Informe o produto do novo item.')
    return {id,productId,quantity:validatePositiveInteger(item.quantity,'items.'+index+'.quantity'),
      note:note(item.note,'items.'+index+'.note')}
  })
  if (raw.adjustment !== undefined && !plain(raw.adjustment)) throw invalid('Ajuste inválido.')
  return {expectedContentRevision:raw.expectedContentRevision,mutationId:raw.mutationId.trim(),
    items,deliveryFee:raw.deliveryFee,adjustment:raw.adjustment}
}

// Pure domain: persisted lines are priced by their original immutable snapshot,
// while newly added products require a currently active product catalog entry.
export function buildOrderEdit({order,existingItems,catalogProducts,input,allowAdjustment=false}) {
  if (!order || order.status !== 'Em preparo' || order.table_reservation_status === 'reserved')
    throw error(409,'ORDER_NOT_EDITABLE','Este pedido não pode ser editado.')
  const value=validateOrderEditInput(input)
  if (!Array.isArray(existingItems) || !(catalogProducts instanceof Map)) throw invalid('Itens oficiais indisponíveis.')
  const historic=new Map(existingItems.map(row=>[row.id,row]))
  const seen=new Set()
  const items=value.items.map(entry=>{
    if (entry.id) {
      if (seen.has(entry.id)) throw invalid('Linha duplicada.')
      seen.add(entry.id)
      const old=historic.get(entry.id)
      if (!old || (entry.productId && entry.productId !== old.product_id))
        throw invalid('Linha inválida para este pedido.')
      return {...old,id:old.id,quantity:entry.quantity,note:entry.note,
        unit_price_cents:Number(old.unit_price_cents),catalog_price_cents:Number(old.catalog_price_cents)}
    }
    const product=catalogProducts.get(entry.productId)
    if (!product || Number(product.active)!==1)
      throw error(404,'PRODUCT_NOT_FOUND','Produto indisponível.')
    const price=Number(product.price_cents)
    if (!Number.isSafeInteger(price)||price<0) throw invalid('Preço de catálogo inválido.')
    const presentation=formatProductPresentation({
      id:product.id,name:product.name,category:product.category,size:product.size || '',
      price:price/100,presentationType:product.presentation_type,
      presentationValue:product.presentation_value,presentationUnit:product.presentation_unit,
    })
    return {id:null,product_id:product.id,name_snapshot:product.name,
      category_snapshot:product.category || '',size_snapshot:presentation==='Unidade'?'Un':presentation,
      quantity:entry.quantity,note:entry.note,unit_price_cents:price,catalog_price_cents:price,
      price_reason:'',created_at:null}
  })
  if(items.some(x=>!Number.isSafeInteger(x.unit_price_cents)||x.unit_price_cents<0))
    throw invalid('Preço histórico inválido.')
  const fee=value.deliveryFee===undefined
    ? Number(order.delivery_fee_cents || 0) : moneyToCents(value.deliveryFee,'deliveryFee')
  if(order.type!=='Entrega'&&fee!==0) throw invalid('Taxa somente para entrega.')
  const previous={type:order.adjustment_type||'none',mode:order.adjustment_mode||'fixed',
    storedValue:Number(order.adjustment_value||0),reason:order.adjustment_reason||''}
  const adjustment=value.adjustment===undefined?previous:validateOrderAdjustment(value.adjustment)
  const sameAdjustment=adjustment.type===previous.type&&adjustment.mode===previous.mode&&
    adjustment.storedValue===previous.storedValue&&adjustment.reason===previous.reason
  if(!allowAdjustment&&!sameAdjustment) throw error(403,'FORBIDDEN','Sem permissão para alterar ajuste.')
  const totals=calculateCheckoutTotals(items.map(x=>({quantity:x.quantity,priceCents:x.unit_price_cents})),fee,adjustment)
  if(!Object.values(totals).every(x=>Number.isSafeInteger(x)&&x>=0))throw invalid('Total fora do intervalo.')
  const next=new Map(items.filter(x=>x.id).map(x=>[x.id,x]))
  const deltas=[]
  for(const old of [...existingItems].sort((a,b)=>a.id.localeCompare(b.id))) {
    const current=next.get(old.id)
    if(!current)deltas.push({kind:'removed',before:snapshot(old),after:null})
    else if(old.quantity!==current.quantity||(old.note||'')!==current.note)
      deltas.push({kind:'modified',before:snapshot(old),after:snapshot(current)})
  }
  for(const item of items.filter(x=>!x.id))deltas.push({kind:'added',before:null,after:snapshot(item)})
  const deliveryFee=fee===Number(order.delivery_fee_cents||0)?null:
    {before:Number(order.delivery_fee_cents||0),after:fee}
  const adjustmentDelta=sameAdjustment?null:{before:previous,after:adjustment}
  const changed=deltas.length>0||Boolean(deliveryFee)||Boolean(adjustmentDelta)||
    totals.totalCents!==Number(order.total_cents)||
    totals.subtotalCents!==Number(order.subtotal_cents)||
    totals.adjustmentAmountCents!==Number(order.adjustment_amount_cents||0)
  return {items,totals,adjustment,deliveryFeeCents:fee,changed,
    changes:{items:deltas,deliveryFee,adjustment:adjustmentDelta}}
}
