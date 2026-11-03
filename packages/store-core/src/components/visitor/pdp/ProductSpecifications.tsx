import { Flame, Timer, TriangleAlert, Wine, type LucideIcon } from 'lucide-react'
import CopySku from '@/components/ui/CopySku'
import { buildSpecGroups, type HandlingFlag, type SpecRow, type SpecSource } from './spec-groups'

const HANDLING: Record<HandlingFlag, { label: string; Icon: LucideIcon; tone: string }> = {
  fragile: {
    label: 'Fragile',
    Icon: Wine,
    tone: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  },
  hazardous: {
    label: 'Hazardous',
    Icon: TriangleAlert,
    tone: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  },
  flammable: {
    label: 'Flammable',
    Icon: Flame,
    tone: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
  },
  perishable: {
    label: 'Perishable',
    Icon: Timer,
    tone: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  },
}

const CHIP =
  'px-2 py-1 rounded-md text-xs font-medium bg-surface-secondary border border-border-default text-foreground'

function RowValue({ row }: { row: SpecRow }) {
  if (row.chips?.length) {
    return (
      <div className="flex flex-wrap gap-2 mt-1">
        {row.chips.map(chip => (
          <span key={chip} className={CHIP}>
            {chip}
          </span>
        ))}
      </div>
    )
  }
  return (
    <>
      {row.value}
      {row.copy && <CopySku sku={row.value} className="ml-1" />}
    </>
  )
}

/** The product page Specifications card; renders nothing when the product has no specs or handling flags. */
export default function ProductSpecifications({ product }: { product: SpecSource }) {
  const { handling, groups } = buildSpecGroups(product)
  if (groups.length === 0 && handling.length === 0) return null

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
      <h2 className="text-xl font-bold text-foreground mb-6">Specifications</h2>

      <div className="space-y-6">
        {handling.length > 0 && (
          <ul aria-label="Handling" className="flex flex-wrap gap-2">
            {handling.map(flag => {
              const { label, Icon, tone } = HANDLING[flag]
              return (
                <li
                  key={flag}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${tone}`}
                >
                  <Icon aria-hidden="true" className="w-3.5 h-3.5" />
                  {label}
                </li>
              )
            })}
          </ul>
        )}

        {groups.map((group, i) => (
          <div key={group.id} className={i > 0 ? 'border-t border-border-default pt-6' : undefined}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-3">{group.title}</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
              {group.rows.map((row, j) => (
                <div key={`${row.label}:${j}`}>
                  <dt className="text-xs text-foreground-muted mb-0.5">{row.label}</dt>
                  <dd
                    className={`font-semibold text-foreground break-words ${group.id === 'codes' ? 'text-xs' : 'text-sm'}`}
                  >
                    <RowValue row={row} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
