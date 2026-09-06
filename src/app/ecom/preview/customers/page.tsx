export const dynamic = 'force-static'

const customers = [
  { id: '1', name: 'Alex Morgan',  email: 'alex.morgan@example.com',  orders: 14, spent: 'Rs. 42,380', last: '04/09/2026', status: 'vip'     },
  { id: '2', name: 'Jordan Lee',   email: 'jordan.lee@example.com',   orders: 9,  spent: 'Rs. 18,940', last: '02/09/2026', status: 'active'  },
  { id: '3', name: 'Sam Carter',   email: 'sam.carter@example.com',   orders: 6,  spent: 'Rs. 11,250', last: '31/08/2026', status: 'active'  },
  { id: '4', name: 'Taylor Reed',  email: 'taylor.reed@example.com',  orders: 22, spent: 'Rs. 68,120', last: '05/09/2026', status: 'vip'     },
  { id: '5', name: 'Casey Brooks', email: 'casey.brooks@example.com', orders: 3,  spent: 'Rs. 4,760',  last: '18/07/2026', status: 'dormant' },
  { id: '6', name: 'Riley Quinn',  email: 'riley.quinn@example.com',  orders: 1,  spent: 'Rs. 899',    last: '03/09/2026', status: 'active'  },
]

function statusCls(s: string) {
  if (s === 'vip')     return 'bg-purple-100 text-purple-700'
  if (s === 'active')  return 'bg-green-100 text-green-800'
  return 'bg-amber-100 text-amber-700'
}
function statusLabel(s: string) {
  if (s === 'vip')     return 'VIP'
  if (s === 'active')  return 'Active'
  return 'Dormant'
}
function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2)
}

const chartBars = [38,52,44,68,57,74,61,83,70,88,79,94]

export default function PreviewCustomers() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Customers</h1>
        <button className="px-3 py-1.5 rounded-lg bg-accent-600 text-white text-xs font-semibold">+ Add Customer</button>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:h-56">
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Total Customers</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">1,284</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            {[['1,284','Total'],['96','New'],['412','Repeat'],['58','VIP']].map(([v, l]) => (
              <div key={l} className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
                <p className="text-lg sm:text-2xl font-bold leading-none">{v}</p>
                <p className="text-[10px] sm:text-xs text-white/80 mt-1">{l}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 flex flex-col">
          <p className="text-sm font-semibold text-foreground mb-3">New Customers</p>
          <div className="flex items-end gap-1 flex-1">
            {chartBars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-accent-500/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-[10px] text-foreground-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-500/70 inline-block" />New signups</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary-500/70 inline-block" />Returning</span>
          </div>
        </div>
      </div>

      {/* Filter / search bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-48 h-9 rounded-lg bg-surface-elevated border border-border-default flex items-center px-3 gap-2">
          <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="text-xs text-foreground-muted">Search customers…</span>
        </div>
        {['Segment','Status'].map(f => (
          <div key={f} className="h-9 px-3 rounded-lg bg-surface-elevated border border-border-default flex items-center gap-1 text-xs text-foreground-secondary">
            {f}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
        ))}
      </div>

      {/* Customers table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Customer','Orders','Total Spent','Last Order','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {customers.map(c => (
              <tr key={c.id} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center flex-shrink-0 text-xs font-semibold text-foreground-secondary">
                      {initials(c.name)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{c.name}</div>
                      <div className="text-xs text-foreground-muted">{c.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-foreground">{c.orders}</td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">{c.spent}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{c.last}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusCls(c.status)}`}>{statusLabel(c.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
