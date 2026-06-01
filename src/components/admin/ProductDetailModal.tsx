'use client'

import React, { useEffect, useCallback, useState } from 'react'
import Link from 'next/link'
import { Package, Star } from 'lucide-react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

interface Props {
  product: any | null
  onClose: () => void
}

function ShelfLocationsSection({ productId }: { productId: string }) {
  const [locations, setLocations] = useState<{ location_display_code: string; quantity: number }[] | null>(null)

  useEffect(() => {
    fetch(`/api/admin/shelving/stock?product_id=${productId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setLocations(d?.locations ?? []))
      .catch(() => setLocations([]))
  }, [productId])

  if (locations === null) return null
  if (locations.length === 0) return (
    <div className="px-5 pb-4">
      <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Shelf Locations</p>
      <p className="text-xs text-foreground-muted italic">No stock assigned to any shelf location</p>
    </div>
  )

  return (
    <div className="px-5 pb-5">
      <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">Shelf Locations</p>
      <div className="flex flex-wrap gap-2">
        {locations.map(l => (
          <div key={l.location_display_code} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border-default bg-surface-secondary text-xs">
            <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
            <span className="text-foreground-muted">·</span>
            <span className="font-semibold text-foreground">{l.quantity}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ProductDetailModal({ product, onClose }: Props) {
  const [detail, setDetail] = useState<any>(null)
  const [imgIdx, setImgIdx] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true)
    setDetail(null)
    setImgIdx(0)
    try {
      const res = await fetch(`/api/admin/products/${id}`)
      if (res.ok) setDetail(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (product) fetchDetail(product.id)
  }, [product, fetchDetail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!product) return null

  const p = detail || product
  const images: any[] = p.product_images || []
  const primaryImg = images.find((i: any) => i.is_primary) || images[0]
  const activeImg = images[imgIdx] || primaryImg
  const variants: any[] = detail?.product_variants || []
  const stock = p.has_variants ? Number(p.variant_inventory_total ?? 0) : Number(p.inventory_quantity ?? 0)
  const isLow = stock > 0 && stock <= (p.low_stock_threshold ?? 5)

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Loading overlay — covers stale content while fetching */}
        {loading && (
          <div className="absolute inset-0 z-10 bg-surface-elevated/80 rounded-xl flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-foreground-muted">Loading details…</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-foreground leading-tight">{product.name}</h2>
            <p className="text-xs text-foreground-muted mt-0.5">{product.sku}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href={`/admin/products/edit/${product.id}`}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
            >
              Edit
            </Link>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {detail && (
          <>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left — images */}
              <div>
                <div className="aspect-square rounded-lg overflow-hidden bg-surface-secondary border border-border-default mb-2">
                  {activeImg?.image_url ? (
                    <ImgWithSkeleton
                      src={activeImg.image_url}
                      alt={p.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-foreground-muted"><Package className="w-12 h-12" /></div>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="flex gap-2 flex-wrap">
                    {images.map((img: any, idx: number) => (
                      <button
                        key={img.id ?? idx}
                        onClick={() => setImgIdx(idx)}
                        className={`w-12 h-12 rounded border-2 overflow-hidden flex-shrink-0 transition-colors ${idx === imgIdx ? 'border-accent-500' : 'border-border-default'}`}
                      >
                        <ImgWithSkeleton src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right — details */}
              <div className="space-y-4">
                {/* Status badges */}
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${p.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {p.is_featured && (
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-current" /> Featured</span>
                  )}
                  {stock === 0 && (
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Out of Stock</span>
                  )}
                  {isLow && (
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">Low Stock</span>
                  )}
                </div>

                {/* Price */}
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Price</p>
                  {p.has_variants ? (
                    <p className="text-xl font-bold text-primary-500">
                      From Rs. {Number(p.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  ) : (
                    <div className="flex items-baseline gap-3">
                      <p className="text-xl font-bold text-primary-500">
                        Rs. {Number(p.base_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                      {p.mrp && Number(p.mrp) > Number(p.base_price) && (
                        <p className="text-sm text-foreground-muted line-through">
                          Rs. {Number(p.mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Meta grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-foreground-muted">Category</p>
                    <p className="text-foreground font-medium">{p.categories?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Brand</p>
                    <p className="text-foreground font-medium">{p.brands?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Inventory Stock</p>
                    <p className="text-foreground font-medium">
                      {stock}
                      {p.has_variants && <span className="ml-1 text-xs text-foreground-muted">(across variants)</span>}
                    </p>
                  </div>
                  {!p.has_variants && (
                    <div>
                      <p className="text-xs text-foreground-muted">Listed (Online)</p>
                      <p className="text-foreground font-medium">{Number(p.stock_quantity ?? 0)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-foreground-muted">HSN Code</p>
                    <p className="text-foreground font-medium">{p.hsn_code || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">GST Rate</p>
                    <p className="text-foreground font-medium">{p.gst_percentage != null ? `${p.gst_percentage}%` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Base Price</p>
                    <p className="text-foreground font-medium">
                      {p.base_price ? `Rs. ${Number(p.base_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                </div>

                {/* Description */}
                {p.description && (
                  <div>
                    <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm text-foreground leading-relaxed line-clamp-4">{p.description}</p>
                  </div>
                )}
              </div>
            </div>

            <ShelfLocationsSection productId={p.id} />

            {/* Variants table */}
            {variants.length > 0 && (
              <div className="px-5 pb-5">
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">Variants ({variants.length})</p>
                <div className="rounded-lg border border-border-default overflow-hidden">
                  <table className="w-full text-sm divide-y divide-border-default table-fixed">
                    <thead className="bg-surface-secondary">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[30%]">Name</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[18%]">SKU</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[18%]">Price</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[12%]">Inventory</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[10%]">Listed</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[12%]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {variants.map((v: any) => {
                        const subs: any[] = v.sub_variants || []
                        const hasSubs = subs.length > 0
                        const vInventory = hasSubs ? Number(v.sub_variant_stock_total || 0) : Number(v.inventory_quantity || 0)
                        const vListed = hasSubs ? Number(v.sub_variant_stock_total || 0) : Number(v.stock_quantity || 0)
                        const vMinPrice = hasSubs ? Number(v.sub_variant_min_price || 0) : Number(v.price || 0)
                        return (
                          <React.Fragment key={v.id}>
                            <tr className="hover:bg-surface-secondary">
                              <td className="px-3 py-2 truncate font-medium text-foreground" title={v.variant_name}>
                                {v.variant_name}
                                {hasSubs && <span className="ml-1.5 text-[10px] font-normal text-foreground-muted">({subs.length} sub)</span>}
                              </td>
                              <td className="px-3 py-2 truncate text-foreground-muted" title={v.sku}>{v.sku || '—'}</td>
                              <td className="px-3 py-2 text-foreground">
                                {hasSubs ? `From Rs. ${vMinPrice.toLocaleString('en-IN')}` : `Rs. ${Number(v.price || 0).toLocaleString('en-IN')}`}
                              </td>
                              <td className="px-3 py-2 text-foreground font-medium">{vInventory}</td>
                              <td className="px-3 py-2 text-foreground-muted">{vListed}</td>
                              <td className="px-3 py-2">
                                <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${v.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}>
                                  {v.is_active ? 'Active' : 'Off'}
                                </span>
                              </td>
                            </tr>
                            {hasSubs && subs.map((sv: any) => (
                              <tr key={sv.id} className="bg-surface-secondary/30 hover:bg-surface-secondary/50 text-xs">
                                <td className="px-3 py-1.5 pl-6 truncate text-foreground-secondary" title={sv.sub_variant_name}>↳ {sv.sub_variant_name}</td>
                                <td className="px-3 py-1.5 truncate text-foreground-muted" title={sv.sku}>{sv.sku || '—'}</td>
                                <td className="px-3 py-1.5 text-foreground">{sv.price ? `Rs. ${Number(sv.price).toLocaleString('en-IN')}` : '—'}</td>
                                <td className="px-3 py-1.5 text-foreground font-medium">{sv.inventory_quantity ?? 0}</td>
                                <td className="px-3 py-1.5 text-foreground-muted">{sv.stock_quantity ?? 0}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${sv.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}>
                                    {sv.is_active ? 'Active' : 'Off'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Placeholder height while loading so modal isn't tiny */}
        {loading && !detail && <div className="h-64" />}
      </div>
    </div>
  )
}
