'use client'

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { SlideArrows, SlideDots, SlideProgress, type ArrowsVariant, type DotsSize, type DotsTone } from './SlideControls'
import { useAutoplay } from './useAutoplay'
import { useSwipe } from './useSwipe'

export type SlidesLayout = 'cards' | 'rail' | 'fade' | 'banner'
export type SlidesAspect = '4:5' | '1:1' | '16:9'

export interface SlidesArrows {
  variant?: ArrowsVariant
  className?: string
  prevLabel?: string
  nextLabel?: string
}

export interface SlidesDots {
  tone?: DotsTone
  size?: DotsSize
  /** Placement; replaces the layout's default. */
  className?: string
  label?: (index: number) => string
}

export interface SlidesProgress {
  className?: string
  label?: (index: number) => string
}

export interface SlidesProps {
  layout: SlidesLayout
  ariaLabel: string
  /** One child per slide. */
  children: ReactNode
  /** Controlled slide; pair with onIndexChange. */
  index?: number
  defaultIndex?: number
  onIndexChange?: (index: number) => void
  arrows?: boolean | SlidesArrows
  dots?: boolean | SlidesDots
  /** fade: progress segments on the autoplay clock. */
  progress?: boolean | SlidesProgress
  /** true (5s) or a duration in ms. */
  autoplay?: boolean | number
  /** cards: loop through clones; on by default from 4 slides. */
  loop?: boolean
  /** fade: swipe between slides (on by default). */
  swipe?: boolean
  /** Names a slide in the arrow and slide labels ("Previous offer"). */
  itemLabel?: string
  /** rail/banner: each slide's width. */
  itemClassName?: string
  /** cards: the card width per breakpoint as the --slide-w variable, so the edge spacers can centre the first and last card. */
  cardWidth?: string
  /** cards: the card's aspect ratio. */
  aspect?: SlidesAspect
  className?: string
  /** rail/banner: the gap; cards: padding and gap overrides. */
  trackClassName?: string
  /** fade: extra classes on each slide, e.g. the crossfade duration. */
  slideClassName?: string
}

export const CARD_WIDTH = '[--slide-w:72vw] sm:[--slide-w:42%] lg:[--slide-w:28%] xl:[--slide-w:24%]'
const RAIL_ITEM = 'w-[45%] sm:w-[30%] lg:w-[18%]'
const ASPECT: Record<SlidesAspect, string> = { '4:5': 'aspect-[4/5]', '1:1': 'aspect-square', '16:9': 'aspect-video' }
const DEFAULT_AUTOPLAY_MS = 5000
const SETTLE_MS = 150
const MIN_OPACITY = 0.35
const MIN_SCALE = 0.9
const HIDE_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const EDGE_MASK =
  '[-webkit-mask-image:linear-gradient(to_right,transparent,#000_15%,#000_85%,transparent)] [mask-image:linear-gradient(to_right,transparent,#000_15%,#000_85%,transparent)]'
// Wide enough that the first and last card can sit in the middle.
const CARD_SPACER = 'shrink-0 w-[max(0px,calc((100%_-_var(--slide-w))_/_2_-_var(--slide-gap)))]'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface SlideState {
  index: number
  current: boolean
  /** A loop copy: decorative, never focusable. */
  clone: boolean
}

const SlideContext = createContext<SlideState>({ index: 0, current: true, clone: false })

/** The slide a component renders in, e.g. to load the current card's image eagerly. */
export function useSlide(): SlideState {
  return useContext(SlideContext)
}

const wrap = (i: number, n: number) => (n ? ((i % n) + n) % n : 0)
const opt = <T extends object>(v: boolean | T | undefined, fallback: boolean): T | null =>
  v === undefined ? (fallback ? ({} as T) : null) : v === false ? null : v === true ? ({} as T) : v
const autoplayMs = (v: boolean | number | undefined) => (typeof v === 'number' ? v : v ? DEFAULT_AUTOPLAY_MS : 0)

// The app router renders with React 19, where `inert` is a boolean prop; the React 18 types lack it.
const inert = (on: boolean) => (on ? { inert: true } : {}) as object

function onArrowKeys(e: React.KeyboardEvent, prev: () => void, next: () => void) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    next()
  }
}

function keyOf(child: ReactNode, i: number) {
  return isValidElement(child) && child.key != null ? child.key : i
}

// One engine for every slider on the storefront: a crossfade stack (fade), a snap row (rail),
// centred cards whose neighbours fade and shrink (cards), and a full-width card (banner).
export default function Slides(props: SlidesProps) {
  const items = Children.toArray(props.children)
  if (items.length === 0 && props.layout !== 'rail') return null
  if (props.layout === 'fade') return <Fade {...props} items={items} />
  if (props.layout === 'banner' && items.length === 1) return <div className={props.className}>{items[0]}</div>
  return <Track {...props} items={items} />
}

type InnerProps = SlidesProps & { items: ReactNode[] }

function Fade({
  items,
  ariaLabel,
  index,
  defaultIndex = 0,
  onIndexChange,
  arrows,
  dots,
  progress,
  autoplay,
  swipe = true,
  itemLabel = 'slide',
  className = 'relative',
  slideClassName = 'duration-700',
}: InnerProps) {
  const count = items.length
  const [inner, setInner] = useState(defaultIndex)
  const active = wrap(index ?? inner, count)
  const many = count > 1

  const go = useCallback(
    (n: number) => {
      const next = wrap(n, count)
      if (index === undefined) setInner(next)
      onIndexChange?.(next)
    },
    [count, index, onIndexChange]
  )

  const swiper = useSwipe({ onSwipe: d => go(active + d), enabled: swipe && many })
  const ms = autoplayMs(autoplay)
  const clock = useAutoplay({
    durationMs: ms || DEFAULT_AUTOPLAY_MS,
    resetKey: active,
    onComplete: () => go(active + 1),
    enabled: !!ms && many,
    paused: swiper.pressed,
  })

  const arrowOpts = opt(arrows, false)
  const dotOpts = opt(dots, true)
  const progressOpts = opt(progress, false)

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={many ? 0 : undefined}
      className={`${className} ${many ? `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${swipe ? 'touch-pan-y touch-pinch-zoom' : ''}` : ''}`}
      onKeyDown={many ? e => onArrowKeys(e, () => go(active - 1), () => go(active + 1)) : undefined}
      {...clock.bind}
      {...swiper.bind}
    >
      {items.map((child, i) => (
        <div
          key={keyOf(child, i)}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${count}`}
          aria-hidden={i !== active}
          {...inert(i !== active)}
          className={`absolute inset-0 transition-opacity motion-reduce:transition-none ${slideClassName} ${i === active ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
        >
          <SlideContext.Provider value={{ index: i, current: i === active, clone: false }}>{child}</SlideContext.Provider>
        </div>
      ))}

      {many && arrowOpts && (
        <SlideArrows
          onPrev={() => go(active - 1)}
          onNext={() => go(active + 1)}
          prevLabel={arrowOpts.prevLabel ?? `Previous ${itemLabel}`}
          nextLabel={arrowOpts.nextLabel ?? `Next ${itemLabel}`}
          variant={arrowOpts.variant}
          className={arrowOpts.className}
        />
      )}
      {many && progressOpts && (
        <SlideProgress
          count={count}
          index={active}
          progress={clock.progress}
          onSelect={go}
          label={progressOpts.label ?? (i => `Go to ${itemLabel} ${i + 1}`)}
          className={progressOpts.className ?? 'absolute inset-x-0 bottom-0 z-30 flex gap-1.5 px-5 pb-5'}
        />
      )}
      {many && dotOpts && (
        <SlideDots
          count={count}
          index={active}
          onSelect={go}
          tone={dotOpts.tone}
          size={dotOpts.size}
          label={dotOpts.label}
          className={dotOpts.className ?? 'absolute bottom-5 left-1/2 -translate-x-1/2 z-30'}
        />
      )}
    </div>
  )
}

interface Metrics {
  width: number
  item: number
  slot: number
  first: number
}

function Track({
  layout,
  items,
  ariaLabel,
  index,
  defaultIndex = 0,
  onIndexChange,
  arrows,
  dots,
  autoplay,
  loop,
  itemLabel = 'slide',
  itemClassName,
  cardWidth = CARD_WIDTH,
  aspect = '4:5',
  className = '',
  trackClassName,
  slideClassName = '',
}: InnerProps) {
  const cards = layout === 'cards'
  const rail = layout === 'rail'
  const n = items.length
  const reduced = !!useReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const metrics = useRef<Metrics>({ width: 0, item: 0, slot: 0, first: 0 })
  const version = useMotionValue(0)

  // Clones go in after hydration, so the server markup is the plain list with the first card centred.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const cloned = cards && n > 1 && (loop ?? n >= 4) && mounted
  const offset = cloned ? n : 0
  const total = cloned ? n * 3 : n

  const [raw, setRaw] = useState(() => wrap(index ?? defaultIndex, n))
  const rawRef = useRef(raw)
  const real = wrap(raw, n)
  const [held, setHeld] = useState(false)
  const heldRef = useRef(false)
  const [edges, setEdges] = useState({ overflows: false, atStart: true, atEnd: true })

  const slideEls = useCallback(
    () =>
      trackRef.current
        ? (Array.from(trackRef.current.children) as HTMLElement[]).filter(c => c.dataset.slide !== undefined)
        : [],
    []
  )

  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const [a, b] = slideEls()
    metrics.current = {
      width: el.clientWidth,
      item: a?.offsetWidth ?? 0,
      slot: a && b ? Math.abs(b.offsetLeft - a.offsetLeft) : (a?.offsetWidth ?? 0),
      first: a?.offsetLeft ?? 0,
    }
    version.set(version.get() + 1)
  }, [slideEls, version])

  // Scroll offset that shows slide k: centred for cards, flush left otherwise.
  const posOf = useCallback(
    (k: number) => {
      const m = metrics.current
      return cards ? m.first + m.item / 2 + k * m.slot - m.width / 2 : k * m.slot
    },
    [cards]
  )

  const setCurrent = useCallback((k: number) => {
    if (k === rawRef.current) return
    rawRef.current = k
    setRaw(k)
  }, [])

  const scrollToRaw = useCallback(
    (k: number, animate = true) => {
      const el = trackRef.current
      if (!el) return
      el.scrollTo({ left: posOf(k), behavior: animate && !reduced ? 'smooth' : 'instant' })
    },
    [posOf, reduced]
  )

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const x = Math.abs(el.scrollLeft)
    setEdges(prev => {
      const next = { overflows: max > 1, atStart: x <= 1, atEnd: x >= max - 1 }
      return prev.overflows === next.overflows && prev.atStart === next.atStart && prev.atEnd === next.atEnd
        ? prev
        : next
    })
    const m = metrics.current
    if (!m.slot || !total) return
    setCurrent(Math.min(total - 1, Math.max(0, Math.round((x - posOf(0)) / m.slot))))
  }, [posOf, setCurrent, total])

  // Loop: once scrolling stops on a copy, jump to the same card in the real run.
  const settle = useCallback(() => {
    if (!cloned || heldRef.current) return
    const k = rawRef.current
    if (k >= n && k < 2 * n) return
    const to = k < n ? k + n : k - n
    scrollToRaw(to, false)
    setCurrent(to)
  }, [cloned, n, scrollToRaw, setCurrent])

  useIsoLayoutEffect(() => {
    measure()
    const k = offset + wrap(rawRef.current, n)
    scrollToRaw(k, false)
    setCurrent(k)
    sync()
  }, [cloned, n])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const native = 'onscrollend' in window
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(settle, SETTLE_MS)
    }
    const onScroll = () => {
      sync()
      if (!native) later()
    }
    const onTouchStart = () => {
      heldRef.current = true
      setHeld(true)
    }
    const onTouchEnd = () => {
      heldRef.current = false
      setHeld(false)
      if (!native) later()
    }
    const observer = new ResizeObserver(() => {
      measure()
      if (cards) scrollToRaw(rawRef.current, false)
      sync()
    })
    observer.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', settle)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', settle)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [cards, measure, scrollToRaw, settle, sync])

  const changeRef = useRef(onIndexChange)
  useEffect(() => {
    changeRef.current = onIndexChange
  })
  const reported = useRef(real)
  useEffect(() => {
    if (!n || real === reported.current) return
    reported.current = real
    changeRef.current?.(real)
  }, [real, n])

  useEffect(() => {
    if (index === undefined || !n || !metrics.current.slot) return
    const want = wrap(index, n)
    const at = rawRef.current
    if (want !== wrap(at, n)) scrollToRaw(at - wrap(at, n) + want)
  }, [index, n, scrollToRaw])

  // Arrows, keys and autoplay step one slide; past either end without a loop they wrap.
  const step = useCallback(
    (d: 1 | -1) => {
      const k = rawRef.current + d
      if (cloned) scrollToRaw(Math.min(total - 1, Math.max(0, k)))
      else scrollToRaw(k < 0 ? n - 1 : k >= n ? 0 : k)
    },
    [cloned, n, scrollToRaw, total]
  )
  const goTo = useCallback((i: number) => scrollToRaw(rawRef.current - wrap(rawRef.current, n) + i), [n, scrollToRaw])

  // A rail shows several items at once, so its arrows page by most of a screen.
  const page = (d: 1 | -1) => {
    const el = trackRef.current
    if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: reduced ? 'instant' : 'smooth' })
  }

  const ms = autoplayMs(autoplay)
  const clock = useAutoplay({
    durationMs: ms || DEFAULT_AUTOPLAY_MS,
    resetKey: real,
    onComplete: () => step(1),
    enabled: !!ms && n > 1,
    paused: held,
  })

  // Neighbouring cards are inert, so a click on one lands on the track: bring that card to the middle.
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (rail) return
    const els = slideEls()
    const hit = els.findIndex(s => {
      const r = s.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right
    })
    if (hit >= 0 && hit !== rawRef.current) scrollToRaw(hit)
  }

  const order = cloned
    ? [...items.map((c, i) => ({ c, i, clone: true, key: `b${i}` })), ...items.map((c, i) => ({ c, i, clone: false, key: keyOf(c, i) })), ...items.map((c, i) => ({ c, i, clone: true, key: `a${i}` }))]
    : items.map((c, i) => ({ c, i, clone: false, key: keyOf(c, i) }))

  const arrowOpts = opt(arrows, true)
  const dotOpts = opt(dots, !rail)
  const showArrows = !!arrowOpts && n > 1 && (rail ? edges.overflows : true)
  const ends = !cloned && !rail

  const trackBase = cards
    ? `group/slides relative flex gap-[var(--slide-gap)] [--slide-gap:0.75rem] md:[--slide-gap:1.25rem] py-4 overflow-x-auto snap-x snap-mandatory overscroll-x-contain ${HIDE_SCROLLBAR} ${EDGE_MASK} focus:outline-none ${cardWidth}`
    : `flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain motion-safe:scroll-smooth ${HIDE_SCROLLBAR} focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-lg`

  return (
    <div
      className={`relative ${className}`}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      {...(ms ? clock.bind : {})}
    >
      <div
        ref={trackRef}
        tabIndex={0}
        className={`${trackBase} ${trackClassName ?? (cards ? '' : 'gap-3 md:gap-5')}`}
        onKeyDown={e => onArrowKeys(e, () => step(-1), () => step(1))}
        onClick={onTrackClick}
      >
        {cards && <div aria-hidden="true" className={CARD_SPACER} />}
        {order.map((s, k) => {
          const current = k === raw
          const state = { index: s.i, current, clone: s.clone }
          const content = <SlideContext.Provider value={state}>{s.c}</SlideContext.Provider>
          if (cards)
            return (
              <CardSlide
                key={s.key}
                trackRef={trackRef}
                metrics={metrics}
                version={version}
                reduced={reduced}
                current={current}
                label={`${s.i + 1} of ${n}`}
                className={`${ASPECT[aspect]} ${slideClassName}`}
              >
                {content}
              </CardSlide>
            )
          return (
            <div
              key={s.key}
              data-slide=""
              {...(rail
                ? {}
                : {
                    role: 'group',
                    'aria-roledescription': 'slide',
                    'aria-label': `${s.i + 1} of ${n}`,
                    'aria-hidden': !current,
                    ...inert(!current),
                  })}
              className={`snap-start shrink-0 ${itemClassName ?? (rail ? RAIL_ITEM : 'w-full')} ${slideClassName}`}
            >
              {content}
            </div>
          )
        })}
        {cards && <div aria-hidden="true" className={CARD_SPACER} />}
      </div>

      {showArrows &&
        (rail ? (
          <SlideArrows
            variant={arrowOpts.variant ?? 'rail'}
            onPrev={() => page(-1)}
            onNext={() => page(1)}
            prevDisabled={edges.atStart}
            nextDisabled={edges.atEnd}
            prevLabel={arrowOpts.prevLabel ?? `Scroll ${ariaLabel} left`}
            nextLabel={arrowOpts.nextLabel ?? `Scroll ${ariaLabel} right`}
            className={arrowOpts.className}
          />
        ) : (
          <SlideArrows
            variant={arrowOpts.variant ?? 'overlay'}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            prevDisabled={ends && real === 0}
            nextDisabled={ends && real === n - 1}
            prevLabel={arrowOpts.prevLabel ?? `Previous ${itemLabel}`}
            nextLabel={arrowOpts.nextLabel ?? `Next ${itemLabel}`}
            className={arrowOpts.className}
          />
        ))}
      {dotOpts && n > 1 && (
        <SlideDots
          count={n}
          index={real}
          onSelect={goTo}
          tone={dotOpts.tone ?? 'brand'}
          size={dotOpts.size}
          label={dotOpts.label}
          className={dotOpts.className ?? 'mt-2 justify-center'}
        />
      )}
    </div>
  )
}

interface CardSlideProps {
  trackRef: RefObject<HTMLDivElement | null>
  metrics: RefObject<Metrics>
  version: MotionValue<number>
  reduced: boolean
  current: boolean
  label: string
  className: string
  children: ReactNode
}

// Opacity and scale follow the card's distance from the middle of the track, reaching their
// minimum at its edge. Until the track is measured both stay at 1, as the server renders them.
function CardSlide({ trackRef, metrics, version, reduced, current, label, className, children }: CardSlideProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollXProgress } = useScroll({ container: trackRef, target: ref, axis: 'x', offset: ['start end', 'end start'] })
  const distance = useTransform([scrollXProgress, version], ([p]: number[]) => {
    const m = metrics.current
    if (!m?.width) return 0
    return Math.min(1, (Math.abs(p - 0.5) * (m.width + m.item)) / (m.width / 2))
  })
  const opacity = useTransform(distance, [0, 1], [1, MIN_OPACITY])
  const scale = useTransform(distance, d => (reduced ? 1 : 1 - (1 - MIN_SCALE) * d))

  return (
    <motion.div
      ref={ref}
      data-slide=""
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={!current}
      {...inert(!current)}
      style={{ opacity, scale }}
      className={`relative snap-center shrink-0 w-[var(--slide-w)] rounded-2xl ${current ? 'group-focus-visible/slides:ring-2 group-focus-visible/slides:ring-accent-500 group-focus-visible/slides:ring-offset-2' : ''} ${className}`}
    >
      {children}
    </motion.div>
  )
}
