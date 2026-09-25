import IconByName from './IconByName'
import { SECTION_COPY_DEFAULTS, SECTION_TILE_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.why_us

export interface WhyUsItem {
  icon: string
  title: string
  desc: string
  color: string
}

interface WhyUsProps {
  title?: string | null
  eyebrow?: string | null
  items?: WhyUsItem[] | null
}

const DEFAULT_ITEMS: WhyUsItem[] = SECTION_TILE_DEFAULTS.why_us

export default function WhyUs({ title, eyebrow, items }: WhyUsProps = {}) {
  const tiles = items && items.length > 0 ? items : DEFAULT_ITEMS

  return (
    <section className="py-12 md:py-20 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{eyebrow || COPY.eyebrow}</p>
          <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title || COPY.title}</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
          {tiles.map((item) => (
            <div key={item.title} className="relative bg-surface-elevated rounded-2xl border border-border-default p-6 md:p-8 overflow-hidden group hover:border-primary-400/50 hover:shadow-lg transition-all">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5
                ${item.color === 'primary' ? 'bg-primary-100 dark:bg-primary-900/30' : item.color === 'accent' ? 'bg-accent-100 dark:bg-accent-900/30' : 'bg-secondary-100 dark:bg-secondary-800/50'}`}>
                <IconByName
                  name={item.icon}
                  className={`w-6 h-6 ${item.color === 'primary' ? 'text-primary-600 dark:text-primary-400' : item.color === 'accent' ? 'text-accent-600 dark:text-accent-400' : 'text-secondary-600 dark:text-secondary-400'}`}
                />
              </div>
              <h3 className="text-lg font-black text-foreground mb-2">{item.title}</h3>
              <p className="text-sm text-foreground-secondary leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
