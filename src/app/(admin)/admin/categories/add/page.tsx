import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories } from '@/lib/queries'
import CategoryForm from '@/components/admin/CategoryForm'
import { ChevronLeft } from 'lucide-react'
import { createCategory } from './actions'

export default async function AddCategoryPage() {
  const host = await getHost()
  const categories = await getAllCategories()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a
          href={ap('/admin/categories', host)}
          className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Categories
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Add Category</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Category</h1>
        <p className="text-foreground-secondary mt-1">Create a new product category</p>
      </div>

      <CategoryForm categories={categories || []} action={createCategory} submitLabel="Save as Draft" />
    </div>
  )
}
