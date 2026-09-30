'use client'

import { createPortal } from 'react-dom'

import { useState } from 'react'

interface Distribution {
  b0_20: number
  b20_40: number
  b40_60: number
  b60_80: number
  b80_100: number
  unscored: number
}

const BUCKETS = [
  { label: '0-20', key: 'b0_20' as const, color: 'bg-red-500' },
  { label: '20-40', key: 'b20_40' as const, color: 'bg-orange-500' },
  { label: '40-60', key: 'b40_60' as const, color: 'bg-yellow-500' },
  { label: '60-80', key: 'b60_80' as const, color: 'bg-lime-500' },
  { label: '80-100', key: 'b80_100' as const, color: 'bg-green-500' },
]

function Bars({ d, tall }: { d: Distribution; tall?: boolean }) {
  const max = Math.max(d.b0_20, d.b20_40, d.b40_60, d.b60_80, d.b80_100, 1)
  return (
    <div className={`space-y-${tall ? '4' : '2'}`}>
      {BUCKETS.map(b => (
        <div key={b.label} className={`flex items-center gap-3 ${tall ? 'text-sm' : 'text-xs'}`}>
          <span className={`${tall ? 'w-16' : 'w-12'} text-foreground-muted tabular-nums`}>{b.label}</span>
          <div className={`flex-1 ${tall ? 'h-6' : 'h-4'} bg-surface-secondary rounded overflow-hidden`}>
            <div
              className={`h-full ${b.color} transition-all duration-500`}
              style={{ width: `${(d[b.key] / max) * 100}%` }}
            />
          </div>
          <span className={`${tall ? 'w-14' : 'w-10'} text-right font-semibold tabular-nums`}>{d[b.key]}</span>
        </div>
      ))}
      {d.unscored > 0 && (
        <p className="text-[10px] text-foreground-muted pt-1">
          {d.unscored.toLocaleString('en-IN')} customer(s) not yet scored
        </p>
      )}
    </div>
  )
}

export default function HealthDistributionCard({ distribution }: { distribution: Distribution }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Health Distribution</h2>
          <button
            onClick={() => setExpanded(true)}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
            aria-label="Expand health distribution"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          </button>
        </div>
        <Bars d={distribution} />
      </div>

      {expanded &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setExpanded(false)}
          >
            <div
              className="bg-surface-elevated rounded-2xl border border-border-default p-8 w-full max-w-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold text-foreground uppercase tracking-widest">
                  Health Distribution
                </h2>
                <button
                  onClick={() => setExpanded(false)}
                  className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <Bars d={distribution} tall />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
