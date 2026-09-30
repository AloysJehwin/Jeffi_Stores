'use client'

import { useEffect, useState } from 'react'
import { inr } from './inr'

interface FreeDeliveryRule {
  freeThreshold: number
  weightLimitKg: number
}

export default function FreeShippingProgress({ subtotal }: { subtotal: number }) {
  const [rule, setRule] = useState<FreeDeliveryRule | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/cart/free-delivery')
      .then(r => (r.ok ? r.json() : null))
      .then((data: FreeDeliveryRule | null) => {
        if (active && data && data.freeThreshold > 0) setRule(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!rule || subtotal <= 0) return null

  const remaining = Math.max(0, Math.round((rule.freeThreshold - subtotal) * 100) / 100)
  const unlocked = remaining === 0
  const percent = unlocked ? 100 : Math.min(100, (subtotal / rule.freeThreshold) * 100)

  return (
    <div className="mb-4 bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
      <p className="text-sm text-foreground" aria-live="polite">
        {unlocked ? (
          <span className="font-semibold text-green-700 dark:text-green-400">You have unlocked free delivery</span>
        ) : (
          <>
            Add <span className="font-semibold">{inr(remaining)}</span> more to get free delivery
          </>
        )}
      </p>
      <div
        role="progressbar"
        aria-label="Progress towards free delivery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="mt-2 h-2 rounded-full bg-surface-secondary overflow-hidden"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${unlocked ? 'bg-green-500' : 'bg-accent-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-foreground-muted">
        Free delivery on orders of {inr(rule.freeThreshold)} or more, for parcels under {rule.weightLimitKg} kg.
      </p>
    </div>
  )
}
