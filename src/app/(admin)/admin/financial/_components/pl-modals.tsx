'use client'

import { Modal, formatINR } from './shared'

export function PLMonthModal({ m, all, onClose }: { m: any; all: any[]; onClose: () => void }) {
  const W = 520,
    H = 200,
    PAD = { t: 12, r: 16, b: 32, l: 64 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const bars = [
    { label: 'Revenue', value: m.revenue, color: '#3b82f6' },
    { label: 'Net Rev.', value: m.net_revenue, color: '#8b5cf6' },
    { label: 'Gross P.', value: m.gross_profit, color: '#10b981' },
    { label: 'Op. Profit', value: m.operating_profit, color: m.operating_profit >= 0 ? '#22c55e' : '#ef4444' },
    { label: 'COGS', value: m.cogs, color: '#f97316' },
    { label: 'Op. Exp.', value: m.operating_expenses, color: '#ec4899' },
    { label: 'Refunds', value: m.refunds, color: '#f43f5e' },
  ]

  const maxVal = Math.max(...bars.map(b => Math.abs(b.value)), 1)
  const bw = Math.floor(innerW / bars.length)
  const gap = 6

  const monthLabel = new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  // Source donut data
  const srcTotal = m.revenue_online + m.revenue_business + m.revenue_cash_sale + m.revenue_offline
  const sources = [
    { label: 'Online', value: m.revenue_online, color: '#3b82f6' },
    { label: 'Business', value: m.revenue_business, color: '#8b5cf6' },
    { label: 'Cash Sale', value: m.revenue_cash_sale, color: '#10b981' },
    { label: 'Offline', value: m.revenue_offline, color: '#f97316' },
  ].filter(s => s.value > 0)

  // Trend sparkline: net revenue across all months
  const trendVals = all.map(r => r.net_revenue)
  const tMin = Math.min(...trendVals, 0)
  const tMax = Math.max(...trendVals, 1)
  const tRange = tMax - tMin || 1
  const tW = 300,
    tH = 60
  const tPts = trendVals
    .map((v, i) => {
      const x = trendVals.length === 1 ? tW / 2 : (i / (trendVals.length - 1)) * tW
      const y = tH - ((v - tMin) / tRange) * tH
      return `${x},${y}`
    })
    .join(' ')

  const curIdx = all.findIndex(r => r.month === m.month)
  const curX = trendVals.length === 1 ? tW / 2 : (curIdx / (trendVals.length - 1)) * tW
  const curY = tH - ((m.net_revenue - tMin) / tRange) * tH

  return (
    <Modal onClose={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-foreground">{monthLabel} — P&amp;L Breakdown</h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Gross Revenue', val: m.revenue },
              { label: 'Net Revenue', val: m.net_revenue },
              { label: 'Gross Margin', val: null, pct: m.gross_margin_pct },
              { label: 'COGS', val: m.cogs },
              { label: 'Gross Profit', val: m.gross_profit },
              { label: 'Op. Profit', val: m.operating_profit },
            ].map(k => (
              <div key={k.label} className="bg-surface-elevated rounded-xl px-3 py-2 border border-border-default">
                <p className="text-xs text-foreground-secondary mb-0.5">{k.label}</p>
                <p className={`text-base font-bold ${k.val != null && k.val < 0 ? 'text-red-500' : 'text-foreground'}`}>
                  {k.val != null ? formatINR(k.val) : `${k.pct}%`}
                </p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
              Metric Comparison
            </p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {/* Y grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => {
                const y = PAD.t + innerH * (1 - t)
                const val = maxVal * t
                return (
                  <g key={t}>
                    <line
                      x1={PAD.l}
                      x2={W - PAD.r}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.08"
                      strokeWidth="1"
                    />
                    <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.5">
                      {val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}
                    </text>
                  </g>
                )
              })}
              {/* Bars */}
              {bars.map((b, i) => {
                const barH = (Math.abs(b.value) / maxVal) * innerH
                const x = PAD.l + i * bw + gap / 2
                const y = b.value >= 0 ? PAD.t + innerH - barH : PAD.t + innerH
                return (
                  <g key={b.label}>
                    <rect x={x} y={y} width={bw - gap} height={barH} fill={b.color} rx="3" fillOpacity="0.85" />
                    <text
                      x={x + (bw - gap) / 2}
                      y={H - PAD.b + 12}
                      textAnchor="middle"
                      fontSize="8"
                      fill="currentColor"
                      fillOpacity="0.6"
                    >
                      {b.label}
                    </text>
                  </g>
                )
              })}
              {/* Zero line */}
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={PAD.t + innerH}
                y2={PAD.t + innerH}
                stroke="currentColor"
                strokeOpacity="0.2"
                strokeWidth="1"
              />
            </svg>
          </div>

          {/* Revenue source donut-style stacked bar */}
          {srcTotal > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
                Revenue by Source
              </p>
              <div className="flex h-5 rounded-full overflow-hidden w-full gap-px">
                {sources.map(s => (
                  <div
                    key={s.label}
                    style={{ width: `${(s.value / srcTotal) * 100}%`, background: s.color }}
                    title={`${s.label}: ${formatINR(s.value)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {sources.map(s => (
                  <span key={s.label} className="flex items-center gap-1 text-xs text-foreground-secondary">
                    <span
                      className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0"
                      style={{ background: s.color }}
                    />
                    {s.label} · {formatINR(s.value)} ({Math.round((s.value / srcTotal) * 100)}%)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Net revenue trend sparkline */}
          {all.length > 1 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
                Net Revenue Trend (period)
              </p>
              <svg viewBox={`0 0 ${tW} ${tH + 16}`} className="w-full h-auto">
                <polyline points={tPts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
                {/* Current month highlight */}
                <circle cx={curX} cy={curY} r="4" fill="#8b5cf6" />
                <text x={curX} y={curY - 7} textAnchor="middle" fontSize="9" fill="#8b5cf6">
                  {formatINR(m.net_revenue)}
                </text>
                {/* Month labels at first/last */}
                <text x={0} y={tH + 13} fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[0].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
                <text x={tW} y={tH + 13} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[all.length - 1].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
              </svg>
            </div>
          )}

          {/* Orders + GST */}
          <div className="flex gap-4 text-sm text-foreground-secondary">
            <span>{m.order_count} orders</span>
            <span>GST collected: {formatINR(m.tax_collected)}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function CashflowMonthModal({ m, all, onClose }: { m: any; all: any[]; onClose: () => void }) {
  const W = 520,
    H = 200,
    PAD = { t: 12, r: 16, b: 32, l: 64 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  // Grouped bar: cash_in (green) vs cash_out (red)
  const maxVal = Math.max(m.cash_in, m.cash_out, 1)
  const groupW = innerW / 2
  const bw = groupW * 0.35

  // Running balance sparkline over all months
  const balVals = all.map(r => r.running_balance)
  const bMin = Math.min(...balVals, 0)
  const bMax = Math.max(...balVals, 1)
  const bRange = bMax - bMin || 1
  const tW = 300,
    tH = 60
  const balPts = balVals
    .map((v, i) => {
      const x = balVals.length === 1 ? tW / 2 : (i / (balVals.length - 1)) * tW
      const y = tH - ((v - bMin) / bRange) * tH
      return `${x},${y}`
    })
    .join(' ')
  const curIdx = all.findIndex(r => r.month === m.month)
  const curX = balVals.length === 1 ? tW / 2 : (curIdx / (balVals.length - 1)) * tW
  const curY = tH - ((m.running_balance - bMin) / bRange) * tH

  const monthLabel = new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const srcTotal = m.cash_in_online + m.cash_in_business + m.cash_in_cash_sale + m.cash_in_offline
  const sources = [
    { label: 'Online', value: m.cash_in_online, color: '#3b82f6' },
    { label: 'Business', value: m.cash_in_business, color: '#8b5cf6' },
    { label: 'Cash Sale', value: m.cash_in_cash_sale, color: '#10b981' },
    { label: 'Offline', value: m.cash_in_offline, color: '#f97316' },
  ].filter(s => s.value > 0)

  return (
    <Modal onClose={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-foreground">{monthLabel} — Cashflow</h2>
          <button
            onClick={onClose}
            className="text-foreground-secondary hover:text-foreground transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Cash In', val: m.cash_in, pos: true },
              { label: 'PO Payments', val: m.po_payments, pos: false },
              { label: 'Refunds Out', val: m.refunds_out, pos: false },
              { label: 'Total Out', val: m.cash_out, pos: false },
              { label: 'Net', val: m.net, pos: m.net >= 0 },
              { label: 'Balance', val: m.running_balance, pos: m.running_balance >= 0 },
            ].map(k => (
              <div key={k.label} className="bg-surface-elevated rounded-xl px-3 py-2 border border-border-default">
                <p className="text-xs text-foreground-secondary mb-0.5">{k.label}</p>
                <p
                  className={`text-base font-bold ${k.pos ? 'text-green-600 dark:text-green-400' : k.val > 0 ? 'text-red-500' : 'text-foreground'}`}
                >
                  {formatINR(k.val)}
                </p>
              </div>
            ))}
          </div>

          {/* Grouped bar: in vs out */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
              Cash In vs Cash Out
            </p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {[0, 0.5, 1].map(t => {
                const y = PAD.t + innerH * (1 - t)
                return (
                  <g key={t}>
                    <line
                      x1={PAD.l}
                      x2={W - PAD.r}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.08"
                      strokeWidth="1"
                    />
                    <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.5">
                      {t > 0 ? `${Math.round((maxVal * t) / 1000)}k` : '0'}
                    </text>
                  </g>
                )
              })}
              {/* Cash In bar */}
              {(() => {
                const bh = (m.cash_in / maxVal) * innerH
                const x = PAD.l + innerW / 4 - bw / 2
                return (
                  <g>
                    <rect
                      x={x}
                      y={PAD.t + innerH - bh}
                      width={bw}
                      height={bh}
                      fill="#22c55e"
                      rx="3"
                      fillOpacity="0.85"
                    />
                    <text
                      x={x + bw / 2}
                      y={H - PAD.b + 12}
                      textAnchor="middle"
                      fontSize="9"
                      fill="currentColor"
                      fillOpacity="0.6"
                    >
                      Cash In
                    </text>
                    <text x={x + bw / 2} y={PAD.t + innerH - bh - 4} textAnchor="middle" fontSize="8" fill="#22c55e">
                      {formatINR(m.cash_in)}
                    </text>
                  </g>
                )
              })()}
              {/* Cash Out bar — stacked PO + refunds */}
              {(() => {
                const totalH = (m.cash_out / maxVal) * innerH
                const poH = m.cash_out > 0 ? (m.po_payments / m.cash_out) * totalH : 0
                const rfH = totalH - poH
                const x = PAD.l + (3 * innerW) / 4 - bw / 2
                return (
                  <g>
                    <rect
                      x={x}
                      y={PAD.t + innerH - poH}
                      width={bw}
                      height={poH}
                      fill="#f97316"
                      rx="0"
                      fillOpacity="0.85"
                    />
                    <rect
                      x={x}
                      y={PAD.t + innerH - totalH}
                      width={bw}
                      height={rfH}
                      fill="#ef4444"
                      rx="3"
                      fillOpacity="0.85"
                      style={{ borderRadius: rfH > 0 ? '3px 3px 0 0' : undefined }}
                    />
                    <text
                      x={x + bw / 2}
                      y={H - PAD.b + 12}
                      textAnchor="middle"
                      fontSize="9"
                      fill="currentColor"
                      fillOpacity="0.6"
                    >
                      Cash Out
                    </text>
                    {m.cash_out > 0 && (
                      <text
                        x={x + bw / 2}
                        y={PAD.t + innerH - totalH - 4}
                        textAnchor="middle"
                        fontSize="8"
                        fill="#ef4444"
                      >
                        {formatINR(m.cash_out)}
                      </text>
                    )}
                  </g>
                )
              })()}
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={PAD.t + innerH}
                y2={PAD.t + innerH}
                stroke="currentColor"
                strokeOpacity="0.2"
                strokeWidth="1"
              />
            </svg>
            <div className="flex gap-4 text-xs text-foreground-secondary mt-1">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-orange-400 inline-block" />
                PO Payments: {formatINR(m.po_payments)}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />
                Refunds Out: {formatINR(m.refunds_out)}
              </span>
            </div>
          </div>

          {/* Source breakdown stacked bar */}
          {srcTotal > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
                Cash In by Source
              </p>
              <div className="flex h-5 rounded-full overflow-hidden w-full gap-px">
                {sources.map(s => (
                  <div
                    key={s.label}
                    style={{ width: `${(s.value / srcTotal) * 100}%`, background: s.color }}
                    title={`${s.label}: ${formatINR(s.value)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {sources.map(s => (
                  <span key={s.label} className="flex items-center gap-1 text-xs text-foreground-secondary">
                    <span
                      className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0"
                      style={{ background: s.color }}
                    />
                    {s.label} · {formatINR(s.value)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Running balance sparkline */}
          {all.length > 1 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">
                Running Balance Trend
              </p>
              <svg viewBox={`0 0 ${tW} ${tH + 16}`} className="w-full h-auto">
                {/* Zero line if range crosses 0 */}
                {bMin < 0 && bMax > 0 && (
                  <line
                    x1={0}
                    x2={tW}
                    y1={tH - ((0 - bMin) / bRange) * tH}
                    y2={tH - ((0 - bMin) / bRange) * tH}
                    stroke="#ef4444"
                    strokeOpacity="0.3"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                )}
                <polyline points={balPts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
                <circle cx={curX} cy={curY} r="4" fill="#3b82f6" />
                <text x={curX} y={curY - 7} textAnchor="middle" fontSize="9" fill="#3b82f6">
                  {formatINR(m.running_balance)}
                </text>
                <text x={0} y={tH + 13} fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[0].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
                <text x={tW} y={tH + 13} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[all.length - 1].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
              </svg>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
