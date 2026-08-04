/**
 * Persistent on-device user preference profile.
 * Stored in localStorage — never sent to server. Privacy-preserving.
 * Updated after each order; read at recap time to personalise the prompt.
 */

const PROFILE_KEY = 'jeffi_od_profile'
const MAX_CATEGORIES = 8
const MAX_BRANDS = 5

export interface UserProfile {
  topCategories: string[]
  topBrands: string[]
  priceRange: { min: number; max: number } | null
  purchaseCount: number
  lastPurchaseDate: string | null
  preferredBuyMode: string | null
  sessionCount: number
}

const DEFAULT_PROFILE: UserProfile = {
  topCategories: [],
  topBrands: [],
  priceRange: null,
  purchaseCount: 0,
  lastPurchaseDate: null,
  preferredBuyMode: null,
  sessionCount: 0,
}

export function readUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return { ...DEFAULT_PROFILE }
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) }
  } catch { return { ...DEFAULT_PROFILE } }
}

function writeUserProfile(p: UserProfile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {}
}

function addFrequent(existing: string[], incoming: string[], max: number): string[] {
  const counts = new Map<string, number>()
  for (const s of existing) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) || 0) + 2)
  for (const s of incoming) {
    const k = s.toLowerCase()
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const seen = new Set<string>()
  const merged = [...existing, ...incoming].filter(s => {
    const k = s.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return merged
    .sort((a, b) => (counts.get(b.toLowerCase()) || 0) - (counts.get(a.toLowerCase()) || 0))
    .slice(0, max)
}

export interface OrderSignal {
  categories: string[]
  brands: string[]
  total: number
  itemCount: number
  buyMode?: string | null
}

/** Call after a successful order to update the local profile. */
export function updateUserProfile(order: OrderSignal) {
  try {
    const p = readUserProfile()
    p.topCategories = addFrequent(p.topCategories, order.categories.filter(Boolean), MAX_CATEGORIES)
    p.topBrands = addFrequent(p.topBrands, order.brands.filter(Boolean), MAX_BRANDS)
    if (order.total > 0) {
      const prev = p.priceRange
      p.priceRange = prev
        ? { min: Math.min(prev.min, order.total), max: Math.max(prev.max, order.total) }
        : { min: order.total, max: order.total }
    }
    p.purchaseCount = (p.purchaseCount || 0) + 1
    p.lastPurchaseDate = new Date().toISOString().slice(0, 10)
    if (order.buyMode) p.preferredBuyMode = order.buyMode
    writeUserProfile(p)
  } catch {}
}

/** Increment session count — call on app mount once per session. */
export function incrementSessionCount() {
  try {
    const p = readUserProfile()
    p.sessionCount = (p.sessionCount || 0) + 1
    writeUserProfile(p)
  } catch {}
}
