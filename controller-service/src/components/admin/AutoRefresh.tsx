'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Re-renders the server page every `ms` while `active` (e.g. delivery results still arriving). */
export default function AutoRefresh({ active, ms = 10_000 }: { active: boolean; ms?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), ms)
    return () => clearInterval(t)
  }, [active, ms, router])
  return null
}
