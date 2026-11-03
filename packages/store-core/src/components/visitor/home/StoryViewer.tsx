'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import StoreImage from '@/components/visitor/StoreImage'
import StoreMedia, { canPlayVideo } from '@/components/visitor/media/StoreMedia'
import { SlideProgress } from '@/components/visitor/slides/SlideControls'
import { useAutoplay } from '@/components/visitor/slides/useAutoplay'
import { useSwipe } from '@/components/visitor/slides/useSwipe'
import type { StoryGroup } from '@/lib/catalog/homepage-sections'

const CLOSE_DRAG_PX = 120
const SWIPE_PX = 60
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
// A clip whose metadata hasn't loaded by then falls back to the slide's timer.
const CLIP_WAIT_MS = 4000
const ARROW =
  'absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-white/20 bg-white/10 p-3 text-white transition-colors hover:bg-white/20 md:inline-flex'

interface StoryViewerProps {
  groups: StoryGroup[]
  startIndex: number
  onClose: () => void
  /** Each group as it comes on screen, the one opened included. */
  onGroupOpen: (group: StoryGroup) => void
}

export default function StoryViewer({ groups, startIndex, onClose, onGroupOpen }: StoryViewerProps) {
  const reduced = !!useReducedMotion()
  const [gi, setGi] = useState(startIndex)
  const [si, setSi] = useState(0)
  const [round, setRound] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // The viewer only mounts on a tap, so this can be read on the first render.
  const [videoOk] = useState(canPlayVideo)
  // How the bar runs for slide `key`: waiting on the clip's metadata, following the clip, or the timer.
  const [clock, setClock] = useState<{ key: string; mode: 'wait' | 'clip' | 'timer' }>({ key: '', mode: 'wait' })

  const group = groups[gi]
  const slide = group?.slides[si]
  const slideCount = group?.slides.length ?? 0

  useEffect(() => {
    if (group) onGroupOpen(group)
  }, [group, onGroupOpen])

  const next = useCallback(() => {
    if (si < slideCount - 1) setSi(si + 1)
    else if (gi < groups.length - 1) {
      setGi(gi + 1)
      setSi(0)
    } else onClose()
  }, [si, slideCount, gi, groups.length, onClose])

  const prev = useCallback(() => {
    if (si > 0) setSi(si - 1)
    else if (gi > 0) {
      setGi(gi - 1)
      setSi(0)
    } else setRound(r => r + 1)
  }, [si, gi])

  // Tap zones: a quick tap navigates (left third back, the rest forward); holding pauses;
  // a horizontal swipe navigates; dragging down past the threshold closes.
  const swipe = useSwipe({
    onSwipe: d => (d > 0 ? next() : prev()),
    threshold: SWIPE_PX,
    onTap: e => {
      const r = e.currentTarget.getBoundingClientRect()
      if (e.clientX - r.left < r.width / 3) prev()
      else next()
    },
    onDragDown: onClose,
    dragDownPx: CLOSE_DRAG_PX,
    capture: true,
  })

  const key = `${gi}:${si}:${round}`
  const hasClip = videoOk && !!slide?.video
  const mode = !hasClip ? 'timer' : clock.key === key ? clock.mode : 'wait'
  const setMode = useCallback((m: 'clip' | 'timer') => setClock({ key, mode: m }), [key])

  // Progress keeps running under reduced motion: it is the only cue for how long a slide has left.
  const { progress } = useAutoplay({
    durationMs: (slide?.seconds ?? 5) * 1000,
    resetKey: key,
    onComplete: next,
    enabled: !!slide && mode === 'timer',
    paused: swipe.pressed,
    ignoreReducedMotion: true,
  })

  useEffect(() => {
    if (mode !== 'wait' || swipe.pressed) return
    const t = setTimeout(() => setMode('timer'), CLIP_WAIT_MS)
    return () => clearTimeout(t)
  }, [mode, swipe.pressed, setMode])

  // The bar follows the clip; holding pauses the clip, and with it the bar.
  useEffect(() => {
    if (mode !== 'clip') return
    let frame = 0
    const tick = () => {
      const v = videoRef.current
      if (v && v.duration > 0) progress.set(Math.min(1, v.currentTime / v.duration))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, progress])

  useEffect(() => {
    const upcoming = group?.slides[si + 1] ?? groups[gi + 1]?.slides[0]
    if (upcoming) new Image().src = upcoming.image
  }, [group, groups, gi, si])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, next, prev])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  if (typeof document === 'undefined' || !group || !slide) return null

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${group.title} stories`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
    >
      <motion.div
        className="relative h-full w-full overflow-hidden bg-gray-900 md:h-[min(92svh,56rem)] md:w-[min(100vw,calc(min(92svh,56rem)*9/16))] md:rounded-2xl"
        initial={reduced ? false : { scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
      >
        <StoreMedia
          key={key}
          image={slide.image}
          video={slide.video}
          alt={slide.caption ?? group.title}
          priority
          sizes="(min-width: 768px) 32rem, 100vw"
          wrapperClassName="absolute inset-0"
          className="absolute inset-0 h-full w-full object-cover"
          active={!swipe.pressed}
          loop={mode === 'timer'}
          videoRef={videoRef}
          onLoadedMetadata={v => {
            if (mode === 'wait') setMode(Number.isFinite(v.duration) && v.duration > 0 ? 'clip' : 'timer')
          }}
          onEnded={mode === 'clip' ? next : undefined}
          // Refused or broken before it started: the timer; broken mid-clip: move on.
          onFail={() => (mode === 'clip' ? next() : setMode('timer'))}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent"
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 touch-none select-none"
          {...swipe.bind}
          onContextMenu={e => e.preventDefault()}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <SlideProgress count={slideCount} index={si} progress={progress} className="flex gap-1" />
          <div className="pointer-events-auto mt-3 flex items-center gap-3">
            <StoreImage
              src={group.cover}
              alt=""
              sizes="32px"
              wrapperClassName="relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-2 ring-white/60"
              className="h-full w-full object-cover"
            />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{group.title}</p>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close stories"
              className="rounded-full p-2 text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {`${group.title}, ${si + 1} of ${slideCount}`}
        </p>

        {(slide.caption || slide.url) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-start gap-3 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {slide.caption && (
              <p className="text-base font-medium leading-snug text-white drop-shadow">{slide.caption}</p>
            )}
            {slide.url && (
              <Link
                href={slide.url}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-gray-900 shadow-lg transition-colors hover:bg-white/90"
              >
                {slide.ctaLabel ?? 'Shop now'}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </motion.div>

      <button type="button" onClick={prev} aria-label="Previous story" className={`${ARROW} left-4`}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button type="button" onClick={next} aria-label="Next story" className={`${ARROW} right-4`}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </motion.div>,
    document.body
  )
}
