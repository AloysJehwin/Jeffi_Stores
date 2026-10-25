import { View } from 'react-native'
import { Rail, Title } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { getAffinity } from '../../api/pdp'

// Mirror of controller-service components/visitor/pdp/CustomersAlsoViewed.tsx (SectionCarousel of ProductCards).

export default function CustomersAlsoViewed({ productId }: { productId: string }) {
  const { data: products = [] } = useQuery({ queryKey: ['pdp-affinity', 'viewed', productId], queryFn: () => getAffinity('viewed', productId, 8) })
  if (products.length === 0) return null
  return (
    <View className="mt-8">
      <Title className="mb-4">Customers also viewed</Title>
      <Rail>
        {products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Rail>
    </View>
  )
}
