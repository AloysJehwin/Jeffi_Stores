import { Suspense } from 'react'
import MessagingTemplatesClient from './MessagingTemplatesClient'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <MessagingTemplatesClient />
    </Suspense>
  )
}
