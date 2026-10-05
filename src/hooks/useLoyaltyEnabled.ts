'use client'

import { useEffect, useState } from 'react'

let cached: boolean | null = null
let pending: Promise<boolean> | null = null

function loadLoyaltyFlag(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch('/api/feature-flags')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        cached = data?.loyaltyEnabled === true
        return cached
      })
      .catch(() => {
        pending = null
        return false
      })
  }
  return pending
}

export function useLoyaltyEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached === true)

  useEffect(() => {
    let active = true
    loadLoyaltyFlag().then(value => {
      if (active) setEnabled(value)
    })
    return () => {
      active = false
    }
  }, [])

  return enabled
}
