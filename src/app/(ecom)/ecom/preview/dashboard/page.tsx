export const dynamic = 'force-static'

export default function PreviewDashboard() {
  const kpis = [
    { label: 'Revenue', value: 'Rs. 1,24,500', sub: 'Prev: Rs. 1,05,200', pct: '+18%', color: 'bg-accent-500/10' },
    { label: 'Orders', value: '342', sub: 'Prev: 276', pct: '+24%', color: 'bg-blue-500/10' },
    { label: 'Avg Order Value', value: 'Rs. 364', sub: 'Prev: Rs. 381', pct: '-4%', color: 'bg-amber-500/10' },
    { label: 'Customers', value: '218', sub: 'Prev: 194', pct: '+12%', color: 'bg-violet-500/10' },
  ]
  const bars = [
    38, 55, 47, 72, 58, 85, 68, 74, 62, 88, 79, 92, 71, 83, 95, 68, 77, 84, 91, 62, 73, 88, 94, 76, 85, 92, 87, 96, 88,
    100,
  ]
  const actions = ['New Product', 'Cash Sale', 'Quotation', 'New PO', 'Orders', 'Packing Slips']

  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Store at a glance · Last 30 days</p>
        </div>
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-1 gap-0.5 self-start shrink-0">
          {['7d', '30d', '90d', '1y'].map((r, i) => (
            <span
              key={r}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${i === 1 ? 'bg-accent-500 text-white shadow-sm' : 'text-foreground-secondary'}`}
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(c => (
          <div key={c.label} className={`${c.color} rounded-xl border border-border-default p-4`}>
            <p className="text-sm text-foreground-secondary">{c.label}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{c.value}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-semibold ${c.pct.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                {c.pct}
              </span>
              <span className="text-xs text-foreground-muted">{c.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue trend */}
      <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Revenue &amp; Orders</h2>
          <span className="text-xs text-accent-600 font-medium">View Orders →</span>
        </div>
        <div className="flex items-end gap-1 h-24">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-accent-500/60" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[8px] text-foreground-muted">
          {['1', '5', '10', '15', '20', '25', '30'].map(d => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
        <p className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Quick Actions</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {actions.map((a, i) => (
            <div
              key={a}
              className={`rounded-lg border px-2 py-2 text-center text-xs font-medium cursor-pointer ${i === 0 ? 'bg-accent-500/15 border-accent-500/30 text-accent-600' : 'bg-surface-secondary border-border-default text-foreground-secondary'}`}
            >
              {a}
            </div>
          ))}
        </div>
      </div>

      {/* Needs attention */}
      <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
        <p className="text-xs text-foreground-muted uppercase tracking-widest mb-3">Needs Attention</p>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 5 pending orders
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> 3 low stock items
          </span>
        </div>
      </div>
    </div>
  )
}
