'use client'

import { useEffect, useState } from 'react'
import { isActive } from '@/lib/support/types'
import { ago } from './format'

/** "In the chat" / "Away · 5m": re-evaluated every few seconds as heartbeats age out. */
export default function PresenceBadge({ lastSeenAt, who = 'Customer', compact = false }: { lastSeenAt: string | null | undefined; who?: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const on = isActive(lastSeenAt, now)
  const label = on ? `${who} in the chat` : lastSeenAt ? `${who} away · ${ago(lastSeenAt, now)}` : `${who} not seen yet`
  if (compact) return <span title={label} aria-label={label} className={`inline-block w-2.5 h-2.5 rounded-full ring-2 ring-surface ${on ? 'bg-emerald-500' : 'bg-foreground-muted/40'}`} />
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground-muted">
      <span className={`w-2 h-2 rounded-full ${on ? 'bg-emerald-500 animate-pulse' : 'bg-foreground-muted/40'}`} />
      {label}
    </span>
  )
}
