export const dynamic = 'force-static'

const orders = [
  { id: '1042', customer: 'Alex Morgan',    amount: 'Rs. 2,499.00', status: 'shipped',    payment_status: 'paid',     source: 'online'    },
  { id: '1041', customer: 'Jordan Lee',      amount: 'Rs. 1,799.00', status: 'delivered',  payment_status: 'paid',     source: 'online'    },
  { id: '1040', customer: 'Sam Carter',      amount: 'Rs. 649.00',   status: 'processing', payment_status: 'paid',     source: 'business'  },
  { id: '1039', customer: 'Taylor Reed',     amount: 'Rs. 3,148.00', status: 'pending',    payment_status: 'pending',  source: 'online'    },
  { id: '1038', customer: 'Casey Brooks',    amount: 'Rs. 899.00',   status: 'cancelled',  payment_status: 'refunded', source: 'cash_sale' },
]

function statusCls(s: string) {
  if (s === 'delivered') return 'bg-green-100 text-green-800'
  if (s === 'processing' || s === 'shipped') return 'bg-blue-100 text-blue-800'
  if (s === 'cancelled') return 'bg-red-100 text-red-800'
  return 'bg-yellow-100 text-yellow-800'
}
function sourceCls(s: string) {
  if (s === 'online') return 'bg-blue-100 text-blue-700'
  if (s === 'business') return 'bg-green-100 text-green-700'
  return 'bg-purple-100 text-purple-700'
}
function paymentCls(s: string) {
  if (s === 'paid') return 'bg-green-100 text-green-800'
  if (s === 'refunded') return 'bg-red-100 text-red-800'
  return 'bg-yellow-100 text-yellow-800'
}
function sourceLabel(s: string) {
  if (s === 'online') return 'Online'
  if (s === 'business') return 'Business'
  return 'Cash Sale'
}

const chartBars = [45,62,38,75,55,88,70,82,65,90,73,95]

export default function PreviewOrders() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Orders</h1>

      {/* Stats banner — mirrors OrdersStats in orders/page.tsx exactly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:h-56">
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Total Revenue</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">Rs. 3,84,250.00</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            {[['342','Total'],['17','Pending'],['28','Processing'],['297','Completed']] .map(([v, l]) => (
              <div key={l} className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
                <p className="text-lg sm:text-2xl font-bold leading-none">{v}</p>
                <p className="text-[10px] sm:text-xs text-white/80 mt-1">{l}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 flex flex-col">
          <p className="text-sm font-semibold text-foreground mb-3">Revenue by Source</p>
          <div className="flex items-end gap-1 flex-1">
            {chartBars.map((h, i) => (
              <div key={i} className={`flex-1 rounded-t ${i % 3 === 0 ? 'bg-blue-500/70' : i % 3 === 1 ? 'bg-accent-500/70' : 'bg-purple-500/60'}`} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-[10px] text-foreground-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/70 inline-block" />Online</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-500/70 inline-block" />Business</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500/60 inline-block" />Cash</span>
          </div>
        </div>
      </div>

      {/* Orders table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Order ID','Source','Customer','Date','Amount','Status','Payment'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {orders.map(o => (
              <tr key={o.id} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3 text-sm font-semibold text-foreground">#{o.id}</td>
                <td className="px-4 py-3">
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${sourceCls(o.source)}`}>{sourceLabel(o.source)}</span>
                </td>
                <td className="px-4 py-3 text-sm text-foreground">{o.customer}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">05/09/2026</td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">{o.amount}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusCls(o.status)}`}>{o.status}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${paymentCls(o.payment_status)}`}>{o.payment_status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
