'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import BatchSerialLabelPicker from '@/components/admin/BatchSerialLabelPicker'
import { LABEL_SIZES, type LabelSpec } from '@/lib/label-sizes'

// Modal wrapper around the shared batch/serial label picker. Used by PO-receive
// and product-edit after stock is created, pre-seeded with the just-created
// batches/serials. When both batches and serials were created, an in-modal toggle
// switches between the two label sets.
export interface BatchSerialLabelModalProps {
  preselectedBatchIds?: string[]
  preselectedSerials?: string[]
  /** Optional: lock the picker to a single product (skips the search box). */
  lockProduct?: { product_id: string; variant_id?: string | null; name?: string }
  /** Which mode to open first when both are present. Defaults to whichever has items. */
  initialMode?: 'batch' | 'serial'
  labelSizes?: LabelSpec[]
  title?: string
  onClose: () => void
}

export default function BatchSerialLabelModal({
  preselectedBatchIds,
  preselectedSerials,
  lockProduct,
  initialMode,
  labelSizes = LABEL_SIZES,
  title = 'Print labels',
  onClose,
}: BatchSerialLabelModalProps) {
  const hasBatches = !!preselectedBatchIds?.length
  const hasSerials = !!preselectedSerials?.length
  const both = hasBatches && hasSerials
  const [mode, setMode] = useState<'batch' | 'serial'>(
    initialMode ?? (hasBatches ? 'batch' : 'serial')
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            {both && (
              <div className="flex gap-1 p-0.5 bg-surface-secondary rounded-lg">
                {(['batch', 'serial'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                    {m === 'batch' ? 'Batch labels' : 'Serial labels'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          <BatchSerialLabelPicker
            key={mode}
            mode={mode}
            labelSizes={labelSizes}
            preselectedBatchIds={mode === 'batch' ? preselectedBatchIds : undefined}
            preselectedSerials={mode === 'serial' ? preselectedSerials : undefined}
            lockProduct={lockProduct}
            compact
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
