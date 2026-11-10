import { Suspense } from 'react'
import ShelvingClient from './ShelvingClient'
import ShelvingTabs from './ShelvingTabs'
import Loading from './loading'

export const dynamic = 'force-dynamic'

export default function ShelvingPage() {
  return (
    <div className="h-full flex flex-col">
      <Suspense fallback={<Loading />}>
        <ShelvingTabs>
          <div className="flex-1 min-h-0">
            <ShelvingClient />
          </div>
        </ShelvingTabs>
      </Suspense>
    </div>
  )
}
