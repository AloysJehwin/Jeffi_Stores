'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
  const toggle = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
    >
      {open ? 'Hide attributes' : 'Attributes'}
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
  if (toolbar) {
    return (
      <div className="space-y-2">
        <DataToolbar {...toolbar}>{toggle}</DataToolbar>
        {open && <AdvancedFilterPanel fields={fields} mode="content" forceExpanded valuesEndpoint={valuesEndpoint} />}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">{toggle}</div>
      {open && <AdvancedFilterPanel fields={fields} mode="content" forceExpanded valuesEndpoint={valuesEndpoint} />}
    </div>
  )
}
