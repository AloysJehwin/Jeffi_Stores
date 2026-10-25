import { Pressable, View, useWindowDimensions } from 'react-native'
import Animated from 'react-native-reanimated'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { useImageSource } from '../../hooks/useImageSource'
import { status } from '../../theme'
import { Gradient, Text, elevationClass, useElevation, usePressScale } from '../../ui'
import type { PromoOffer } from '../../api/products'

// Mirror of controller-service components/visitor/listing/ListingPromoBanner.tsx at the mobile breakpoint
// (the server picks the offer: listing-model promoOffer).

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function ListingPromoBanner({ offer }: { offer: PromoOffer }) {
  const router = useRouter()
  const shadow = useElevation('overlay')
  const press = usePressScale(0.985)
  const imgSource = useImageSource()
  const { width } = useWindowDimensions()
  const src = absUrl(offer.image_url_mobile || offer.image_url)
  if (!src) return null
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  return (
    <Animated.View style={[shadow, { borderRadius: 20 }, press.style]}>
      <Pressable
        onPress={() => openHref(router, `/products?offer=${encodeURIComponent(offer.slug)}`)}
        accessibilityRole="button"
        accessibilityLabel={`Shop ${offer.title}`}
        {...press.handlers}
        className={`w-full overflow-hidden rounded-panel bg-black ${elevationClass('overlay')}`}
        style={{ height: 144 }}
      >
        <Image source={imgSource(src, width)} placeholder={blurhash ? { blurhash } : undefined} style={FILL} contentFit="cover" transition={200} />
        {/* bg-gradient-to-r from-black/75 via-black/40 to-transparent */}
        <Gradient dir="r" stops={[[0, status.black, 0.75], [0.5, status.black, 0.4], [1, status.black, 0]]} />
        <View className="h-full items-start justify-center gap-1.5 px-5" style={{ maxWidth: '85%' }}>
          {offer.badge_text ? (
            <View className={`rounded-full px-2.5 py-1 ${badgeBg(offer.badge_color)}`}>
              <Text className="text-[11px] font-extrabold uppercase text-white" style={{ letterSpacing: 1.5 }}>
                {offer.badge_text}
              </Text>
            </View>
          ) : null}
          <Text className="font-display font-extrabold text-white" style={{ fontSize: 17.6, lineHeight: 22, letterSpacing: -0.4 }}>
            {offer.title}
          </Text>
          {offer.subtitle ? (
            <Text numberOfLines={2} className="text-xs text-white/75" style={{ lineHeight: 19.5 }}>
              {offer.subtitle}
            </Text>
          ) : null}
          {/* The whole banner is the button; this is its label. */}
          <View className="mt-1 rounded-full bg-white px-3.5 py-1.5">
            <Text className="text-xs font-bold text-black">{offer.cta_label || 'Shop the offer'}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}
