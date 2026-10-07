'use client'

import { useEffect, useState } from 'react'

// Identity watermark over protected content: a slowly drifting tiled layer plus a stamp that jumps
// position every few seconds, so no single crop of a still screenshot removes it. Traceable, not DRM.

export interface WatermarkInfo {
  buyer: string
  store: string
  timestamp: string
  /** Order number / entitlement id — ties a leaked capture to one purchase. */
  reference?: string | null
}

const MOVE_MS = 4000

export function watermarkLabel(info: WatermarkInfo, at?: string): string {
  return [info.buyer, info.reference ? `#${info.reference}` : null, info.store, at ?? info.timestamp]
    .filter(Boolean)
    .join(' · ')
}

export default function Watermark({ info }: { info: WatermarkInfo }) {
  const [stamp, setStamp] = useState({ x: 12, y: 18, at: info.timestamp })

  useEffect(() => {
    const id = window.setInterval(() => {
      setStamp({
        x: 6 + Math.random() * 58,
        y: 8 + Math.random() * 80,
        at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      })
    }, MOVE_MS)
    return () => window.clearInterval(id)
  }, [])

  const label = watermarkLabel(info)

  return (
    <div aria-hidden data-vault-watermark className="pointer-events-none absolute inset-0 z-40 select-none overflow-hidden">
      <style>{`
        @keyframes vault-wm-drift {
          0% { transform: translate(0, 0) rotate(-28deg) scale(1.6); }
          25% { transform: translate(-60px, 40px) rotate(-28deg) scale(1.6); }
          50% { transform: translate(-20px, 90px) rotate(-28deg) scale(1.6); }
          75% { transform: translate(50px, 30px) rotate(-28deg) scale(1.6); }
          100% { transform: translate(0, 0) rotate(-28deg) scale(1.6); }
        }
      `}</style>
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          alignContent: 'start',
          gap: '110px 28px',
          animation: 'vault-wm-drift 48s linear infinite',
          mixBlendMode: 'difference',
        }}
      >
        {Array.from({ length: 120 }).map((_, i) => (
          <div key={i} className="flex justify-center">
            <span className="whitespace-nowrap text-[11px] font-medium text-white/[0.18]">{label}</span>
          </div>
        ))}
      </div>
      <span
        className="absolute whitespace-nowrap rounded bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-white/45 transition-[left,top] duration-[1500ms] ease-in-out"
        style={{ left: `${stamp.x}%`, top: `${stamp.y}%` }}
      >
        {watermarkLabel(info, stamp.at)}
      </span>
    </div>
  )
}
