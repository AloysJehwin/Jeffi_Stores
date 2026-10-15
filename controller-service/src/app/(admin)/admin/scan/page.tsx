import ScanClient from './ScanClient'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `QuickScan — ${name} Admin`, robots: 'noindex, nofollow' }
}

export default function ScanPage() {
  return <ScanClient />
}
