import CopySku from '@/components/ui/CopySku'
import { RANGES, type AnalyticsData } from './analytics'

const stockTone = (stock: number) =>
  stock === 0 ? 'text-red-600 dark:text-red-400' : stock < 10 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'

/** SKU, brand and stock on the left; the day-range switch on the right. */
export function AnalyticsToolbar({ product, days, loading, onRange }: { product: AnalyticsData['product']; days: number; loading: boolean; onRange: (d: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
        <span className="inline-flex min-w-0 items-center font-mono [overflow-wrap:anywhere]">
          SKU: {product.sku}
          {product.sku && <CopySku sku={product.sku} className="ml-1" />}
        </span>
        {product.brandName && <span>Brand: {product.brandName}</span>}
        <span>
          Stock: <span className={`font-semibold tabular-nums ${stockTone(product.stock)}`}>{product.stock}</span>
        </span>
      </div>
      <div className="inline-flex h-control items-center gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
        {RANGES.map(d => (
          <button
            key={d}
            type="button"
            onClick={() => onRange(d)}
            disabled={loading}
            aria-pressed={days === d}
            className={`h-full rounded-md px-3 text-xs font-semibold transition-colors ${
              days === d ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:bg-surface-secondary hover:text-foreground'
            } disabled:opacity-50`}
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  )
}
