import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Carousel } from '../home/layout'
import { api } from '../../api/client'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { rowsToCards } from './cards'

// Mirror of controller-service components/visitor/cart/CartUpsellRow.tsx.
const TITLE = 'Frequently bought with your cart'

const idKey = (ids: string[]) => Array.from(new Set(ids.filter(Boolean))).sort().join(',')

export default function CartUpsellRow({ cartProductIds, savedProductIds }: { cartProductIds: string[]; savedProductIds: string[] }) {
  const { gstEnabled } = useStoreConfig().flags
  const idsKey = idKey(cartProductIds)
  const excludeKey = idKey([...cartProductIds, ...savedProductIds])
  const { data } = useQuery({
    queryKey: ['affinity', 'bought', idsKey, excludeKey],
    queryFn: async () => {
      const exclude = excludeKey.split(',')
      const params = new URLSearchParams({
        kind: 'bought',
        ids: idsKey.split(',').slice(0, 20).join(','),
        exclude: exclude.slice(0, 50).join(','),
        limit: '8',
      })
      const d = await api<{ products?: any[] }>(`/api/products/affinity?${params}`)
      const skip = new Set(exclude)
      return (Array.isArray(d?.products) ? d.products : []).filter(p => !skip.has(p.id))
    },
    enabled: !!idsKey,
    retry: false,
  })
  const products = rowsToCards(data ?? [], gstEnabled)
  if (!idsKey || products.length === 0) return null

  return (
    <Card className="mt-8">
      <View className="mb-4">
        <Overline className="mb-0.5 text-accent-500">Customers also bought</Overline>
        <Text accessibilityRole="header" className="font-display text-lg font-extrabold text-foreground">
          {TITLE}
        </Text>
      </View>
      <Carousel>
        {products.map(p => (
          <ProductCard key={p.card.id} product={p.card} handlingDays={p.handlingDays} />
        ))}
      </Carousel>
    </Card>
  )
}
