import { Suspense } from 'react'
import MessagingTemplatesClient from './MessagingTemplatesClient'
import Loading from './loading'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MessagingTemplatesClient />
    </Suspense>
  )
}
