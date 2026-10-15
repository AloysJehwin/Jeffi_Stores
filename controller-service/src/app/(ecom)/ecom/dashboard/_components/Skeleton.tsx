const bar = 'rounded bg-surface-secondary animate-pulse'

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border-default">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-3" style={{ animationDelay: `${r * 60}ms` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`${bar} h-3.5`} style={{ width: `${c === 0 ? 28 : 100 / (cols + 1)}%`, animationDelay: `${r * 60}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function CardShell({ children, tall }: { children: React.ReactNode; tall?: boolean }) {
  return <section className={`rounded-2xl border border-border-default bg-surface-elevated p-6 ${tall ? 'min-h-[320px]' : ''}`}>{children}</section>
}

/** Route-level loading state for the ecom console: header + a layout that matches the page. */
export default function DashboardSkeleton({ variant = 'cards' }: { variant?: 'cards' | 'table' | 'split' | 'form' }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-8 space-y-3">
        <div className={`${bar} h-3 w-24`} />
        <div className={`${bar} h-9 w-64`} />
        <div className={`${bar} h-3.5 w-96 max-w-full opacity-70`} />
      </div>
      {variant === 'cards' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => (
              <CardShell key={i}>
                <div className={`${bar} h-3 w-20 mb-3`} />
                <div className={`${bar} h-7 w-28`} />
              </CardShell>
            ))}
          </div>
          <CardShell><SkeletonRows rows={4} cols={3} /></CardShell>
        </div>
      )}
      {variant === 'table' && <CardShell tall><SkeletonRows rows={8} cols={5} /></CardShell>}
      {variant === 'form' && (
        <CardShell tall>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="mb-5">
              <div className={`${bar} h-3 w-24 mb-2`} />
              <div className={`${bar} h-10 w-full opacity-70`} />
            </div>
          ))}
        </CardShell>
      )}
      {variant === 'split' && (
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">
          <CardShell tall><SkeletonRows rows={7} cols={1} /></CardShell>
          <CardShell tall><SkeletonRows rows={5} cols={2} /></CardShell>
        </div>
      )}
    </div>
  )
}
