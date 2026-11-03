'use client'

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

const STORAGE_PREFIX = 'order-celebration-seen:'

function readSeen(orderId: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + orderId) === '1'
  } catch {
    return false
  }
}

function markSeen(orderId: string) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + orderId, '1')
  } catch {
    // storage unavailable; celebration still shows once per mount
  }
}

interface OrderCelebrationProps {
  orderId: string
  orderNumber: string
}

export default function OrderCelebration({ orderId, orderNumber }: OrderCelebrationProps) {
  const prefersReduced = useReducedMotion()
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (readSeen(orderId)) {
      setAnimate(false)
    } else {
      setAnimate(!prefersReduced)
      markSeen(orderId)
    }
  }, [orderId, prefersReduced])

  const cardInitial = animate ? { opacity: 0, scale: 0.96 } : false
  const cardAnimate = { opacity: 1, scale: 1 }

  return (
    <motion.div
      initial={cardInitial}
      animate={cardAnimate}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6 lg:p-8 mb-8 text-center"
    >
      <div className="flex justify-center mb-4">
        <CheckmarkDraw animate={animate} />
      </div>
      <h1 className="text-3xl font-bold text-foreground mb-2">Order Confirmed!</h1>
      <p className="text-foreground-secondary mb-4">
        Thank you for your purchase. Your order has been successfully placed.
      </p>
      <div className="bg-surface-elevated rounded-lg p-4 inline-block">
        <p className="text-sm text-foreground-secondary mb-1">Order Number</p>
        <p className="text-2xl font-bold text-accent-600 dark:text-accent-400">{orderNumber}</p>
      </div>
    </motion.div>
  )
}

function CheckmarkDraw({ animate }: { animate: boolean }) {
  return (
    <svg
      className="w-16 h-16 text-green-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      />
      <motion.path
        d="M8.5 12.5l2.5 2.5 5-5"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: animate ? 0.4 : 0 }}
      />
    </svg>
  )
}
