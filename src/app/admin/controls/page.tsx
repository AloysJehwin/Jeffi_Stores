import { getAllCategories, getAllBrands } from '@/lib/queries'
import { getSpecFilterFields } from '@/lib/product-attribute-filters.server'
import ControlsClient from './ControlsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ControlsPage() {
  const [categories, brands, specFields] = await Promise.all([
    getAllCategories().catch(() => []),
    getAllBrands().catch(() => []),
    getSpecFilterFields(),
  ])
  return <ControlsClient categories={categories || []} brands={brands || []} specFields={specFields} />
}
