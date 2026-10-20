import { Text, View } from 'react-native'

// The brand / SKU / variant chips the web shows under a cart or checkout line name.
export function BrandChip({ name, small }: { name: string; small?: boolean }) {
  return (
    <View className={`rounded-full border border-border-default bg-surface-secondary ${small ? 'px-1.5 py-0.5' : 'px-2 py-0.5'}`}>
      <Text className={`${small ? 'text-[10px]' : 'text-xs'} text-foreground-secondary`}>{name}</Text>
    </View>
  )
}

export function SkuText({ sku, small }: { sku: string; small?: boolean }) {
  return (
    <Text className={`${small ? 'text-[10px]' : 'text-xs'} text-foreground-muted`} style={{ fontFamily: 'monospace' }}>
      SKU: {sku}
    </Text>
  )
}

export function VariantChips({ variant, subVariant }: { variant?: string | null; subVariant?: string | null }) {
  if (!variant && !subVariant) return null
  return (
    <View className="mt-1 flex-row flex-wrap gap-1">
      {variant ? (
        <View className="rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 dark:border-accent-700 dark:bg-accent-900/30">
          <Text className="text-xs font-medium text-accent-700 dark:text-accent-300">{variant}</Text>
        </View>
      ) : null}
      {subVariant ? (
        <View className="rounded-full border border-border-default bg-surface-secondary px-2 py-0.5">
          <Text className="text-xs font-medium text-foreground-secondary">{subVariant}</Text>
        </View>
      ) : null}
    </View>
  )
}
