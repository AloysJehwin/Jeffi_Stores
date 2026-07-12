import { getAllCategories, getAllBrands } from '@/lib/queries'
import ControlsClient from './ControlsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ControlsPage() {
  const [categories, brands] = await Promise.all([
    getAllCategories().catch(() => []),
    getAllBrands().catch(() => []),
  ])
  return <ControlsClient categories={categories || []} brands={brands || []} />
}
