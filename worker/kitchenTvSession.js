import { apiError } from './http.js'
import { readKitchenTvSessionToken, hashKitchenTvToken } from './kitchenTvAuth.js'
import { loadKitchenTvSessionByHash } from './kitchenTvRepository.js'
import { multiCompanyEnabled } from './tenancy/routePolicy.js'

export async function authenticatedTv(request,env) {
  const token=readKitchenTvSessionToken(request)
  if (!token) throw apiError(401,'KITCHEN_TV_UNAUTHORIZED','Este painel não está mais autorizado.')
  const access=await loadKitchenTvSessionByHash(env.DB,await hashKitchenTvToken(token),undefined,{requireActive:multiCompanyEnabled(env)})
  if (!access) throw apiError(401,'KITCHEN_TV_UNAUTHORIZED','Este painel não está mais autorizado.')
  return {token,access}
}
