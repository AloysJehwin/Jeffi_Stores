import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
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
  const item = Math.floor(width * 0.45)

  return (
    <View className="bg-surface-elevated rounded-xl border border-border-default p-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-sm font-semibold text-foreground">Buy again</Text>
        <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.push('/orders')}>
          Past orders
        </Text>
      </View>
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
    </View>
  )
}
