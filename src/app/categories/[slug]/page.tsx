import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

async function getCategoryBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (error) return null
  return data
}

async function getSubcategories(parentId: string) {
  const { data } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('parent_category_id', parentId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  return data || []
}

async function getCategoryProducts(categoryId: string, subcategoryIds: string[]) {
  const allCategoryIds = [categoryId, ...subcategoryIds]

  const { data } = await supabaseAdmin
    .from('products')
    .select(`
      *,
      categories (id, name, slug),
      brands (id, name),
      product_images (*)
    `)
    .in('category_id', allCategoryIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  return data || []
}

export default async function CategoryDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  const category = await getCategoryBySlug(params.slug)

  if (!category) {
    notFound()
  }

  const subcategories = await getSubcategories(category.id)
  const products = await getCategoryProducts(
    category.id,
    subcategories.map(sub => sub.id)
  )

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm mb-4">
            <Link href="/" className="text-gray-500 hover:text-accent-500">
              Home
            </Link>
            <span className="text-gray-400">/</span>
            <Link href="/categories" className="text-gray-500 hover:text-accent-500">
              Categories
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-gray-900 font-medium">{category.name}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 mb-2">
            {category.name}
          </h1>
          {category.description && (
            <p className="text-gray-600">{category.description}</p>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Subcategories */}
        {subcategories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Subcategories</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {subcategories.map((subcategory) => (
                <Link
                  key={subcategory.id}
                  href={`/categories/${subcategory.slug}`}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md hover:border-accent-500 transition-all group"
                >
                  <div className="text-center">
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:bg-accent-100 transition-colors">
                      <svg className="w-6 h-6 text-primary-600 group-hover:text-accent-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 group-hover:text-accent-600 transition-colors">
                      {subcategory.name}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              Products ({products.length})
            </h2>
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product) => {
                const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
                const displayPrice = product.sale_price || product.base_price

                return (
                  <Link
                    key={product.id}
                    href={`/products/${product.slug}`}
                    className="group"
                  >
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow h-full flex flex-col">
                      {/* Product Image */}
                      <div className="relative h-56 bg-gray-100">
                        {primaryImage ? (
                          <img
                            src={primaryImage.image_url}
                            alt={product.name}
                            className="w-full h-full object-contain p-4"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-20 h-20 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {product.sale_price && (
                          <div className="absolute top-3 right-3 bg-accent-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                            Sale
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="p-5 flex flex-col flex-grow">
                        <h3 className="font-semibold text-base text-gray-900 mb-2 group-hover:text-accent-600 transition-colors line-clamp-2 min-h-[3rem]">
                          {product.name}
                        </h3>
                        <div className="text-xs text-gray-500 mb-3">
                          {product.brands && (
                            <div>Brand: {product.brands.name}</div>
                          )}
                        </div>
                        <div className="mt-auto">
                          <div className="flex items-baseline gap-2 mb-3">
                            <span className="text-xl font-bold text-primary-600">
                              ₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                            {product.sale_price && (
                              <span className="text-sm text-gray-400 line-through">
                                ₹{Number(product.base_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-medium ${product.stock_quantity > product.low_stock_threshold ? 'text-green-600' : 'text-orange-600'}`}>
                              {product.stock_quantity > 0 ? 'In Stock' : 'Out of Stock'}
                            </span>
                            <span className="text-accent-500 group-hover:text-accent-600 font-semibold text-sm">
                              View Details →
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <svg className="mx-auto h-24 w-24 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Products Yet</h3>
              <p className="text-gray-600 mb-6">
                We're working on adding products to this category. Check back soon!
              </p>
              <Link
                href="/products"
                className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Browse All Products
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
