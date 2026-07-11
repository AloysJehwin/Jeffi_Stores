'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Star } from 'lucide-react'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import { ap } from '@/lib/admin-path'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import ProductDetailModal from '@/components/admin/ProductDetailModal'
import ProductLabelModal from '@/components/admin/ProductLabelModal'
import HoverCard from '@/components/ui/HoverCard'

interface Props {
  products: any[]
  featuredCount: number
  backUrl?: string
}

export default function ProductsTableClient({ products, featuredCount, backUrl = '/admin/products' }: Props) {
  const [selected, setSelected] = useState<any>(null)
  const [labelProduct, setLabelProduct] = useState<{ id: string; name: string; has_variants: boolean } | null>(null)
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({})

  async function handleToggleActive(productId: string, currentActive: boolean) {
    const next = !currentActive
    setActiveStates(prev => ({ ...prev, [productId]: next }))
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) setActiveStates(prev => ({ ...prev, [productId]: currentActive }))
    } catch {
      setActiveStates(prev => ({ ...prev, [productId]: currentActive }))
    }
  }

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
              <td className="px-4 py-3 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <div className="flex-shrink-0 h-10 w-10">
                    <ProductImage
                      thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                      altText={product.name}
                    />
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <HoverCard
                      trigger={
                        <span className="text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 cursor-default hover:text-accent-500 transition-colors truncate block w-full">
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
                                <span className="px-1.5 py-0.5 text-xs rounded-full font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-current" /> Featured</span>
                              )}
                            </div>
                            <ProductWarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} size="xs" />
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
                            {product.has_variants ? (
                              <p className="text-foreground font-medium">
                                From Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN')}
                              </p>
                            ) : (
                              <div className="flex items-baseline gap-1">
                                <p className="text-foreground font-medium">
                                  Rs. {Number(product.base_price || 0).toLocaleString('en-IN')}
                                </p>
                                {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                                  <span className="text-foreground-muted line-through text-[11px]">
                                    Rs. {Number(product.mrp).toLocaleString('en-IN')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className={product.has_variants && Array.isArray(product.product_variants) && product.product_variants.length > 0 ? 'col-span-2' : ''}>
                            <p className="text-foreground-muted mb-0.5">Stock</p>
                            {product.has_variants && Array.isArray(product.product_variants) && product.product_variants.length > 0 ? (
                              <div className="space-y-0.5">
                                {product.product_variants.map((v: any) => {
                                  const hasSubs = Array.isArray(v.sub_variants) && v.sub_variants.length > 0
                                  const vInv = hasSubs ? Number(v.sub_variant_inventory_total || 0) : Number(v.inventory_quantity || 0)
                                  const vListed = hasSubs ? Number(v.sub_variant_stock_total || 0) : (v.stock_status !== 'Out of Stock' ? 1 : 0)
                                  return (
                                    <div key={v.id} className="flex items-center justify-between gap-2">
                                      <span className="text-foreground-secondary truncate">{v.variant_name}</span>
                                      <div className="flex gap-1.5 shrink-0">
                                        <span className={`font-semibold ${vInv === 0 ? 'text-red-600 dark:text-red-400' : vInv <= 3 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>{vInv}</span>
                                        {vListed !== vInv && <span className="text-foreground-muted text-[11px]">/ {vListed}</span>}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-foreground-muted">Inventory</span>
                                  <span className={`font-semibold shrink-0 ${
                                    (product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)) === 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : product.stock_status === 'Low Stock'
                                      ? 'text-orange-600 dark:text-orange-400'
                                      : 'text-foreground'
                                  }`}>
                                    {product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-foreground-muted">Status</span>
                                  <span className="font-semibold shrink-0 text-foreground-secondary">
                                    {product.has_variants ? Number(product.variant_stock_total) : (product.stock_status || '—')}
                                  </span>
                                </div>
                              </div>
                            )}
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
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate overflow-hidden max-w-0">
                {product.sku}
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate overflow-hidden max-w-0">
                {product.categories?.name || 'N/A'}
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate overflow-hidden max-w-0">
                {product.brands?.name || 'N/A'}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-primary-500 truncate">
                  {product.has_variants ? (
                    <div className="flex items-baseline gap-1.5">
                      <span>From Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      {product.variant_min_mrp && Number(product.variant_min_mrp) > Number(product.variant_min_price || 0) && (
                        <span className="text-xs text-foreground-muted line-through font-normal">
                          Rs. {Number(product.variant_min_mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span>Rs. {Number(product.base_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                        <span className="text-xs text-foreground-muted line-through font-normal">
                          Rs. {Number(product.mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const invStock = product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)
                  const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
                  const stockStatus: string = product.stock_status || 'In Stock'
                  const isOut = invStock === 0 || stockStatus === 'Out of Stock'
                  const isLow = !isOut && (stockStatus === 'Low Stock' || (product.has_variants && invStock > 0 && invStock <= 3))
                  const invColor = isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'
                  const statusColor = isOut
                    ? 'text-red-600 dark:text-red-400'
                    : isLow
                    ? 'text-orange-500 dark:text-orange-400'
                    : 'text-green-600 dark:text-green-400'
                  return (
                    <div className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground-muted shrink-0">Inv:</span>
                        <span className={`font-semibold ${invColor}`}>{invStock}</span>
                        {product.has_variants && (
                          <HoverCard
                            trigger={
                              <span className="text-[10px] text-blue-500 dark:text-blue-400 underline decoration-dotted underline-offset-2 cursor-default hover:text-blue-700 dark:hover:text-blue-200 transition-colors">(v)</span>
                            }
                            align="left"
                            side="bottom"
                            width="240px"
                          >
                            <div className="p-3 space-y-2">
                              <p className="text-xs font-semibold text-foreground">Variant Stock</p>
                              {Array.isArray(product.product_variants) && product.product_variants.length > 0 ? (
                                <div className="border-t border-border-default pt-2 space-y-1.5">
                                  {product.product_variants.map((v: any) => {
                                    const hasSubs = Array.isArray(v.sub_variants) && v.sub_variants.length > 0
                                    const vInv = hasSubs ? Number(v.sub_variant_inventory_total || 0) : Number(v.inventory_quantity || 0)
                                    const vColor = vInv === 0 ? 'text-red-600 dark:text-red-400' : vInv <= 3 ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'
                                    return (
                                      <div key={v.id} className="text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-foreground font-medium truncate">{v.variant_name}</span>
                                          {!hasSubs && <span className={`font-semibold shrink-0 ${vColor}`}>{vInv}</span>}
                                        </div>
                                        {hasSubs && (
                                          <div className="ml-2 mt-0.5 space-y-0.5">
                                            {v.sub_variants.map((sv: any) => {
                                              const svInv = Number(sv.inventory_quantity || 0)
                                              const svColor = svInv === 0 ? 'text-red-600 dark:text-red-400' : svInv <= 3 ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'
                                              return (
                                                <div key={sv.id} className="flex items-center justify-between gap-2">
                                                  <span className="text-foreground-muted truncate">{sv.sub_variant_name}</span>
                                                  <span className={`font-semibold shrink-0 ${svColor}`}>{svInv}</span>
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-foreground-muted border-t border-border-default pt-2">No variant data.</p>
                              )}
                            </div>
                          </HoverCard>
                        )}
                      </div>
                      {listedStock !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-foreground-muted shrink-0">Listed:</span>
                          <span className="text-foreground">{listedStock}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <span className="text-foreground-muted shrink-0">Online:</span>
                        <span className={`font-semibold ${statusColor}`}>
                          {stockStatus === 'Out of Stock' ? 'Out' : stockStatus === 'Low Stock' ? 'Low' : 'In Stock'}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                  <button
                    onClick={() => handleToggleActive(product.id, activeStates[product.id] ?? product.is_active)}
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full shrink-0 hover:opacity-75 transition-opacity ${
                      (activeStates[product.id] ?? product.is_active)
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-surface-secondary text-foreground'
                    }`}
                  >
                    {(activeStates[product.id] ?? product.is_active) ? 'Active' : 'Inactive'}
                  </button>
                  <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />
                </div>
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-1 flex-nowrap whitespace-nowrap">
                  <Link
                    href={ap(`/admin/products/${product.id}`)}
                    title="View Details"
                    className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Link>
                  <Link
                    href={ap(`/admin/products/edit/${product.id}?back=${encodeURIComponent(backUrl)}`)}
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
