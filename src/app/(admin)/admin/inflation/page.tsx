import { getAllCategories, getAllBrands } from '@/lib/queries'
import InflationClient from './InflationClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function InflationPage() {
  const [categories, brands] = await Promise.all([getAllCategories().catch(() => []), getAllBrands().catch(() => [])])
  return <InflationClient categories={categories || []} brands={brands || []} />
}
