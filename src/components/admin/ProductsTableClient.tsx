'use client'

import { useState } from 'react'
import Link from 'next/link'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import DeactivateProductButton from '@/components/admin/DeactivateProductButton'
import ProductDetailModal from '@/components/admin/ProductDetailModal'

interface Props {
  products: any[]
  featuredCount: number
}

export default function ProductsTableClient({ products, featuredCount }: Props) {
  const [selected, setSelected] = useState<any>(null)

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
                  <div className="flex-shrink-0 h-8 w-8">
                    <ProductImage
                      thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                      altText={product.name}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate" title={product.name}>{product.name}</div>
                    {product.is_featured && (
                      <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">★ Featured</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate" title={product.sku}>{product.sku}</td>
              <td className="px-4 py-3 text-sm text-foreground truncate" title={product.categories?.name}>{product.categories?.name || 'N/A'}</td>
              <td className="px-4 py-3 text-sm text-foreground truncate" title={product.brands?.name}>{product.brands?.name || 'N/A'}</td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-primary-500 truncate">
                  {product.has_variants
                    ? `From Rs. ${Number(product.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                    : `Rs. ${Number(product.sale_price || product.base_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                  }
                </div>
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const stock = product.has_variants ? Number(product.variant_stock_total) : product.stock_quantity
                  const isLow = stock > 0 && stock <= product.low_stock_threshold
                  return (
                    <div className="text-sm text-foreground">
                      {stock}
                      {product.has_variants && <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">(v)</span>}
                      {isLow && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Low</span>}
                      {stock === 0 && <span className="ml-1 text-xs text-red-600 dark:text-red-400 font-semibold">Out</span>}
                    </div>
                  )
                })()}
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                  product.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground'
                }`}>
                  {product.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm font-medium" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-2">
                  <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />
                  <Link href={`/admin/products/edit/${product.id}`} className="text-accent-500 hover:text-accent-600">Edit</Link>
                  <DownloadAdButton productId={product.id} productName={product.name} />
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
    </>
  )
}
