import { api } from '../api/client'

// One request per unique key, shared by every card (mirrors the web's edd-cache).
const eddCache = new Map<string, Promise<string | null>>()
let pinPromise: Promise<string | null> | null = null

function fetchEdd(pin: string | null, handlingDays: number, extraDays: number): Promise<string | null> {
  const key = `${pin ?? ''}|${handlingDays}|${extraDays}`
  if (!eddCache.has(key)) {
    const params = new URLSearchParams()
    if (pin) params.set('pin', pin)
    params.set('handlingDays', String(handlingDays))
    if (extraDays > 0) params.set('extraDays', String(extraDays))
    eddCache.set(
      key,
      api<{ edd?: string }>(`/api/products/edd?${params.toString()}`)
        .then(d => d?.edd ?? null)
        .catch(() => null)
    )
  }
  return eddCache.get(key)!
}

function defaultPin(): Promise<string | null> {
  pinPromise ??= api<{ addresses?: { is_default?: boolean; postal_code?: string }[] }>('/api/user/addresses')
    .then(d => {
      const list = d?.addresses ?? []
      return list.find(a => a.is_default)?.postal_code ?? list[0]?.postal_code ?? null
    })
    .catch(() => null)
  return pinPromise
}

export async function resolveEdd(loggedIn: boolean, handlingDays: number, extraDays: number): Promise<string | null> {
  return fetchEdd(loggedIn ? await defaultPin() : null, handlingDays, extraDays)
}

/** Call on sign-in/out or an address change. */
export function invalidateEddCache() {
  eddCache.clear()
  pinPromise = null
}
