import { api } from '../api/client'

// One request per unique key, shared by every card (mirrors the web's edd-cache).
const eddCache = new Map<string, Promise<string | null>>()
// Settled answers, so a card mounting mid-scroll renders its date at once instead of re-rendering for it.
const eddValues = new Map<string, string | null>()
let pinPromise: Promise<string | null> | null = null
let pinValue: string | null | undefined

const eddKey = (pin: string | null, handlingDays: number, extraDays: number) => `${pin ?? ''}|${handlingDays}|${extraDays}`

function fetchEdd(pin: string | null, handlingDays: number, extraDays: number): Promise<string | null> {
  const key = eddKey(pin, handlingDays, extraDays)
  if (!eddCache.has(key)) {
    const params = new URLSearchParams()
    if (pin) params.set('pin', pin)
    params.set('handlingDays', String(handlingDays))
    if (extraDays > 0) params.set('extraDays', String(extraDays))
    const p = api<{ edd?: string }>(`/api/products/edd?${params.toString()}`)
      .then(d => d?.edd ?? null)
      .catch(() => null)
    eddCache.set(key, p)
    p.then(v => {
      if (eddCache.get(key) === p) eddValues.set(key, v)
    })
  }
  return eddCache.get(key)!
}

function defaultPin(): Promise<string | null> {
  if (!pinPromise) {
    const p = api<{ addresses?: { is_default?: boolean; postal_code?: string }[] }>('/api/user/addresses')
      .then(d => {
        const list = d?.addresses ?? []
        return list.find(a => a.is_default)?.postal_code ?? list[0]?.postal_code ?? null
      })
      .catch(() => null)
    pinPromise = p
    p.then(v => {
      if (pinPromise === p) pinValue = v
    })
  }
  return pinPromise
}

export async function resolveEdd(loggedIn: boolean, handlingDays: number, extraDays: number): Promise<string | null> {
  return fetchEdd(loggedIn ? await defaultPin() : null, handlingDays, extraDays)
}

/** The answer resolveEdd would give, if it has already settled; undefined while unknown. */
export function peekEdd(loggedIn: boolean, handlingDays: number, extraDays: number): string | null | undefined {
  const pin = loggedIn ? pinValue : null
  if (pin === undefined) return undefined
  return eddValues.get(eddKey(pin, handlingDays, extraDays))
}

/** Call on sign-in/out or an address change. */
export function invalidateEddCache() {
  eddCache.clear()
  eddValues.clear()
  pinPromise = null
  pinValue = undefined
}
