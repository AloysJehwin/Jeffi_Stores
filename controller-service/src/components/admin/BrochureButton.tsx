'use client'

import { useState } from 'react'
import BrochureModal from './BrochureModal'

/**
 * Toolbar button for the admin categories/brands pages. Opens the shared
 * BrochureModal in the matching mode so section 1 shows categories (category
 * page) or brands (brand page).
 */
export default function BrochureButton({ mode }: { mode: 'category' | 'brand' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 h-11 border border-border-default bg-surface-elevated hover:bg-surface-secondary text-foreground px-5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        Generate Brochure
      </button>
      <BrochureModal open={open} mode={mode} onClose={() => setOpen(false)} />
    </>
  )
}
