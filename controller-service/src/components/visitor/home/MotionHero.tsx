'use client'

import { Fragment, useCallback, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from 'motion/react'
import StoreImage from '@/components/visitor/StoreImage'
import { SlideArrows, SlideProgress } from '@/components/visitor/slides/SlideControls'
import { useAutoplay } from '@/components/visitor/slides/useAutoplay'
import { useSwipe } from '@/components/visitor/slides/useSwipe'
import type { MotionHeroSlide } from '@/lib/catalog/homepage-sections'

const FADE_S = 0.7
const KEN_BURNS = 0.06
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

interface MotionHeroProps {
  slides: MotionHeroSlide[]
  /** How long a slide stays; also the length of its Ken Burns drift. */
  intervalMs: number
}

// Under reduced motion every variant resolves instantly; the hidden state waits out the crossfade
// so the outgoing slide's text does not vanish before its image has faded.
const headlineVariants = (reduced: boolean): Variants => ({
  hidden: {},
  show: { transition: reduced ? { staggerChildren: 0 } : { staggerChildren: 0.06, delayChildren: 0.15 } },
})

const wordVariants = (reduced: boolean): Variants => ({
  hidden: { y: '110%', opacity: 0, transition: { duration: 0, delay: reduced ? 0 : FADE_S } },
  show: { y: 0, opacity: 1, transition: reduced ? { duration: 0 } : { duration: 0.7, ease: EASE } },
})

const riseVariants = (reduced: boolean, delay: number): Variants => ({
  hidden: { y: 14, opacity: 0, transition: { duration: 0, delay: reduced ? 0 : FADE_S } },
  show: { y: 0, opacity: 1, transition: reduced ? { duration: 0 } : { duration: 0.6, ease: EASE, delay } },
})

export default function MotionHero({ slides, intervalMs }: MotionHeroProps) {
  const count = slides.length
  const [active, setActive] = useState(0)

  const go = useCallback((n: number) => setActive(((n % count) + count) % count), [count])

  const swipe = useSwipe({ onSwipe: d => go(active + d) })
  // One clock drives the autoplay, the segment fill and the Ken Burns drift, so pausing stops all three.
  const { progress, reduced, bind } = useAutoplay({
    durationMs: intervalMs,
    resetKey: active,
    onComplete: () => {
      if (count > 1) go(active + 1)
    },
    paused: swipe.pressed,
  })

  // Pointer parallax for the foreground image: mouse only, softened by springs.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const px = useSpring(mx, { stiffness: 60, damping: 18, mass: 0.6 })
  const py = useSpring(my, { stiffness: 60, damping: 18, mass: 0.6 })
  const fgX = useTransform(px, v => v * 18)
  const fgY = useTransform(py, v => v * 12)

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    swipe.bind.onPointerMove(e)
    if (reduced || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2)
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2)
  }
  const onPointerLeave = (e: React.PointerEvent<HTMLElement>) => {
    bind.onPointerLeave(e)
    if (e.pointerType !== 'mouse') return
    mx.set(0)
    my.set(0)
  }

  if (count === 0) return null

  // A rounded card with the same inset as the business card (BusinessCta), not full bleed.
  return (
    <div className="px-3 pt-3 sm:px-6 md:px-8 md:pt-6">
      <section
        aria-roledescription="carousel"
        aria-label="Featured"
        className="relative isolate h-[clamp(20rem,56svh,36rem)] w-full touch-pan-y touch-pinch-zoom select-none overflow-hidden rounded-2xl bg-gray-950 text-white shadow-2xl md:h-[clamp(26rem,64vh,46rem)]"
        {...swipe.bind}
        {...bind}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onKeyDown={e => {
          if (e.key === 'ArrowRight') go(active + 1)
          else if (e.key === 'ArrowLeft') go(active - 1)
        }}
      >
        {slides.map((slide, i) => (
          <Slide
            key={i}
            slide={slide}
            index={i}
            count={count}
            active={i === active}
            reduced={reduced}
            progress={progress}
            fgX={fgX}
            fgY={fgY}
          />
        ))}

        {count > 1 && (
          <>
            <SlideArrows onPrev={() => go(active - 1)} onNext={() => go(active + 1)} />
            <SlideProgress
              count={count}
              index={active}
              progress={progress}
              onSelect={go}
              label={i => `Go to slide ${i + 1}: ${slides[i].headline}`}
              className="absolute inset-x-0 bottom-0 z-30 flex gap-1.5 px-5 pb-5 sm:px-8 md:px-12 lg:px-16"
            />
          </>
        )}
      </section>
    </div>
  )
}

interface SlideProps {
  slide: MotionHeroSlide
  index: number
  count: number
  active: boolean
  reduced: boolean
  progress: MotionValue<number>
  fgX: MotionValue<number>
  fgY: MotionValue<number>
}

function Slide({ slide, index, count, active, reduced, progress, fgX, fgY }: SlideProps) {
  // Follows the clock while active and freezes otherwise, so the outgoing image keeps its frame through the crossfade.
  const scale = useMotionValue(1)
  useMotionValueEvent(progress, 'change', v => {
    if (active) scale.set(reduced ? 1 : 1 + KEN_BURNS * v)
  })
  const words = slide.headline.split(/\s+/)

  return (
    <motion.div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}`}
      aria-hidden={!active}
      className={`absolute inset-0 ${active ? 'z-10' : 'z-0'}`}
      initial={false}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : FADE_S, ease: 'easeInOut' }}
    >
      <motion.div className="absolute inset-0" style={{ scale }}>
        <StoreImage
          src={slide.bgImage}
          alt=""
          priority={index === 0}
          sizes="100vw"
          wrapperClassName="absolute inset-0"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </motion.div>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10 md:bg-gradient-to-r md:from-black/80 md:via-black/40 md:to-black/5"
      />

      {slide.fgImage && (
        <motion.div
          className="absolute right-[4%] top-[6%] z-10 h-[44%] w-[56%] md:inset-y-[12%] md:right-[6%] md:h-auto md:w-[36%]"
          style={{ x: fgX, y: fgY }}
        >
          <motion.div
            className="h-full w-full"
            animate={{ y: [0, -8, 0] }}
            transition={reduced ? { duration: 0 } : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          >
            <StoreImage
              src={slide.fgImage}
              alt={slide.headline}
              priority={index === 0}
              sizes="(min-width: 768px) 36vw, 56vw"
              wrapperClassName="relative h-full w-full"
              className="h-full w-full object-contain object-right-bottom drop-shadow-2xl md:object-right"
            />
          </motion.div>
        </motion.div>
      )}

      <motion.div
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-start gap-3 px-5 pb-14 pt-24 sm:px-8 md:inset-y-0 md:right-auto md:w-[58%] md:max-w-3xl md:justify-center md:px-12 md:pb-0 md:pt-0 lg:px-16"
        initial="hidden"
        animate={active ? 'show' : 'hidden'}
      >
        {slide.eyebrow && (
          <motion.p
            variants={riseVariants(reduced, 0)}
            className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70 sm:text-xs"
          >
            {slide.eyebrow}
          </motion.p>
        )}
        <motion.h1
          variants={headlineVariants(reduced)}
          className="text-[clamp(2rem,6vw,4.5rem)] font-black leading-[0.95] tracking-tight"
        >
          {words.map((word, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-bottom">
                <motion.span className="inline-block" variants={wordVariants(reduced)}>
                  {word}
                </motion.span>
              </span>
            </Fragment>
          ))}
        </motion.h1>
        {slide.sub && (
          <motion.p
            variants={riseVariants(reduced, 0.55)}
            className="max-w-md text-sm leading-relaxed text-white/75 sm:text-base md:text-lg"
          >
            {slide.sub}
          </motion.p>
        )}
        {slide.url && (
          <motion.div variants={riseVariants(reduced, 0.7)}>
            <Link
              href={slide.url}
              tabIndex={active ? 0 : -1}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-gray-900 shadow-lg transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {slide.ctaLabel ?? 'Shop now'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}
