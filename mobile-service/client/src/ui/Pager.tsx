import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions, type AccessibilityActionEvent, type AccessibilityProps } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useTokens } from '../theme'
import { Gradient } from './Gradient'
import { PagerDots, type PagerDotsProps } from './PagerDots'
import { GUTTER } from './Screen'
import { useMotion } from './motion'
import { useAutoplay, useSwipe } from './paging'

// Horizontal pagers that snap one page at a time. Pager: full-width pages (the motion hero). PeekPager:
// centred cards whose neighbours peek in, shrunk, dimmed and faded at both edges (offer cards).
// FadePager: full-width pages that crossfade in place.

export interface PageInfo {
  index: number
  /** Scroll offset; this page is current at `index * page`. Drive parallax from it. */
  x: SharedValue<number>
  /** Snap interval: page width + gap. */
  page: number
  width: number
  height: number
}

/** A screen-reader action on a page, for controls inside it (the page reads as one element). */
export interface PageAction {
  name: string
  label: string
  run: () => void
}

export interface PagerBaseProps<T> {
  data: readonly T[]
  renderItem: (item: T, info: PageInfo) => ReactNode
  keyExtractor?: (item: T, index: number) => string
  /** Makes each page one accessible button. */
  onPress?: (item: T, index: number) => void
  /** Pages it returns false for aren't pressable. */
  canPress?: (item: T, index: number) => boolean
  /** Spoken label for a page; its position ("Slide 2 of 5") is appended. */
  itemLabel?: (item: T, index: number) => string
  itemActions?: (item: T, index: number) => PageAction[]
  /** Page width / height. */
  aspect?: number
  /** Page height, fixed or from the page width; overrides `aspect`. */
  height?: number | ((width: number) => number)
  gap?: number
  /** Advance on a timer (off under reduced motion or a screen reader, held while touched). */
  autoplay?: boolean
  intervalMs?: number
  onIndexChange?: (index: number) => void
  /** Dots under the pager with 2+ pages (default on); an object restyles them. */
  dots?: boolean | Pick<PagerDotsProps, 'tone' | 'size' | 'label' | 'className'>
  /** Viewport width; defaults to the window. */
  width?: number
}

export interface PagerProps<T> extends PagerBaseProps<T> {
  /** Side padding; a page is the viewport minus twice this (default the gutter). */
  inset?: number
}

export interface PeekPagerProps<T> extends PagerBaseProps<T> {
  /** Card width as a share of the viewport (default 0.72). */
  peek?: number
  /** Edge fade colour (default the surface token), or false for none. */
  fade?: string | false
}

export interface FadePageInfo {
  index: number
  /** The page on show. */
  active: boolean
  width: number
  height: number
}

export interface FadePagerProps<T> extends Omit<PagerBaseProps<T>, 'renderItem' | 'gap'> {
  renderItem: (item: T, info: FadePageInfo) => ReactNode
  /** Side padding (default the gutter). */
  inset?: number
}

export function Pager<T>({ inset = GUTTER, aspect = 16 / 9, width, ...rest }: PagerProps<T>) {
  const win = useWindowDimensions().width
  const viewport = width ?? win
  return <Track {...rest} aspect={aspect} itemWidth={viewport - inset * 2} pad={inset} />
}

export function PeekPager<T>({ peek = 0.72, aspect = 4 / 5, fade, width, ...rest }: PeekPagerProps<T>) {
  const t = useTokens()
  const win = useWindowDimensions().width
  const viewport = width ?? win
  const itemWidth = Math.round(viewport * peek)
  return <Track {...rest} aspect={aspect} itemWidth={itemWidth} pad={(viewport - itemWidth) / 2} peek fade={fade === false ? undefined : (fade ?? t.surface)} />
}

const NEXT_PREV = [
  { name: 'next', label: 'Next slide' },
  { name: 'previous', label: 'Previous slide' },
]
const INC_DEC = [{ name: 'increment' }, { name: 'decrement' }]

// Built on the JS side and captured: worklets can't call plain functions.
const pageRange = (i: number, page: number) => [(i - 1) * page, i * page, (i + 1) * page]

/** A layer that drifts against its page while paging (`drift` of a page each side); still under reduced motion. */
export function usePageParallax({ index, x, page }: PageInfo, drift: number, scale = 1) {
  const still = useMotion().reduced
  const range = pageRange(index, page)
  return useAnimatedStyle(() => {
    if (still) return {}
    const tx = interpolate(x.value, range, [-page * drift, 0, page * drift], Extrapolation.CLAMP)
    return { transform: [{ scale }, { translateX: tx }] }
  })
}

/** Text that fades and rises in as its page settles; still under reduced motion. */
export function usePageReveal({ index, x, page }: PageInfo, lift = 14) {
  const still = useMotion().reduced
  const range = pageRange(index, page)
  return useAnimatedStyle(() => {
    if (still) return {}
    return {
      opacity: interpolate(x.value, range, [0, 1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(x.value, range, [lift, 0, lift], Extrapolation.CLAMP) }],
    }
  })
}

/** One page as screen readers get it: a button (or an adjustable when it can't be pressed) with next / previous. */
function pageA11y({
  label,
  position,
  pressable,
  many,
  extra,
  step,
}: {
  label?: string
  position?: string
  pressable: boolean
  many: boolean
  extra: PageAction[]
  step: (d: 1 | -1) => void
}): AccessibilityProps {
  const actions = [...(many ? (pressable ? NEXT_PREV : INC_DEC) : []), ...extra.map(a => ({ name: a.name, label: a.label }))]
  return {
    accessible: true,
    accessibilityLabel: label ? [label, position].filter(Boolean).join(', ') : undefined,
    accessibilityHint: label ? undefined : position,
    accessibilityRole: pressable ? 'button' : many ? 'adjustable' : undefined,
    accessibilityActions: actions.length ? actions : undefined,
    onAccessibilityAction: (e: AccessibilityActionEvent) => {
      const name = e.nativeEvent.actionName
      const custom = extra.find(a => a.name === name)
      if (custom) custom.run()
      else if (name === 'next' || name === 'increment') step(1)
      else if (name === 'previous' || name === 'decrement') step(-1)
    },
  }
}

function PageBody({ onPress, a11y, children }: { onPress?: () => void; a11y: AccessibilityProps; children: ReactNode }) {
  return onPress ? (
    <Pressable style={{ flex: 1 }} onPress={onPress} {...a11y}>
      {children}
    </Pressable>
  ) : (
    <View style={{ flex: 1 }} {...a11y}>
      {children}
    </View>
  )
}

function Track<T>({
  data,
  renderItem,
  keyExtractor,
  onPress,
  canPress,
  itemLabel,
  itemActions,
  aspect = 1,
  height,
  gap = 12,
  autoplay = false,
  intervalMs = 5000,
  onIndexChange,
  dots = true,
  itemWidth,
  pad,
  peek = false,
  fade,
}: Omit<PagerBaseProps<T>, 'width'> & { itemWidth: number; pad: number; peek?: boolean; fade?: string }) {
  const { animate, reduced } = useMotion()
  const count = data.length
  const page = itemWidth + gap
  const itemHeight = typeof height === 'function' ? height(itemWidth) : (height ?? Math.round(itemWidth / aspect))

  const ref = useAnimatedRef<Animated.ScrollView>()
  const x = useSharedValue(0)
  const active = useRef(0)

  const go = useCallback((i: number, animated: boolean) => ref.current?.scrollTo({ x: i * page, animated }), [ref, page])
  const auto = useAutoplay(() => go((active.current + 1) % count, true), { enabled: autoplay && count > 1, intervalMs })

  const indexChange = useRef(onIndexChange)
  indexChange.current = onIndexChange
  const landed = useCallback(
    (i: number) => {
      active.current = i
      auto.restart()
      indexChange.current?.(i)
    },
    [auto]
  )
  const onScroll = useAnimatedScrollHandler(e => {
    x.value = e.contentOffset.x
  })
  useAnimatedReaction(
    () => Math.min(count - 1, Math.max(0, Math.round(x.value / page))),
    (cur, prev) => {
      if (prev != null && cur !== prev) runOnJS(landed)(cur)
    },
    [page, count, landed]
  )

  if (count === 0) return null
  const label = (i: number) => itemLabel?.(data[i], i)
  const position = (i: number) => (count > 1 ? `Slide ${i + 1} of ${count}` : undefined)
  // Screen-reader next / previous: scroll there and say where we landed.
  const step = (from: number, d: 1 | -1) => {
    const to = (from + d + count) % count
    go(to, animate)
    AccessibilityInfo.announceForAccessibility([label(to), position(to)].filter(Boolean).join(', '))
  }
  const dotOpts = typeof dots === 'object' ? dots : {}

  return (
    <View>
      <View>
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
          onTouchStart={() => auto.hold(true)}
          onTouchEnd={() => auto.hold(false)}
          onTouchCancel={() => auto.hold(false)}
          contentContainerStyle={{ paddingHorizontal: pad, gap }}
        >
          {data.map((item, i) => {
            const pressable = !!onPress && (canPress?.(item, i) ?? true)
            return (
              <Page
                key={keyExtractor ? keyExtractor(item, i) : i}
                i={i}
                x={x}
                page={page}
                width={itemWidth}
                height={itemHeight}
                peek={peek}
                still={reduced}
                onPress={pressable ? () => onPress?.(item, i) : undefined}
                a11y={pageA11y({
                  label: label(i),
                  position: position(i),
                  pressable,
                  many: count > 1,
                  extra: itemActions?.(item, i) ?? [],
                  step: d => step(i, d),
                })}
              >
                {renderItem(item, { index: i, x, page, width: itemWidth, height: itemHeight })}
              </Page>
            )
          })}
        </Animated.ScrollView>
        {fade ? (
          <>
            <Gradient dir="r" stops={[[0, fade], [1, fade, 0]]} style={{ left: 0, top: 0, bottom: 0, width: pad }} />
            <Gradient dir="l" stops={[[0, fade], [1, fade, 0]]} style={{ right: 0, top: 0, bottom: 0, width: pad }} />
          </>
        ) : null}
      </View>
      {dots && count > 1 ? <PagerDots {...dotOpts} count={count} x={x} page={page} onSelect={i => go(i, animate)} className={dotOpts.className ?? 'mt-3'} /> : null}
    </View>
  )
}

function Page({
  i,
  x,
  page,
  width,
  height,
  peek,
  still,
  onPress,
  a11y,
  children,
}: {
  i: number
  x: SharedValue<number>
  page: number
  width: number
  height: number
  peek: boolean
  still: boolean
  onPress?: () => void
  a11y: AccessibilityProps
  children: ReactNode
}) {
  const range = pageRange(i, page)
  // PeekPager: the centred card is full size; neighbours shrink (not under reduced motion) and dim.
  const style = useAnimatedStyle(() => {
    if (!peek) return {}
    const p = interpolate(x.value, range, [0, 1, 0], Extrapolation.CLAMP)
    return { opacity: 0.4 + 0.6 * p, transform: [{ scale: still ? 1 : 0.9 + 0.1 * p }] }
  })
  return (
    <Animated.View style={[{ width, height }, style]}>
      <PageBody onPress={onPress} a11y={a11y}>
        {children}
      </PageBody>
    </Animated.View>
  )
}

export function FadePager<T>({
  data,
  renderItem,
  keyExtractor,
  onPress,
  canPress,
  itemLabel,
  itemActions,
  aspect = 16 / 9,
  height,
  autoplay = false,
  intervalMs = 5000,
  onIndexChange,
  dots = true,
  width,
  inset = GUTTER,
}: FadePagerProps<T>) {
  const win = useWindowDimensions().width
  const itemWidth = (width ?? win) - inset * 2
  const itemHeight = typeof height === 'function' ? height(itemWidth) : (height ?? Math.round(itemWidth / aspect))
  const count = data.length
  const [active, setActive] = useState(0)
  const index = active < count ? active : 0

  const go = useCallback((i: number) => setActive(((i % count) + count) % count), [count])
  const shift = useCallback((d: 1 | -1) => setActive(a => (((a + d) % count) + count) % count), [count])
  const auto = useAutoplay(() => shift(1), { enabled: autoplay && count > 1, intervalMs })
  const swipe = useSwipe(shift)

  const indexChange = useRef(onIndexChange)
  indexChange.current = onIndexChange
  const shown = useRef(index)
  useEffect(() => {
    auto.restart()
    if (shown.current === index) return
    shown.current = index
    indexChange.current?.(index)
  }, [auto, index])

  if (count === 0) return null
  const label = (i: number) => itemLabel?.(data[i], i)
  const position = (i: number) => (count > 1 ? `Slide ${i + 1} of ${count}` : undefined)
  const step = (from: number, d: 1 | -1) => {
    const to = (from + d + count) % count
    go(to)
    AccessibilityInfo.announceForAccessibility([label(to), position(to)].filter(Boolean).join(', '))
  }
  const dotOpts = typeof dots === 'object' ? dots : {}

  return (
    <View>
      <View
        style={{ height: itemHeight, marginHorizontal: inset }}
        {...(count > 1 ? swipe : null)}
        onTouchStart={() => auto.hold(true)}
        onTouchEnd={() => auto.hold(false)}
        onTouchCancel={() => auto.hold(false)}
      >
        {data.map((item, i) => {
          const pressable = !!onPress && (canPress?.(item, i) ?? true)
          return (
            <FadePage key={keyExtractor ? keyExtractor(item, i) : i} on={i === index}>
              <PageBody
                onPress={pressable ? () => onPress?.(item, i) : undefined}
                a11y={pageA11y({
                  label: label(i),
                  position: position(i),
                  pressable,
                  many: count > 1,
                  extra: itemActions?.(item, i) ?? [],
                  step: d => step(i, d),
                })}
              >
                {renderItem(item, { index: i, active: i === index, width: itemWidth, height: itemHeight })}
              </PageBody>
            </FadePage>
          )
        })}
      </View>
      {dots && count > 1 ? <PagerDots {...dotOpts} count={count} index={index} onSelect={go} className={dotOpts.className ?? 'mt-3'} /> : null}
    </View>
  )
}

/** A stacked page; only the one on show takes touches or reaches screen readers. */
function FadePage({ on, children }: { on: boolean; children: ReactNode }) {
  const { animate } = useMotion()
  const opacity = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    opacity.value = withTiming(on ? 1 : 0, { duration: animate ? 700 : 0 })
  }, [on, opacity, animate])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return (
    <Animated.View
      pointerEvents={on ? 'auto' : 'none'}
      importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!on}
      style={[StyleSheet.absoluteFill, { zIndex: on ? 1 : 0 }, style]}
    >
      {children}
    </Animated.View>
  )
}
