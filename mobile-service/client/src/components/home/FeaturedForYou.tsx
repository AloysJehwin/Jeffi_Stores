import { Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Grid } from './layout'
import { api } from '../../api/client'
import { toCard } from '../../lib/card'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useAuthStore } from '../../stores/authStore'
import type { CardProduct, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/FeaturedForYou.tsx (visitor variant, full layout).

const COPY = { eyebrow: 'Picked for you', title: 'Featured For You' }

type Row = Partial<CardProduct> & { handlingDays?: number } & Record<string, any>

interface ApiResponse {
  products: Row[]
  source?: string
  curated?: boolean
  fallback?: boolean
}

export default function FeaturedForYou({ section }: SectionProps) {
  const userId = useAuthStore(s => s.user?.id ?? null)
  const { gstEnabled } = useStoreConfig().flags
  const { data } = useQuery({
    queryKey: ['recommendations', 'for-you', userId],
    queryFn: () => api<ApiResponse>('/api/recommendations/for-you'),
    retry: false,
  })

  // Only genuine personalised results; signed-out visitors get a best-sellers `fallback`, which stays hidden.
  const rows = data && !data.fallback && Array.isArray(data.products) ? data.products : []
  if (rows.length === 0) return null
  // The route already returns card props; raw rows go through toCard.
  const products = rows.map(r => ({
    card: (typeof r.displayPrice === 'number' ? r : toCard(r as any, gstEnabled)) as CardProduct,
    handlingDays: typeof r.handlingDays === 'number' ? r.handlingDays : undefined,
  }))

  // "Explore more" is hidden below sm on the web.
  return (
    <View className="px-4 py-12">
      <View className="mb-7">
        <Text className="mb-1 text-[10px] font-black uppercase text-accent-500" style={{ letterSpacing: 2 }}>
          {COPY.eyebrow}
        </Text>
        <Text className="text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
          {section.title || COPY.title}
        </Text>
      </View>
      <Grid cols={2} gap={16}>
        {products.map(p => (
          <ProductCard key={p.card.id} product={p.card} handlingDays={p.handlingDays} />
        ))}
      </Grid>
    </View>
  )
}
