import type { ShelfRow } from './product-view'

export function ShelfBadges({ rows, small }: { rows: ShelfRow[]; small?: boolean }) {
  if (rows.length === 0 && !small) return <span className="text-xs text-foreground-muted italic">—</span>
  return (
    <div className={`flex flex-wrap gap-1 ${small ? 'pl-1' : ''}`}>
      {rows.map(l => (
        <span
          key={l.location_display_code}
          className={`inline-flex items-center gap-1 border border-border-default bg-surface-secondary ${small ? 'rounded px-1.5 py-0.5 text-[10px]' : 'rounded-md px-2 py-0.5 text-xs'}`}
        >
          <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
          <span className="text-foreground-muted">·</span>
          <span className="font-semibold text-foreground">{l.quantity}</span>
        </span>
      ))}
    </div>
  )
}
