import { Pressable, View } from 'react-native'
import { Button, Card, Gradient, Overline, Pill, Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Package } from 'lucide-react-native'
import { DealCountdown } from './DealOfTheDay'
import { useImageSource } from '../../hooks/useImageSource'
import { inr } from '../../lib/format'
import { accent, primary, useTokens } from '../../theme'
import type { CountdownDeal, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CountdownDealBanner.tsx at the mobile breakpoint.

const COPY = { eyebrow: 'Limited time', title: 'Deal ends soon', ctaLabel: 'Grab the deal' }

export default function CountdownDealBanner({ section, data }: SectionProps) {
  const router = useRouter()
  const t = useTokens()
  const imgSource = useImageSource()
  const deal = data.extras[section.id] as CountdownDeal | null | undefined
  if (!deal) return null

  const { product, endsAt } = deal
  const open = () => router.push(`/product/${product.slug}`)
  const image = product.primaryImage
  const showMrp = product.mrp != null && product.mrp > product.displayPrice

  return (
    <View className="bg-surface px-4 py-10">
      <Card padded={false} className="overflow-hidden">
        {/* bg-gradient-to-br from-primary-500/10 via-surface-elevated to-accent-500/10 */}
        <Gradient stops={[[0, primary[500], 0.1], [0.5, t.surfaceElevated], [1, accent[500], 0.1]]} />

        <View className="items-center gap-6 p-5">
          <Pressable
            onPress={open}
            className="overflow-hidden rounded-xl bg-surface-elevated"
            style={{ width: '100%', maxWidth: 384, aspectRatio: 1 }}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            {image ? (
              <Image
                source={imgSource(image.image_url, 352)}
                placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
                style={{ flex: 1, margin: 16 }}
                contentFit="contain"
                transition={200}
              />
            ) : (
              <View className="flex-1 items-center justify-center">
                <Package size={64} color={t.foregroundMuted} />
              </View>
            )}
            {product.mrpDiscount > 0 && <Pill label={`${product.mrpDiscount}% off`} tone="accent" className="absolute left-3 top-3" />}
          </Pressable>

          <View className="w-full items-center gap-3">
            <Overline className="text-center text-primary-500" style={{ letterSpacing: 2 }}>
              {section.copy.eyebrow ?? COPY.eyebrow}
            </Overline>
            <Text accessibilityRole="header" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
              {section.copy.title ?? COPY.title}
            </Text>
            {product.brandName ? (
              <Text className="text-center text-xs font-medium uppercase text-accent-600 dark:text-accent-400" style={{ letterSpacing: 0.3 }}>
                {product.brandName}
              </Text>
            ) : null}
            <Text accessibilityRole="link" onPress={open} className="text-center text-lg font-semibold text-foreground">
              {product.name}
            </Text>
            <View className="flex-row items-baseline gap-3">
              <Text className="text-3xl font-black text-primary-600 dark:text-primary-400">
                {product.hasVariants ? 'From ' : ''}₹{inr(product.displayPrice)}
              </Text>
              {showMrp && <Text className="text-base text-foreground-muted line-through">₹{inr(product.mrp)}</Text>}
            </View>
            {endsAt ? (
              <View className="items-center gap-1.5">
                <Text className="text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
                  Offer ends in
                </Text>
                <DealCountdown endsAt={endsAt} />
              </View>
            ) : null}
            <Button label={section.copy.ctaLabel ?? COPY.ctaLabel} onPress={open} haptics className="mt-2" />
          </View>
        </View>
      </Card>
    </View>
  )
}
