import Link from 'next/link'
import { getFilteredCategories } from '@/lib/queries'
import { queryMany } from '@/lib/db'
import AdminFilters from '@/components/admin/AdminFilters'
import CategoriesClient from '@/components/admin/CategoriesClient'

export default async function CategoriesPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const [categories, productCountRows] = await Promise.all([
    getFilteredCategories({
      is_active: searchParams.is_active,
      type: searchParams.type,
      search: searchParams.search,
    }),
    queryMany<{ category_id: string; count: string }>(
      'SELECT category_id, COUNT(*) as count FROM products WHERE is_active = true GROUP BY category_id'
    ),
  ])

  const productCounts: Record<string, number> = {}
  productCountRows.forEach(r => { productCounts[r.category_id] = parseInt(r.count, 10) })

  const mainCategoriesCount = categories?.filter(c => !c.parent_category_id).length || 0
  const totalCategories = categories?.length || 0
  const subCategoriesCount = totalCategories - mainCategoriesCount

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Categories</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage product categories and subcategories</p>
        </div>
        <Link
          href="/admin/categories/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
        >
          Add New Category
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalCategories}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Main Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{mainCategoriesCount}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Subcategories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{subCategoriesCount}</p>
        </div>
      </div>

      <AdminFilters
        filters={[
          {
            name: 'is_active',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
          {
            name: 'type',
            label: 'Type',
            options: [
              { value: 'main', label: 'Main Categories' },
              { value: 'sub', label: 'Subcategories' },
            ],
          },
        ]}
        searchPlaceholder="Search by name..."
        suggestType="categories"
        searchParam="search"
      />

      <CategoriesClient initialCategories={categories || []} productCounts={productCounts} />
    </div>
  )
}
