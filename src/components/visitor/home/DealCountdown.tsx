'use client'

import { useEffect, useState } from 'react'

function remaining(endsAt: number) {
  return Math.max(0, endsAt - Date.now())
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export default function DealCountdown({ endsAt }: { endsAt: string }) {
  const target = Date.parse(endsAt)
  // Server and first client paint must agree, so start at null and fill in after mount.
  const [ms, setMs] = useState<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(target)) return
    setMs(remaining(target))
    const id = setInterval(() => setMs(remaining(target)), 1000)
    return () => clearInterval(id)
  }, [target])

  if (ms == null || ms <= 0) return null

  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: { value: string; label: string }[] = [
    ...(days > 0 ? [{ value: pad(days), label: 'Days' }] : []),
    { value: pad(hours), label: 'Hrs' },
    { value: pad(minutes), label: 'Min' },
    { value: pad(seconds), label: 'Sec' },
  ]

  return (
    <div className="flex items-center gap-1.5" role="timer" aria-label="Offer ends in">
      {parts.map(part => (
        <div key={part.label} className="flex flex-col items-center min-w-[2.5rem] px-2 py-1 rounded-lg bg-primary-500 text-white">
          <span className="text-sm md:text-base font-black leading-none tabular-nums">{part.value}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider opacity-80 leading-none mt-0.5">{part.label}</span>
        </div>
      ))}
    </div>
  )
}
