'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

const TONE = {
  dark: 'bg-secondary-800 text-white',
  brand: 'bg-primary-500 text-white',
  accent: 'bg-accent-500 text-white',
} as const

/** Site Builder's announcement bar under the header; several messages take turns. Nothing when none is set. */
export default function AnnouncementBar() {
  const { chrome } = useStoreConfig()
  const list = chrome?.announcements ?? []
  const [i, setI] = useState(0)
  useEffect(() => {
    if (list.length < 2) return
    const t = setInterval(() => setI(n => (n + 1) % list.length), 5000)
    return () => clearInterval(t)
  }, [list.length])
  if (!list.length) return null
  const a = list[i % list.length]
  const body = <span className="truncate">{a.text}</span>
  return (
    <div className={`${TONE[a.tone] ?? TONE.dark} text-center text-xs sm:text-sm font-medium`} role="region" aria-label="Announcement" aria-live="polite">
      <div className="container mx-auto px-4 py-2 flex items-center justify-center min-h-9">
        {a.href ? (
          <Link href={a.href} className="truncate underline-offset-2 hover:underline">
            {a.text}
          </Link>
        ) : (
          body
        )}
      </div>
    </div>
  )
}
