'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Navigate away after a successful sign-in and keep `leaving` true until the next page replaces this one. */
export function useLeaveTo() {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  const go = useCallback(
    (href: string, how: 'push' | 'replace' | 'hard' = 'push') => {
      setLeaving(true)
      if (how === 'hard') window.location.href = href
      else if (how === 'replace') router.replace(href)
      else router.push(href)
    },
    [router]
  )
  return { leaving, go }
}
