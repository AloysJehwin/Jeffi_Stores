'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export interface StoreConfig {
  identity: {
    name: string
    email: string
    phone: string
    web: string
    logoUrl: string
  }
  flags: {
    razorpayEnabled: boolean
    gstEnabled: boolean
    ondeviceSummaryEnabled: boolean
    ondeviceFinetuneEnabled: boolean
  }
  orderAutoCancelMinutes: number
  storefront: {
    featuredLimit: number
    newArrivalsLimit: number
  }
}

// Defaults mirror src/lib/site-controls.ts DEFAULTS (env-driven flags read here
// via NEXT_PUBLIC_ so the pre-fetch state matches historical behavior).
const DEFAULT_CONFIG: StoreConfig = {
  identity: {
    name: 'Jeffi Stores',
    email: 'jeffistoress@gmail.com',
    phone: '+91 96853 54099',
    web: 'jeffistores.in',
    logoUrl: '',
  },
  flags: {
    razorpayEnabled: process.env.NEXT_PUBLIC_ENABLE_RAZORPAY === 'true',
    // Seed from NEXT_PUBLIC_ENABLE_GST so the pre-fetch first paint matches the
    // real GST state (avoids a price flash before /api/store-config resolves).
    // Default to true (GST-inclusive prices) when the env var is unset.
    gstEnabled: process.env.NEXT_PUBLIC_ENABLE_GST !== 'false',
    ondeviceSummaryEnabled:
      process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY === 'true' ||
      process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY === '1',
    ondeviceFinetuneEnabled:
      process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE === 'true' ||
      process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE === '1',
  },
  orderAutoCancelMinutes: 10,
  storefront: {
    featuredLimit: 8,
    newArrivalsLimit: 4,
  },
}

interface StoreConfigContextValue {
  config: StoreConfig
  loaded: boolean
}

const StoreConfigContext = createContext<StoreConfigContextValue | null>(null)

export function StoreConfigProvider({ children, initialConfig }: { children: ReactNode; initialConfig?: StoreConfig }) {
  const [config, setConfig] = useState<StoreConfig>(initialConfig ?? DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(!!initialConfig)

  useEffect(() => {
    // Always fetch /api/store-config once on mount. When SSR already provided
    // initialConfig we start with the correct value (no price/GST flash), and
    // this background fetch catches any toggle changed AFTER the page was
    // server-rendered — updating state only if a value actually differs, so an
    // unchanged config never triggers a re-render or flicker.
    let active = true
    fetch('/api/store-config')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!active || !data) return
        setConfig(prev => {
          const next: StoreConfig = {
            identity: { ...prev.identity, ...(data.identity || {}) },
            flags: { ...prev.flags, ...(data.flags || {}) },
            orderAutoCancelMinutes: data.orderAutoCancelMinutes ?? prev.orderAutoCancelMinutes,
            storefront: { ...prev.storefront, ...(data.storefront || {}) },
          }
          // Only replace state if something actually changed — avoids a needless
          // re-render (and any flicker) when SSR and the API agree.
          return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
        })
        setLoaded(true)
      })
      .catch(() => { /* keep initial/defaults */ })
    return () => { active = false }
  }, [])

  return (
    <StoreConfigContext.Provider value={{ config, loaded }}>
      {children}
    </StoreConfigContext.Provider>
  )
}

export function useStoreConfig(): StoreConfig {
  const ctx = useContext(StoreConfigContext)
  return ctx ? ctx.config : DEFAULT_CONFIG
}

export function useStoreConfigState(): StoreConfigContextValue {
  const ctx = useContext(StoreConfigContext)
  return ctx ?? { config: DEFAULT_CONFIG, loaded: false }
}
