'use client'
import { useSearchParams } from 'next/navigation'

export default function DesktopRequiredBanner() {
  const params = useSearchParams()
  if (!params.get('desktop_required')) return null
  return (
    <div className="md:hidden mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-3 flex items-start gap-3">
      <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
      <div>
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Desktop required for editing</p>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Write actions are only available on desktop. Please switch to a larger screen.</p>
      </div>
    </div>
  )
}
