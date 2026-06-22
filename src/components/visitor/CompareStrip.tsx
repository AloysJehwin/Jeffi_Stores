'use client'

import { useRouter } from 'next/navigation'
import { useCompare } from '@/contexts/CompareContext'

export default function CompareStrip() {
  const { compareList, removeFromCompare, clearCompare } = useCompare()
  const router = useRouter()

  if (compareList.length === 0) return null

  function handleCompare() {
    router.push(`/compare?ids=${compareList.map(p => p.id).join(',')}`)
  }

  return (
    <div className="mb-6 flex items-center gap-3 p-3 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-xl">
      {/* Thumbnails */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs font-semibold text-accent-700 dark:text-accent-300 whitespace-nowrap hidden sm:block">
          Compare:
        </span>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {compareList.map(p => (
            <div key={p.id} className="relative flex-shrink-0 group">
              <div className="w-10 h-10 rounded-lg border border-accent-200 dark:border-accent-700 bg-surface overflow-hidden">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="w-full h-full object-contain p-0.5" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <button
                onClick={() => removeFromCompare(p.id)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                aria-label={`Remove ${p.name}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {/* Empty slots */}
          {Array.from({ length: Math.max(0, 2 - compareList.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="flex-shrink-0 w-10 h-10 rounded-lg border border-dashed border-accent-300 dark:border-accent-700 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
          ))}
        </div>
        <span className="text-xs text-accent-600 dark:text-accent-400 whitespace-nowrap">
          {compareList.length} / 4
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={clearCompare}
          className="text-xs text-accent-600 dark:text-accent-400 hover:text-foreground transition-colors px-2 py-1"
        >
          Clear
        </button>
        <button
          onClick={handleCompare}
          disabled={compareList.length < 2}
          className="bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Compare{compareList.length >= 2 ? ` (${compareList.length})` : ''}
        </button>
      </div>
    </div>
  )
}
