import { getAllCategories } from '@/lib/queries'
import InflationClient from './InflationClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function InflationPage() {
  const categories = await getAllCategories().catch(() => [])
  return <InflationClient categories={categories || []} />
}
