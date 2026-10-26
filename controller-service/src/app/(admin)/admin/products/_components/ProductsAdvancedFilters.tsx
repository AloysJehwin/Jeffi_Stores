'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'
import { activeCount, paramNamesOf } from '@jeffi/list-filters/client'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import type { ComponentProps } from 'react'
import { DataToolbar } from '@/components/admin/kit'

type Fields = ComponentProps<typeof AdvancedFilterPanel>['fields']

/** Chevron toggle over the attribute filter panel; local state only (same as the old AdminFilters). */
/** With `toolbar`, the toggle sits on the toolbar's line and the panel opens below it. */
export default function ProductsAdvancedFilters({
  fields,
  valuesEndpoint,
  toolbar,
}: {
  fields: Fields
  valuesEndpoint?: string
  toolbar?: ComponentProps<typeof DataToolbar>
}) {
  const [open, setOpen] = useState(false)
  const sp = useSearchParams()
  const toggle = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      aria-label="Toggle attribute filters"
      className={`control-md border ${open ? 'border-accent-500/50 bg-accent-500/5 text-accent-600' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span className="hidden sm:inline">Attributes</span>
    </button>
  )
  if (toolbar) {
    return (
      <div className="space-y-2">
        <DataToolbar {...toolbar} activeExtra={activeCount(sp, fields)} clear={fields.flatMap(paramNamesOf)}>
          {toggle}
        </DataToolbar>
        {open && (
          <div className="rounded-xl border border-border-default bg-surface-elevated p-4">
            <AdvancedFilterPanel fields={fields} mode="content" forceExpanded valuesEndpoint={valuesEndpoint} />
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">{toggle}</div>
      {open && (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-4">
          <AdvancedFilterPanel fields={fields} mode="content" forceExpanded valuesEndpoint={valuesEndpoint} />
        </div>
      )}
    </div>
  )
}
