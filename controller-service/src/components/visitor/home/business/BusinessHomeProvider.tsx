'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { bp } from '@/lib/shared/business-path'
import type { BusinessHomeData } from './business-home'

type Status = 'loading' | 'ready' | 'visitor' | 'error'

interface BusinessHomeValue {
  status: Status
  data: BusinessHomeData | null
  /** A business-portal link that's the same on the server and the client. */
  href: (path: string) => string
}

const BusinessHomeContext = createContext<BusinessHomeValue | null>(null)

// Without a provider (an admin preview, say) the sections show their visitor view.
const VISITOR: BusinessHomeValue = { status: 'visitor', data: null, href: p => bp(p) }

/** One /api/business/home fetch shared by every business section on the page. */
export default function BusinessHomeProvider({
  query,
  approved,
  host,
  children,
}: {
  /** businessHomeQuery() for the page's sections; null when it has none. */
  query: string | null
  /** An approved business session; anyone else gets the visitor view without a request. */
  approved: boolean
  host: string
  children: React.ReactNode
}) {
  const [state, setState] = useState<Pick<BusinessHomeValue, 'status' | 'data'>>({
    status: approved && query ? 'loading' : 'visitor',
    data: null,
  })

  useEffect(() => {
    if (!approved || !query) return
    let live = true
    fetch(`/api/business/home?${query}`, { credentials: 'include', headers: { 'X-Auth-Portal': 'business' } })
      .then(async res => {
        if (!live) return
        if (res.status === 401 || res.status === 403) return setState({ status: 'visitor', data: null })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as BusinessHomeData
        if (live) setState({ status: 'ready', data })
      })
      .catch(() => live && setState({ status: 'error', data: null }))
    return () => {
      live = false
    }
  }, [approved, query])

  return (
    <BusinessHomeContext.Provider value={{ ...state, href: p => bp(p, host) }}>{children}</BusinessHomeContext.Provider>
  )
}

export function useBusinessHome(): BusinessHomeValue {
  return useContext(BusinessHomeContext) ?? VISITOR
}
