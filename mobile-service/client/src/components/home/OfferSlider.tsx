import { useCallback, useEffect, useMemo, useState } from 'react'
import { PanResponder, Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { SectionHeading } from './layout'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { primary, status, useTokens } from '../../theme'
import type { ProductOffer, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/OfferSlider.tsx at the mobile breakpoint (no peeks).

const SWIPE_THRESHOLD = 50
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

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > SWIPE_THRESHOLD) step(g.dx < 0 ? 1 : -1)
        },
      }),
    [step]
  )

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

      <View {...pan.panHandlers}>
        <Pressable onPress={() => openHref(router, `/products?offer=${encodeURIComponent(current.slug)}`)} accessibilityLabel={`Shop ${current.title}`}>
          <OfferCard offer={current} height={cardHeight} titleSize={Math.min(36, Math.max(20, width * 0.032))} />
        </Pressable>

        {!single && (
          <>
            <Pressable
              onPress={() => go(index - 1)}
              accessibilityLabel="Previous offer"
              className="absolute left-1 z-20 h-9 w-9 items-center justify-center rounded-full bg-black/50 active:bg-black/70"
              style={{ top: arrowTop }}
            >
              <ChevronLeft size={18} strokeWidth={2.5} color={status.white} />
            </Pressable>
            <Pressable
              onPress={() => go(index + 1)}
              accessibilityLabel="Next offer"
              className="absolute right-1 z-20 h-9 w-9 items-center justify-center rounded-full bg-black/50 active:bg-black/70"
              style={{ top: arrowTop }}
            >
              <ChevronRight size={18} strokeWidth={2.5} color={status.white} />
            </Pressable>

            <View className="flex-row items-center justify-center gap-2" style={{ marginTop: 16 }}>
              {offers.map((_, i) => (
                <Dot key={i} on={i === index} onPress={() => go(i)} label={`Go to offer ${i + 1}`} />
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  )
}

// Pager pill: bg-primary-500 w-5 when active, bg-foreground/20 w-2 otherwise (transition-all duration-300).
function Dot({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const t = useTokens()
  const w = useSharedValue(on ? 20 : 8)
  useEffect(() => {
    w.value = withTiming(on ? 20 : 8, { duration: 300 })
  }, [on, w])
  const style = useAnimatedStyle(() => ({ width: w.value }))
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={label}>
      <Animated.View
        style={[{ height: 8, borderRadius: 999 }, style, on ? { backgroundColor: primary[500] } : { backgroundColor: t.foreground, opacity: 0.2 }]}
      />
    </Pressable>
  )
}

function OfferCard({ offer, height, titleSize }: { offer: ProductOffer; height: number; titleSize: number }) {
  const src = absUrl(offer.image_url_mobile ?? offer.image_url)
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  return (
    <View className="rounded-2xl shadow-xl">
      <View className="w-full overflow-hidden rounded-2xl bg-black" style={{ height }}>
        <Image
          source={src ? { uri: src } : undefined}
          placeholder={blurhash ? { blurhash } : undefined}
          style={FILL}
          contentFit="cover"
          transition={200}
          accessibilityLabel={offer.title}
        />
        {/* bg-gradient-to-t from-black/70 via-black/10 to-transparent */}
        <Svg style={FILL} width="100%" height="100%">
          <Defs>
            <LinearGradient id="offer" x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor={status.black} stopOpacity={0.7} />
              <Stop offset="0.5" stopColor={status.black} stopOpacity={0.1} />
              <Stop offset="1" stopColor={status.black} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#offer)" />
        </Svg>

        <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 p-5">
          {offer.badge_text ? (
            <View className={`mb-3 self-start rounded px-3 py-1.5 ${badgeBg(offer.badge_color, 'bg-primary-500')}`}>
              <Text className="text-[10px] font-black uppercase text-white" style={{ letterSpacing: 1.5 }}>
                {offer.badge_text}
              </Text>
            </View>
          ) : null}
          <Text className="font-black text-white" style={{ fontSize: titleSize, lineHeight: titleSize * 1.25, letterSpacing: -titleSize * 0.025 }}>
            {offer.title}
          </Text>
          {offer.subtitle ? <Text className="mt-1 text-xs leading-relaxed text-white/70">{offer.subtitle}</Text> : null}
          {offer.cta_label ? (
            <View className="mt-3 self-start rounded-lg bg-white px-4 py-2">
              <Text className="text-xs font-bold text-black">{offer.cta_label}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}
