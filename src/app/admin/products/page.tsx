import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { getFilteredProducts, getAllCategories, getAllBrands } from '@/lib/queries'
import DeactivateProductButton from '@/components/admin/DeactivateProductButton'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import ProductsTableClient from '@/components/admin/ProductsTableClient'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import MerchantSyncStatus from '@/components/admin/MerchantSyncStatus'

const PAGE_SIZE = 25

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined

  const [{ products, total }, categories, brands, allProductsForStats] = await Promise.all([
    getFilteredProducts({
      category_id: resolvedSearchParams.category_id,
      brand_id: resolvedSearchParams.brand_id,
      is_active: resolvedSearchParams.is_active,
      stock: resolvedSearchParams.stock,
      search: resolvedSearchParams.search,
      page,
      limit: PAGE_SIZE,
      sort,
      dir }),
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
    if (resolvedSearchParams.category_id) params.set('category_id', resolvedSearchParams.category_id)
    if (resolvedSearchParams.brand_id) params.set('brand_id', resolvedSearchParams.brand_id)
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.stock) params.set('stock', resolvedSearchParams.stock)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/products${qs ? `?${qs}` : ''}`, host)
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Products</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage your product inventory</p>
        </div>
        <Link
          href={ap('/admin/products/add', host)}
          className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
        >
          Add New Product
        </Link>
      </div>

      <MerchantSyncStatus />

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
        suggestType="products"
      />

      <div className="md:hidden space-y-3">
        {products && products.length > 0 ? (
          products.map((product: any) => {
            const stock = product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)
            const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
            const isLow = product.stock_status === 'Low Stock' || (product.has_variants && stock > 0 && stock <= 3)
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
                  <div>
                    {product.has_variants ? (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold text-primary-500">
                          From Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN')}
                        </span>
                        {product.variant_min_mrp && Number(product.variant_min_mrp) > Number(product.variant_min_price || 0) && (
                          <span className="text-xs text-foreground-muted line-through">
                            Rs. {Number(product.variant_min_mrp).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold text-primary-500">
                          Rs. {Number(product.base_price || 0).toLocaleString('en-IN')}
                        </span>
                        {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                          <span className="text-xs text-foreground-muted line-through">
                            Rs. {Number(product.mrp).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-foreground">
                    Inv: {stock}
                    {isLow && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Low</span>}
                    {stock === 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Out</span>}
                    {listedStock !== null && listedStock !== stock && <span className="ml-1 text-xs text-foreground-muted">/ {listedStock}</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-foreground-muted">
                  <span>{product.categories?.name || 'N/A'} / {product.brands?.name || 'N/A'}</span>
                  <div className="flex items-center gap-3">
                    <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />
                    <Link href={ap(`/admin/products/edit/${product.id}`, host)} className="text-accent-500 font-medium">Edit</Link>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] divide-y divide-border-default table-fixed">
            <thead className="bg-surface-secondary">
              <tr>
                <SortableHeader label="Product" column="name" options={sortOptions('text')} currentSort={sort} currentDir={dir} className="w-[22%]" />
                <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={sort} currentDir={dir} className="w-[9%]" />
                <SortableHeader label="Category" column="category" options={sortOptions('text')} currentSort={sort} currentDir={dir} className="w-[9%]" />
                <SortableHeader label="Brand" column="brand" options={sortOptions('text')} currentSort={sort} currentDir={dir} className="w-[7%]" />
                <SortableHeader label="Price" column="price" options={sortOptions('number')} currentSort={sort} currentDir={dir} className="w-[10%]" />
                <SortableHeader label="Stock" column="stock" options={sortOptions('number')} currentSort={sort} currentDir={dir} className="w-[7%]" />
                <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={sort} currentDir={dir} className="w-[20%]" />
                <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider w-[16%]">Actions</th>
              </tr>
            </thead>
            <ProductsTableClient products={products || []} featuredCount={featuredCount} />
          </table>
        </div>
      </div>
      <div className="hidden md:block px-6 py-3 border border-border-default border-t-0 rounded-b-lg bg-surface-elevated">
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>
    </div>
  )
}
