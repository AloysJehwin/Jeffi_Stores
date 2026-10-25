import { useCallback, useState } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Gradient, IconButton, PagerDots, Text, elevationClass, useElevation, useSwipe } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { SectionHeading } from './layout'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { status } from '../../theme'
import type { ProductOffer, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/OfferSlider.tsx at the mobile breakpoint (no peeks).

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function OfferSlider({ section, data }: SectionProps) {
  if (data.offers.length === 0) return null
  return <Slider offers={data.offers} title={section.copy.title} eyebrow={section.copy.eyebrow} />
}

function Slider({ offers, title, eyebrow }: { offers: ProductOffer[]; title?: string | null; eyebrow?: string | null }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [active, setActive] = useState(0)
  const count = offers.length
  const go = useCallback((next: number) => setActive(((next % count) + count) % count), [count])
  const step = useCallback((d: number) => setActive(a => (((a + d) % count) + count) % count), [count])

  const swipe = useSwipe(step)

  const single = count === 1
  const index = active < count ? active : 0
  const current = offers[index]
  const cardHeight = Math.min(352, Math.max(176, width * 0.44)) // h-[clamp(11rem,44vw,22rem)]
  // top-1/2 of the slider box, which includes the mt-4 h-2 dot row
  const arrowTop = (cardHeight + 24) / 2 - 18

  return (
    <View className="bg-surface py-8" style={{ paddingHorizontal: 12 }}>
      {eyebrow || title ? (
        <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName="text-primary-500" className="mb-5 px-1" />
      ) : null}

      <View {...swipe}>
        <Pressable onPress={() => openHref(router, `/products?offer=${encodeURIComponent(current.slug)}`)} accessibilityRole="button" accessibilityLabel={`Shop ${current.title}`}>
          <OfferCard offer={current} height={cardHeight} titleSize={Math.min(36, Math.max(20, width * 0.032))} />
        </Pressable>

        {!single && (
          <>
            <View className="absolute left-1 z-20" style={{ top: arrowTop }}>
              <IconButton icon={ChevronLeft} label="Previous offer" variant="overlay" size="sm" onPress={() => go(index - 1)} />
            </View>
            <View className="absolute right-1 z-20" style={{ top: arrowTop }}>
              <IconButton icon={ChevronRight} label="Next offer" variant="overlay" size="sm" onPress={() => go(index + 1)} />
            </View>

            <PagerDots count={count} index={index} onSelect={go} tone="primary" label={i => `Go to offer ${i + 1}`} className="mt-4" />
          </>
        )}
      </View>
    </View>
  )
}

function OfferCard({ offer, height, titleSize }: { offer: ProductOffer; height: number; titleSize: number }) {
  const src = absUrl(offer.image_url_mobile ?? offer.image_url)
  const blurhash = offer.blurhash_mobile || offer.blurhash || null
  const shadow = useElevation('overlay')

  return (
    <View style={shadow} className={`rounded-panel ${elevationClass('overlay')}`}>
      <View className="w-full overflow-hidden rounded-panel bg-black" style={{ height }}>
        <Image
          source={src ? { uri: src } : undefined}
          placeholder={blurhash ? { blurhash } : undefined}
          style={FILL}
          contentFit="cover"
          transition={200}
          accessibilityLabel={offer.title}
        />
        {/* bg-gradient-to-t from-black/70 via-black/10 to-transparent */}
        <Gradient dir="t" stops={[[0, status.black, 0.7], [0.5, status.black, 0.1], [1, status.black, 0]]} />

        <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 p-5">
          {offer.badge_text ? (
            <View className={`mb-3 self-start rounded-lg px-3 py-1.5 ${badgeBg(offer.badge_color, 'bg-primary-500')}`}>
              <Text className="text-[11px] font-extrabold uppercase text-white" style={{ letterSpacing: 1.5 }}>
                {offer.badge_text}
              </Text>
            </View>
          ) : null}
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
