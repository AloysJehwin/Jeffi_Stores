import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Grid } from '../home/layout'
import { api } from '../../api/client'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useAuthStore } from '../../stores/authStore'
import { rowsToCards } from './cards'

// The web's <FeaturedForYou compact limit={N} /> (the boxed row on cart / checkout pages).
const COPY = { eyebrow: 'Picked for you', title: 'Featured For You' }

export default function FeaturedForYouCompact({ limit, title, inset = 0 }: { limit?: number; title?: string | null; inset?: number }) {
  const userId = useAuthStore(s => s.user?.id ?? null)
  const { gstEnabled } = useStoreConfig().flags
  const { data } = useQuery({
    queryKey: ['recommendations', 'for-you', userId],
    queryFn: () => api<{ products: any[]; fallback?: boolean }>('/api/recommendations/for-you'),
    retry: false,
  })
  // Signed-out visitors get a best-sellers `fallback`, which stays hidden.
  const rows = data && !data.fallback && Array.isArray(data.products) ? data.products : []
  if (rows.length === 0) return null
  const shown = rowsToCards(typeof limit === 'number' ? rows.slice(0, limit) : rows, gstEnabled)

  return (
    <Card className="mt-8">
      <View className="mb-4">
        <Overline className="mb-0.5 text-accent-500">{COPY.eyebrow}</Overline>
        <Text accessibilityRole="header" className="font-display text-lg font-extrabold text-foreground">
          {title || COPY.title}
        </Text>
      </View>
      <Grid cols={2} gap={12} inset={17 + inset}>
        {shown.map(p => (
          <ProductCard key={p.card.id} product={p.card} handlingDays={p.handlingDays} />
        ))}
      </Grid>
    </Card>
  )
}
