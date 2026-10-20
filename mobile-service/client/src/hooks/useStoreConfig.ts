import { useQuery } from '@tanstack/react-query'
import { getStoreConfig, type StoreConfig } from '../api/storeConfig'

const FALLBACK: StoreConfig = {
  slug: null,
  identity: { name: '', email: '', phone: '', web: '', logoUrl: null },
  flags: { razorpayEnabled: true, codEnabled: false, gstEnabled: true, digitalProductsEnabled: false, subscriptionsEnabled: false },
}

export function useStoreConfig(): StoreConfig {
  const { data } = useQuery({ queryKey: ['store-config'], queryFn: getStoreConfig, staleTime: 30_000 })
  return data ?? FALLBACK
}
