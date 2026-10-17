'use client'

import { useEffect } from 'react'
import { ErrorState, PageBody } from '@/components/admin/kit'

export default function EditProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[product-edit] render error:', error)
  }, [error])

  return (
    <PageBody>
      <ErrorState
        title="The product edit page could not load"
        body={
          <>
            {error.message || 'An unexpected error occurred while rendering this page.'}
            {error.digest && <span className="mt-1 block font-mono">Reference: {error.digest}</span>}
          </>
        }
        actionNode={
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()} className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary">
              Reload
            </button>
          </div>
        }
      />
    </PageBody>
  )
}
