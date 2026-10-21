import { Text, View } from 'react-native'
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
    <View className="mt-8 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-sm">
      <View className="mb-4">
        <Text className="text-[10px] font-black uppercase text-accent-500" style={{ letterSpacing: 2 }}>
          Customers also bought
        </Text>
        <Text className="text-lg font-bold text-foreground">{TITLE}</Text>
      </View>
      <Carousel>
        {products.map(p => (
          <ProductCard key={p.card.id} product={p.card} handlingDays={p.handlingDays} />
        ))}
      </Carousel>
    </View>
  )
}
