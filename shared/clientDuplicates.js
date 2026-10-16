import { normalizeClientPhone } from './clientIdentity.js'

export const normalizeClientName = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLocaleLowerCase('pt-BR')

export const findClientDuplicates = (clients, draft, excludeId = null) => {
  const name = normalizeClientName(draft?.name)
  const phone = normalizeClientPhone(draft?.phone)
  const candidates = (Array.isArray(clients) ? clients : []).filter((client) => client?.id !== excludeId)

  return {
    name: name ? candidates.find((client) => normalizeClientName(client?.name) === name) ?? null : null,
    phone: phone ? candidates.find((client) => normalizeClientPhone(client?.phone) === phone) ?? null : null,
  }
}
