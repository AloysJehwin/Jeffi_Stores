export const dynamic = 'force-static'

const kpis = [
  { label: 'Sent', value: '12,480', sub: 'last 30 days' },
  { label: 'Open Rate', value: '38%', sub: '+4.2% vs prev' },
  { label: 'Click Rate', value: '6.2%', sub: '+0.8% vs prev' },
  { label: 'Revenue', value: 'Rs. 2,84,500', sub: 'attributed' },
]

const campaigns = [
  { name: 'Diwali Sale Blast', channel: 'email', audience: 'All Subscribers', sent: '8,240', status: 'active' },
  { name: 'Abandoned Cart Recovery', channel: 'email', audience: 'Cart Abandoners', sent: '1,120', status: 'active' },
  { name: 'Welcome Series', channel: 'email', audience: 'New Signups', sent: '640', status: 'active' },
  { name: 'Winback 30d', channel: 'sms', audience: 'Dormant 30d+', sent: '2,310', status: 'scheduled' },
  { name: 'New Arrivals', channel: 'push', audience: 'App Installs', sent: '0', status: 'draft' },
  { name: 'VIP Early Access', channel: 'email', audience: 'VIP Segment', sent: '480', status: 'completed' },
]

function channelBadge(c: string) {
  if (c === 'email') return { cls: 'bg-blue-100 text-blue-800', label: 'Email' }
  if (c === 'sms') return { cls: 'bg-green-100 text-green-800', label: 'SMS' }
  return { cls: 'bg-purple-100 text-purple-700', label: 'Push' }
}

function statusCls(s: string) {
  if (s === 'active') return 'bg-green-100 text-green-800'
  if (s === 'scheduled') return 'bg-blue-100 text-blue-800'
  if (s === 'completed') return 'bg-purple-100 text-purple-700'
  return 'bg-amber-100 text-amber-700'
}

const perfBars = [42, 58, 51, 70, 64, 82, 76, 90, 71, 88, 79, 95]
const perfLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function PreviewCampaigns() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">6 campaigns · 3 active</p>
        </div>
        <button className="px-3 py-1.5 rounded-lg bg-accent-600 text-white text-xs font-semibold">
          + New Campaign
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-surface-elevated rounded-xl border border-border-default p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{k.label}</p>
            <p className="text-2xl font-bold mt-1 text-foreground tabular-nums">{k.value}</p>
            <p className="text-xs text-foreground-muted mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Campaigns table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Campaign', 'Type', 'Audience', 'Sent', 'Status'].map(h => (
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
            {campaigns.map(c => {
              const ch = channelBadge(c.channel)
              return (
                <tr key={c.name} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-500/10 text-accent-600 text-xs font-bold uppercase">
                        {ch.label[0]}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        <p className="text-xs text-foreground-muted">{ch.label} campaign</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${ch.cls}`}>{ch.label}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{c.audience}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground tabular-nums">{c.sent}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full capitalize ${statusCls(c.status)}`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Performance over time */}
      <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">
            Performance over time
          </h2>
          <span className="text-xs text-foreground-muted">Opens per month</span>
        </div>
        <div className="flex items-end gap-1.5 h-40">
          {perfBars.map((h, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end">
              <div
                className={`w-full rounded-t ${i % 3 === 0 ? 'bg-blue-500/70' : i % 3 === 1 ? 'bg-accent-500/70' : 'bg-purple-500/60'}`}
                style={{ height: `${h}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          {perfLabels.map(l => (
            <span key={l} className="flex-1 text-center text-[10px] text-foreground-muted">
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
