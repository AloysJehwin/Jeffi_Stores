'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateProductPitch } from '@/lib/on-device/runtime'
import { readUserProfile } from '@/lib/on-device/user-profile'

interface Props {
  productName: string
  brand: string | null
  category: string | null
}

export default function ProductPitchLine({ productName, brand, category }: Props) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    canRunOnDeviceSummary().then(({ capable, isMobile }) => {
      if (!capable) return
      const profile = readUserProfile()
      if (!profile.purchaseCount) return // no history yet — skip
      generateProductPitch(productName, brand, category, profile, isMobile, partial => setText(partial))
        .then(final => { setText(final); setDone(true) })
        .catch(() => {})
    })
  }, [productName, brand, category])

  if (!text) return null

  return (
    <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border-default">
      <svg className="w-3.5 h-3.5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      <p className="text-sm text-foreground-secondary leading-relaxed flex-1">
        {text}{!done && <span className="animate-pulse">▍</span>}
      </p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">on-device</span>
    </div>
  )
}
