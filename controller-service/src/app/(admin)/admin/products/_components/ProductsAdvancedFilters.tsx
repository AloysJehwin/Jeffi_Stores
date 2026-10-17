'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import type { ComponentProps } from 'react'

type Fields = ComponentProps<typeof AdvancedFilterPanel>['fields']

/** Chevron toggle over the attribute filter panel; local state only (same as the old AdminFilters). */
export default function ProductsAdvancedFilters({ fields, valuesEndpoint }: { fields: Fields; valuesEndpoint?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      {open && <AdvancedFilterPanel fields={fields} mode="content" forceExpanded valuesEndpoint={valuesEndpoint} />}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
        >
          {open ? 'Hide attribute filters' : 'Attribute filters'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  )
}
