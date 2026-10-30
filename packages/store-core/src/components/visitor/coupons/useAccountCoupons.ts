'use client'

import { useEffect, useState } from 'react'
import type { AccountCoupon } from '@/lib/rewards/account-coupons'

/** GET /api/account/coupons; `coupons` is null until the first answer. */
export function useAccountCoupons(enabled: boolean, opts: { usableOnly?: boolean; reloadKey?: number } = {}) {
  const { usableOnly = false, reloadKey = 0 } = opts
  const [coupons, setCoupons] = useState<AccountCoupon[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setCoupons(null)
      return
    }
    const controller = new AbortController()
    fetch(`/api/account/coupons${usableOnly ? '?status=usable' : ''}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => {
        setCoupons(Array.isArray(data?.coupons) ? data.coupons : [])
        setFailed(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setCoupons([])
        setFailed(true)
      })
    return () => controller.abort()
  }, [enabled, usableOnly, reloadKey])

  return { coupons, failed }
}
