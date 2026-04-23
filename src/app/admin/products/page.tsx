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
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500">Products</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage your product inventory</p>
        </div>
        <Link
          href="/admin/products/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
        >
          Add New Product
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Products</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{products?.length || 0}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{categories?.length || 0}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Brands</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{brands?.length || 0}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active Products</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">
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

      {/* Products - Mobile Cards */}
      <div className="md:hidden space-y-3">
        {products && products.length > 0 ? (
          products.map((product: any) => {
            const stock = product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity
            const isLow = stock > 0 && stock <= product.low_stock_threshold
            return (
              <div
                key={product.id}
                className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-shrink-0 h-12 w-12">
                    <ProductImage
                      thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                      altText={product.name}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{product.name}</div>
                    <div className="text-xs text-foreground-muted">{product.sku}</div>
                  </div>
                  <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                    product.is_active
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      : 'bg-surface-secondary text-foreground'
                  }`}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-primary-500">
                    {product.has_variants
                      ? `From Rs. ${Number(product.variant_min_price || 0).toLocaleString('en-IN')}`
                      : `Rs. ${Number(product.sale_price || product.base_price).toLocaleString('en-IN')}`
                    }
                  </span>
                  <span className="text-sm text-foreground">
                    Stock: {stock}
                    {isLow && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Low</span>}
                    {stock === 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Out</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-foreground-muted">
                  <span>{product.categories?.name || 'N/A'} / {product.brands?.name || 'N/A'}</span>
                  <div className="flex items-center gap-3">
                    <Link href={`/admin/products/edit/${product.id}`} className="text-accent-500 font-medium">
                      Edit
                    </Link>
                    <DeleteProductButton productId={product.id} productName={product.name} />
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No products found. Add your first product to get started.
          </div>
        )}
      </div>

      {/* Products Table - Desktop */}
      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  SKU
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Brand
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Stock
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
              {products && products.length > 0 ? (
                products.map((product: any) => (
                  <tr key={product.id} className="hover:bg-surface-secondary">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <ProductImage
                            thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                            altText={product.name}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-foreground">{product.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">{product.sku}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">
                        {product.categories?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">
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
                          <div className="text-sm text-foreground">
                            {stock}
                            {product.has_variants && <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">(variants)</span>}
                            {isLow && <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-semibold">Low Stock</span>}
                            {stock === 0 && <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-semibold">Out of Stock</span>}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        product.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-surface-secondary text-foreground'
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
                  <td colSpan={8} className="px-6 py-12 text-center text-foreground-muted">
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
