'use client'

import { useEffect } from 'react'

// Posts the Google click ids and UTM tags of an ad landing to /api/ecom/attribution, which keeps them in a first-party
// cookie for signup. Renders nothing; a URL without them does nothing.

const KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

export default function AttributionCapture() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const params: Record<string, string> = {}
    for (const k of KEYS) {
      const v = q.get(k)
      if (v) params[k] = v
    }
    if (!Object.keys(params).length) return
    fetch('/api/ecom/attribution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ params, landingPath: window.location.pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [])
  return null
}
