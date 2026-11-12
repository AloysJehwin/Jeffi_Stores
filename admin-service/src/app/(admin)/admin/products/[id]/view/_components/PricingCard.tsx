import { Card } from '@/components/admin/kit'
import { formatINR } from '@/lib/shared/format'
import { GREEN, discountPct } from './product-view'

function Figure({ label, children, className = 'text-foreground' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-xs text-foreground-muted">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${className}`}>{children}</p>
    </div>
  )
}

export function PricingCard({ p }: { p: any }) {
  const figures = [
    { label: 'MRP', val: p.mrp },
    { label: p.has_variants ? 'From' : 'Selling Price', val: p.has_variants ? p.variant_min_price : p.base_price },
    { label: 'Ex-GST', val: p.has_variants ? null : p.price_ex_gst },
  ]
  const pct = discountPct(p)
  return (
    <Card title="Pricing">
      <div className="grid grid-cols-2 gap-4">
        {figures.map(
          ({ label, val }) =>
            val != null && (
              <Figure key={label} label={label}>
                {formatINR(Number(val))}
              </Figure>
            )
        )}
        {pct > 0 && (
          <Figure label="Discount" className={GREEN}>
            {pct}% off
          </Figure>
        )}
      </div>
    </Card>
  )
}
