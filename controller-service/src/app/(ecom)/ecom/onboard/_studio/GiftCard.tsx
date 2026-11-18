'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Gift, X } from 'lucide-react'
import { studioGet } from './api'

// The free AI site generation, announced once when the owner starts onboarding: a card that springs in at the corner
// with a burst of sparkles. Never blocks the page (no overlay, no focus trap) and can be dismissed.

const SEEN_KEY = 'jeffi:studio-gift-seen'

const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1)
  const dist = 46 + (i % 3) * 16
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, size: i % 3 === 0 ? 7 : 5, delay: 0.25 + (i % 4) * 0.04, star: i % 3 === 0 }
})
const SPARK_COLORS = ['var(--org-terracotta)', 'var(--org-apricot)', 'var(--org-sage-deep)', '#e9b949']

function seenLocally(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export default function GiftCard({ seen, onSeen }: { seen: boolean; onSeen: () => void }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (seen || seenLocally()) return
    let cancelled = false
    studioGet()
      .then(v => {
        if (cancelled || v.allowance.free !== 'available') return
        // A moment after the wizard settles, so it reads as a gift rather than an error.
        setTimeout(() => {
          if (cancelled) return
          setOpen(true)
          try {
            localStorage.setItem(SEEN_KEY, '1')
          } catch {}
          onSeen()
        }, 900)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Once per mount: `seen` flips to true right after it shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="status"
          aria-live="polite"
          aria-label="A gift for you"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.86, rotate: -4 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, rotate: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.94 }}
          transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 18 }}
          className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 sm:w-[22rem] pb-[env(safe-area-inset-bottom)]"
        >
          <div className="relative overflow-visible rounded-3xl border border-[var(--org-apricot)] bg-surface-elevated p-5 pr-11 shadow-[0_18px_50px_-12px_rgba(42,40,34,0.35)]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Dismiss"
              className="ecom-focus absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted ecom-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <motion.span
                  className="org-peach relative z-10 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                  animate={reduce ? undefined : { rotate: [0, -12, 10, -6, 0], scale: [1, 1.08, 1] }}
                  transition={reduce ? undefined : { delay: 0.35, duration: 0.8, ease: 'easeInOut' }}
                >
                  <Gift className="h-6 w-6 org-brown" />
                </motion.span>
                {!reduce &&
                  SPARKS.map((s, i) => (
                    <motion.span
                      key={i}
                      aria-hidden
                      className="pointer-events-none absolute left-1/2 top-1/2"
                      style={{ width: s.size, height: s.size, marginLeft: -s.size / 2, marginTop: -s.size / 2, background: SPARK_COLORS[i % SPARK_COLORS.length], borderRadius: s.star ? 1 : 999, rotate: s.star ? 45 : 0 }}
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                      animate={{ x: s.x, y: s.y, opacity: [0, 1, 1, 0], scale: [0.4, 1, 0.9, 0.6] }}
                      transition={{ delay: s.delay, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                    />
                  ))}
              </div>
              <div className="min-w-0">
                <div className="org-brown text-[11px] font-bold uppercase tracking-[0.18em]">A gift for you</div>
                <p className="mt-1 font-display text-lg font-black leading-snug text-foreground">You&apos;ve earned a free AI site generation</p>
                <p className="mt-1.5 text-sm text-foreground-secondary">
                  At the <span className="font-semibold text-foreground">Your site</span> step, describe your store and watch the AI design every page, on desktop and phone.
                </p>
                <button type="button" onClick={() => setOpen(false)} className="ecom-focus mt-3 text-sm font-semibold org-brown hover:underline">
                  Got it
                </button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** The step's standing reminder: still free, being used, or already used. */
export function FreeChip({ free }: { free: 'available' | 'resume' | 'used' | null }) {
  if (!free) return null
  const label = free === 'available' ? 'Free generation' : free === 'resume' ? 'Free generation in progress' : 'Free generation used'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${free === 'used' ? 'bg-surface-secondary text-foreground-muted' : 'org-peach org-brown'}`}>
      <Gift className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}
