import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories, getAllBrands } from '@/lib/queries'
import ProductForm from '@/components/admin/ProductForm'
import { ChevronLeft } from 'lucide-react'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { createProduct } from './actions'

export default async function AddProductPage() {
  const host = await getHost()
  const categories = await getAllCategories()
  const brands = await getAllBrands()
  const session = await getAdminSession()
  const { hasPlanScope } = await import('@/lib/auth/plan-gate')
  const hasInventory = await hasPlanScope(session?.role ?? '', session?.scopes ?? [], 'inventory:read')

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a
          href={ap('/admin/products', host)}
          className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Products
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Add Product</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Product</h1>
        <p className="text-foreground-secondary mt-1">Create a new product in your inventory</p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        action={createProduct}
        hasInventory={hasInventory}
      />
    </div>
  )
}
