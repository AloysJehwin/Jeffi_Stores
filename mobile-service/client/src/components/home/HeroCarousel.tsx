import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, View, useWindowDimensions, type TextLayoutEventData, type NativeSyntheticEvent } from 'react-native'
import { Gradient, Media, PagerDots, Text, elevationClass, useAutoplay, useElevation, useMotion, useSwipe } from '../../ui'
import { useRouter } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useOnScreen } from './scroll-context'
import { badgeBg } from '../../lib/badge'
import { absUrl, openHref } from '../../lib/links'
import { status } from '../../theme'
import type { HeroSlide, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/HeroCarousel.tsx at the mobile breakpoint.

// Legacy per-category copy — used only when a slide has no DB-provided badge/subtitle.
const LEGACY_COPY: Record<string, { badge: string; badgeColor: string; subtitle: string }> = {
  fasteners: { badge: 'New Arrivals', badgeColor: 'bg-primary-500', subtitle: 'Bolts, nuts, screws & more — precision engineered for industrial use' },
  'power-transmission': { badge: 'Top Picks', badgeColor: 'bg-red-500', subtitle: 'V-belts, timing belts, bearings and transmission components' },
  'tools-equipment': { badge: 'Best Sellers', badgeColor: 'bg-accent-500', subtitle: 'Drill bits, cutting tools and accessories for every job' },
  'welding-supplies': { badge: 'Trusted Quality', badgeColor: 'bg-emerald-600', subtitle: 'Welding rods, electrodes and accessories for every application' },
  'electrical-cables': { badge: 'In Stock', badgeColor: 'bg-blue-600', subtitle: 'Industrial cables, wires and electrical accessories' },
  'industrial-components': { badge: 'Precision Parts', badgeColor: 'bg-purple-600', subtitle: 'Gears, flanges, bearings and machined components' },
  'material-handling': { badge: 'Heavy Duty', badgeColor: 'bg-orange-600', subtitle: 'Chains, hooks, pulleys and lifting equipment' },
  abrasives: { badge: 'Top Picks', badgeColor: 'bg-yellow-600', subtitle: 'Grinding wheels, cutting discs and abrasive products' },
  'lubricants-chemicals': { badge: 'In Stock', badgeColor: 'bg-teal-600', subtitle: 'Industrial lubricants, greases and specialty chemicals' },
  'safety-equipment': { badge: 'Stay Safe', badgeColor: 'bg-rose-600', subtitle: 'PPE, helmets, gloves and workplace safety gear' },
}

const AUTO_ADVANCE_MS = 5000
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

interface Resolved {
  key: string
  title: string
  subtitle: string
  badge: string
  badgeColor: string
  img: string | null
  blurhash: string | null
  video: string | null
}

function resolveSlide(s: HeroSlide, i: number): Resolved {
  const legacy = s.slug ? LEGACY_COPY[s.slug] : undefined
  return {
    key: s.id ?? s.slug ?? String(i),
    title: s.title ?? s.name ?? 'Shop Now',
    subtitle: s.subtitle ?? legacy?.subtitle ?? '',
    badge: s.badge_text ?? legacy?.badge ?? 'Shop Now',
    badgeColor: s.badge_color ?? legacy?.badgeColor ?? 'bg-primary-500',
    img: absUrl(s.image_url_mobile ?? s.image_url ?? s.hero_image_mobile),
    blurhash: s.blurhash_mobile || s.blurhash || null,
    video: s.video_url || null,
  }
}

export default function HeroCarousel({ data }: SectionProps) {
  const slides = data.heroSlides
  if (!slides.length) return null
  return <Carousel slides={slides} />
}

function Carousel({ slides }: { slides: HeroSlide[] }) {
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const [active, setActive] = useState(0)
  const count = slides.length
  const index = active < count ? active : 0
  const resolved = useMemo(() => slides.map(resolveSlide), [slides])

  const go = useCallback((next: number) => setActive(((next % count) + count) % count), [count])
  const step = useCallback((d: number) => setActive(a => (((a + d) % count) + count) % count), [count])

  // Advances only while on screen with the tab focused; off screen a slide change is wasted work mid-scroll.
  const { ref, onLayout, onScreen } = useOnScreen(count > 1 || slides.some(s => s.video_url))
  const auto = useAutoplay(() => step(1), { enabled: count > 1 && onScreen, intervalMs: AUTO_ADVANCE_MS })
  useEffect(() => auto.restart(), [auto, index])
  const swipe = useSwipe(step)

  const open = () => {
    const s = slides[index]
    if (s.href) openHref(router, s.href)
    else if (s.slug) router.push(`/category/${s.slug}`)
    else openHref(router, '/products')
  }

  // h-[clamp(20rem,60svh,32rem)] including pt-3; the card fills the rest
  const boxHeight = Math.min(512, Math.max(320, height * 0.6))
  const cardWidth = width - 24
  const titleSize = Math.min(64, Math.max(32, width * 0.05)) // text-[clamp(2rem,5vw,4rem)]
  const shadow = useElevation('floating')

  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false} className="bg-surface" style={{ height: boxHeight, paddingHorizontal: 12, paddingTop: 12 }}>
      <View style={shadow} className={`flex-1 rounded-sheet ${elevationClass('floating')}`}>
        <View
          className="flex-1 overflow-hidden rounded-sheet bg-black"
          {...swipe}
          onTouchStart={() => auto.hold(true)}
          onTouchEnd={() => auto.hold(false)}
          onTouchCancel={() => auto.hold(false)}
        >
          {resolved.map((s, i) => (
            <Slide key={s.key} slide={s} active={i === index} play={onScreen && i === index} cardWidth={cardWidth} titleSize={titleSize} />
          ))}

          <Pressable
            style={[FILL, { zIndex: 20 }]}
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={[`Shop ${resolved[index].title}`, resolved[index].subtitle, count > 1 && `Slide ${index + 1} of ${count}`].filter(Boolean).join(', ')}
            accessibilityActions={count > 1 ? [{ name: 'next', label: 'Next slide' }, { name: 'previous', label: 'Previous slide' }] : undefined}
            onAccessibilityAction={e => step(e.nativeEvent.actionName === 'previous' ? -1 : 1)}
          />

          <PagerDots count={count} index={index} onSelect={go} tone="white" className="absolute bottom-5 left-0 right-0" style={{ zIndex: 30 }} />
        </View>
      </View>
    </Animated.View>
  )
}

const Slide = memo(function Slide({ slide: s, active, play, cardWidth, titleSize }: { slide: Resolved; active: boolean; play: boolean; cardWidth: number; titleSize: number }) {
  const opacity = useSharedValue(active ? 1 : 0)
  const { animate } = useMotion()
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: animate ? 700 : 0 })
  }, [active, opacity, animate])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const imageWidth = cardWidth * 0.62

  return (
    <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[FILL, { zIndex: active ? 10 : 0 }, fade]}>
      <View className="bg-black" style={FILL}>
        {/* The image covers the right 62%; its left edge fades into the base. */}
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: imageWidth }}>
          <Media image={s.img} video={s.video} blurhash={s.blurhash} style={FILL} width={imageWidth} transition={300} active={play} />
          <Gradient dir="r" stops={[[0, status.black], [0.35, status.black, 0]]} />
        </View>
        {/* bg-gradient-to-r from-35% via-80% at 60% to-transparent, then to-b from-black/20 via-transparent to-black/30 */}
        <Gradient dir="r" stops={[[0.35, status.black], [0.6, status.black, 0.8], [1, status.black, 0]]} />
        <Gradient dir="b" stops={[[0, status.black, 0.2], [0.5, status.black, 0], [1, status.black, 0.3]]} />
      </View>

      <View style={{ height: '100%', maxWidth: '55%', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 64 }}>
        {s.badge ? (
          <View className={`mb-4 self-start rounded-lg px-3 py-1.5 ${badgeBg(s.badgeColor, 'bg-primary-500')}`}>
            <Text className="text-[11px] font-extrabold uppercase text-white" style={{ letterSpacing: 1.5 }}>
              {s.badge}
            </Text>
          </View>
        ) : null}
        <HeroTitle text={s.title.replace(' ', '\n')} maxWidth={cardWidth * 0.55 - 48} fullWidth={cardWidth - 48} fontSize={titleSize} />
        {s.subtitle ? (
          <Text className="text-xs leading-relaxed text-white/50" style={{ maxWidth: 180 }}>
            {s.subtitle}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  )
})

// whitespace-pre-line inside the 55% column: wraps at spaces, but a word wider than the column
// overflows it (as on the web) instead of breaking mid-word. Word widths come from one hidden layout.
function HeroTitle({ text, maxWidth, fullWidth, fontSize }: { text: string; maxWidth: number; fullWidth: number; fontSize: number }) {
  const style = { fontSize, lineHeight: Math.round(fontSize * 0.9), letterSpacing: -fontSize * 0.025 }
  const lines = text.split('\n').map(l => l.split(' ').filter(Boolean))
  const words = Array.from(new Set(lines.flat()))
  const probe = [...words, 'x x', 'xx'].join('\n')
  const [measured, setMeasured] = useState<{ probe: string; fontSize: number; widths: number[] | null } | null>(null)
  const ready = measured && measured.probe === probe && measured.fontSize === fontSize

  const onProbe = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const widths = e.nativeEvent.lines.map(l => l.width)
    setMeasured({ probe, fontSize, widths: widths.length === words.length + 2 ? widths : null })
  }

  let wrapped = lines.map(l => l.join(' '))
  if (ready && measured.widths) {
    const w = measured.widths
    const space = w[words.length] - w[words.length + 1]
    const width = (word: string) => w[words.indexOf(word)]
    wrapped = lines.flatMap(l => {
      const out: string[] = []
      let cur = ''
      let curW = 0
      for (const word of l) {
        if (!cur) {
          cur = word
          curW = width(word)
        } else if (curW + space + width(word) <= maxWidth) {
          cur += ` ${word}`
          curW += space + width(word)
        } else {
          out.push(cur)
          cur = word
          curW = width(word)
        }
      }
      out.push(cur)
      return out
    })
  }

  return (
    <View className="mb-3" style={{ width: maxWidth }}>
      {!ready && (
        <Text onTextLayout={onProbe} className="font-display font-extrabold" style={[style, { position: 'absolute', opacity: 0, width: 4000 }]}>
          {probe}
        </Text>
      )}
      <Text className="font-display font-extrabold text-white" style={[style, { width: fullWidth, opacity: ready ? 1 : 0 }]}>
        {wrapped.join('\n')}
      </Text>
    </View>
  )
}
