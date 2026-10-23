import { assertSameOriginMutation, apiError, json, readJson } from './http.js'
import { requireCapability } from './access/authorization.js'
import {
  readConferenceDate, readDayConferenceState, readDayConferenceEntries,
  readDayConferenceHistory, completeDayConference,
} from './dayConferenceRepository.js'

export async function handleDayConferenceApi(request,env,context,url=new URL(request.url)){
  if(!url.pathname.startsWith('/api/finance/day-conference'))return null
  requireCapability(context,'finance.movements')
  const path=url.pathname,method=request.method,businessId=context.businessId
  if(method==='GET' && path==='/api/finance/day-conference'){
    const date=readConferenceDate(url.searchParams.get('date'))
    return json(await readDayConferenceState(env.DB,businessId,date))
  }
  if(method==='GET' && path==='/api/finance/day-conference/entries'){
    const date=readConferenceDate(url.searchParams.get('date'))
    const methodName=url.searchParams.get('method')
    const rawPage=url.searchParams.get('page')||'1'
    if(!/^[1-9]\d{0,3}$/.test(rawPage))throw apiError(400,'INVALID_CONFERENCE_PAGE','Página inválida.')
    return json(await readDayConferenceEntries(env.DB,businessId,date,methodName,Number(rawPage)))
  }
  if(method==='GET' && path==='/api/finance/day-conference/history'){
    return json({history:await readDayConferenceHistory(env.DB,businessId)})
  }
  if(method==='POST' && path==='/api/finance/day-conference'){
    requireCapability(context,'finance.movements.manage')
    assertSameOriginMutation(request)
    return json({conference:await completeDayConference(env.DB,businessId,context.userId,await readJson(request))},{status:201})
  }
  throw apiError(405,'METHOD_NOT_ALLOWED','Operação não permitida.')
}
