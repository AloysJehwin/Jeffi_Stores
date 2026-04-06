import { notFound } from 'next/navigation'
import Link from 'next/link'
import { queryOne, queryMany } from '@/lib/db'
import ProductImageGallery from '@/components/visitor/ProductImageGallery'
import ProductActions from '@/components/visitor/ProductActions'
import ProductReviews from '@/components/visitor/ProductReviews'

async function getProductBySlug(slug: string) {
  return queryOne(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.slug = $1 AND p.is_active = true
  `, [slug])
}

async function getRelatedProducts(productId: string, categoryId: string) {
  return queryMany(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.category_id = $1 AND p.is_active = true AND p.id != $2
    LIMIT 4
  `, [categoryId, productId])
}

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  const product = await getProductBySlug(params.slug)

  if (!product) {
    notFound()
  }

  const relatedProducts = await getRelatedProducts(product.id, product.category_id)

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const displayPrice = product.sale_price || product.base_price
  const mrp = product.mrp ? Number(product.mrp) : null
  const mrpDiscount = mrp && mrp > Number(displayPrice)
    ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
    : 0

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-gray-500 hover:text-accent-500">
              Home
            </Link>
            <span className="text-gray-400">/</span>
            <Link href="/products" className="text-gray-500 hover:text-accent-500">
              Products
            </Link>
            {product.categories && (
              <>
                <span className="text-gray-400">/</span>
                <Link
                  href={`/categories/${product.categories.slug}`}
                  className="text-gray-500 hover:text-accent-500"
                >
                  {product.categories.name}
                </Link>
              </>
            )}
            <span className="text-gray-400">/</span>
            <span className="text-gray-900 font-medium">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Product Details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            {/* Product Images */}
            <div>
              <ProductImageGallery
                images={product.product_images || []}
                productName={product.name}
              />
            </div>

            {/* Product Info */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                {product.name}
              </h1>

              {/* SKU and Brand */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <span className="text-gray-600">
                  SKU: <span className="font-medium text-gray-900">{product.sku}</span>
                </span>
                {product.brands && (
                  <span className="text-gray-600">
                    Brand: <span className="font-medium text-gray-900">{product.brands.name}</span>
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="text-4xl font-bold text-primary-600">
                    ₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  {mrp && mrp > Number(displayPrice) && (
                    <span className="text-xl text-gray-400 line-through">
                      ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                {mrpDiscount > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-accent-100 text-accent-700 px-3 py-1 rounded-full text-sm font-semibold">
                      {mrpDiscount}% off
                    </span>
                    <span className="text-sm text-gray-600">
                      You save ₹{(mrp! - Number(displayPrice)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  Inclusive of all taxes
                  {product.gst_percentage ? ` (${product.gst_percentage}% GST)` : ''}
                </p>
                {product.wholesale_price && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <span className="text-sm text-gray-600">
                      Wholesale Price: <span className="font-semibold text-gray-900">₹{Number(product.wholesale_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Stock Status */}
              <div className="mb-6">
                {product.stock_quantity > 0 ? (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-green-700 font-semibold">
                      In Stock ({product.stock_quantity} available)
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span className="text-red-700 font-semibold">Out of Stock</span>
                  </div>
                )}
                {product.stock_quantity > 0 && product.stock_quantity <= product.low_stock_threshold && (
                  <p className="text-sm text-orange-600 mt-1">
                    ⚠️ Only {product.stock_quantity} left in stock - order soon!
                  </p>
                )}
              </div>

              {/* Product Actions */}
              <ProductActions
                productId={product.id}
                productName={product.name}
                sku={product.sku}
                stockQuantity={product.stock_quantity}
              />

              {/* Product Specifications */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">Product Specifications</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {product.weight && (
                    <>
                      <dt className="text-gray-600">Weight:</dt>
                      <dd className="font-medium text-gray-900">{product.weight} kg</dd>
                    </>
                  )}
                  {product.dimensions && (
                    <>
                      <dt className="text-gray-600">Dimensions:</dt>
                      <dd className="font-medium text-gray-900">{product.dimensions} cm</dd>
                    </>
                  )}
                  {product.categories && (
                    <>
                      <dt className="text-gray-600">Category:</dt>
                      <dd className="font-medium text-gray-900">{product.categories.name}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="border-t border-gray-200 p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Product Description</h2>
              <p className="text-gray-600 leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>

        {/* Product Reviews */}
        <ProductReviews productId={product.id} productName={product.name} />

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Related Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map((relatedProduct) => {
                const relatedPrimaryImage = relatedProduct.product_images?.find((img: any) => img.is_primary) || relatedProduct.product_images?.[0]
                const relatedDisplayPrice = relatedProduct.sale_price || relatedProduct.base_price
                const relatedMrp = relatedProduct.mrp ? Number(relatedProduct.mrp) : null
                const relatedMrpDiscount = relatedMrp && relatedMrp > Number(relatedDisplayPrice)
                  ? Math.round(((relatedMrp - Number(relatedDisplayPrice)) / relatedMrp) * 100)
                  : 0

                return (
                  <Link
                    key={relatedProduct.id}
                    href={`/products/${relatedProduct.slug}`}
                    className="group"
                  >
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
                      <div className="relative h-48 bg-white overflow-hidden">
                        {relatedPrimaryImage ? (
                          <img
                            src={relatedPrimaryImage.image_url}
                            alt={relatedProduct.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-16 h-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {relatedMrpDiscount > 0 && (
                          <div className="absolute top-2 right-2 bg-accent-500 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                            {relatedMrpDiscount}% off
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-sm text-gray-900 mb-2 group-hover:text-accent-600 transition-colors line-clamp-2">
                          {relatedProduct.name}
                        </h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-bold text-primary-600">
                            ₹{Number(relatedDisplayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          {relatedMrp && relatedMrp > Number(relatedDisplayPrice) && (
                            <span className="text-xs text-gray-400 line-through">
                              ₹{relatedMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
