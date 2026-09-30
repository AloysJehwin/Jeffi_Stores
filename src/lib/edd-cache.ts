// Module-level promise cache — one fetch per unique key per page load.
// Keyed by "pin|handlingDays|extraDays" so cards with the same params share a single request.
const eddCache = new Map<string, Promise<string | null>>()
const addressCache = new Map<string, Promise<string | null>>()

function fetchEdd(pin: string | null, handlingDays: number, extraDays: number): Promise<string | null> {
  const key = `${pin ?? ''}|${handlingDays}|${extraDays}`
  if (!eddCache.has(key)) {
    const params = new URLSearchParams()
    if (pin) params.set('pin', pin)
    params.set('handlingDays', String(handlingDays))
    if (extraDays > 0) params.set('extraDays', String(extraDays))
    const url = `/api/products/edd?${params.toString()}`
    eddCache.set(
      key,
      fetch(url)
        .then(r => (r.ok ? r.json() : null))
        .then(d => d?.edd ?? null)
        .catch(() => null)
    )
  }
  return eddCache.get(key)!
}

function fetchDefaultPin(portal?: 'business'): Promise<string | null> {
  const key = portal ?? 'visitor'
  if (!addressCache.has(key)) {
    const headers: Record<string, string> = portal === 'business' ? { 'X-Auth-Portal': 'business' } : {}
    addressCache.set(
      key,
      fetch('/api/user/addresses', { headers })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          const list = d?.addresses ?? []
          return list.find((a: any) => a.is_default)?.postal_code ?? list[0]?.postal_code ?? null
        })
        .catch(() => null)
    )
  }
  return addressCache.get(key)!
}

export async function resolveEdd(
  loggedIn: boolean,
  handlingDays: number,
  extraDays: number,
  portal?: 'business'
): Promise<string | null> {
  if (!loggedIn) return fetchEdd(null, handlingDays, extraDays)
  const pin = await fetchDefaultPin(portal)
  return fetchEdd(pin, handlingDays, extraDays)
}

// Call on logout / address change so next render refetches.
export function invalidateEddCache() {
  eddCache.clear()
  addressCache.clear()
}
