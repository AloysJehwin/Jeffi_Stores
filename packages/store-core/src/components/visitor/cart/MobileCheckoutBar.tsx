'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useCompare } from '@/contexts/CompareContext'

const PHONE_QUERY = '(max-width: 1023px)'

/**
 * Phones and tablets: a fixed bottom bar with the order total and the primary action. Hides while the
 * in-page summary action (`watchId`) is on screen, so the two never show at once.
 */
export default function MobileCheckoutBar({
  label,
  amount,
  watchId,
  children,
}: {
  label: ReactNode
  amount: string
  watchId: string
  children: ReactNode
}) {
  const [phone, setPhone] = useState(false)
  // null until the observer reports, so a short page never flashes the bar over its own summary.
  const [summaryInView, setSummaryInView] = useState<boolean | null>(null)
  const { compareList } = useCompare()

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const sync = () => setPhone(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!phone) return
    const el = document.getElementById(watchId)
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSummaryInView(false)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setSummaryInView(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [phone, watchId])

  if (!phone || summaryInView !== false) return null

  // CompareBar sits fixed at bottom-0 (73px plus the home-indicator inset) when 2+ products are queued.
  const position =
    compareList.length >= 2
      ? 'bottom-[73px] mb-[env(safe-area-inset-bottom,0px)]'
      : 'bottom-0 pb-[env(safe-area-inset-bottom,0px)]'

  return (
    <div
      role="region"
      aria-label="Order total"
      data-bottom-bar="checkout"
      className={`fixed inset-x-0 ${position} z-30 bg-surface-elevated border-t border-border-default shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] animate-slide-up motion-reduce:animate-none`}
    >
      <div className="container mx-auto px-4 py-2.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground-muted truncate">{label}</p>
          <p className="text-lg font-bold text-foreground tabular-nums truncate leading-tight">{amount}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
