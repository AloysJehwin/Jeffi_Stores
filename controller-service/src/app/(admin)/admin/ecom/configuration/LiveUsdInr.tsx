export type FxRate = { rate: number; source: string; fetchedAt: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** The live USD→INR rate every USD price converts at (read-only; refreshed every six hours). */
export default function LiveUsdInr({ fx }: { fx: FxRate }) {
  const live = fx.source !== 'default'
  return (
    <div className="space-y-1 min-w-0">
      <span className="block text-xs font-medium text-foreground-secondary">USD → INR (live)</span>
      <div className="flex h-control items-center gap-2 rounded-lg border border-border-default bg-surface-secondary px-3 text-sm">
        <span className="font-semibold tabular-nums text-foreground">₹{fx.rate.toFixed(2)}</span>
        <span className="truncate text-xs text-foreground-muted" title={live ? `${fx.source}, ${when(fx.fetchedAt)}` : undefined}>
          {live ? `${fx.source} · ${when(fx.fetchedAt)}` : 'fallback: no rate source answered yet'}
        </span>
      </div>
    </div>
  )
}
