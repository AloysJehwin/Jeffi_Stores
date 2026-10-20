import { Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Package } from 'lucide-react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { DealCountdown } from './DealOfTheDay'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { accent, primary, useTokens } from '../../theme'
import type { CountdownDeal, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CountdownDealBanner.tsx at the mobile breakpoint.

const COPY = { eyebrow: 'Limited time', title: 'Deal ends soon', ctaLabel: 'Grab the deal' }

export default function CountdownDealBanner({ section, data }: SectionProps) {
  const router = useRouter()
  const t = useTokens()
  const deal = data.extras[section.id] as CountdownDeal | null | undefined
  if (!deal) return null

  const { product, endsAt } = deal
  const open = () => router.push(`/product/${product.slug}`)
  const image = product.primaryImage
  const showMrp = product.mrp != null && product.mrp > product.displayPrice

  return (
    <View className="bg-surface px-4 py-10">
      <View className="overflow-hidden rounded-2xl border border-border-default">
        {/* bg-gradient-to-br from-primary-500/10 via-surface-elevated to-accent-500/10 */}
        <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
          <Defs>
            <LinearGradient id="cdbg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={primary[500]} stopOpacity={0.1} />
              <Stop offset="0.5" stopColor={t.surfaceElevated} />
              <Stop offset="1" stopColor={accent[500]} stopOpacity={0.1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#cdbg)" />
        </Svg>

        <View className="items-center gap-6 p-5">
          <Pressable
            onPress={open}
            className="overflow-hidden rounded-xl bg-surface-elevated"
            style={{ width: '100%', maxWidth: 384, aspectRatio: 1 }}
            accessibilityLabel={product.name}
          >
            {image ? (
              <Image
                source={{ uri: absUrl(image.image_url) ?? image.image_url }}
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
            {product.mrpDiscount > 0 && (
              <View className="absolute left-3 top-3 rounded-full bg-accent-500 px-2.5 py-1 dark:bg-accent-600">
                <Text className="text-sm font-bold text-white">{product.mrpDiscount}% off</Text>
              </View>
            )}
          </Pressable>

          <View className="w-full items-center gap-3">
            <Text className="text-center text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
              {section.copy.eyebrow ?? COPY.eyebrow}
            </Text>
            <Text className="text-center text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
              {section.copy.title ?? COPY.title}
            </Text>
            {product.brandName ? (
              <Text className="text-center text-xs font-medium uppercase text-accent-600 dark:text-accent-400" style={{ letterSpacing: 0.3 }}>
                {product.brandName}
              </Text>
            ) : null}
            <Text onPress={open} className="text-center text-lg font-semibold text-foreground">
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
            <Pressable onPress={open} className="mt-2 rounded-xl bg-primary-500 px-8 py-3 shadow-lg shadow-primary-500/20 active:bg-primary-600">
              <Text className="font-bold text-white">{section.copy.ctaLabel ?? COPY.ctaLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  )
}
