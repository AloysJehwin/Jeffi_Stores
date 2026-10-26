import { useId, useState } from 'react'
import { View } from 'react-native'
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg'
import { Gradient, Media, Overline, Pager, Text, usePageParallax, usePageReveal, type PageInfo } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated from 'react-native-reanimated'
import { SlideCta } from './layout'
import { useOnScreen } from './scroll-context'
import { absUrl, openHref, type RemoteImage } from '../../lib/links'
import { useImageSource } from '../../hooks/useImageSource'
import { radius, status } from '../../theme'
import type { MotionHeroData, MotionHeroSlide, SectionProps } from '../../types/home'

// Swiggy-style animated hero: paged cards whose foreground drifts slower than the card, autoplaying
// unless a finger is down or the system asks for less motion.

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

export default function MotionHero({ section, data }: SectionProps) {
  const hero = data.extras[section.id] as MotionHeroData | undefined
  if (!hero?.slides.length) return null
  return <Hero hero={hero} />
}

function Hero({ hero }: { hero: MotionHeroData }) {
  const router = useRouter()
  const [current, setCurrent] = useState(0)
  const { ref, onLayout, onScreen } = useOnScreen(hero.slides.length > 1 || hero.slides.some(s => s.bgVideo))
  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false} className="bg-surface pb-4 pt-3">
      <Pager
        data={hero.slides}
        keyExtractor={(slide, i) => `${i}-${slide.bgImage}`}
        height={w => Math.min(420, Math.round(w * 0.9))}
        // Off screen (or on another tab) it holds instead of paging under the feed.
        autoplay={onScreen}
        intervalMs={hero.intervalMs}
        dots={{ size: 6 }}
        onPress={slide => openHref(router, slide.url)}
        canPress={slide => !!slide.url}
        itemLabel={slide => [slide.eyebrow, slide.headline, slide.sub, slide.ctaLabel].filter(Boolean).join(', ')}
        onIndexChange={setCurrent}
        renderItem={(slide, info) => <Card slide={slide} info={info} active={onScreen && info.index === current} />}
      />
    </Animated.View>
  )
}

function Card({ slide, info, active }: { slide: MotionHeroSlide; info: PageInfo; active: boolean }) {
  const { width: w, height: h } = info
  const bg = absUrl(slide.bgImage)
  const fg = absUrl(slide.fgImage)
  const imgSource = useImageSource()
  const frame = slide.fgFrame ?? 'none'
  const titleSize = Math.min(40, Math.max(26, Math.round(w * 0.085)))

  // Relative to the card: the background lags a little, the foreground more, so the layers separate while paging.
  const bgStyle = usePageParallax(info, 0.08, 1.12)
  const fgStyle = usePageParallax(info, 0.28)
  const textStyle = usePageReveal(info)

  return (
    <View style={{ width: w, height: h }} className="overflow-hidden rounded-sheet bg-black">
      <Animated.View style={[FILL, bgStyle]}>
        <Media image={bg} video={slide.bgVideo} style={FILL} width={w * 1.12} transition={300} active={active} />
      </Animated.View>
      <Gradient dir="b" stops={[[0, status.black, 0.35], [0.4, status.black, 0], [1, status.black, 0.9]]} />

      {fg && frame === 'none' ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 0, bottom: 0, width: w * 0.5, height: h * 0.72 }, fgStyle]}>
          <Image source={imgSource(fg, w * 0.5)} style={{ width: '100%', height: '100%' }} contentFit="contain" contentPosition="bottom right" transition={300} />
        </Animated.View>
      ) : fg ? (
        // A framed photo sits top right, clear of the copy at the bottom.
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 16, right: 16, width: w * 0.46, height: h * 0.44, alignItems: 'flex-end' }, fgStyle]}>
          <Framed source={imgSource(fg, w * 0.46)} fade={frame === 'fade'} boxW={w * 0.46} boxH={h * 0.44} />
        </Animated.View>
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, maxWidth: fg ? '64%' : '90%' }, textStyle]}
      >
        {slide.eyebrow ? (
          <Overline className="mb-2 text-white/70" style={{ letterSpacing: 2 }}>
            {slide.eyebrow}
          </Overline>
        ) : null}
        <Text
          className="font-display font-extrabold text-white"
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
        <SlideCta label={slide.ctaLabel} size="md" className="mt-4" />
      </Animated.View>
    </View>
  )
}

const FEATHER = [0, 0.14, 0.86, 1] as const

// Hugs the photo's own aspect so the rounded corners or the feathered edges follow it, not the box.
function Framed({ source, fade, boxW, boxH }: { source?: RemoteImage; fade: boolean; boxW: number; boxH: number }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const id = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const fit = ratio == null ? null : ratio > boxW / boxH ? { width: boxW, height: boxW / ratio } : { width: boxH * ratio, height: boxH }

  if (fade && fit) {
    // Mask = horizontal feather × vertical feather: white fading in, then black fading out over it.
    return (
      <Svg width={fit.width} height={fit.height}>
        <Defs>
          <LinearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
            {FEATHER.map((o, i) => (
              <Stop key={i} offset={o} stopColor={status.white} stopOpacity={i === 0 || i === 3 ? 0 : 1} />
            ))}
          </LinearGradient>
          <LinearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
            {FEATHER.map((o, i) => (
              <Stop key={i} offset={o} stopColor={status.black} stopOpacity={i === 0 || i === 3 ? 1 : 0} />
            ))}
          </LinearGradient>
          <Mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={fit.width} height={fit.height}>
            <Rect width="100%" height="100%" fill={`url(#${id}h)`} />
            <Rect width="100%" height="100%" fill={`url(#${id}v)`} />
          </Mask>
        </Defs>
        <SvgImage href={source} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" mask={`url(#${id})`} />
      </Svg>
    )
  }

  return (
    <View
      className="overflow-hidden border border-white/15"
      style={{ width: fit?.width ?? boxW, height: fit?.height ?? boxH, borderRadius: radius.hero, opacity: fit ? 1 : 0 }}
    >
      <Image
        source={source}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        transition={300}
        onLoad={e => e.source.width > 0 && e.source.height > 0 && setRatio(e.source.width / e.source.height)}
      />
    </View>
  )
}
