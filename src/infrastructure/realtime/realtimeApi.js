import { apiRequest, withJson } from '../api/httpClient.js'
export const createRealtimeApi=({request=apiRequest,basePath='/api/realtime'}={})=>Object.freeze({
  prepare:()=>request(`${basePath}/prepare`,withJson('POST',{})),
  renew:connectionId=>request(`${basePath}/renew`,withJson('POST',{connectionId})),
})
