'use client'

import { useEffect, useState } from 'react'

// Storefront feature switches from /api/feature-flags, fetched once per page load and shared by
// every hook that needs one. Each reads off until loaded (and if the request fails), so an SMS or
// WhatsApp option never shows while its Site Controls switch is off.
export interface StoreFlags {
  loyaltyEnabled: boolean
  referralEnabled: boolean
  birthdayEnabled: boolean
  smsEnabled: boolean
  whatsappEnabled: boolean
}

const OFF: StoreFlags = { loyaltyEnabled: false, referralEnabled: false, birthdayEnabled: false, smsEnabled: false, whatsappEnabled: false }

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
          smsEnabled: data?.smsEnabled === true,
          whatsappEnabled: data?.whatsappEnabled === true,
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

/** Site Controls' SMS and WhatsApp switches: hide every option for a channel that's off. */
export function useMessagingChannels(): { sms: boolean; whatsapp: boolean } {
  return { sms: useStoreFlag('smsEnabled'), whatsapp: useStoreFlag('whatsappEnabled') }
}

/** "WhatsApp, SMS & email": the update channels a customer actually gets, for copy. */
export function updateChannelsLabel(c: { sms: boolean; whatsapp: boolean }): string {
  const list = [c.whatsapp && 'WhatsApp', c.sms && 'SMS', 'email'].filter(Boolean) as string[]
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}` : list[0]
}
