'use client'

import { useEffect, useState } from 'react'

type Probe = { ok: boolean; status: number; latencyMs: number }

const GREEN = 'org-sage org-sage-text'
const RED = 'bg-[#f2d4cd] text-[#8a2e1f]'
const NEUTRAL = 'bg-surface-secondary text-foreground-muted'

export default function SiteReachabilityBadge({ url }: { url?: string }) {
  const [state, setState] = useState<'loading' | 'error' | Probe>('loading')

  useEffect(() => {
    let active = true
    const qs = url ? `?url=${encodeURIComponent(url)}` : ''
    fetch(`/api/ecom/site-reachability${qs}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (typeof d?.ok === 'boolean') setState({ ok: d.ok, status: d.status, latencyMs: d.latencyMs })
        else setState('error')
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => {
      active = false
    }
  }, [url])

  let cls = NEUTRAL
  let label = 'Checking…'
  if (state === 'error') {
    cls = RED
    label = 'Unreachable'
  } else if (state !== 'loading') {
    if (state.ok) {
      cls = GREEN
      label = `Reachable · ${state.latencyMs}ms`
    } else {
      cls = RED
      label = 'Unreachable'
    }
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
  )
}
