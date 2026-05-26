'use client'

import { useState } from 'react'
import Link from 'next/link'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import DeactivateProductButton from '@/components/admin/DeactivateProductButton'
import ProductDetailModal from '@/components/admin/ProductDetailModal'
import ProductLabelModal from '@/components/admin/ProductLabelModal'
import HoverCard from '@/components/ui/HoverCard'

interface Props {
  products: any[]
  featuredCount: number
}

export default function ProductsTableClient({ products, featuredCount }: Props) {
  const [selected, setSelected] = useState<any>(null)
  const [labelProduct, setLabelProduct] = useState<{ id: string; name: string; has_variants: boolean } | null>(null)

  return (
    <>
      <tbody className="divide-y divide-border-default">
        {products.length > 0 ? (
          products.map((product: any) => (
            <tr
              key={product.id}
              className={`hover:bg-surface-secondary cursor-pointer ${product.is_featured ? 'bg-yellow-50/40 dark:bg-yellow-900/5' : ''}`}
              onClick={() => setSelected(product)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-shrink-0 h-10 w-10">
                    <ProductImage
                      thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                      altText={product.name}
                    />
                  </div>
                  <div className="min-w-0">
                    <HoverCard
                      trigger={
                        <span className="text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 cursor-default hover:text-accent-500 transition-colors truncate block max-w-[180px]">
                          {product.name}
                        </span>
                      }
                      align="left"
                      side="bottom"
                      width="280px"
                    >
                      <div className="p-3 space-y-2.5">
                        <div className="flex gap-3 items-start">
                          {product.product_images?.[0] && (
                            <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border-default bg-surface-secondary">
                              <img
                                src={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-tight">{product.name}</p>
                            <p className="text-xs text-foreground-muted mt-0.5">{product.sku}</p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${product.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}>
                                {product.is_active ? 'Active' : 'Inactive'}
                              </span>
                              {product.is_featured && (
                                <span className="px-1.5 py-0.5 text-xs rounded-full font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">★ Featured</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs border-t border-border-default pt-2">
                          <div>
                            <p className="text-foreground-muted">Category</p>
                            <p className="text-foreground font-medium">{product.categories?.name || '—'}</p>
                          </div>
                          <div>
                            <p className="text-foreground-muted">Brand</p>
                            <p className="text-foreground font-medium">{product.brands?.name || '—'}</p>
                          </div>
                          <div>
                            <p className="text-foreground-muted">Price</p>
                            <p className="text-foreground font-medium">
                              {product.has_variants
                                ? `From Rs. ${Number(product.variant_min_price || 0).toLocaleString('en-IN')}`
                                : `Rs. ${Number(product.base_price || 0).toLocaleString('en-IN')}`
                              }
                            </p>
                          </div>
                          <div>
                            <p className="text-foreground-muted">Stock</p>
                            <p className={`font-medium ${
                              (product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity) === 0
                                ? 'text-red-600 dark:text-red-400'
                                : (product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity) <= product.low_stock_threshold
                                ? 'text-orange-600 dark:text-orange-400'
                                : 'text-foreground'
                            }`}>
                              {product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity}
                              {product.has_variants && <span className="ml-0.5 text-foreground-muted font-normal">(v)</span>}
                            </p>
                          </div>
                        </div>
                        {product.description && (
                          <p className="text-xs text-foreground-secondary leading-snug line-clamp-2 border-t border-border-default pt-2">
                            {product.description}
                          </p>
                        )}
                        <p className="text-xs text-accent-500 font-medium">Click row to view full details →</p>
                      </div>
                    </HoverCard>
                    {product.is_featured && (
                      <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium mt-0.5">★ Featured</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate">
                {product.sku}
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate">
                {product.categories?.name || 'N/A'}
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate">
                {product.brands?.name || 'N/A'}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-primary-500 truncate">
                    {product.has_variants
                      ? `From Rs. ${Number(product.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                      : `Rs. ${Number(product.base_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                    }
                </div>
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const stock = product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity
                  const isLow = stock > 0 && stock <= product.low_stock_threshold
                  return (
                    <div className="text-sm text-foreground flex items-center gap-0.5">
                      <span>
                        {stock}
                        {isLow && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Low</span>}
                        {stock === 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Out</span>}
                      </span>
                      {product.has_variants && (
                        <HoverCard
                          trigger={
                            <span className="ml-1 text-xs text-blue-600 dark:text-blue-400 underline decoration-dotted underline-offset-2 cursor-default hover:text-blue-800 dark:hover:text-blue-200 transition-colors">(v)</span>
                          }
                          align="left"
                          side="bottom"
                          width="220px"
                        >
                          <div className="p-3 space-y-2">
                            <p className="text-xs font-semibold text-foreground">Variant Stock</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                              <div>
                                <p className="text-foreground-muted">Total Stock</p>
                                <p className={`font-semibold ${stock === 0 ? 'text-red-600 dark:text-red-400' : stock <= product.low_stock_threshold ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>{stock} units</p>
                              </div>
                              <div>
                                <p className="text-foreground-muted">From Price</p>
                                <p className="font-semibold text-primary-500">Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN')}</p>
                              </div>
                            </div>
                            <p className="text-xs text-foreground-muted border-t border-border-default pt-2">Click row to see individual variants →</p>
                          </div>
                        </HoverCard>
                      )}
                    </div>
                  )
                })()}
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full shrink-0 ${
                    product.is_active
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                      : 'bg-surface-secondary text-foreground'
                  }`}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />
                </div>
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-1 flex-nowrap whitespace-nowrap">
                  <Link
                    href={`/admin/products/${product.id}`}
                    title="View Details"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Link>
                  <Link
                    href={`/admin/products/edit/${product.id}`}
                    title="Edit Product"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </Link>
                  <button
                    onClick={() => setLabelProduct({ id: product.id, name: product.name, has_variants: product.has_variants })}
                    title="Print Label"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                  </button>
                  <DownloadAdButton productId={product.id} productName={product.name} productSlug={product.slug} />
                  <DeactivateProductButton productId={product.id} productName={product.name} isActive={product.is_active} />
                </div>
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={8} className="px-4 py-12 text-center text-foreground-muted">
              No products found.
            </td>
          </tr>
        )}
      </tbody>

      <ProductDetailModal product={selected} onClose={() => setSelected(null)} />
      <ProductLabelModal product={labelProduct} onClose={() => setLabelProduct(null)} />
    </>
  )
}
