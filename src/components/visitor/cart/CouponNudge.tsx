'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { inr } from './inr'

interface Nudge {
  code: string
  saving: number
  shortfall: number
}

interface CouponNudgeProps {
  subtotal: number
  signedIn: boolean
  applying: boolean
  onApply: (code: string) => void
}

export default function CouponNudge({ subtotal, signedIn, applying, onApply }: CouponNudgeProps) {
  const [nudge, setNudge] = useState<Nudge | null>(null)
  const amount = Math.round(subtotal * 100) / 100

  useEffect(() => {
    if (amount <= 0) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/coupons/nudge?subtotal=${amount}`, { credentials: 'include', signal: controller.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => setNudge(data?.nudge ?? null))
        .catch(() => {})
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [amount])

  if (!nudge || amount <= 0) return null

  const code = <span className="font-mono font-bold text-accent-700 dark:text-accent-300">{nudge.code}</span>

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-dashed border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 px-3 py-2">
      {nudge.shortfall > 0 ? (
        <p className="text-xs text-foreground-secondary">
          Add <span className="font-semibold text-foreground">{inr(nudge.shortfall)}</span> more to unlock {code} and
          save {inr(nudge.saving)}
        </p>
      ) : (
        <>
          <p className="text-xs text-foreground-secondary">
            Use {code} to save <span className="font-semibold text-foreground">{inr(nudge.saving)}</span>
          </p>
          {signedIn ? (
            <button
              type="button"
              onClick={() => onApply(nudge.code)}
              disabled={applying}
              className="shrink-0 text-xs font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 disabled:opacity-50 transition-colors"
            >
              {applying ? 'Applying...' : 'Apply'}
            </button>
          ) : (
            <Link
              href="/login?redirect=/cart"
              className="shrink-0 text-xs font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 transition-colors"
            >
              Log in to apply
            </Link>
          )}
        </>
      )}
    </div>
  )
}
