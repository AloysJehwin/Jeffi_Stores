import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View, useWindowDimensions, type AccessibilityActionEvent } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'
import {
  FadePager,
  GUTTER,
  Gradient,
  Media,
  Overline,
  Pager,
  PeekPager,
  Rail,
  Text,
  elevationClass,
  useElevation,
  useMotion,
  usePageParallax,
  usePageReveal,
  type PageAction,
  type PageInfo,
} from '../../ui'
import QuickAddButton from '../product/QuickAddButton'
import { SHADOW_ROOM, SectionHeading, SlideBadge, SlideCta } from './layout'
import { useOnScreen } from './scroll-context'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { productLabel } from '../../lib/a11y'
import { inr } from '../../lib/format'
import { absUrl, openHref, type RemoteImage } from '../../lib/links'
import { useImageSource } from '../../hooks/useImageSource'
import { openQuickAdd } from '../../stores/quickAddStore'
import { primary, status } from '../../theme'
import type { CardProduct, SectionProps, SlideCard, SlidesData } from '../../types/home'

// The slides section (homepage-extras.ts getSlides): offer, category, product and custom slides as peeking
// cards, full-width banners, a rail or a crossfade, all in the section's shape.

type Shape = SlidesData['aspect']
type Motion = SlideCard['motion']

const RATIO: Record<Shape, number> = { '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 }
// cards: the card's share of the screen, capped on tablets; rail: the card's share of the row.
const PEEK: Record<Shape, { share: number; max: number }> = {
  '4:5': { share: 0.72, max: 360 },
  '1:1': { share: 0.72, max: 360 },
  '16:9': { share: 0.86, max: 560 },
}
const RAIL_SHARE: Record<Shape, number> = { '4:5': 0.62, '1:1': 0.62, '16:9': 0.85 }
const MAX_HEIGHT = 460 // banner / fade: tall shapes on wide screens
const KENBURNS_MS = 9000
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const
const CAPTION = { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 } as const
const SCRIM = [[0, status.black, 0.8], [0.45, status.black, 0.25], [1, status.black, 0]] as const

export default function SlidesSection({ section, data }: SectionProps) {
  const cfg = data.extras[section.id] as SlidesData | undefined
  if (!cfg?.slides.length) return null
  return <Slides cfg={cfg} eyebrow={section.copy.eyebrow} title={section.copy.title} />
}

function slideLabel(s: SlideCard): string {
  if (s.product) {
    return productLabel({
      name: s.title,
      price: s.price ?? s.product.displayPrice,
      from: s.product.hasVariants,
      mrp: s.mrp ?? s.product.mrp,
      discountPct: s.product.mrpDiscount || undefined,
      extra: [s.eyebrow],
    })
  }
  return [s.eyebrow, s.title, s.badge, s.sub, s.ctaLabel].filter(Boolean).join(', ')
}

function Slides({ cfg, eyebrow, title }: { cfg: SlidesData; eyebrow?: string; title?: string }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { digitalProductsEnabled } = useStoreConfig().flags
  const [current, setCurrent] = useState(0)
  const { slides, aspect } = cfg
  const ratio = RATIO[aspect]
  // A lone card would float mid-screen; like the offer slider, it becomes a banner.
  const layout = cfg.layout === 'cards' && slides.length === 1 ? 'banner' : cfg.layout
  const { ref, onLayout, onScreen } = useOnScreen(layout !== 'rail' && slides.some(s => s.video || s.videoCard))

  const inStock = (p: CardProduct) => (digitalProductsEnabled && p.isDigital) || p.effectiveStock > 0
  const open = (s: SlideCard) => openHref(router, s.href)
  const actions = (s: SlideCard): PageAction[] => {
    const p = s.product
    return p && inStock(p) ? [{ name: 'quickAdd', label: p.hasVariants ? 'Choose options' : 'Quick add to cart', run: () => openQuickAdd(p) }] : []
  }
  // A clip plays on the slide on show while the section is on screen; rail slides keep their posters.
  const card = (s: SlideCard, w: number, h: number, on: boolean, info?: PageInfo, room = true, play = on && onScreen) => (
    <SlideCardView
      slide={s}
      width={w}
      height={h}
      shape={aspect}
      current={on}
      play={play}
      info={info}
      room={room}
      inStock={!!s.product && inStock(s.product)}
    />
  )
  const pager = {
    data: slides,
    keyExtractor: (s: SlideCard) => s.id,
    onPress: open,
    canPress: (s: SlideCard) => !!s.href,
    itemLabel: slideLabel,
    itemActions: actions,
    autoplay: cfg.autoplay,
    intervalMs: cfg.intervalSeconds * 1000,
    onIndexChange: setCurrent,
  }
  const wideHeight = (w: number) => Math.min(MAX_HEIGHT, Math.round(w / ratio))
  const withRoom = (h: number) => h + SHADOW_ROOM.top + SHADOW_ROOM.bottom

  let body: ReactNode
  if (layout === 'cards') {
    const { share, max } = PEEK[aspect]
    body = (
      <PeekPager
        {...pager}
        peek={Math.min(share, max / width)}
        height={w => withRoom(Math.round(w / ratio))}
        dots={{ tone: 'primary', className: 'mt-1' }}
        renderItem={(s, info) => card(s, info.width, Math.round(info.width / ratio), info.index === current, info)}
      />
    )
  } else if (layout === 'banner') {
    body = (
      <Pager
        {...pager}
        height={w => withRoom(wideHeight(w))}
        dots={{ className: 'mt-1' }}
        renderItem={(s, info) => card(s, info.width, wideHeight(info.width), info.index === current, info)}
      />
    )
  } else if (layout === 'fade') {
    body = <FadePager {...pager} height={wideHeight} renderItem={(s, info) => card(s, info.width, info.height, info.active, undefined, false)} />
  } else {
    const share = RAIL_SHARE[aspect]
    const w = Math.floor((width - GUTTER * 2) * share) // Rail's item width
    body = (
      <View className="px-4">
        <Rail itemWidth={share}>
          {slides.map(s => (
            <RailSlide key={s.id} slide={s} onPress={() => open(s)} actions={actions(s)}>
              {card(s, w, Math.round(w / ratio), true, undefined, true, false)}
            </RailSlide>
          ))}
        </Rail>
      </View>
    )
  }

  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false} className="bg-surface py-8">
      {eyebrow || title ? <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName="text-primary-500" className="mb-4 px-4" /> : null}
      {body}
    </Animated.View>
  )
}

/** A rail slide as one accessible button; a product's quick add is an action on it. */
function RailSlide({ slide, onPress, actions, children }: { slide: SlideCard; onPress: () => void; actions: PageAction[]; children: ReactNode }) {
  return (
    <Pressable
      onPress={slide.href ? onPress : undefined}
      accessible
      accessibilityRole={slide.href ? 'button' : undefined}
      accessibilityLabel={slideLabel(slide)}
      accessibilityActions={actions.length ? actions.map(a => ({ name: a.name, label: a.label })) : undefined}
      onAccessibilityAction={(e: AccessibilityActionEvent) => actions.find(a => a.name === e.nativeEvent.actionName)?.run()}
    >
      {children}
    </Pressable>
  )
}

function SlideCardView({
  slide,
  width,
  height,
  shape,
  current,
  play,
  info,
  room,
  inStock,
}: {
  slide: SlideCard
  width: number
  height: number
  shape: Shape
  /** The slide on show (Ken Burns runs only then). */
  current: boolean
  /** Its clip may play. */
  play: boolean
  /** The scroll pager's offset, for parallax and reveal. */
  info?: PageInfo
  /** Leave the pager's shadow room around the card. */
  room: boolean
  inStock: boolean
}) {
  const shadow = useElevation('overlay')
  const { animate } = useMotion()
  const motion: Motion = slide.kind === 'custom' && animate ? slide.motion : 'none'
  const compact = width < 240 || height < 200
  const titleSize = Math.round(Math.min(compact ? 20 : 26, Math.max(17, width * 0.075)))

  return (
    <View style={[shadow, room && { marginTop: SHADOW_ROOM.top, marginBottom: SHADOW_ROOM.bottom }]} className={`rounded-panel ${elevationClass('overlay')}`}>
      <View className="w-full overflow-hidden rounded-panel bg-black" style={{ height }}>
        <Backdrop slide={slide} shape={shape} motion={motion} current={current} play={play} info={info} width={width} />
        <Gradient dir="t" stops={SCRIM} />
        <Caption motion={motion} current={current} info={info}>
          <SlideBadge text={slide.badge} color={slide.badgeClass} />
          {slide.eyebrow ? (
            <Overline numberOfLines={1} className="mb-1 text-white/70" style={{ letterSpacing: 2 }}>
              {slide.eyebrow}
            </Overline>
          ) : null}
          <Text
            numberOfLines={compact ? 2 : 3}
            className="font-display font-extrabold text-white"
            style={{ fontSize: titleSize, lineHeight: Math.round(titleSize * 1.2), letterSpacing: -titleSize * 0.02 }}
          >
            {slide.title}
          </Text>
          {slide.sub && !compact ? (
            <Text className="mt-1 text-sm leading-5 text-white/75" numberOfLines={2}>
              {slide.sub}
            </Text>
          ) : null}
          {slide.product ? <ProductFoot slide={slide} product={slide.product} inStock={inStock} /> : <SlideCta label={slide.ctaLabel} />}
        </Caption>
      </View>
    </View>
  )
}

function ProductFoot({ slide, product, inStock }: { slide: SlideCard; product: CardProduct; inStock: boolean }) {
  const price = slide.price ?? product.displayPrice
  const mrp = slide.mrp ?? product.mrp
  return (
    <View pointerEvents="box-none" className="mt-3 flex-row items-center justify-between gap-3">
      <View className="shrink flex-row flex-wrap items-baseline gap-x-2">
        <Text className="text-lg font-black text-white">
          {product.hasVariants ? 'From ' : ''}₹{inr(price)}
        </Text>
        {mrp != null && mrp > price ? <Text className="text-xs text-white/60 line-through">₹{inr(mrp)}</Text> : null}
      </View>
      <QuickAddButton product={product} inStock={inStock} />
    </View>
  )
}

/** Portrait and square shapes take the card picture first; wide takes the wide one. A clip goes with its poster. */
function pickImage(s: SlideCard, shape: Shape) {
  const wide = { src: absUrl(s.image), blurhash: s.blurhash, video: s.video ?? null }
  const card = { src: absUrl(s.imageCard), blurhash: s.blurhashCard, video: s.videoCard ?? null }
  const [first, second] = shape === '16:9' ? [wide, card] : [card, wide]
  const pick = first.src ? first : second
  return { ...pick, blurhash: pick.blurhash ?? first.blurhash ?? second.blurhash }
}

function Backdrop({
  slide,
  shape,
  motion,
  current,
  play,
  info,
  width,
}: {
  slide: SlideCard
  shape: Shape
  motion: Motion
  current: boolean
  play: boolean
  info?: PageInfo
  width: number
}) {
  const { src, blurhash, video } = pickImage(slide, shape)
  const imgSource = useImageSource()
  const [playing, setPlaying] = useState(false)
  if (!src) {
    return (
      <View style={FILL} className="bg-secondary-700">
        <Gradient dir="br" stops={[[0, primary[600], 0.55], [0.7, primary[600], 0]]} />
      </View>
    )
  }
  if (slide.product) return <ProductShot src={src} image={imgSource(src, width * 0.8)} backdrop={imgSource(src, 64)} blurhash={blurhash} />
  // Parallax and the zoom scale the picture up a little.
  const img = <Media image={src} video={video} blurhash={blurhash} style={FILL} width={width * 1.15} active={play} onPlaying={setPlaying} />
  if (motion === 'parallax' && info) return <Parallax info={info}>{img}</Parallax>
  // The clip is the motion; the zoom waits for it to stop.
  if (motion === 'kenburns') return <KenBurns on={current && !playing}>{img}</KenBurns>
  return img
}

/** The whole product, uncropped and clear of the caption, over a blurred copy of itself. */
function ProductShot({ src, image, backdrop, blurhash }: { src: string; image?: RemoteImage; backdrop?: RemoteImage; blurhash: string | null }) {
  return (
    <View style={FILL} className="bg-surface-elevated">
      <Image
        recyclingKey={src}
        source={backdrop}
        style={[FILL, { opacity: 0.6, transform: [{ scale: 1.1 }] }]}
        contentFit="cover"
        blurRadius={24}
      />
      <Image
        recyclingKey={src}
        source={image}
        placeholder={blurhash ? { blurhash } : undefined}
        style={{ position: 'absolute', top: '8%', left: '10%', right: '10%', bottom: '38%' }}
        contentFit="contain"
        transition={200}
      />
    </View>
  )
}

function Parallax({ info, children }: { info: PageInfo; children: ReactNode }) {
  const style = usePageParallax(info, 0.08, 1.12)
  return <Animated.View style={[FILL, style]}>{children}</Animated.View>
}

/** A slow zoom while the slide is on show. */
function KenBurns({ on, children }: { on: boolean; children: ReactNode }) {
  const scale = useSharedValue(1)
  useEffect(() => {
    scale.value = on
      ? withRepeat(withTiming(1.12, { duration: KENBURNS_MS, easing: Easing.inOut(Easing.quad) }), -1, true)
      : withTiming(1, { duration: 400 })
    return () => cancelAnimation(scale)
  }, [on, scale])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return <Animated.View style={[FILL, style]}>{children}</Animated.View>
}

// box-none: taps fall through to the slide, except on the product's "+".
function Caption({ motion, current, info, children }: { motion: Motion; current: boolean; info?: PageInfo; children: ReactNode }) {
  if (motion !== 'reveal') {
    return (
      <View pointerEvents="box-none" style={CAPTION}>
        {children}
      </View>
    )
  }
  return info ? <PageReveal info={info}>{children}</PageReveal> : <Reveal on={current}>{children}</Reveal>
}

function PageReveal({ info, children }: { info: PageInfo; children: ReactNode }) {
  const style = usePageReveal(info)
  return (
    <Animated.View pointerEvents="box-none" style={[CAPTION, style]}>
      {children}
    </Animated.View>
  )
}

/** Without a scroll offset (fade, rail) the caption rises in whenever its slide comes on. */
function Reveal({ on, children }: { on: boolean; children: ReactNode }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = on ? withDelay(150, withTiming(1, { duration: 500 })) : withTiming(0, { duration: 300 })
  }, [on, p])
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: 14 * (1 - p.value) }] }))
  return (
    <Animated.View pointerEvents="box-none" style={[CAPTION, style]}>
      {children}
    </Animated.View>
  )
}
