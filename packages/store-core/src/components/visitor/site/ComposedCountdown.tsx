'use client'

import { useEffect, useState } from 'react'

const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0')

/** A ticking countdown to `endsAt`; renders the server time first, then ticks. Hides itself once it ends. */
export default function ComposedCountdown({ endsAt, label }: { endsAt: string; label: string }) {
  const end = Date.parse(endsAt)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, end - (now ?? end - 1))
  if (now !== null && left <= 0) return null
  const s = Math.floor(left / 1000)
  const parts: [string, number][] = [
    ['Days', Math.floor(s / 86400)],
    ['Hours', Math.floor((s % 86400) / 3600)],
    ['Mins', Math.floor((s % 3600) / 60)],
    ['Secs', s % 60],
  ]
  return (
    <div className="inline-flex flex-col items-center gap-2" role="timer" aria-live="off">
      {label && <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>}
      <div className="flex gap-2">
        {parts.map(([k, v]) => (
          <div key={k} className="min-w-14 rounded-lg bg-black/10 px-2 py-1.5 text-center">
            <div className="font-display text-2xl tabular-nums">{now === null ? '--' : pad(v)}</div>
            <div className="text-[10px] uppercase opacity-75">{k}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
