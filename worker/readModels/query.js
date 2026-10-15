import {READ_SURFACE_IDS} from '../../shared/scopedReads.js'
import {apiError} from '../http.js'
import {requireCapability,requireAnyCapability} from '../access/authorization.js'
export function parseReadSurface(value){
  if(!READ_SURFACE_IDS.includes(value))throw apiError(400,'INVALID_READ_SURFACE','Superfície de leitura inválida.')
  return value
}
const capabilities={
  orders:'orders.view',history:'orders.history','kitchen-tv-control':'orders.view','new-order':'orders.create',
  comandas:'comandas.view','print-queue':'printing.queue',dashboard:'finance.overview',reports:'reports.view',
  receivables:'finance.receivables',finance:'finance.movements',clients:'clients.view',products:'products.view',tables:'tables.view',
  'access-team':'access.users.view','access-activity':'access.audit.view','settings-business-profile':'business.profile.view',
  'settings-operations':'operations.settings.view','settings-modalities':'operations.settings.view',
  'settings-payments':'payments.settings.view','settings-cancellations':'orders.settings.view',
  'settings-finance-categories':'finance.categories.view','settings-kitchen-tv':'orders.settings.view','settings-device':'preferences.local',
}
export function requireReadSurface(granted,surface){
  parseReadSurface(surface)
  if(capabilities[surface])requireCapability({granted},capabilities[surface])
  if(surface==='settings-printing')requireAnyCapability({granted},['printing.settings.view','printing.settings','printing.station.configure'])
  if(surface==='settings-home')requireAnyCapability({granted},['business.profile.view','operations.settings.view','payments.settings.view','orders.settings.view','finance.categories.view','printing.settings.view','printing.settings','printing.station.configure','preferences.local','access.users.view','access.audit.view'])
}

export function parseReadLimit(value){
  if(value===undefined || value===null || value==='')return 50
  const number=Number(value)
  if(!Number.isInteger(number) || number<1 || number>100)throw apiError(400,'INVALID_READ_LIMIT','O limite deve estar entre 1 e 100.')
  return number
}
const invalidCursor=()=>apiError(400,'INVALID_READ_CURSOR','A consulta mudou ou a página é inválida. Recarregue a lista.')
export function encodeReadCursor(queryKey,key){
  const text=JSON.stringify({v:1,q:queryKey,k:key})
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function decodeReadCursor(value,queryKey,{text=false}={}){
  if(value===undefined || value===null || value==='')return null
  try{
    if(typeof value!=='string' || value.length>2048 || !/^[A-Za-z0-9_-]+$/.test(value))throw invalidCursor()
    const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
    if(parsed?.v!==1 || parsed.q!==queryKey || Object.keys(parsed).sort().join(',')!=='k,q,v' || !Array.isArray(parsed.k) || parsed.k.length!==2
      || (text?typeof parsed.k[0]!=='string' || parsed.k[0].length>256:!Number.isSafeInteger(parsed.k[0]) || Math.abs(parsed.k[0])>8640000000000000) || typeof parsed.k[1]!=='string' || !parsed.k[1] || parsed.k[1].length>256)throw invalidCursor()
    return parsed.k
  }catch{throw invalidCursor()}
}

export function readEnum(value,values,fallback){
  const parsed=value===undefined || value===null || value===''?fallback:value
  if(!values.includes(parsed))throw apiError(400,'INVALID_READ_QUERY','Filtro de consulta inválido.')
  return parsed
}
export function readSearch(value=''){
  if(typeof value!=='string' || value.length>500)throw apiError(400,'INVALID_READ_QUERY','Busca inválida.')
  return value.trim()
}
// Rank is validated against the last selected identity before loading another page.
// A concurrent reorder requires a fresh query rather than silently skipping records.
export function rankPage(values,{cursor,queryKey,limit,key=value=>value.id}){
  const decoded=decodeReadCursor(cursor,queryKey)
  if(decoded && (decoded[0]<0 || key(values[decoded[0]] || {})!==decoded[1]))throw apiError(409,'READ_QUERY_CHANGED','A lista mudou. Atualize a consulta.')
  const start=decoded?decoded[0]+1:0,page=values.slice(start,start+limit),last=start+page.length-1
  return {page,nextCursor:last+1<values.length && page.length?encodeReadCursor(queryKey,[last,key(page.at(-1))]):null}
}

export function readCalendarDate(value){
  if(value===undefined || value===null || value==='')return null
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)throw apiError(400,'INVALID_READ_QUERY','Data inválida.')
  return value
}
