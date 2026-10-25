import { View } from 'react-native'
import { Skeleton } from '../../ui'

const CARD = 'rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default'

// The loaded page's cards: order header, delivery estimate, items + totals, address.
export default function OrderLoading() {
  return (
    <View className="gap-4">
      <View className={CARD}>
        <Skeleton height={24} width={200} />
        <Skeleton height={13} width="80%" className="mt-2" />
        <View className="mt-4 flex-row gap-2">
          <Skeleton height={24} width={90} rounded="rounded-full" />
          <Skeleton height={24} width={120} rounded="rounded-full" />
        </View>
        <View className="mt-4 flex-row gap-2">
          <Skeleton height={40} width={170} rounded="rounded-xl" />
          <Skeleton height={40} width={120} rounded="rounded-xl" />
        </View>
      </View>
      <View className={`${CARD} flex-row items-center gap-3`}>
        <Skeleton width={40} height={40} rounded="rounded-xl" />
        <View className="gap-1.5">
          <Skeleton height={14} width={140} />
          <Skeleton height={11} width={100} rounded="rounded" />
        </View>
      </View>
      <View className={CARD}>
        <Skeleton height={20} width={170} className="mb-4" />
        <View className="gap-4">
          {[0, 1].map(i => (
            <View key={i} className={`flex-row gap-4 pb-4 ${i === 0 ? 'border-b border-border-default' : ''}`}>
              <Skeleton width={80} height={80} rounded="rounded-xl" />
              <View className="flex-1 gap-2">
                <Skeleton height={14} width="80%" />
                <Skeleton height={12} width="40%" />
                <Skeleton height={13} width="65%" />
              </View>
            </View>
          ))}
        </View>
        <View className="mt-2 gap-3 border-t border-border-default pt-4">
          {[0, 1].map(i => (
            <View key={i} className="flex-row justify-between">
              <Skeleton height={12} width={80} />
              <Skeleton height={12} width={72} />
            </View>
          ))}
          <View className="flex-row items-center justify-between pt-2">
            <Skeleton height={18} width={60} />
            <Skeleton height={26} width={110} />
          </View>
        </View>
      </View>
      <View className={CARD}>
        <Skeleton height={20} width={150} className="mb-4" />
        <View className="gap-2">
          <Skeleton height={14} width="45%" />
          <Skeleton height={13} width="85%" />
          <Skeleton height={13} width="60%" />
        </View>
      </View>
    </View>
  )
}
