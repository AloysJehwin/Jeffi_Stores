'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { DataToolbar, type FilterDef } from '@/components/admin/kit'

// Search, the three quick filters and an Advanced toggle revealing the existing AdvancedFilterPanel.
// Same URL params as the AdminFilters stack it replaces.
export default function OrdersFilters({ filters, advanced }: { filters: FilterDef[]; advanced: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <DataToolbar search={{ placeholder: 'Search by order number or customer...', param: 'search', suggestType: 'orders' }} filters={filters}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label="Advanced filters"
          title="Advanced filters"
          className={`control-md border ${open ? 'border-accent-500/50 bg-accent-500/5 text-accent-600' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Advanced</span>
        </button>
      </DataToolbar>
      {open && <div className="rounded-xl border border-border-default bg-surface-elevated p-4">{advanced}</div>}
    </div>
  )
}
