import { api } from './client'

/** GET /api/store-config: the same public settings the web's useStoreConfig reads. */
export interface StoreConfig {
  slug: string | null
  identity: { name: string; email: string; phone: string; web: string; logoUrl: string | null }
  flags: {
    razorpayEnabled: boolean
    codEnabled: boolean
    gstEnabled: boolean
    digitalProductsEnabled: boolean
    subscriptionsEnabled: boolean
  }
}

export function getStoreConfig(): Promise<StoreConfig> {
  return api<StoreConfig>('/api/store-config')
}
