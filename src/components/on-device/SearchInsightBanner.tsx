'use client'

import { useEffect, useState } from 'react'
import { readUserProfile } from '@/lib/on-device/user-profile'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

interface Props {
  activeBrands: string[]   // brand names active in current results
  activeCategories: string[] // category names active in current results
  resultCount: number
}

export default function SearchInsightBanner({ activeBrands, activeCategories, resultCount }: Props) {
  const aiEnabled = useStoreConfig().flags.aiStorefrontEnabled
  const [matches, setMatches] = useState<string[]>([])

  useEffect(() => {
    if (!aiEnabled) return
    const profile = readUserProfile()
    if (!profile.purchaseCount) return

    const profileBrands = profile.topBrands.map(b => b.toLowerCase())
    const profileCats = profile.topCategories.map(c => c.toLowerCase())

    const matchedBrands = activeBrands.filter(b => profileBrands.includes(b.toLowerCase()))
    const matchedCats = activeCategories.filter(c => profileCats.includes(c.toLowerCase()))

    const all = [...matchedBrands, ...matchedCats]
    if (all.length) setMatches(all.slice(0, 3))
  }, [aiEnabled, activeBrands, activeCategories])

  if (!aiEnabled || !matches.length || resultCount === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-700 rounded-lg">
      <svg className="w-3.5 h-3.5 text-accent-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      <p className="text-xs text-accent-700 dark:text-accent-300">
        Matches your history: <span className="font-semibold">{matches.join(', ')}</span>
      </p>
      <span className="text-[9px] text-accent-400 ml-auto flex-shrink-0">on-device</span>
    </div>
  )
}
