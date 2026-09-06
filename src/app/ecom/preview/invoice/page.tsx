export const dynamic = 'force-static'

const invoices = [
  { num: 'INV-2026-1042', date: '05/09/2026', customer: 'Alex Morgan',   amount: 'Rs. 3,895.06', payment: 'razorpay', source: 'online',   irn: true  },
  { num: 'INV-2026-1041', date: '04/09/2026', customer: 'Jordan Lee',    amount: 'Rs. 1,799.00', payment: 'razorpay', source: 'online',   irn: true  },
  { num: 'INV-2026-1040', date: '03/09/2026', customer: 'Sam Carter',    amount: 'Rs. 649.00',   payment: 'razorpay', source: 'business', irn: false },
  { num: 'INV-2026-1039', date: '02/09/2026', customer: 'Taylor Reed',   amount: 'Rs. 3,148.00', payment: 'cod',      source: 'online',   irn: true  },
  { num: 'INV-2026-1038', date: '01/09/2026', customer: 'Casey Brooks',  amount: 'Rs. 899.00',   payment: 'razorpay', source: 'online',   irn: false },
]

function paymentCls(p: string) {
  if (p === 'razorpay') return 'bg-blue-100 text-blue-700'
  if (p === 'cod')      return 'bg-amber-100 text-amber-700'
  return 'bg-purple-100 text-purple-700'
}
function sourceCls(s: string) {
  if (s === 'online')   return 'bg-blue-100 text-blue-700'
  if (s === 'business') return 'bg-green-100 text-green-700'
  return 'bg-purple-100 text-purple-700'
}

export default function PreviewInvoice() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Invoices</h1>
        <button className="px-3 py-1.5 rounded-lg bg-accent-600 text-white text-xs font-semibold">+ New Invoice</button>
      </div>

      {/* Filter / search bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-48 h-9 rounded-lg bg-surface-elevated border border-border-default flex items-center px-3 gap-2">
          <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="text-xs text-foreground-muted">Search invoices…</span>
        </div>
        {['Payment','Source','IRN Status'].map(f => (
          <div key={f} className="h-9 px-3 rounded-lg bg-surface-elevated border border-border-default flex items-center gap-1 text-xs text-foreground-secondary">
            {f}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
        ))}
      </div>

      {/* Invoices table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Invoice No','Date','Customer','Amount','Payment','Source','IRN'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {invoices.map(inv => (
              <tr key={inv.num} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3 text-sm font-mono font-semibold text-foreground">{inv.num}</td>
                <td className="px-4 py-3 text-sm text-foreground-muted">{inv.date}</td>
                <td className="px-4 py-3 text-sm text-foreground">{inv.customer}</td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">{inv.amount}</td>
                <td className="px-4 py-3">
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${paymentCls(inv.payment)}`}>{inv.payment}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${sourceCls(inv.source)}`}>{inv.source}</span>
                </td>
                <td className="px-4 py-3">
                  {inv.irn
                    ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700">Generated</span>
                    : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-surface-secondary text-foreground-muted">Pending</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
