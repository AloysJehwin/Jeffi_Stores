import Link from 'next/link'
import { getFilteredProducts, getAllCategories, getAllBrands } from '@/lib/queries'
import DeleteProductButton from '@/components/admin/DeleteProductButton'
import ProductImage from '@/components/admin/ProductImage'
import AdminFilters from '@/components/admin/AdminFilters'

export default async function ProductsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const [products, categories, brands] = await Promise.all([
    getFilteredProducts({
      category_id: searchParams.category_id,
      brand_id: searchParams.brand_id,
      is_active: searchParams.is_active,
      stock: searchParams.stock,
      search: searchParams.search,
    }),
    getAllCategories(),
    getAllBrands(),
  ])

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-secondary-500">Products</h1>
          <p className="text-gray-600 mt-1">Manage your product inventory</p>
        </div>
        <Link
          href="/admin/products/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Add New Product
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Total Products</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{products?.length || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Categories</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{categories?.length || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Brands</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">{brands?.length || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-600 text-sm">Active Products</p>
          <p className="text-3xl font-bold text-secondary-500 mt-2">
            {products?.filter(p => p.is_active).length || 0}
          </p>
        </div>
      </div>

      {/* Filters */}
      <AdminFilters
        filters={[
          {
            name: 'category_id',
            label: 'Category',
            options: (categories || []).map((c: any) => ({ value: c.id, label: c.name })),
          },
          {
            name: 'brand_id',
            label: 'Brand',
            options: (brands || []).map((b: any) => ({ value: b.id, label: b.name })),
          },
          {
            name: 'is_active',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
          {
            name: 'stock',
            label: 'Stock',
            options: [
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' },
            ],
          },
        ]}
        searchPlaceholder="Search by name or SKU..."
        searchParam="search"
      />

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SKU
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Brand
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock
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
              {products && products.length > 0 ? (
                products.map((product: any) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <ProductImage
                            thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                            altText={product.name}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{product.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{product.sku}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {product.categories?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {product.brands?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-primary-500">
                        {product.has_variants
                          ? `From Rs. ${Number(product.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : `Rs. ${Number(product.sale_price || product.base_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        }
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        const stock = product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity
                        const isLow = stock > 0 && stock <= product.low_stock_threshold
                        return (
                          <div className="text-sm text-gray-900">
                            {stock}
                            {product.has_variants && <span className="ml-1 text-xs text-blue-600">(variants)</span>}
                            {isLow && <span className="ml-2 text-xs text-red-600 font-semibold">Low Stock</span>}
                            {stock === 0 && <span className="ml-2 text-xs text-red-600 font-semibold">Out of Stock</span>}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        product.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {product.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        href={`/admin/products/edit/${product.id}`}
                        className="text-accent-500 hover:text-accent-600 mr-4"
                      >
                        Edit
                      </Link>
                      <DeleteProductButton productId={product.id} productName={product.name} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    No products found. Add your first product to get started.
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
