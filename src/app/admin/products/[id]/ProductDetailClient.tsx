'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Star } from 'lucide-react'
import HoverCard from '@/components/ui/HoverCard'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Field({ label, value, mono }: { label: string; value?: any; mono?: boolean }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-foreground-secondary shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

type ShelfRow = { location_display_code: string; quantity: number; variant_id: string | null; sub_variant_id: string | null }

function ShelfBadges({ rows }: { rows: ShelfRow[] }) {
  if (rows.length === 0) return <span className="text-xs text-foreground-muted italic">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map(l => (
        <span key={l.location_display_code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-default bg-surface-secondary text-xs">
          <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
          <span className="text-foreground-muted">·</span>
          <span className="font-semibold text-foreground">{l.quantity}</span>
        </span>
      ))}
    </div>
  )
}

export default function ProductDetailClient({ id }: { id: string }) {
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedImage, setSelectedImage] = useState(0)
  const [shelfStock, setShelfStock] = useState<ShelfRow[]>([])

  useEffect(() => {
    fetch(`/api/admin/products/${id}`)
      .then(r => r.json())
      .then(p => { setProduct(p); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    fetch(`/api/admin/shelving/stock?product_id=${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setShelfStock(d?.locations ?? []))
      .catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!product || product.error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-foreground-secondary">Product not found.</p>
        <Link href="/admin/products" className="text-accent-500 hover:underline text-sm">← Back to Products</Link>
      </div>
    )
  }

  const p = product
  const images: any[] = p.product_images || []
  const variants: any[] = p.product_variants || []
  const primaryImg = images.find((i: any) => i.is_primary) || images[0]
  const displayImg = images[selectedImage] || primaryImg

  const inventoryQty = p.has_variants
    ? Number(p.variant_stock_total || 0)
    : Number(p.inventory_quantity || 0)
  const listedQty = p.has_variants
    ? Number(p.variant_stock_total || 0)
    : Number(p.stock_quantity || 0)

  const stockColor = inventoryQty === 0
    ? 'text-red-600 dark:text-red-400'
    : inventoryQty <= (p.low_stock_threshold || 5)
    ? 'text-orange-600 dark:text-orange-400'
    : 'text-green-600 dark:text-green-400'

  function shelfFor(variantId: string | null, subVariantId: string | null) {
    return shelfStock.filter(r =>
      (variantId ? r.variant_id === variantId : r.variant_id === null) &&
      (subVariantId ? r.sub_variant_id === subVariantId : r.sub_variant_id === null)
    )
  }

  const hasVariantShelf = shelfStock.some(r => r.variant_id !== null)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href="/admin/products" className="text-accent-500 hover:text-accent-600 transition-colors">Products</Link>
        <span>/</span>
        <span className="text-foreground truncate">{p.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/products" className="p-1.5 text-foreground-secondary hover:text-foreground rounded-lg hover:bg-surface-secondary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{p.name}</h1>
            <p className="text-xs text-foreground-muted font-mono mt-0.5">{p.sku}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.is_active
            ? <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
            : <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-secondary text-foreground-secondary">Inactive</span>
          }
          {p.is_featured && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-current" /> Featured</span>
          )}
          <Link href={`/admin/products/${p.id}/analytics`} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors">
            Analytics
          </Link>
          <Link href={`/admin/products/edit/${p.id}`} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          {displayImg ? (
            <div className="aspect-square rounded-xl overflow-hidden border border-border-default bg-surface-secondary">
              <img src={displayImg.image_url || displayImg.thumbnail_url} alt={p.name} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="aspect-square rounded-xl border border-border-default bg-surface-secondary flex items-center justify-center">
              <svg className="w-16 h-16 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {images.map((img: any, idx: number) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(idx)}
                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${idx === selectedImage ? 'border-secondary-500' : 'border-border-default hover:border-border-secondary'}`}
                >
                  <img src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {!p.has_variants && shelfStock.length > 0 && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Shelf Locations</p>
              <ShelfBadges rows={shelfStock} />
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Pricing</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'MRP', val: p.mrp },
                { label: p.has_variants ? 'From' : 'Selling Price', val: p.has_variants ? p.variant_min_price : p.base_price },
                { label: 'Ex-GST', val: p.has_variants ? null : p.price_ex_gst },
                { label: 'Wholesale', val: p.wholeprice_ex_gst },
              ].map(({ label, val }) => val != null && (
                <div key={label}>
                  <p className="text-xs text-foreground-secondary mb-0.5">{label}</p>
                  <p className="text-base font-semibold text-foreground">{formatINR(Number(val))}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Details</p>
              <Field label="Category" value={p.categories?.name} />
              <Field label="Brand" value={p.brands?.name} />
              <Field label="GST" value={p.gst_percentage != null ? `${p.gst_percentage}%` : null} />
              <Field label="HSN Code" value={p.hsn_code} mono />
              <Field label="MPN" value={p.mpn} mono />
              <Field label="GTIN" value={p.gtin} mono />
              <Field label="Slug" value={p.slug} mono />
            </div>

            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Stock & Shipping</p>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-secondary">Inventory Stock</span>
                <span className={`font-semibold ${stockColor}`}>
                  {inventoryQty}{p.has_variants ? ' (variants)' : ''}
                </span>
              </div>
              {!p.has_variants && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Listed (Online)</span>
                  <span className="font-semibold text-foreground">{listedQty}</span>
                </div>
              )}
              {!p.has_variants && p.low_stock_threshold != null && (
                <Field label="Low Stock At" value={p.low_stock_threshold} />
              )}
              <Field label="Weight" value={p.weight ? `${p.weight} kg` : null} />
              <Field label="Weight (g)" value={p.weight_grams} />
              <Field label="Dimensions" value={p.dimensions} />
              {(p.length_cm || p.breadth_cm || p.height_cm) && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">L × B × H</span>
                  <span className="text-foreground font-mono text-xs">{p.length_cm} × {p.breadth_cm} × {p.height_cm} cm</span>
                </div>
              )}
              <Field label="Package Type" value={p.package_type} />
            </div>
          </div>

          {p.description && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Description</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{p.description}</p>
            </div>
          )}

          <div className="flex gap-4 text-xs text-foreground-muted">
            <span>Created {formatDate(p.created_at)}</span>
            <span>Updated {formatDate(p.updated_at)}</span>
          </div>
        </div>
      </div>

      {p.has_variants && variants.length > 0 && (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="px-4 py-3 border-b border-border-default">
            <p className="text-sm font-semibold text-foreground">Variants ({variants.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Variant</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Price (incl. GST)</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden md:table-cell">Ex-GST</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden md:table-cell">MRP</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Inventory</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden lg:table-cell">Listed</th>
                  {hasVariantShelf && (
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary hidden xl:table-cell">Shelf</th>
                  )}
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {variants.map((v: any) => {
                  const subVariants: any[] = v.sub_variants || []
                  const hasSubs = subVariants.length > 0
                  const vInventory = hasSubs ? Number(v.sub_variant_stock_total || 0) : Number(v.inventory_quantity || 0)
                  const vListed = hasSubs ? Number(v.sub_variant_stock_total || 0) : Number(v.stock_quantity || 0)
                  const vStockColor = vInventory === 0 ? 'text-red-600 dark:text-red-400' : vInventory <= (v.low_stock_threshold || 3) ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'
                  const vMinPrice = hasSubs ? Number(v.sub_variant_min_price || 0) : Number(v.price || 0)
                  const vShelf = hasSubs ? [] : shelfFor(v.id, null)
                  return (
                    <React.Fragment key={v.id}>
                    <tr className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {hasSubs ? (
                          <HoverCard
                            trigger={
                              <span className="cursor-help">
                                {v.variant_name}
                                <span className="ml-2 text-xs font-normal text-foreground-muted underline decoration-dotted">({subVariants.length} sub-variants)</span>
                              </span>
                            }
                            align="left"
                            side="bottom"
                            width="360px"
                          >
                            <div className="p-3 space-y-2">
                              <p className="text-sm font-semibold text-foreground">{v.variant_name}</p>
                              <div className="border-t border-border-default pt-2 space-y-2">
                                {subVariants.map((sv: any) => {
                                  const svShelf = shelfFor(v.id, sv.id)
                                  return (
                                    <div key={sv.id} className="space-y-1">
                                      <div className="flex items-center justify-between gap-3 text-xs">
                                        <div className="flex flex-col min-w-0">
                                          <span className="font-medium text-foreground truncate">{sv.sub_variant_name}</span>
                                          {sv.sku && <span className="font-mono text-foreground-muted text-[10px]">{sv.sku}</span>}
                                        </div>
                                        <div className="flex items-center gap-3 text-right shrink-0">
                                          <span className="text-foreground-secondary">{sv.price ? formatINR(Number(sv.price)) : '—'}</span>
                                          <span className={`font-medium ${Number(sv.inventory_quantity || 0) === 0 ? 'text-red-600' : Number(sv.inventory_quantity || 0) <= 3 ? 'text-orange-600' : 'text-foreground'}`}>
                                            Inv: {Number(sv.inventory_quantity || 0)}
                                          </span>
                                          <span className="text-foreground-muted">
                                            Listed: {Number(sv.stock_quantity || 0)}
                                          </span>
                                        </div>
                                      </div>
                                      {svShelf.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pl-1">
                                          {svShelf.map(l => (
                                            <span key={l.location_display_code} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-default bg-surface-secondary text-[10px]">
                                              <span className="font-mono font-medium text-foreground">{l.location_display_code}</span>
                                              <span className="text-foreground-muted">·</span>
                                              <span className="font-semibold text-foreground">{l.quantity}</span>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </HoverCard>
                        ) : (
                          v.variant_name
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">{v.sku || '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground">{vMinPrice > 0 ? (hasSubs ? `From ${formatINR(vMinPrice)}` : formatINR(vMinPrice)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">{!hasSubs && v.price_ex_gst ? formatINR(Number(v.price_ex_gst)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden md:table-cell">{!hasSubs && v.mrp ? formatINR(Number(v.mrp)) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${vStockColor}`}>{vInventory}</td>
                      <td className="px-4 py-3 text-right text-foreground-muted hidden lg:table-cell">{vListed}</td>
                      {hasVariantShelf && (
                        <td className="px-4 py-3 hidden xl:table-cell">
                          {hasSubs
                            ? <span className="text-xs text-foreground-muted italic">see sub-variants</span>
                            : <ShelfBadges rows={vShelf} />
                          }
                        </td>
                      )}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${v.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-surface-secondary text-foreground-secondary'}`}>
                          {v.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                    {hasSubs && subVariants.map((sv: any) => {
                      const svInventory = Number(sv.inventory_quantity || 0)
                      const svListed = Number(sv.stock_quantity || 0)
                      const svStockColor = svInventory === 0 ? 'text-red-600 dark:text-red-400' : svInventory <= 3 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'
                      const svShelf = shelfFor(v.id, sv.id)
                      return (
                        <tr key={sv.id} className="bg-surface-secondary/30 hover:bg-surface-secondary/50 transition-colors">
                          <td className="px-4 py-2 pl-10 text-sm text-foreground-secondary">↳ {sv.sub_variant_name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-foreground-muted hidden sm:table-cell">{sv.sku || '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground">{sv.price ? formatINR(Number(sv.price)) : '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">{sv.price_ex_gst ? formatINR(Number(sv.price_ex_gst)) : '—'}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-secondary hidden md:table-cell">{sv.mrp ? formatINR(Number(sv.mrp)) : '—'}</td>
                          <td className={`px-4 py-2 text-right text-sm font-medium ${svStockColor}`}>{svInventory}</td>
                          <td className="px-4 py-2 text-right text-sm text-foreground-muted hidden lg:table-cell">{svListed}</td>
                          {hasVariantShelf && (
                            <td className="px-4 py-2 hidden xl:table-cell">
                              <ShelfBadges rows={svShelf} />
                            </td>
                          )}
                          <td className="px-4 py-2 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${sv.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-surface-secondary text-foreground-secondary'}`}>
                              {sv.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
