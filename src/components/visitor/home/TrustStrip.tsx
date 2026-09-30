import IconByName from './IconByName'
import { SECTION_TILE_DEFAULTS } from '@/lib/homepage-sections'

export interface TrustStripItem {
  icon: string
  label: string
}

interface TrustStripProps {
  freeShippingThreshold: number
  items?: TrustStripItem[] | null
}

export default function TrustStrip({ freeShippingThreshold, items }: TrustStripProps) {
  const amount = `₹${freeShippingThreshold.toLocaleString('en-IN')}`
  const tiles = (items && items.length > 0 ? items : SECTION_TILE_DEFAULTS.trust_strip).map(item => ({
    ...item,
    label: item.label.replace(/\{amount\}/g, amount),
  }))

  return (
    <div className="bg-surface-elevated border-b border-border-default">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border-default">
          {tiles.map((item, i) => (
            <div key={i} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:justify-center min-w-0">
              <IconByName name={item.icon} className="w-5 h-5 text-accent-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-foreground-secondary leading-tight min-w-0">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
