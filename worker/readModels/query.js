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
