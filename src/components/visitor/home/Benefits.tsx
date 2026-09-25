import IconByName from './IconByName'
import { SECTION_TILE_DEFAULTS } from '@/lib/homepage-sections'

export interface BenefitItem {
  icon: string
  title: string
  sub: string
}

interface BenefitsProps {
  title?: string | null
  eyebrow?: string | null
  items?: BenefitItem[] | null
}

const DEFAULT_ITEMS: BenefitItem[] = SECTION_TILE_DEFAULTS.benefits

export default function Benefits({ title, eyebrow, items }: BenefitsProps = {}) {
  const tiles = items && items.length > 0 ? items : DEFAULT_ITEMS

  return (
    <section className="py-8 bg-surface border-y border-border-default">
      <div className="container mx-auto px-4">
        {(title || eyebrow) && (
          <div className="text-center mb-6">
            {eyebrow && <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{eyebrow}</p>}
            {title && <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">{title}</h2>}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {tiles.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-surface-elevated border border-border-default">
              <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                <IconByName name={item.icon} className="w-5 h-5 text-accent-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{item.title}</p>
                <p className="text-xs text-foreground-secondary mt-0.5 leading-relaxed">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
