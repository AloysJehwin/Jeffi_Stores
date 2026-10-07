'use client'

import { useEffect, useState } from 'react'

// Storefront feature switches from /api/feature-flags, fetched once per page load and shared by
// every hook that needs one.
export interface StoreFlags {
  loyaltyEnabled: boolean
  referralEnabled: boolean
  birthdayEnabled: boolean
}

const OFF: StoreFlags = { loyaltyEnabled: false, referralEnabled: false, birthdayEnabled: false }

let cached: StoreFlags | null = null
let pending: Promise<StoreFlags> | null = null

function loadStoreFlags(): Promise<StoreFlags> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch('/api/feature-flags')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        cached = {
          loyaltyEnabled: data?.loyaltyEnabled === true,
          referralEnabled: data?.referralEnabled === true,
          birthdayEnabled: data?.birthdayEnabled === true,
        }
        return cached
      })
      .catch(() => {
        pending = null
        return OFF
      })
  }
  return pending
}

export function useStoreFlag(key: keyof StoreFlags): boolean {
  const [enabled, setEnabled] = useState(cached?.[key] === true)

  useEffect(() => {
    let active = true
    loadStoreFlags().then(flags => {
      if (active) setEnabled(flags[key])
    })
    return () => {
      active = false
    }
  }, [key])

  return enabled
}
