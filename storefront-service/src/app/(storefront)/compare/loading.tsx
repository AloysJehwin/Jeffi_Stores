import { Sk } from '@/components/admin/kit/skeleton'

const LABEL = 'p-4 text-xs font-semibold text-foreground-muted uppercase tracking-wide bg-surface-secondary align-top whitespace-nowrap'
const COLS = [0, 1, 2]

// Which spec rows appear depends on the products; Brand and Category always do.
export default function Loading() {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading comparison">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <span className="text-foreground-muted">Home</span>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground-muted">Products</span>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground font-medium">Compare</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Product Comparison</h1>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default bg-surface text-sm font-medium text-foreground-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add product
          </span>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border-default">
                <th className="w-36 sm:w-44 p-4 bg-surface-secondary" />
                {COLS.map(i => (
                  <th key={i} className="p-4 text-left align-top">
                    <div className="space-y-2">
                      <Sk className="w-full aspect-square max-w-[120px] mx-auto rounded-lg" />
                      <Sk className="h-4 w-full" />
                      <Sk className="h-4 w-3/4" />
                      <Sk className="h-5 w-24" />
                      <Sk className="h-5 w-20 rounded-full" />
                      <span className="block text-xs text-accent-500 font-medium">Change</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {['Brand', 'Category', '', '', '', '', ''].map((label, row) => (
                <tr
                  key={row}
                  className={`border-b border-border-default last:border-0 ${row % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}
                >
                  <td className={LABEL}>{label || <Sk className="h-3 w-20" />}</td>
                  {COLS.map(i => (
                    <td key={i} className="p-4 align-top">
                      <Sk className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center">
          <span className="text-sm text-accent-500">← Back to Products</span>
        </div>
      </div>
    </div>
  )
}
