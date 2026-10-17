import { Suspense } from 'react'
import PackingSlipsTabs from './_components/PackingSlipsTabs'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `Packing Slips — ${name} Admin` }
}

// The slips list fetches page by page from /api/admin/packing-slips/list.
export default async function PackingSlipsPage() {
  return (
    <Suspense fallback={null}>
      <PackingSlipsTabs />
    </Suspense>
  )
}
