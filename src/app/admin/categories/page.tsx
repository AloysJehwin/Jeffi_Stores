import Link from 'next/link'
import { getAllCategories } from '@/lib/queries'
import DeleteCategoryButton from '@/components/admin/DeleteCategoryButton'

export default async function CategoriesPage() {
  // Middleware already verified authentication
  const categories = await getAllCategories()

  // Organize categories by parent
  const mainCategories = categories?.filter(c => !c.parent_category_id) || []
  const getSubcategories = (parentId: string) =>
    categories?.filter(c => c.parent_category_id === parentId) || []

  const totalCategories = categories?.length || 0
  const mainCategoriesCount = mainCategories.length
  const subCategoriesCount = totalCategories - mainCategoriesCount

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-secondary-500">Categories</h1>
          <p className="text-gray-600 mt-1">Manage product categories and subcategories</p>
        </div>
        <Link
          href="/admin/categories/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Add New Category
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Total Categories</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{totalCategories}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Main Categories</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{mainCategoriesCount}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Subcategories</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{subCategoriesCount}</p>
        </div>
      </div>

      {/* Categories Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Slug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Display Order
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {mainCategories.length > 0 ? (
                <>
                  {mainCategories.map((category: any) => {
                    const subcategories = getSubcategories(category.id)
                    return (
                      <React.Fragment key={category.id}>
                        {/* Main Category */}
                        <tr className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-semibold text-gray-900">{category.name}</div>
                            {category.description && (
                              <div className="text-xs text-gray-500 mt-1">{category.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-600">{category.slug}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{category.display_order}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              category.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
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

                        {/* Subcategories */}
                        {subcategories.map((sub: any) => (
                          <tr key={sub.id} className="hover:bg-gray-50 bg-gray-25">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900 ml-8">
                                <span className="text-gray-400 mr-2">└</span>
                                {sub.name}
                              </div>
                              {sub.description && (
                                <div className="text-xs text-gray-500 mt-1 ml-8">{sub.description}</div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-600">{sub.slug}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">{sub.display_order}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                sub.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
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
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
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

// Import React for Fragment
import React from 'react'
