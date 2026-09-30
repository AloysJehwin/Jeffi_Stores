import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import BrandForm from '@/components/admin/BrandForm'
import { ChevronLeft } from 'lucide-react'
import { createBrand } from './actions'

export default async function AddBrandPage() {
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a
          href={ap('/admin/brands', host)}
          className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Brands
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Add Brand</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Brand</h1>
        <p className="text-foreground-secondary mt-1">Create a new product brand</p>
      </div>

      <BrandForm action={createBrand} submitLabel="Save as Draft" />
    </div>
  )
}
