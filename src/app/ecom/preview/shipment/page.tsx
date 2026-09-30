export const dynamic = 'force-static'

const shipments = [
  { awb: 'DEL5892341', order: '#1042', customer: 'Alex Morgan', dest: 'Bengaluru', status: 'Out for Delivery' },
  { awb: 'DEL5892289', order: '#1039', customer: 'Taylor Reed', dest: 'Chennai', status: 'In Transit' },
  { awb: 'DEL5891976', order: '#1037', customer: 'Sam Carter', dest: 'Mumbai', status: 'Picked Up' },
  { awb: 'DEL5891820', order: '#1035', customer: 'Jordan Lee', dest: 'Hyderabad', status: 'Delivered' },
]

function statusCls(s: string) {
  if (s === 'Delivered') return 'bg-green-100 text-green-800'
  if (s === 'Out for Delivery') return 'bg-blue-100 text-blue-800'
  if (s === 'In Transit') return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}

const trackingEvents = [
  { time: '10:42 AM', label: 'Out for delivery', loc: 'Bengaluru South Hub', done: true },
  { time: '07:15 AM', label: 'Arrived at hub', loc: 'Bengaluru South Hub', done: true },
  { time: 'Yesterday', label: 'In transit', loc: 'Chennai Facility', done: true },
  { time: '2 days ago', label: 'Picked up', loc: 'Origin Pickup', done: false },
]

export default function PreviewShipment() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Delhivery · Shipments</h1>

      {/* Credentials card */}
      <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Delhivery Integration</p>
            <p className="text-xs text-foreground-muted mt-0.5">API credentials configured</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Connected</span>
        </div>
      </div>

      {/* Warehouse card */}
      <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default bg-surface-secondary">
          <p className="text-sm font-semibold text-foreground">Pickup Warehouses</p>
        </div>
        <div className="divide-y divide-border-default">
          {[
            { name: 'Main Warehouse', pin: '560001', phone: '9876543210' },
            { name: 'Regional Hub', pin: '600001', phone: '9876543211' },
          ].map(w => (
            <div key={w.name} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{w.name}</p>
                <p className="text-xs text-foreground-muted">
                  PIN: {w.pin} · {w.phone}
                </p>
              </div>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">Active</span>
            </div>
          ))}
        </div>
      </div>

      {/* Shipments table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default bg-surface-secondary">
          <p className="text-sm font-semibold text-foreground">Active Shipments</p>
        </div>
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['AWB Number', 'Order', 'Customer', 'Destination', 'Status'].map(h => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {shipments.map(s => (
              <tr key={s.awb} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3 text-sm font-mono text-foreground">{s.awb}</td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">{s.order}</td>
                <td className="px-4 py-3 text-sm text-foreground">{s.customer}</td>
                <td className="px-4 py-3 text-sm text-foreground-secondary">{s.dest}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusCls(s.status)}`}>
                    {s.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tracking timeline for first shipment */}
      <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-foreground">Tracking: DEL5892341</p>
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
            Out for Delivery
          </span>
        </div>
        <div className="space-y-3">
          {trackingEvents.map((e, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex flex-col items-center flex-shrink-0">
                <span
                  className={`w-3 h-3 rounded-full border-2 mt-0.5 ${e.done ? 'bg-accent-500 border-accent-500' : 'bg-surface border-border-default'}`}
                />
                {i < trackingEvents.length - 1 && (
                  <span className="w-px flex-1 bg-border-default mt-1" style={{ minHeight: 12 }} />
                )}
              </div>
              <div className="pb-1">
                <p className={`text-sm font-medium ${e.done ? 'text-foreground' : 'text-foreground-muted'}`}>
                  {e.label}
                </p>
                <p className="text-xs text-foreground-muted">
                  {e.loc} · {e.time}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
