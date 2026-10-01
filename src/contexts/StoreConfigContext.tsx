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
    codEnabled: boolean
    gstEnabled: boolean
    ondeviceSummaryEnabled: boolean
    ondeviceFinetuneEnabled: boolean
    ondeviceSummaryMobileEnabled: boolean
    ondeviceSummaryDesktopEnabled: boolean
    ondeviceFinetuneMobileEnabled: boolean
    ondeviceFinetuneDesktopEnabled: boolean
    /** The store's plan includes storefront AI (ai:storefront). Hide AI features when false. */
    aiStorefrontEnabled: boolean
  }
  orderAutoCancelMinutes: number
  storefront: {
    featuredLimit: number
    newArrivalsLimit: number
    /** The store's own trade line, shown under its name. Empty renders nothing. */
    metaTagline: string
  }
}

// The server (app/layout.tsx → getSiteControls) always supplies initialConfig from the
// tenant's own DB, so this object is only the pre-hydration fallback for a stray client
// render with no SSR value. It must therefore carry NO platform state: reading the shared
// build-time NEXT_PUBLIC_ENABLE_* here would flash the platform's flags on a tenant, the
// same leak the identity block above already guards against. Neutral defaults only; gst
// stays on so prices render inclusive (a price-flash guard, not a platform value).
const DEFAULT_CONFIG: StoreConfig = {
  identity: {
    // Blank, not the platform's: this shows for the instant before the server config
    // arrives, and a tenant must never flash another business's contact details.
    name: '',
    email: '',
    phone: '',
    web: '',
    logoUrl: '',
  },
  flags: {
    razorpayEnabled: false,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
    ondeviceSummaryDesktopEnabled: false,
    ondeviceSummaryMobileEnabled: false,
    ondeviceFinetuneDesktopEnabled: false,
    ondeviceFinetuneMobileEnabled: false,
    aiStorefrontEnabled: false,
  },
  orderAutoCancelMinutes: 10,
  storefront: {
    featuredLimit: 8,
    newArrivalsLimit: 4,
    // No default trade line: the flagship's ("Hardware & Tools") was being shown
    // by every tenant whatever they sell. Blank until the store's own value loads.
    metaTagline: '',
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
      .catch(() => {
        /* keep initial/defaults */
      })
    return () => {
      active = false
    }
  }, [])

  return <StoreConfigContext.Provider value={{ config, loaded }}>{children}</StoreConfigContext.Provider>
}

export function useStoreConfig(): StoreConfig {
  const ctx = useContext(StoreConfigContext)
  return ctx ? ctx.config : DEFAULT_CONFIG
}

export function useStoreConfigState(): StoreConfigContextValue {
  const ctx = useContext(StoreConfigContext)
  return ctx ?? { config: DEFAULT_CONFIG, loaded: false }
}
