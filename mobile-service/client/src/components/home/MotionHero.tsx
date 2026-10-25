import { useEffect, useId, useRef } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ArrowRight } from 'lucide-react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { GUTTER } from './layout'
import { absUrl, openHref } from '../../lib/links'
import { status } from '../../theme'
import type { MotionHeroData, MotionHeroSlide, SectionProps } from '../../types/home'

// Swiggy-style animated hero: paged cards whose foreground drifts slower than the card, autoplaying
// unless a finger is down or the system asks for less motion.

const GAP = 12
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function MotionHero({ section, data }: SectionProps) {
  const hero = data.extras[section.id] as MotionHeroData | undefined
  if (!hero?.slides.length) return null
  return <Pager slides={hero.slides} intervalMs={hero.intervalMs} />
}

function Pager({ slides, intervalMs }: { slides: MotionHeroSlide[]; intervalMs: number }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const reduceMotion = useReducedMotion()
  const cardW = width - GUTTER * 2
  const cardH = Math.min(420, Math.round(cardW * 0.9))
  const page = cardW + GAP
  const count = slides.length
  const autoplay = count > 1 && !reduceMotion

  const ref = useAnimatedRef<Animated.ScrollView>()
  const x = useSharedValue(0)
  const active = useRef(0)
  const touching = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restarted on every page change (swipe or auto), so a slide always gets its full interval.
  const schedule = useRef<(delay: number) => void>(() => {})
  schedule.current = delay => {
    if (timer.current) clearTimeout(timer.current)
    if (!autoplay) return
    timer.current = setTimeout(() => {
      if (touching.current) return schedule.current(600)
      ref.current?.scrollTo({ x: ((active.current + 1) % count) * page, animated: true })
    }, delay)
  }
  useEffect(() => {
    schedule.current(intervalMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [intervalMs, autoplay, count, page])

  const landed = (i: number) => {
    active.current = i
    schedule.current(intervalMs)
  }
  const onScroll = useAnimatedScrollHandler(e => {
    x.value = e.contentOffset.x
  })
  useAnimatedReaction(
    () => Math.min(count - 1, Math.max(0, Math.round(x.value / page))),
    (cur, prev) => {
      if (cur !== prev) runOnJS(landed)(cur)
    },
    [page, count]
  )

  const release = () => {
    touching.current = false
    schedule.current(intervalMs)
  }

  return (
    <View className="bg-surface pb-4 pt-3">
      <Animated.ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={count > 1}
        snapToInterval={page}
        disableIntervalMomentum
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onTouchStart={() => (touching.current = true)}
        onTouchEnd={release}
        onTouchCancel={release}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
      >
        {slides.map((slide, i) => (
          <Card
            key={`${i}-${slide.bgImage}`}
            slide={slide}
            i={i}
            x={x}
            page={page}
            w={cardW}
            h={cardH}
            still={reduceMotion}
            onPress={slide.url ? () => openHref(router, slide.url) : undefined}
          />
        ))}
      </Animated.ScrollView>

      {count > 1 && (
        <View className="mt-3 flex-row items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <Pill key={i} i={i} x={x} page={page} onPress={() => ref.current?.scrollTo({ x: i * page, animated: true })} />
          ))}
        </View>
      )}
    </View>
  )
}

function Card({
  slide,
  i,
  x,
  page,
  w,
  h,
  still,
  onPress,
}: {
  slide: MotionHeroSlide
  i: number
  x: SharedValue<number>
  page: number
  w: number
  h: number
  still: boolean
  onPress?: () => void
}) {
  const gid = `mh${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const bg = absUrl(slide.bgImage)
  const fg = absUrl(slide.fgImage)
  const range = [(i - 1) * page, i * page, (i + 1) * page]
  const titleSize = Math.min(40, Math.max(26, Math.round(w * 0.085)))

  // Relative to the card: the background lags a little, the foreground more, so the layers separate while paging.
  const bgStyle = useAnimatedStyle(() =>
    still
      ? {}
      : { transform: [{ scale: 1.12 }, { translateX: interpolate(x.value, range, [-page * 0.08, 0, page * 0.08], Extrapolation.CLAMP) }] }
  )
  const fgStyle = useAnimatedStyle(() =>
    still ? {} : { transform: [{ translateX: interpolate(x.value, range, [-page * 0.28, 0, page * 0.28], Extrapolation.CLAMP) }] }
  )
  const textStyle = useAnimatedStyle(() =>
    still
      ? {}
      : {
          opacity: interpolate(x.value, range, [0, 1, 0], Extrapolation.CLAMP),
          transform: [{ translateY: interpolate(x.value, range, [14, 0, 14], Extrapolation.CLAMP) }],
        }
  )

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ width: w, height: h }}
      className="overflow-hidden rounded-3xl bg-black"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={slide.headline}
    >
      <Animated.View style={[FILL, bgStyle]}>
        <Image source={bg ? { uri: bg } : undefined} style={FILL} contentFit="cover" transition={300} />
      </Animated.View>
      <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={status.black} stopOpacity={0.35} />
            <Stop offset="0.4" stopColor={status.black} stopOpacity={0} />
            <Stop offset="1" stopColor={status.black} stopOpacity={0.9} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gid})`} />
      </Svg>

      {fg ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 0, bottom: 0, width: w * 0.5, height: h * 0.72 }, fgStyle]}>
          <Image source={{ uri: fg }} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom right" transition={300} />
        </Animated.View>
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, maxWidth: fg ? '64%' : '90%' }, textStyle]}
      >
        {slide.eyebrow ? (
          <Text className="mb-2 text-[10px] font-black uppercase text-white/70" style={{ letterSpacing: 2 }}>
            {slide.eyebrow}
          </Text>
        ) : null}
        <Text
          className="font-black text-white"
          numberOfLines={3}
          style={{ fontSize: titleSize, lineHeight: Math.round(titleSize * 1.02), letterSpacing: -titleSize * 0.02 }}
        >
          {slide.headline}
        </Text>
        {slide.sub ? (
          <Text className="mt-2 text-sm leading-5 text-white/70" numberOfLines={2}>
            {slide.sub}
          </Text>
        ) : null}
        {slide.ctaLabel ? (
          <View className="mt-4 flex-row items-center gap-1.5 self-start rounded-full bg-white px-4 py-2.5">
            <Text className="text-sm font-bold text-black">{slide.ctaLabel}</Text>
            <ArrowRight size={16} color={status.black} strokeWidth={2.5} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

// Pager pill: wide and solid for the current page, driven from the scroll offset so it tracks the drag.
function Pill({ i, x, page, onPress }: { i: number; x: SharedValue<number>; page: number; onPress: () => void }) {
  const range = [(i - 1) * page, i * page, (i + 1) * page]
  const style = useAnimatedStyle(() => ({
    width: interpolate(x.value, range, [6, 20, 6], Extrapolation.CLAMP),
    opacity: interpolate(x.value, range, [0.25, 1, 0.25], Extrapolation.CLAMP),
  }))
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={`Go to slide ${i + 1}`}>
      <Animated.View className="h-1.5 rounded-full bg-foreground" style={style} />
    </Pressable>
  )
}
