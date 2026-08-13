'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  viewMode: 'grid' | 'table'
  onViewModeChange: (v: 'grid' | 'table') => void
}

export default function ProductViewControls({ viewMode, onViewModeChange }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const grouped = searchParams.get('sort') === 'category'

  function toggleGrouped() {
    const params = new URLSearchParams(searchParams.toString())
    if (grouped) {
      params.delete('sort')
      params.delete('order')
    } else {
      params.set('sort', 'category')
      params.delete('order')
    }
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={toggleGrouped}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${grouped ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}>
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
          <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
        Group by Category
      </button>
      <div className="flex items-center border border-border-default rounded-lg overflow-hidden">
        <button type="button" onClick={() => onViewModeChange('grid')} title="Grid view"
          className={`px-2.5 py-1.5 transition-colors ${viewMode === 'grid' ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'}`}>
          <svg viewBox="0 0 16 16" className={`w-4 h-4 ${viewMode === 'grid' ? 'text-accent-500' : 'text-foreground-muted'}`} fill="currentColor">
            <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button type="button" onClick={() => onViewModeChange('table')} title="Table view"
          className={`px-2.5 py-1.5 border-l border-border-default transition-colors ${viewMode === 'table' ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'}`}>
          <svg viewBox="0 0 16 16" className={`w-4 h-4 ${viewMode === 'table' ? 'text-accent-500' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M1 4h14M1 8h14M1 12h14M5 2v12M11 2v12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
