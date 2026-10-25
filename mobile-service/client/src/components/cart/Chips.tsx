import { View } from 'react-native'
import { Badge, Text } from '../../ui'

// The brand / SKU / variant chips the web shows under a cart or checkout line name.
export function BrandChip({ name, small }: { name: string; small?: boolean }) {
  return <Badge label={name} size={small ? 'sm' : 'md'} />
}

export function SkuText({ sku, small }: { sku: string; small?: boolean }) {
  return (
    <Text className={`${small ? 'text-[11px]' : 'text-xs'} text-foreground-muted`} style={{ fontFamily: 'monospace' }}>
      SKU: {sku}
    </Text>
  )
}

export function VariantChips({ variant, subVariant }: { variant?: string | null; subVariant?: string | null }) {
  if (!variant && !subVariant) return null
  return (
    <View className="mt-1 flex-row flex-wrap gap-1">
      {variant ? <Badge label={variant} tone="accent" /> : null}
      {subVariant ? <Badge label={subVariant} /> : null}
    </View>
  )
}
