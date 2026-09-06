export const dynamic = 'force-static'

const coupons = [
  { code: 'WELCOME10', type: 'percentage', value: '10%',      used: 142, limit: 500,  expiry: '31/12/2026', status: 'active'    },
  { code: 'FLAT500',   type: 'flat',       value: 'Rs. 500',  used: 87,  limit: 200,  expiry: '15/10/2026', status: 'active'    },
  { code: 'FESTIVE25', type: 'percentage', value: '25%',      used: 0,   limit: 1000, expiry: '01/11/2026', status: 'scheduled' },
  { code: 'FREESHIP',  type: 'shipping',   value: 'Rs. 0',    used: 318, limit: 500,  expiry: '30/09/2026', status: 'active'    },
  { code: 'BOGO',      type: 'percentage', value: '50%',      used: 64,  limit: 150,  expiry: '20/08/2026', status: 'expired'   },
  { code: 'VIP15',     type: 'flat',       value: 'Rs. 1,500', used: 23, limit: 100,  expiry: '31/12/2026', status: 'active'    },
]

function typeMeta(t: string) {
  if (t === 'percentage') return { label: 'Percentage', cls: 'bg-blue-100 text-blue-800' }
  if (t === 'flat')       return { label: 'Flat', cls: 'bg-purple-100 text-purple-700' }
  return { label: 'Free Shipping', cls: 'bg-green-100 text-green-800' }
}
function statusMeta(s: string) {
  if (s === 'active')    return { label: 'Active', cls: 'bg-green-100 text-green-800' }
  if (s === 'scheduled') return { label: 'Scheduled', cls: 'bg-amber-100 text-amber-700' }
  return { label: 'Expired', cls: 'bg-red-100 text-red-800' }
}

const kpis = [
  { label: 'Active Coupons',        value: '4',           sub: 'of 6 total' },
  { label: 'Total Redemptions',     value: '634',         sub: '+82 this month' },
  { label: 'Discount Given',        value: 'Rs. 1,84,250', sub: 'lifetime' },
  { label: 'Avg Order Value Uplift', value: '+18%',       sub: 'vs. no coupon' },
]

export default function PreviewCoupons() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Coupons</h1>
        <button className="px-3 py-1.5 rounded-lg bg-accent-600 text-white text-xs font-semibold">+ Create Coupon</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-surface-elevated rounded-lg border border-border-default p-4 shadow-sm">
            <p className="text-xs text-foreground-muted">{k.label}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{k.value}</p>
            <p className="text-[11px] text-foreground-secondary mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter / search bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-48 h-9 rounded-lg bg-surface-elevated border border-border-default flex items-center px-3 gap-2">
          <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="text-xs text-foreground-muted">Search coupons…</span>
        </div>
        {['Type','Status'].map(f => (
          <div key={f} className="h-9 px-3 rounded-lg bg-surface-elevated border border-border-default flex items-center gap-1 text-xs text-foreground-secondary">
            {f}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
        ))}
      </div>

      {/* Coupons table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Code','Type','Value','Used / Limit','Expiry','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {coupons.map(c => {
              const t = typeMeta(c.type)
              const s = statusMeta(c.status)
              return (
                <tr key={c.code} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-foreground">{c.code}</td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${t.cls}`}>{t.label}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">{c.value}</td>
                  <td className="px-4 py-3 text-sm text-foreground-secondary">{c.used} / {c.limit}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{c.expiry}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${s.cls}`}>{s.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
