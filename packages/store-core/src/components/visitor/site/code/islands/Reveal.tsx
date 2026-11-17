'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

// Content that eases in when it scrolls into view (once). Respects reduced motion.

const FROM: Record<string, { opacity: number; x?: number; y?: number; scale?: number }> = {
  'fade-up': { opacity: 0, y: 28 },
  fade: { opacity: 0 },
  zoom: { opacity: 0, scale: 0.94 },
  'slide-left': { opacity: 0, x: 40 },
  'slide-right': { opacity: 0, x: -40 },
}

export default function Reveal({ effect = 'fade-up', delay = 0, className, children }: { effect?: string; delay?: number; className?: string; children?: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? false : (FROM[effect] ?? FROM['fade-up'])}
      whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.6, delay: Math.min(2, Math.max(0, delay)), ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
