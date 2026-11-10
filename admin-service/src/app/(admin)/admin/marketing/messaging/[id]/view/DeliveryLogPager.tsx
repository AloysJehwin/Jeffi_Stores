'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { EMBEDDED_PAGE_SIZE, Pager } from '@/components/admin/kit/pager'

/** ‹ › for the delivery log: ?logPage swaps in that page of rows from the server. */
export default function DeliveryLogPager({ page, total }: { page: number; total: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [paging, startPaging] = useTransition()
  const setPage = (p: number) => {
    const q = new URLSearchParams(sp.toString())
    if (p > 1) q.set('logPage', String(p))
    else q.delete('logPage')
    startPaging(() => router.replace(`${pathname}${q.size ? `?${q}` : ''}`, { scroll: false }))
  }
  return (
    <Pager
      className="px-5 pb-3"
      noun="deliveries"
      control={{ page, pageSize: EMBEDDED_PAGE_SIZE, total, hasNext: page * EMBEDDED_PAGE_SIZE < total, loading: paging, setPage }}
    />
  )
}
