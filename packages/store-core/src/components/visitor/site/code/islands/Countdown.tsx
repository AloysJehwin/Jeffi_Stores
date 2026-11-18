'use client'

import { useEffect, useState } from 'react'

// A ticking countdown to `endsAt`. Shows dashes until it mounts (no hydration mismatch) and hides once it ends.

const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0')

export default function Countdown({ endsAt, label, variant = 'boxes', className }: { endsAt: string; label?: string; variant?: 'boxes' | 'inline'; className?: string }) {
  const end = Date.parse(endsAt)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!Number.isFinite(end)) return null
  const left = Math.max(0, end - (now ?? end - 1))
  if (now !== null && left <= 0) return null
  const s = Math.floor(left / 1000)
  const parts: [string, number][] = [
    ['Days', Math.floor(s / 86400)],
    ['Hours', Math.floor((s % 86400) / 3600)],
    ['Mins', Math.floor((s % 3600) / 60)],
    ['Secs', s % 60],
  ]
  if (variant === 'inline')
    return (
      <span className={`tabular-nums ${className ?? ''}`} role="timer" aria-live="off">
        {label && <span className="mr-2">{label}</span>}
        {now === null ? '--:--:--' : `${parts[0][1] > 0 ? `${parts[0][1]}d ` : ''}${pad(parts[1][1])}:${pad(parts[2][1])}:${pad(parts[3][1])}`}
      </span>
    )
  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className ?? ''}`} role="timer" aria-live="off">
      {label && <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>}
      <div className="flex gap-2">
        {parts.map(([k, v]) => (
          <div key={k} className="min-w-14 rounded-[var(--radius-button,0.5rem)] bg-black/10 px-2 py-1.5 text-center">
            <div className="font-display text-2xl tabular-nums">{now === null ? '--' : pad(v)}</div>
            <div className="text-[10px] uppercase opacity-75">{k}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
