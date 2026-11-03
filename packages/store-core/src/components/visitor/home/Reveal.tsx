'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  /**
   * Above-the-fold sections pass true to render at their resting state on load
   * instead of waiting for the viewport observer.
   */
  disabled?: boolean
}

export default function Reveal({ children, disabled = false }: RevealProps) {
  const prefersReduced = useReducedMotion()
  const animate = !prefersReduced && !disabled

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 24 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
