import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { status } from '../../theme'
import type { PromoOffer } from '../../api/products'

// Mirror of controller-service components/visitor/listing/ListingPromoBanner.tsx at the mobile breakpoint
// (the server picks the offer: listing-model promoOffer).

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function ListingPromoBanner({ offer }: { offer: PromoOffer }) {
  const router = useRouter()
  const src = absUrl(offer.image_url_mobile || offer.image_url)
  if (!src) return null
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  return (
    <Pressable
      onPress={() => openHref(router, `/products?offer=${encodeURIComponent(offer.slug)}`)}
      accessibilityLabel={`Shop ${offer.title}`}
      className="w-full overflow-hidden rounded-2xl bg-black shadow-sm"
      style={{ height: 144 }}
    >
      <Image source={{ uri: src }} placeholder={blurhash ? { blurhash } : undefined} style={FILL} contentFit="cover" transition={200} />
      {/* bg-gradient-to-r from-black/75 via-black/40 to-transparent */}
      <Svg style={FILL} width="100%" height="100%">
        <Defs>
          <LinearGradient id="promo" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={status.black} stopOpacity={0.75} />
            <Stop offset="0.5" stopColor={status.black} stopOpacity={0.4} />
            <Stop offset="1" stopColor={status.black} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#promo)" />
      </Svg>
      <View className="h-full items-start justify-center gap-1.5 px-5" style={{ maxWidth: '85%' }}>
        {offer.badge_text ? (
          <View className={`rounded px-2.5 py-1 ${badgeBg(offer.badge_color)}`}>
            <Text className="text-[10px] font-black uppercase text-white" style={{ letterSpacing: 1.5 }}>
              {offer.badge_text}
            </Text>
          </View>
        ) : null}
        <Text className="font-black text-white" style={{ fontSize: 17.6, lineHeight: 22, letterSpacing: -0.4 }}>
          {offer.title}
        </Text>
        {offer.subtitle ? (
          <Text numberOfLines={2} className="text-xs text-white/75" style={{ lineHeight: 19.5 }}>
            {offer.subtitle}
          </Text>
        ) : null}
        <View className="mt-1 rounded-lg bg-white px-3.5 py-1.5">
          <Text className="text-xs font-bold text-black">{offer.cta_label || 'Shop the offer'}</Text>
        </View>
      </View>
    </Pressable>
  )
}
