import { useCallback, useRef, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, View, useWindowDimensions, type AccessibilityActionEvent, type AccessibilityProps } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useTokens } from '../theme'
import { Gradient } from './Gradient'
import { PagerDots, type PagerDotsProps } from './PagerDots'
import { GUTTER } from './Screen'
import { useMotion } from './motion'
import { useAutoplay } from './paging'

// Horizontal pagers that snap one page at a time. Pager: full-width pages (the motion hero). PeekPager:
// centred cards whose neighbours peek in, shrunk, dimmed and faded at both edges (offer cards).

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
  const step = (from: number, d: number) => {
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
            const l = label(i)
            const extra = itemActions?.(item, i) ?? []
            const actions = [...(count > 1 ? (pressable ? NEXT_PREV : INC_DEC) : []), ...extra.map(a => ({ name: a.name, label: a.label }))]
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
                a11y={{
                  accessible: true,
                  accessibilityLabel: l ? [l, position(i)].filter(Boolean).join(', ') : undefined,
                  accessibilityHint: l ? undefined : position(i),
                  accessibilityRole: pressable ? 'button' : count > 1 ? 'adjustable' : undefined,
                  accessibilityActions: actions.length ? actions : undefined,
                  onAccessibilityAction: (e: AccessibilityActionEvent) => {
                    const name = e.nativeEvent.actionName
                    const custom = extra.find(a => a.name === name)
                    if (custom) custom.run()
                    else if (name === 'next' || name === 'increment') step(i, 1)
                    else if (name === 'previous' || name === 'decrement') step(i, -1)
                  },
                }}
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
  const range = [(i - 1) * page, i * page, (i + 1) * page]
  // PeekPager: the centred card is full size; neighbours shrink (not under reduced motion) and dim.
  const style = useAnimatedStyle(() => {
    if (!peek) return {}
    const p = interpolate(x.value, range, [0, 1, 0], Extrapolation.CLAMP)
    return { opacity: 0.4 + 0.6 * p, transform: [{ scale: still ? 1 : 0.9 + 0.1 * p }] }
  })
  return (
    <Animated.View style={[{ width, height }, style]}>
      {onPress ? (
        <Pressable style={{ flex: 1 }} onPress={onPress} {...a11y}>
          {children}
        </Pressable>
      ) : (
        <View style={{ flex: 1 }} {...a11y}>
          {children}
        </View>
      )}
    </Animated.View>
  )
}
