import Link from 'next/link'
import { getFilteredProducts, getAllCategories, getAllBrands } from '@/lib/queries'
import DeactivateProductButton from '@/components/admin/DeactivateProductButton'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import ProductsTableClient from '@/components/admin/ProductsTableClient'

const PAGE_SIZE = 25

export default async function ProductsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const [{ products, total }, categories, brands, allProductsForStats] = await Promise.all([
    getFilteredProducts({
      category_id: searchParams.category_id,
      brand_id: searchParams.brand_id,
      is_active: searchParams.is_active,
      stock: searchParams.stock,
      search: searchParams.search,
      page,
      limit: PAGE_SIZE,
    }),
    getAllCategories(),
    getAllBrands(),
    getFilteredProducts({}),
  ])

  const featuredCount = allProductsForStats.products?.filter((p: any) => p.is_featured).length || 0
  const activeCount = allProductsForStats.products?.filter((p: any) => p.is_active).length || 0
  const totalCount = allProductsForStats.total

  const allCats: any[] = categories || []
  const mainCats = allCats.filter((c: any) => !c.parent_category_id)
  const categoryOptions = mainCats.flatMap((cat: any) => {
    const subs = allCats.filter((c: any) => c.parent_category_id === cat.id)
    return [
      { value: cat.id, label: cat.name, group: cat.name },
      ...subs.map((sub: any) => ({ value: sub.id, label: sub.name, group: cat.name, indent: true })),
    ]
  })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.category_id) params.set('category_id', searchParams.category_id)
    if (searchParams.brand_id) params.set('brand_id', searchParams.brand_id)
    if (searchParams.is_active) params.set('is_active', searchParams.is_active)
    if (searchParams.stock) params.set('stock', searchParams.stock)
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/products${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Products</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage your product inventory</p>
        </div>
        <Link
          href="/admin/products/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
        >
          Add New Product
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Products</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalCount}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Featured</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">
            <span className={featuredCount >= 6 ? 'text-yellow-600 dark:text-yellow-400' : ''}>{featuredCount}</span>
            <span className="text-base font-normal text-foreground-muted">/6</span>
          </p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{categories?.length || 0}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active Products</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{activeCount}</p>
        </div>
      </div>

      <AdminFilters
        filters={[
          { name: 'category_id', label: 'Category', options: categoryOptions },
          { name: 'brand_id', label: 'Brand', options: (brands || []).map((b: any) => ({ value: b.id, label: b.name })) },
          { name: 'is_active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
          { name: 'stock', label: 'Stock', options: [{ value: 'low', label: 'Low Stock' }, { value: 'out', label: 'Out of Stock' }] },
        ]}
        searchPlaceholder="Search by name or SKU..."
        searchParam="search"
      />

      <div className="md:hidden space-y-3">
        {products && products.length > 0 ? (
          products.map((product: any) => {
            const stock = product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity
            const isLow = stock > 0 && stock <= product.low_stock_threshold
            return (
              <div
                key={product.id}
                className={`bg-surface-elevated rounded-lg shadow-sm border p-4 ${product.is_featured ? 'border-yellow-400 dark:border-yellow-600' : 'border-border-default'}`}
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
                    <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />
                    <Link href={`/admin/products/edit/${product.id}`} className="text-accent-500 font-medium">Edit</Link>
                    <DownloadAdButton productId={product.id} productName={product.name} />
                    <DeactivateProductButton productId={product.id} productName={product.name} isActive={product.is_active} />
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No products found.
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div>
          <table className="w-full divide-y divide-border-default table-fixed">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[25%]">Product</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[11%]">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[11%]">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[9%]">Brand</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[11%]">Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[8%]">Stock</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-[10%]">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider w-[15%]">Actions</th>
              </tr>
            </thead>
            <ProductsTableClient products={products || []} featuredCount={featuredCount} />
          </table>
        </div>
        <div className="px-6 py-3 border-t border-border-default">
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
        </div>
      </div>
    </div>
  )
}
