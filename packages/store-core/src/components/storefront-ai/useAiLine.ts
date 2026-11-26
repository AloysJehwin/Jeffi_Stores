'use client'

import { useEffect, useState } from 'react'

export interface CartLine {
  name: string
  category?: string | null
  brand?: string | null
  qty: number
}

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, text: string) => {
  try {
    sessionStorage.setItem(key, text)
  } catch {}
}

/**
 * One AI line from a storefront route (/api/ai-*: the store's model through the gateway, charged to the store).
 * Fetched once per distinct request and kept for the visit, so a shopper re-opening the page is not charged again.
 * `off` is true when the store's plan has no storefront AI (403).
 */
export function useAiLine(route: string, body: Record<string, unknown> | null, field: 'text' | 'pitch', enabled: boolean): { text: string | null; off: boolean } {
  const key = enabled && body ? `jeffi_ai_line:${route}:${JSON.stringify(body)}` : ''
  const [state, setState] = useState<{ key: string; text: string | null; off: boolean }>({ key: '', text: null, off: false })

  useEffect(() => {
    if (!key) return
    const cached = read(key)
    if (cached) {
      setState({ key, text: cached, off: false })
      return
    }
    let alive = true
    fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key.slice(`jeffi_ai_line:${route}:`.length) })
      .then(async res => {
        if (!alive) return
        if (res.status === 403) return setState({ key, text: null, off: true })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
        const text = typeof data?.[field] === 'string' ? (data[field] as string).trim() : ''
        if (!text || !alive) return
        write(key, text)
        setState({ key, text, off: false })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key, route, field])

  return state.key === key ? { text: state.text, off: state.off } : { text: null, off: false }
}
