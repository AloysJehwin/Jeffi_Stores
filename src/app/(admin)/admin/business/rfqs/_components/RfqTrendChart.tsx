export interface RfqTrendPoint {
  month: string
  count: number
}

const VIEW_W = 560
const VIEW_H = 140
const PAD = { top: 10, right: 8, bottom: 20, left: 28 }

function shortMonth(m: string): string {
  if (!m) return ''
  const [y, mm] = m.split('-')
  const d = new Date(Number(y), Number(mm) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

export default function RfqTrendChart({ data }: { data: RfqTrendPoint[] }) {
  const points = data.filter(Boolean)
  const hasData = points.length > 0 && points.some(p => p.count > 0)

  const maxY = Math.max(1, ...points.map(p => p.count))
  const plotW = VIEW_W - PAD.left - PAD.right
  const plotH = VIEW_H - PAD.top - PAD.bottom

  const slot = points.length > 0 ? plotW / points.length : plotW
  const barW = Math.max(6, Math.min(28, slot * 0.6))
  const xCenter = (i: number) => PAD.left + slot * i + slot / 2
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH
  const yTicks = [0, Math.ceil(maxY / 2), maxY]
  const xStep = points.length <= 8 ? 1 : Math.ceil(points.length / 7)

  return (
    <div className="bg-surface-elevated border border-border-default rounded-lg shadow-sm p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2 flex-shrink-0 gap-2">
        <p className="text-sm font-semibold text-foreground">RFQs Received</p>
        <span className="text-xs text-foreground-muted">last 12 months</span>
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground-muted">No RFQs yet</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-full min-w-[320px]"
            preserveAspectRatio="none"
            role="img"
            aria-label="RFQs received per month"
          >
            {yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={VIEW_W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border-default"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? undefined : '3 3'}
                />
                <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" className="fill-foreground-muted" fontSize={9}>
                  {t}
                </text>
              </g>
            ))}

            {points.map((p, i) => (
              <rect
                key={p.month}
                x={xCenter(i) - barW / 2}
                y={y(p.count)}
                width={barW}
                height={PAD.top + plotH - y(p.count)}
                rx={2}
                className="fill-accent-500"
              >
                <title>
                  {shortMonth(p.month)} {p.month.split('-')[0]}: {p.count}
                </title>
              </rect>
            ))}

            {points.map(
              (p, i) =>
                (i % xStep === 0 || i === points.length - 1) && (
                  <text
                    key={p.month}
                    x={xCenter(i)}
                    y={VIEW_H - 6}
                    textAnchor="middle"
                    className="fill-foreground-muted"
                    fontSize={9}
                  >
                    {shortMonth(p.month)}
                  </text>
                )
            )}
          </svg>
        </div>
      )}
    </div>
  )
}
