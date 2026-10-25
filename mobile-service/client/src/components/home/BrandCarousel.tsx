import { View } from 'react-native'
import { Card, Text } from '../../ui'
import { useRouter } from 'expo-router'
import { Carousel, Grid, SectionHeading } from './layout'
import { openHref } from '../../lib/links'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/BrandCarousel.tsx.
export default function BrandCarousel({ section, data }: SectionProps) {
  const router = useRouter()
  const brands = data.topBrands
  if (brands.length === 0) return null

  const items = brands.map(brand => (
    <Card
      key={brand.id}
      onPress={() => openHref(router, `/brands/${brand.slug}`)}
      accessibilityLabel={`${brand.name}, ${brand.product_count} items`}
      padded={false}
      wrapperClassName="flex-1"
      className="flex-1 items-center gap-2 p-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-500/10">
        <Text className="text-xs font-black text-accent-600 dark:text-accent-400">{brand.name.slice(0, 2).toUpperCase()}</Text>
      </View>
      <Text numberOfLines={2} className="text-center text-[11px] font-semibold text-foreground" style={{ lineHeight: 14 }}>
        {brand.name}
      </Text>
      <Text className="text-[11px] text-foreground-muted">{brand.product_count} items</Text>
    </Card>
  ))

  // "All brands" is hidden below sm on the web.
  return (
    <View className="border-y border-border-default bg-surface-elevated px-4 py-8">
      <SectionHeading
        eyebrow={section.copy.eyebrow}
        title={section.copy.title}
        eyebrowClassName="text-primary-500"
        titleClassName="font-display text-xl font-extrabold tracking-tight text-foreground"
        className="mb-5"
      />
      {section.layout === 'carousel' ? (
        <Carousel itemWidth={0.22}>{items}</Carousel>
      ) : (
        <Grid cols={4} gap={12}>{items}</Grid>
      )}
    </View>
  )
}
