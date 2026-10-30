'use client'

import { Fragment } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type Variants } from 'motion/react'

/** A slide crossfade, in seconds. */
export const FADE_S = 0.7
/** How far a Ken Burns drift zooms in. */
export const KEN_BURNS = 0.06
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

// Under reduced motion every variant resolves instantly; the hidden state waits out the crossfade
// so the outgoing slide's text does not vanish before its image has faded.
export const headlineVariants = (reduced: boolean): Variants => ({
  hidden: {},
  show: { transition: reduced ? { staggerChildren: 0 } : { staggerChildren: 0.06, delayChildren: 0.15 } },
})

export const wordVariants = (reduced: boolean): Variants => ({
  hidden: { y: '110%', opacity: 0, transition: { duration: 0, delay: reduced ? 0 : FADE_S } },
  show: { y: 0, opacity: 1, transition: reduced ? { duration: 0 } : { duration: 0.7, ease: EASE } },
})

export const riseVariants = (reduced: boolean, delay: number): Variants => ({
  hidden: { y: 14, opacity: 0, transition: { duration: 0, delay: reduced ? 0 : FADE_S } },
  show: { y: 0, opacity: 1, transition: reduced ? { duration: 0 } : { duration: 0.6, ease: EASE, delay } },
})

/** A headline's words rising in turn; the enclosing motion element carries headlineVariants. */
export function RevealWords({ text, reduced }: { text: string; reduced: boolean }) {
  return (
    <>
      {text.split(/\s+/).map((word, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em] align-bottom">
            <motion.span className="inline-block" variants={wordVariants(reduced)}>
              {word}
            </motion.span>
          </span>
        </Fragment>
      ))}
    </>
  )
}

const SPRING = { stiffness: 60, damping: 18, mass: 0.6 }

/** Pointer parallax in px: mouse only, softened by springs, still under reduced motion. */
export function usePointerParallax(reduced: boolean, range = { x: 18, y: 12 }) {
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const px = useSpring(mx, SPRING)
  const py = useSpring(my, SPRING)
  const x = useTransform(px, v => v * range.x)
  const y = useTransform(py, v => v * range.y)

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2)
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2)
  }
  const onPointerLeave = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return
    mx.set(0)
    my.set(0)
  }
  return { x, y, onPointerMove, onPointerLeave }
}
