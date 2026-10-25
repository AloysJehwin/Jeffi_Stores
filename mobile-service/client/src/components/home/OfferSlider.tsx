import { Pressable, View, useWindowDimensions } from 'react-native'
import { Gradient, PeekPager, Text, Title, elevationClass, useElevation } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ArrowRight } from 'lucide-react-native'
import { SectionHeading } from './layout'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { status } from '../../theme'
import type { ProductOffer, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/OfferSlider.tsx at the mobile breakpoint: several offers
// are 4:5 cards whose neighbours peek in and fade; a lone offer stays one wide banner.

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const
const ASPECT = 4 / 5
const MAX_CARD = 360 // card width cap on tablets
// Room in each page for the card's shadow; the pager's ScrollView clips its content.
const SHADOW_TOP = 8
const SHADOW_BOTTOM = 16

export default function OfferSlider({ section, data }: SectionProps) {
  if (data.offers.length === 0) return null
  return <Offers offers={data.offers} title={section.copy.title} eyebrow={section.copy.eyebrow} />
}

const shopLabel = (o: ProductOffer) => [`Shop ${o.title}`, o.badge_text, o.subtitle].filter(Boolean).join(', ')

function Offers({ offers, title, eyebrow }: { offers: ProductOffer[]; title?: string | null; eyebrow?: string | null }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const open = (o: ProductOffer) => openHref(router, `/products?offer=${encodeURIComponent(o.slug)}`)
  const single = offers.length === 1

  return (
    <View className="bg-surface py-8">
      {eyebrow || title ? (
        <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName="text-primary-500" className={single ? 'mb-5 px-4' : 'mb-4 px-4'} />
      ) : null}

      {single ? (
        <View className="px-3">
          <Pressable onPress={() => open(offers[0])} accessibilityRole="button" accessibilityLabel={shopLabel(offers[0])}>
            <OfferBanner offer={offers[0]} width={width} />
          </Pressable>
        </View>
      ) : (
        <PeekPager
          data={offers}
          keyExtractor={o => o.id}
          peek={Math.min(0.72, MAX_CARD / width)}
          height={w => Math.round(w / ASPECT) + SHADOW_TOP + SHADOW_BOTTOM}
          onPress={o => open(o)}
          itemLabel={shopLabel}
          dots={{ tone: 'primary', label: i => `Go to offer ${i + 1}`, className: 'mt-1' }}
          renderItem={(o, { width: w }) => <OfferCard offer={o} height={Math.round(w / ASPECT)} />}
        />
      )}
    </View>
  )
}

/** The card's own image first, then the mobile and wide ones, each with its blurhash. */
function cardImage(o: ProductOffer) {
  if (o.image_url_card) return { src: absUrl(o.image_url_card), blurhash: o.blurhash_card || o.blurhash || null }
  if (o.image_url_mobile) return { src: absUrl(o.image_url_mobile), blurhash: o.blurhash_mobile || o.blurhash || null }
  return { src: absUrl(o.image_url), blurhash: o.blurhash || null }
}

function OfferBadge({ offer, shape = 'rounded-full' }: { offer: ProductOffer; shape?: string }) {
  if (!offer.badge_text) return null
  return (
    <View className={`mb-3 self-start px-3 py-1.5 ${shape} ${badgeBg(offer.badge_color, 'bg-primary-500')}`}>
      <Text className="text-[11px] font-extrabold uppercase text-white" style={{ letterSpacing: 1.5 }}>
        {offer.badge_text}
      </Text>
    </View>
  )
}

function OfferCard({ offer, height }: { offer: ProductOffer; height: number }) {
  const shadow = useElevation('overlay')
  const { src, blurhash } = cardImage(offer)
  return (
    <View style={[shadow, { marginTop: SHADOW_TOP }]} className={`rounded-panel ${elevationClass('overlay')}`}>
      <View className="w-full overflow-hidden rounded-panel bg-black" style={{ height }}>
        <Image
          recyclingKey={src}
          source={src ? { uri: src } : undefined}
          placeholder={blurhash ? { blurhash } : undefined}
          style={FILL}
          contentFit="cover"
          transition={200}
        />
        <Gradient dir="t" stops={[[0, status.black, 0.8], [0.45, status.black, 0.25], [1, status.black, 0]]} />

        <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 p-4">
          <OfferBadge offer={offer} />
          <Title className="text-white" numberOfLines={3}>
            {offer.title}
          </Title>
          {offer.subtitle ? (
            <Text className="mt-1 text-sm leading-5 text-white/75" numberOfLines={2}>
              {offer.subtitle}
            </Text>
          ) : null}
          {offer.cta_label ? (
            <View className="mt-3 flex-row items-center gap-1.5 self-start rounded-full bg-white px-4 py-2">
              <Text className="text-xs font-bold text-black">{offer.cta_label}</Text>
              <ArrowRight size={14} color={status.black} strokeWidth={2.5} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function OfferBanner({ offer, width }: { offer: ProductOffer; width: number }) {
  const shadow = useElevation('overlay')
  const height = Math.min(352, Math.max(176, width * 0.44)) // h-[clamp(11rem,44vw,22rem)]
  const titleSize = Math.min(36, Math.max(20, width * 0.032))
  const src = absUrl(offer.image_url_mobile ?? offer.image_url)
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  return (
    <View style={shadow} className={`rounded-panel ${elevationClass('overlay')}`}>
      <View className="w-full overflow-hidden rounded-panel bg-black" style={{ height }}>
        <Image
          recyclingKey={src}
          source={src ? { uri: src } : undefined}
          placeholder={blurhash ? { blurhash } : undefined}
          style={FILL}
          contentFit="cover"
          transition={200}
        />
        {/* bg-gradient-to-t from-black/70 via-black/10 to-transparent */}
        <Gradient dir="t" stops={[[0, status.black, 0.7], [0.5, status.black, 0.1], [1, status.black, 0]]} />

        <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 p-5">
          <OfferBadge offer={offer} shape="rounded-lg" />
          <Text className="font-display font-extrabold text-white" style={{ fontSize: titleSize, lineHeight: titleSize * 1.25, letterSpacing: -titleSize * 0.025 }}>
            {offer.title}
          </Text>
          {offer.subtitle ? <Text className="mt-1 text-xs leading-relaxed text-white/70">{offer.subtitle}</Text> : null}
          {offer.cta_label ? (
            <View className="mt-3 self-start rounded-xl bg-white px-4 py-2">
              <Text className="text-xs font-bold text-black">{offer.cta_label}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}
