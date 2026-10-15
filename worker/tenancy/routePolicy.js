import { authenticateAccountRequest } from '../identity/sessions.js'
import { authenticateHumanRequest } from '../access/sessions.js'

const identity = new Map([
  ['/api/auth/login', ['POST']], ['/api/auth/session', ['GET']], ['/api/auth/logout', ['POST']],
  ['/api/auth/businesses', ['GET']], ['/api/auth/select-business', ['POST']], ['/api/auth/select-platform', ['POST']],
  ['/api/auth/password-recovery', ['POST']], ['/api/auth/email-challenges/inspect', ['POST']], ['/api/auth/email-challenges/complete', ['POST']],
  ['/api/auth/company-invitations/inspect', ['POST']], ['/api/auth/company-invitations/accept', ['POST']], ['/api/access/me/password', ['POST']],
])
const television = new Map([
  ['/api/kitchen-tv/realtime/prepare', ['POST']], ['/api/kitchen-tv/realtime/renew', ['POST']],
  ['/api/kitchen-tv/pairing-request', ['POST']], ['/api/kitchen-tv/pairing-status', ['GET', 'POST']], ['/api/kitchen-tv/report', ['POST']], ['/api/kitchen-tv/state', ['GET']],
])
export const multiCompanyEnabled = env => env.AUTH_MULTI_COMPANY_ENABLED === true || env.AUTH_MULTI_COMPANY_ENABLED === 'true'
export function classifyApiRoute(method, path) {
  if (path === '/api/realtime/socket' && method === 'GET') return 'realtime-upgrade'
  if (/^\/api\/realtime\/(prepare|renew)$/.test(path) && method === 'POST') return 'business'
  if (identity.get(path)?.includes(method)) return 'public-identity'
  if (television.get(path)?.includes(method)) return 'public-tv'
  if (/^\/api\/platform\/businesses(?:\/[^/]+(?:\/(?:first-manager-invitation\/resend|suspend|resume|delete|restore|memberships|history|management-attempts\/[^/]+|memberships\/[^/]+\/(?:revoke|reactivate)|invitations\/[^/]+\/(?:cancel|resend)))?)?$/.test(path)) return 'platform'
  if (path === '/api/access/invitations/accept' || path.startsWith('/api/auth/')) return 'unknown'
  if (path === '/api/bootstrap' || /^\/api\/(orders|clients|products|tables|table-tabs|table-reservations|movements|finance-settings|settings|reporting|printing|business|access)(?:\/|$)/.test(path)
    || /^\/api\/kitchen-tv\/(control|settings|approve|revoke)(?:\/|$)/.test(path)) return 'business'
  return 'unknown'
}
export async function resolveRequestContext(request, env, _executionContext) {
  return multiCompanyEnabled(env) ? authenticateAccountRequest(request, env) : authenticateHumanRequest(request, env)
}
