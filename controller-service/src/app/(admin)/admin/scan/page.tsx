import { Suspense } from 'react'
import ScanTabs from './_components/ScanTabs'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `QuickScan — ${name} Admin`, robots: 'noindex, nofollow' }
}

export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <ScanTabs />
    </Suspense>
  )
}
