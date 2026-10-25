import { View } from 'react-native'
import { Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Grid } from '../home/layout'
import { api } from '../../api/client'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { rowsToCards } from '../cart/cards'

// Mirror of controller-service components/visitor/RecommendedProducts.tsx (newest products, boxed grid).
export default function RecommendedProducts({ title = 'You Might Also Like', limit = 4 }: { title?: string; limit?: number }) {
  const { gstEnabled } = useStoreConfig().flags
  const { data } = useQuery({
    queryKey: ['products', 'newest', limit],
    queryFn: async () =>
      (await api<{ products?: any[] }>(`/api/products?limit=${limit}&sort=newest&is_active=true`, { token: null }))?.products?.slice(0, limit) ?? [],
    retry: false,
  })
  const products = rowsToCards(data ?? [], gstEnabled)
  if (products.length === 0) return null

  return (
    <View className="mt-8 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-sm">
      <Text className="mb-4 text-lg font-bold text-foreground">{title}</Text>
      <Grid cols={2} gap={12} inset={17}>
        {products.map(p => (
          <ProductCard key={p.card.id} product={p.card} handlingDays={p.handlingDays ?? 2} />
        ))}
      </Grid>
    </View>
  )
}
