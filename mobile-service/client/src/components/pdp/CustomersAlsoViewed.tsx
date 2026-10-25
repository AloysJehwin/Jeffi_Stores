import { View } from 'react-native'
import { Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import ProductCard from '../product/ProductCard'
import { Carousel } from '../home/layout'
import { getAffinity } from '../../api/pdp'

// Mirror of controller-service components/visitor/pdp/CustomersAlsoViewed.tsx (SectionCarousel of ProductCards).

export default function CustomersAlsoViewed({ productId }: { productId: string }) {
  const { data: products = [] } = useQuery({ queryKey: ['pdp-affinity', 'viewed', productId], queryFn: () => getAffinity('viewed', productId, 8) })
  if (products.length === 0) return null
  return (
    <View className="mt-10">
      <Text className="mb-6 text-2xl font-bold text-foreground">Customers also viewed</Text>
      <Carousel>
        {products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Carousel>
    </View>
  )
}
