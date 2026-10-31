import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import ProductForm from '@/components/admin/ProductForm'
import { FormPage, PageHeader } from '@/components/admin/kit'
import { getAdminSession } from '@/lib/auth/admin-auth'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { createProduct } from './actions'

export default async function AddProductPage() {
  const host = await getHost()
  const categories = await getAllCategories()
  const brands = await getAllBrands()
  const session = await getAdminSession()
  const { hasPlanScope } = await import('@/lib/auth/plan-gate')
  const hasInventory = await hasPlanScope(session?.role ?? '', session?.scopes ?? [], 'inventory:read')
  const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
  const flags = await getFeatureFlags()

  return (
    <MobileEditBlock>
    <FormPage header={<PageHeader back={{ href: ap('/admin/products', host), label: 'Products' }} title="Add New Product" description="Create a new product in your inventory" />}>
      <ProductForm
        categories={categories || []}
        brands={brands || []}
        action={createProduct}
        hasInventory={hasInventory}
        subscriptionsEnabled={flags.subscriptionsEnabled}
        digitalProductsEnabled={flags.digitalProductsEnabled}
      />
    </FormPage>
    </MobileEditBlock>
  )
}
