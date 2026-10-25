import IconByName from './IconByName'
import { SECTION_TILE_DEFAULTS } from '@/lib/catalog/homepage-sections'

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

  // One row from sm up for up to 5 tiles, else two even rows; two columns on phones, a lone last tile spans both.
  const n = tiles.length
  const cols = n <= 5 ? n : Math.ceil(n / 2)

  return (
    <div className="bg-surface-elevated border-b border-border-default">
      <div className="container mx-auto px-4">
        <div
          className="grid grid-cols-2 sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
          style={{ '--cols': cols } as React.CSSProperties}
        >
          {tiles.map((item, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:justify-center min-w-0 border-border-default ${
                i % 2 ? 'max-sm:border-l' : ''
              } ${i >= 2 ? 'max-sm:border-t' : ''} ${n % 2 && i === n - 1 ? 'max-sm:col-span-2' : ''} ${
                i % cols ? 'sm:border-l' : ''
              } ${i >= cols ? 'sm:border-t' : ''}`}
            >
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
