import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Section } from '../../ui'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { getBuyAgain } from '../../api/account'
import { useAccountUser } from './hooks'
import ProductCard from '../product/ProductCard'

// Mirror of controller-service components/visitor/account/BuyAgainRow.tsx (SectionCarousel: w-[45%], gap-3).

export default function BuyAgainRow() {
  const router = useRouter()
  const user = useAccountUser()
  const [width, setWidth] = useState(0)
  const { data: products = [] } = useQuery({ queryKey: ['buy-again', user?.id ?? null], queryFn: getBuyAgain, enabled: !!user })

  if (products.length === 0) return null
  // 45% like the web, but no narrower than the home carousels' cards: below that a name word breaks mid-word.
  const item = Math.max(160, Math.floor(width * 0.45))

  return (
    <Section title="Buy again" actionLabel="Past orders" onAction={() => router.push('/orders')} gutter={false}>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={item + 12} decelerationRate="fast" contentContainerStyle={{ gap: 12 }}>
            {products.map(p => (
              <View key={p.id} style={{ width: item }}>
                <ProductCard product={p} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Section>
  )
}
