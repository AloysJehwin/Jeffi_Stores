import { View } from 'react-native'
import type { OrderReview } from '../../api/account'
import { BodySmall, Button, Card, Divider, Heading, Text } from '../../ui'
import type { Order } from './shared'

/** "Rate Your Order" with the stars already given. */
export function ReviewPrompt({ order, reviewMap, onOpen }: { order: Order; reviewMap: Record<string, OrderReview>; onOpen: () => void }) {
  const allReviewed = order.items.every(i => reviewMap[i.productId])
  const reviewed = order.items.filter(i => reviewMap[i.productId])
  return (
    <Card>
      <View className="flex-row items-center justify-between gap-4">
        <View className="flex-1">
          <Heading>Rate Your Order</Heading>
          <BodySmall className="mt-0.5">{allReviewed ? 'You have reviewed all items in this order.' : 'Share your experience with the products you received.'}</BodySmall>
        </View>
        <View>
          <Button label={allReviewed ? 'Edit Reviews' : 'Write Reviews'} size="sm" block={false} onPress={onOpen} />
        </View>
      </View>
      {reviewed.length > 0 && (
        <>
          <Divider className="my-4" />
          <View className="flex-row flex-wrap gap-3">
            {reviewed.map(item => {
              const r = reviewMap[item.productId]
              return (
                <View key={item.productId} className="flex-row items-center gap-2">
                  <Text accessibilityLabel={`${r.rating} of 5 stars`} className="text-sm text-yellow-400">
                    {'★'.repeat(r.rating)}
                    <Text className="text-border-secondary">{'★'.repeat(5 - r.rating)}</Text>
                  </Text>
                  <Text className="text-xs font-medium text-foreground" numberOfLines={1} style={{ maxWidth: 140 }}>
                    {item.productName}
                  </Text>
                </View>
              )
            })}
          </View>
        </>
      )}
    </Card>
  )
}
