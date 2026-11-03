'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface MobileEditBlockProps {
  children: ReactNode
}

export default function MobileEditBlock({ children }: MobileEditBlockProps) {
  const router = useRouter()

  return (
    <>
      <div className="md:hidden flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-sm p-8 max-w-sm w-full">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary text-foreground-muted">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-foreground">Editing is not available on mobile</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Please open this page on a larger screen to make changes.
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-lg bg-surface-secondary px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-border-default transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Go back
          </button>
        </div>
      </div>

      <div className="hidden md:block">{children}</div>
    </>
  )
}
