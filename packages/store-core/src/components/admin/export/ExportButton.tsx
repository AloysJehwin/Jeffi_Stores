'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'
import type { DateRange, FilterValues } from '@/lib/export/types'
import { ExportDialog } from './ExportDialog'

export interface ExportButtonProps {
  /** The export registry key (a filter-registry list key, or a report key like `gst.gstr1`). */
  exportKey: string
  /** The page's query string; defaults to the current URL's. */
  query?: string
  /** The page's period when it lives in state, not the URL. */
  range?: DateRange
  /** Include/exclude values the page has already narrowed. */
  filters?: FilterValues
  /** Data the page already holds, for `clientRows` exports (what is on screen). */
  rows?: unknown[]
  label?: string
}

/** The standard Export action: an icon button at the top right of the data it exports. */
export function ExportButton({ exportKey, query, range, filters, rows, label = 'Export' }: ExportButtonProps) {
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        className="control-md control-icon shrink-0 border border-border-default text-foreground-secondary hover:bg-surface-secondary hover:text-foreground"
      >
        <Download className="h-4 w-4" />
      </button>
      {open && <ExportDialog open onClose={() => setOpen(false)} exportKey={exportKey} query={query ?? sp.toString()} range={range} filters={filters} rows={rows} />}
    </>
  )
}
