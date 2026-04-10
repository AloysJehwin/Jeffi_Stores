'use client'

import { useState } from 'react'

export default function MobileFilterToggle({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-border-default rounded-lg text-foreground font-medium shadow-sm hover:bg-surface-secondary transition-colors mb-4"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 010 2H4a1 1 0 01-1-1zm3 6a1 1 0 011-1h10a1 1 0 010 2H7a1 1 0 01-1-1zm4 6a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
        </svg>
        {isOpen ? 'Hide Filters' : 'Filters'}
      </button>
      <div className={`${isOpen ? 'block' : 'hidden'} lg:block`}>
        {children}
      </div>
    </>
  )
}
