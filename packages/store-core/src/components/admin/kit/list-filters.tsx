'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import {
  activeCount,
  canonicalQuery,
  listParamNames,
  normalizeParams,
  paramNamesOf,
  splitFilterValues,
  type FilterAlias,
  type FilterField,
} from '@jeffi/list-filters/client'
import AdvancedFilterPanel, { chipLabel, fieldIsActive } from '@/components/admin/AdvancedFilterPanel'
import { DataToolbar, type FilterDef } from './data-table'
import { ExportRowsButton, SavedViewsMenu, ShareFilterLink } from './saved-views'

// One filter bar for every registered admin list: search, quick selects, a Filters toggle over the
// full panel (a sheet on phones) and a chip per active filter, all kept in the URL.

const PERIOD = ['from', 'to']

export interface ListFiltersProps {
  /** Registry key: value help comes from /api/admin/filters/<entity>/values. */
  entity: string
  fields: FilterField[]
  aliases?: FilterAlias[]
  search?: { placeholder: string; param?: string; suggestType?: string }
  /** On an Overview tab: the PeriodBar owns from / to, so the date field is hidden. */
  period?: boolean
  noun?: string
  /** Pins ?tab, so filtering (or clearing) on a URL without one never flips the page's tab. */
  tab?: string
  /** Saved views menu and share link (on unless turned off). */
  views?: boolean
  share?: boolean
  /** Export CSV of the filtered rows; set when the entity has export columns. */
  exportable?: boolean
  /** Extra controls at the toolbar's right end. */
  children?: ReactNode
}

const chipCls =
  'inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded-full'

export function ListFilters({
  entity,
  fields: allFields,
  aliases,
  search,
  period,
  noun,
  tab,
  views = true,
  share = true,
  exportable = false,
  children,
}: ListFiltersProps) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)

  // Old links: rewrite their param names to the canonical ones.
  useEffect(() => {
    const { params, changed } = normalizeParams(sp, aliases)
    const pin = !!tab && !params.get('tab')
    if (pin) params.set('tab', tab)
    if (changed || pin) router.replace(`${pathname}?${params}`, { scroll: false })
  }, [sp, aliases, tab, router, pathname])

  const fields = period ? allFields.filter(f => !paramNamesOf(f).some(n => PERIOD.includes(n))) : allFields
  const advanced = fields.filter(f => !f.quick)
  const searchParam = search?.param ?? 'search'
  const nAdvanced = activeCount(sp, advanced)
  const params = new URLSearchParams(sp.toString())
  const active = fields.filter(f => fieldIsActive(f, params))
  const endpoint = `/api/admin/filters/${entity}/values`

  const quick: FilterDef[] = fields
    .filter(f => f.quick && f.options?.length)
    .map(f => {
      const name = paramNamesOf(f)[0]
      const raw = sp.get(name) || ''
      const picked = splitFilterValues(raw, { commas: true })
      const options = f.options ?? []
      return {
        name,
        label: f.label,
        options: picked.length > 1 ? [{ value: raw, label: `${picked.length} selected` }, ...options] : options,
      }
    })

  const remove = (f: FilterField) => {
    const q = new URLSearchParams(sp.toString())
    paramNamesOf(f).forEach(n => q.delete(n))
    q.delete('page')
    const qs = q.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  return (
    <div className="space-y-2">
      <DataToolbar
        search={search}
        filters={quick}
        activeExtra={nAdvanced}
        clear={listParamNames(fields, { search: searchParam, aliases })}
        hideFiltersBelow="md"
      >
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`control-md hidden border md:inline-flex ${open || nAdvanced ? 'border-accent-500/50 bg-accent-500/5 text-accent-600' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters{nAdvanced ? ` · ${nAdvanced}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className={`control-md border md:hidden ${active.length ? 'border-accent-500/50 bg-accent-500/5 text-accent-600' : 'border-border-default text-foreground-secondary'}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters{active.length ? ` (${active.length})` : ''}
        </button>
        {views && <SavedViewsMenu entity={entity} fields={allFields} search={searchParam} tab={tab} />}
        {share && <ShareFilterLink fields={allFields} search={searchParam} tab={tab} />}
        {exportable && <ExportRowsButton entity={entity} fields={allFields} search={searchParam} noun={noun} />}
        {children}
      </DataToolbar>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map(f => (
            <span key={paramNamesOf(f)[0]} className={chipCls}>
              {chipLabel(f, params)}
              <button type="button" onClick={() => remove(f)} aria-label={`Remove ${f.label} filter`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="hidden rounded-xl border border-border-default bg-surface-elevated p-4 md:block">
          <AdvancedFilterPanel
            fields={advanced}
            mode="content"
            forceExpanded
            chips={false}
            valuesEndpoint={endpoint}
            noun={noun}
          />
        </div>
      )}
      <AdvancedFilterPanel
        fields={fields}
        mode="sheet"
        open={sheet}
        onClose={() => setSheet(false)}
        valuesEndpoint={endpoint}
        noun={noun}
        title="Filters"
      />
    </div>
  )
}

/** The list's canonical filter query from the URL (for an overview fetch), old names rewritten. */
export function useFilterQuery(
  fields: FilterField[],
  opts: { aliases?: FilterAlias[]; omit?: string[]; search?: string | false } = {}
): string {
  const sp = useSearchParams()
  return canonicalQuery(normalizeParams(sp, opts.aliases).params, fields, opts)
}
