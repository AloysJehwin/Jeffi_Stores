'use client'

import { useRouter } from 'next/navigation'
import { useCompare } from '@/contexts/CompareContext'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

export default function CompareBar() {
  const { compareList, removeFromCompare, clearCompare } = useCompare()
  const router = useRouter()

  if (compareList.length < 2) return null

  function handleCompare() {
    router.push(`/compare?ids=${compareList.map(p => p.id).join(',')}`)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface-elevated border-t border-border-default shadow-2xl">
      <div className="container mx-auto px-4 py-3 flex items-center gap-3">
        {/* Product thumbnails */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto min-w-0">
          {compareList.map(p => (
            <div key={p.id} className="relative flex-shrink-0 group">
              <div className="w-12 h-12 rounded-lg border border-border-default bg-surface-secondary overflow-hidden">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="w-full h-full object-contain p-1" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <button
                onClick={() => removeFromCompare(p.id)}
                className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                aria-label={`Remove ${p.name}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {compareList.length < 4 && (
            <div className="flex-shrink-0 w-12 h-12 rounded-lg border border-dashed border-border-default flex items-center justify-center text-foreground-muted">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden sm:block text-xs text-foreground-muted">{compareList.length} selected</span>
          <button
            onClick={clearCompare}
            className="text-xs text-foreground-muted hover:text-foreground transition-colors px-2 py-1.5"
          >
            Clear
          </button>
          <button
            onClick={handleCompare}
            className="bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            Compare Now
          </button>
        </div>
      </div>
    </div>
  )
}
