import { apiRequest } from './httpClient.js'

export const createBootstrapApi = ({ request = apiRequest } = {}) => Object.freeze({
  getBootstrap: (knownEffectiveConfigVersion,{surface,signal}={}) => {
    const params = new URLSearchParams()
    if(surface)params.set('surface',surface)
    if (knownEffectiveConfigVersion) params.set('knownEffectiveConfigVersion', knownEffectiveConfigVersion)
    return request(`/api/bootstrap${params.size ? `?${params}` : ''}`,...(signal?[{signal}]:[]))
  },
})

export const { getBootstrap } = createBootstrapApi()
