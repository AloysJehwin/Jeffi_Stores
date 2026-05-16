import Link from 'next/link'
import { queryMany } from '@/lib/db'
import CategoryIcon from '@/components/visitor/CategoryIcon'

export const dynamic = 'force-dynamic'

async function getAllCategories() {
  return queryMany('SELECT * FROM categories WHERE is_active = true ORDER BY display_order ASC')
}

async function getCategoryProductCounts() {
  const rows = await queryMany<{ category_id: string; count: string }>(
    'SELECT category_id, COUNT(*) as count FROM products WHERE is_active = true GROUP BY category_id'
  )

  const counts: Record<string, number> = {}
  rows.forEach((row) => {
    counts[row.category_id] = parseInt(row.count, 10)
  })

  return counts
}

export default async function CategoriesPage() {
  const categories = await getAllCategories()
  const productCounts = await getCategoryProductCounts()

  const mainCategories = categories.filter(c => !c.parent_category_id)
  const getSubcategories = (parentId: string) =>
    categories.filter(c => c.parent_category_id === parentId)

  return (
    <div className="bg-surface min-h-screen">
      {/* Page Header */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            All Categories
          </h1>
          <p className="text-foreground-secondary">
            Browse our complete range of product categories
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {mainCategories.map((category) => {
            const subcategories = getSubcategories(category.id)
            const totalProducts = (productCounts[category.id] || 0) +
              subcategories.reduce((sum, sub) => sum + (productCounts[sub.id] || 0), 0)

            return (
              <div
                key={category.id}
                className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow"
              >
                <Link href={`/categories/${category.slug}`} className="block p-4 sm:p-6 group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-accent-100 rounded-lg flex items-center justify-center group-hover:bg-accent-200 transition-colors">
                        <CategoryIcon
                          iconName={category.icon_name}
                          categoryName={category.name}
                          className="w-8 h-8 text-accent-600 group-hover:text-accent-700"
                        />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                          {category.name}
                        </h2>
                        <p className="text-sm text-foreground-muted mt-1">
                          {totalProducts} {totalProducts === 1 ? 'product' : 'products'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {category.description && (
                    <p className="text-sm text-foreground-secondary mb-4 line-clamp-2">
                      {category.description}
                    </p>
                  )}

                  {subcategories.length > 0 && (
                    <div className="border-t border-border-default pt-4">
                      <p className="text-xs font-medium text-foreground-muted mb-2">Subcategories:</p>
                      <div className="flex flex-wrap gap-2">
                        {subcategories.slice(0, 5).map((sub) => (
                          <span
                            key={sub.id}
                            className="text-xs bg-surface-secondary text-foreground-secondary px-2 py-1 rounded"
                          >
                            {sub.name}
                          </span>
                        ))}
                        {subcategories.length > 5 && (
                          <span className="text-xs text-accent-600 dark:text-accent-400 font-medium">
                            +{subcategories.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex items-center text-accent-500 group-hover:text-accent-600 font-semibold text-sm">
                    Browse Products
                    <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
