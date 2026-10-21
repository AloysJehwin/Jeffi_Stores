import { Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Grid } from '../home/layout'
import { api } from '../../api/client'
import { toCard } from '../../lib/card'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useAuthStore } from '../../stores/authStore'
import type { CardProduct } from '../../types/home'

// Mirror of controller-service components/visitor/FeaturedForYou.tsx as the PDP renders it (no props, full layout).

type Row = Partial<CardProduct> & { handlingDays?: number } & Record<string, any>

export default function FeaturedForYou() {
  const userId = useAuthStore(s => s.user?.id ?? null)
  const { gstEnabled } = useStoreConfig().flags
  const { data } = useQuery({
    queryKey: ['recommendations', 'for-you', userId],
    queryFn: () => api<{ products: Row[]; fallback?: boolean }>('/api/recommendations/for-you'),
    retry: false,
  })
  // Signed-out visitors get a best-sellers fallback, which stays hidden.
  const rows = data && !data.fallback && Array.isArray(data.products) ? data.products : []
  if (rows.length === 0) return null

  return (
    <View className="py-12">
      <View className="px-4">
        <View className="mb-7">
          <Text className="mb-1 text-[10px] font-black uppercase text-accent-500" style={{ letterSpacing: 2 }}>
            Picked for you
          </Text>
          <Text className="text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
            Featured For You
          </Text>
        </View>
        <Grid cols={2} gap={16} inset={16}>
          {rows.map((r, i) => (
            <ProductCard
              key={String(r.id ?? i)}
              product={(typeof r.displayPrice === 'number' ? r : toCard(r as any, gstEnabled)) as CardProduct}
              handlingDays={typeof r.handlingDays === 'number' ? r.handlingDays : undefined}
            />
          ))}
        </Grid>
      </View>
    </View>
  )
}
