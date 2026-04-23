import Link from 'next/link'
import React from 'react'
import { getFilteredCategories } from '@/lib/queries'
import DeleteCategoryButton from '@/components/admin/DeleteCategoryButton'
import AdminFilters from '@/components/admin/AdminFilters'

export default async function CategoriesPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const categories = await getFilteredCategories({
    is_active: searchParams.is_active,
    type: searchParams.type,
    search: searchParams.search,
  })

  const mainCategories = categories?.filter(c => !c.parent_category_id) || []
  const getSubcategories = (parentId: string) =>
    categories?.filter(c => c.parent_category_id === parentId) || []

  const totalCategories = categories?.length || 0
  const mainCategoriesCount = mainCategories.length
  const subCategoriesCount = totalCategories - mainCategoriesCount

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500">Categories</h1>
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
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{totalCategories}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Main Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{mainCategoriesCount}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Subcategories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{subCategoriesCount}</p>
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
        searchParam="search"
      />

      <div className="md:hidden space-y-3">
        {mainCategories.length > 0 ? (
          <>
            {mainCategories.map((category: any) => {
              const subcategories = getSubcategories(category.id)
              return (
                <React.Fragment key={category.id}>
                  <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground">{category.name}</div>
                        {category.description && (
                          <div className="text-xs text-foreground-muted mt-1">{category.description}</div>
                        )}
                      </div>
                      <span className={`flex-shrink-0 ml-2 px-2 py-0.5 text-xs font-semibold rounded-full ${
                        category.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-surface-secondary text-foreground'
                      }`}>
                        {category.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-foreground-muted mb-3">
                      <span>{category.slug}</span>
                      <span>Order: {category.display_order}</span>
                    </div>
                    <div className="flex items-center justify-end gap-3 text-sm">
                      <Link href={`/admin/categories/edit/${category.id}`} className="text-accent-500 font-medium">
                        Edit
                      </Link>
                      <DeleteCategoryButton categoryId={category.id} categoryName={category.name} />
                    </div>
                  </div>

                  {subcategories.map((sub: any) => (
                    <div key={sub.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 ml-6">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground">
                            <span className="text-foreground-muted mr-1">└</span>
                            {sub.name}
                          </div>
                          {sub.description && (
                            <div className="text-xs text-foreground-muted mt-1">{sub.description}</div>
                          )}
                        </div>
                        <span className={`flex-shrink-0 ml-2 px-2 py-0.5 text-xs font-semibold rounded-full ${
                          sub.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'bg-surface-secondary text-foreground'
                        }`}>
                          {sub.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-foreground-muted mb-3">
                        <span>{sub.slug}</span>
                        <span>Order: {sub.display_order}</span>
                      </div>
                      <div className="flex items-center justify-end gap-3 text-sm">
                        <Link href={`/admin/categories/edit/${sub.id}`} className="text-accent-500 font-medium">
                          Edit
                        </Link>
                        <DeleteCategoryButton categoryId={sub.id} categoryName={sub.name} />
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              )
            })}
          </>
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No categories found. Add your first category to get started.
          </div>
        )}
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Slug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Display Order
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {mainCategories.length > 0 ? (
                <>
                  {mainCategories.map((category: any) => {
                    const subcategories = getSubcategories(category.id)
                    return (
                      <React.Fragment key={category.id}>
                        <tr className="hover:bg-surface-secondary">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-semibold text-foreground">{category.name}</div>
                            {category.description && (
                              <div className="text-xs text-foreground-muted mt-1">{category.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-foreground-secondary">{category.slug}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-foreground">{category.display_order}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              category.is_active
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                : 'bg-surface-secondary text-foreground'
                            }`}>
                              {category.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <Link
                              href={`/admin/categories/edit/${category.id}`}
                              className="text-accent-500 hover:text-accent-600 mr-4"
                            >
                              Edit
                            </Link>
                            <DeleteCategoryButton categoryId={category.id} categoryName={category.name} />
                          </td>
                        </tr>

                        {subcategories.map((sub: any) => (
                          <tr key={sub.id} className="hover:bg-surface-secondary bg-gray-25">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-foreground ml-8">
                                <span className="text-foreground-muted mr-2">└</span>
                                {sub.name}
                              </div>
                              {sub.description && (
                                <div className="text-xs text-foreground-muted mt-1 ml-8">{sub.description}</div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-foreground-secondary">{sub.slug}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-foreground">{sub.display_order}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                sub.is_active
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                  : 'bg-surface-secondary text-foreground'
                              }`}>
                                {sub.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <Link
                                href={`/admin/categories/edit/${sub.id}`}
                                className="text-accent-500 hover:text-accent-600 mr-4"
                              >
                                Edit
                              </Link>
                              <DeleteCategoryButton categoryId={sub.id} categoryName={sub.name} />
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </>
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-foreground-muted">
                    No categories found. Add your first category to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
