'use client'

import { useEffect } from 'react'

export default function EditProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[product-edit] render error:', error)
  }, [error])

  return (
    <div className="p-6 w-full max-w-3xl">
      <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5">
        <h1 className="text-lg font-semibold text-red-800 dark:text-red-200">The product edit page could not load</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error.message || 'An unexpected error occurred while rendering this page.'}
        </p>
        {error.digest && (
          <p className="mt-2 text-xs font-mono text-red-600 dark:text-red-400">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
