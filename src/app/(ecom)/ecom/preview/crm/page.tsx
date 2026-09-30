export const dynamic = 'force-static'

const tasks = [
  { label: 'My Tasks', value: '7', color: 'bg-surface-elevated', text: 'text-foreground' },
  { label: 'Overdue', value: '3', color: 'bg-red-50 border-red-200', text: 'text-red-700' },
  { label: 'Open (all)', value: '19', color: 'bg-surface-elevated', text: 'text-foreground' },
]

const health = [
  { label: 'Healthy', count: 842, pct: 68, chip: 'bg-green-100 text-green-800', bar: 'bg-green-500' },
  { label: 'At Risk', count: 274, pct: 22, chip: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
  { label: 'Dormant', count: 132, pct: 10, chip: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
]

const churnRisks = [
  { name: 'Morgan Blake', score: 34, days: 62, spend: 'Rs. 18,400' },
  { name: 'Riley Quinn', score: 41, days: 48, spend: 'Rs. 9,250' },
  { name: 'Casey Brooks', score: 46, days: 39, spend: 'Rs. 12,900' },
  { name: 'Taylor Reed', score: 52, days: 31, spend: 'Rs. 6,700' },
]

const topTags = [
  { tag: 'VIP', count: 48 },
  { tag: 'Repeat Buyer', count: 132 },
  { tag: 'Wholesale', count: 27 },
  { tag: 'Newsletter', count: 610 },
  { tag: 'First Order', count: 94 },
  { tag: 'High Value', count: 39 },
  { tag: 'Referral', count: 56 },
]

const recentSignups = [
  { name: 'Alex Morgan', when: '2h ago', email: 'alex.m@example.com' },
  { name: 'Jordan Lee', when: '5h ago', email: 'jordan.lee@example.com' },
  { name: 'Sam Carter', when: '1d ago', email: 'sam.carter@example.com' },
  { name: 'Riley Quinn', when: '2d ago', email: 'riley.q@example.com' },
  { name: 'Morgan Blake', when: '3d ago', email: 'm.blake@example.com' },
]

function scoreCls(n: number) {
  if (n < 40) return 'bg-red-100 text-red-800'
  if (n < 50) return 'bg-amber-100 text-amber-700'
  return 'bg-yellow-100 text-yellow-800'
}

export default function PreviewCrm() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">CRM</h1>
        <p className="text-sm text-foreground-secondary mt-0.5">1,248 customers · 32 new this week</p>
      </div>

      {/* Task summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {tasks.map(t => (
          <div key={t.label} className={`rounded-xl border border-border-default p-4 ${t.color}`}>
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${t.text === 'text-red-700' ? 'text-red-700' : 'text-foreground-muted'}`}
            >
              {t.label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${t.text}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Customer Health */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">
            Customer Health
          </h2>
          <div className="space-y-4">
            {health.map(h => (
              <div key={h.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${h.chip}`}>
                    {h.label}
                  </span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">{h.count.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-secondary overflow-hidden">
                  <div className={`h-full rounded-full ${h.bar}`} style={{ width: `${h.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Churn Risks */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Churn Risks</h2>
          <div className="divide-y divide-border-default">
            {churnRisks.map(c => (
              <div key={c.name} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {c.days} days since last order · {c.spend}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scoreCls(c.score)}`}>{c.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Tags */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Top Tags</h2>
          <div className="flex flex-wrap gap-2">
            {topTags.map(t => (
              <span
                key={t.tag}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium"
              >
                {t.tag}
                <span className="text-[10px] opacity-70 tabular-nums">{t.count}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Recent Signups */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Recent Signups</h2>
          <div className="divide-y divide-border-default">
            {recentSignups.map(r => (
              <div key={r.email} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-500/10 text-accent-600 text-xs font-bold">
                    {r.name
                      .split(' ')
                      .map(n => n[0])
                      .join('')}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.name}</p>
                    <p className="text-xs text-foreground-muted">{r.email}</p>
                  </div>
                </div>
                <span className="text-xs text-foreground-muted">{r.when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
