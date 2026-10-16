import { apiRequest, withJson } from '../api/httpClient.js'
export const createRealtimeApi=({request=apiRequest,basePath='/api/realtime'}={})=>Object.freeze({
  prepare:(options={})=>request(`${basePath}/prepare`,{...options,...withJson('POST',{})}),
  renew:(connectionId,options={})=>request(`${basePath}/renew`,{...options,...withJson('POST',{connectionId})}),
})
