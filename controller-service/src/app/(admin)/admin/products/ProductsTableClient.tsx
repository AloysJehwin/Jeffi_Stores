'use client'

import { useState } from 'react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import Link from 'next/link'
import { Star } from 'lucide-react'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import { ap } from '@/lib/shared/admin-path'
import FeaturedToggleButton from './_components/FeaturedToggleButton'
import ProductImage from './_components/ProductImage'
import ProductDetailModal from './_components/ProductDetailModal'
import ProductLabelModal from './_components/ProductLabelModal'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import HoverCard from '@/components/ui/HoverCard'
import CopySku from '@/components/ui/CopySku'
import RowActions from '@/components/admin/RowActions'
import { useConfirm } from '@/contexts/ConfirmContext'

interface Props {
  products: any[]
  featuredCount: number
  backUrl?: string
  isSuperAdmin?: boolean
  canWrite?: boolean
}

export default function ProductsTableClient({
  products,
  featuredCount,
  backUrl = '/admin/products',
  isSuperAdmin = false,
  canWrite = false,
}: Props) {
  const canLabels = useHasScope('labels:read')
  const confirm = useConfirm()
  const [selected, setSelected] = useState<any>(null)
  const [labelProduct, setLabelProduct] = useState<{ id: string; name: string; has_variants: boolean } | null>(null)
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({})
  const [draftProduct, setDraftProduct] = useState<{
    id: string
    name: string
    sku: string | null
    backUrl: string
  } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  async function handleDelete(productId: string) {
    setDeletingId(productId)
    try {
      const res = await fetch(`/api/admin/products/${productId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        window.location.reload()
      } else {
        await confirm({
          title: 'Could not delete',
          message: data.error || 'Failed to delete product.',
          confirmLabel: 'OK',
          cancelLabel: 'Close',
        })
      }
    } finally {
      setDeletingId(null)
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
                      thumbnailUrl={
                        product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url ||
                        product.product_images?.[0]?.thumbnail_url
                      }
                      altText={product.name}
                    />
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <HoverCard
                      trigger={
                        <Link
                          href={ap(`/admin/products/${product.id}`)}
                          onClick={e => e.stopPropagation()}
                          className="text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-accent-500 transition-colors truncate block w-full"
                        >
                          {product.name}
                        </Link>
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
                                src={
                                  product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url ||
                                  product.product_images?.[0]?.thumbnail_url
                                }
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <Link
                              href={ap(`/admin/products/${product.id}`)}
                              onClick={e => e.stopPropagation()}
                              className="text-sm font-semibold text-foreground leading-tight hover:text-accent-500 hover:underline underline-offset-2 transition-colors block truncate"
                            >
                              {product.name}
                            </Link>
                            <p className="text-xs text-foreground-muted mt-0.5">
                              <span className="inline-flex items-center gap-1">
                                {product.sku}
                                {product.sku && <CopySku sku={product.sku} />}
                              </span>
                            </p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              <span
                                className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${product.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}
                              >
                                {product.is_active ? 'Active' : 'Inactive'}
                              </span>
                              {product.is_featured && (
                                <span className="px-1.5 py-0.5 text-xs rounded-full font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 inline-flex items-center gap-1">
                                  <Star className="w-3 h-3 fill-current" /> Featured
                                </span>
                              )}
                            </div>
                            <ProductWarningBadges
                              fragile={product.fragile}
                              hazardous={product.hazardous}
                              flammable={product.flammable}
                              size="xs"
                            />
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
                          <div
                            className={
                              product.has_variants &&
                              Array.isArray(product.product_variants) &&
                              product.product_variants.length > 0
                                ? 'col-span-2'
                                : ''
                            }
                          >
                            <p className="text-foreground-muted mb-0.5">Stock</p>
                            {product.has_variants &&
                            Array.isArray(product.product_variants) &&
                            product.product_variants.length > 0 ? (
                              <div className="space-y-0.5">
                                {product.product_variants.map((v: any) => {
                                  const hasSubs = Array.isArray(v.sub_variants) && v.sub_variants.length > 0
                                  const vInv = hasSubs
                                    ? Number(v.sub_variant_inventory_total || 0)
                                    : Number(v.inventory_quantity || 0)
                                  const vListed = hasSubs
                                    ? Number(v.sub_variant_stock_total || 0) > 0
                                      ? 'In Stock'
                                      : 'Out of Stock'
                                    : v.stock_status || '—'
                                  return (
                                    <div key={v.id} className="flex items-center justify-between gap-2">
                                      <span className="text-foreground-secondary truncate">{v.variant_name}</span>
                                      <div className="flex gap-1.5 shrink-0">
                                        <span
                                          className={`font-semibold ${vInv === 0 ? 'text-red-600 dark:text-red-400' : vInv <= 3 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}
                                        >
                                          {vInv}
                                        </span>
                                        <span className="text-foreground-muted text-[11px] whitespace-nowrap">
                                          {vListed}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-foreground-muted">Inventory</span>
                                  <span
                                    className={`font-semibold shrink-0 ${
                                      (product.has_variants
                                        ? Number(product.variant_inventory_total)
                                        : Number(product.inventory_quantity ?? 0)) === 0
                                        ? 'text-red-600 dark:text-red-400'
                                        : product.stock_status === 'Low Stock'
                                          ? 'text-orange-600 dark:text-orange-400'
                                          : 'text-foreground'
                                    }`}
                                  >
                                    {product.has_variants
                                      ? Number(product.variant_inventory_total)
                                      : Number(product.inventory_quantity ?? 0)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-foreground-muted">Status</span>
                                  <span className="font-semibold shrink-0 text-foreground-secondary">
                                    {product.stock_status || '—'}
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
                    <ProductWarningBadges
                      fragile={product.fragile}
                      hazardous={product.hazardous}
                      flammable={product.flammable}
                      size="xs"
                    />
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-foreground truncate overflow-hidden max-w-0">
                <span className="inline-flex items-center gap-1">
                  {product.sku}
                  {product.sku && <CopySku sku={product.sku} />}
                </span>
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
                      <span>
                        From Rs.{' '}
                        {Number(product.variant_min_price || 0).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      {product.variant_min_mrp &&
                        Number(product.variant_min_mrp) > Number(product.variant_min_price || 0) && (
                          <span className="text-xs text-foreground-muted line-through font-normal">
                            Rs.{' '}
                            {Number(product.variant_min_mrp).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span>
                        Rs.{' '}
                        {Number(product.base_price || 0).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                        <span className="text-xs text-foreground-muted line-through font-normal">
                          Rs.{' '}
                          {Number(product.mrp).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const invStock = product.has_variants
                    ? Number(product.variant_inventory_total)
                    : Number(product.inventory_quantity ?? 0)
                  const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
                  const stockStatus: string = product.stock_status || 'In Stock'
                  const isOut = invStock === 0 || stockStatus === 'Out of Stock'
                  const isLow =
                    !isOut && (stockStatus === 'Low Stock' || (product.has_variants && invStock > 0 && invStock <= 3))
                  const invColor = isOut
                    ? 'text-red-600 dark:text-red-400'
                    : isLow
                      ? 'text-orange-500 dark:text-orange-400'
                      : 'text-foreground'
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
                              <span className="text-[10px] text-blue-500 dark:text-blue-400 underline decoration-dotted underline-offset-2 cursor-default hover:text-blue-700 dark:hover:text-blue-200 transition-colors">
                                (v)
                              </span>
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
                                    const vInv = hasSubs
                                      ? Number(v.sub_variant_inventory_total || 0)
                                      : Number(v.inventory_quantity || 0)
                                    const vColor =
                                      vInv === 0
                                        ? 'text-red-600 dark:text-red-400'
                                        : vInv <= 3
                                          ? 'text-orange-500 dark:text-orange-400'
                                          : 'text-foreground'
                                    return (
                                      <div key={v.id} className="text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-foreground font-medium truncate">{v.variant_name}</span>
                                          {!hasSubs && (
                                            <span className={`font-semibold shrink-0 ${vColor}`}>{vInv}</span>
                                          )}
                                        </div>
                                        {hasSubs && (
                                          <div className="ml-2 mt-0.5 space-y-0.5">
                                            {v.sub_variants.map((sv: any) => {
                                              const svInv = Number(sv.inventory_quantity || 0)
                                              const svColor =
                                                svInv === 0
                                                  ? 'text-red-600 dark:text-red-400'
                                                  : svInv <= 3
                                                    ? 'text-orange-500 dark:text-orange-400'
                                                    : 'text-foreground'
                                              return (
                                                <div key={sv.id} className="flex items-center justify-between gap-2">
                                                  <span className="text-foreground-muted truncate">
                                                    {sv.sub_variant_name}
                                                  </span>
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
                                <p className="text-xs text-foreground-muted border-t border-border-default pt-2">
                                  No variant data.
                                </p>
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
                    onClick={() =>
                      canWrite && handleToggleActive(product.id, activeStates[product.id] ?? product.is_active)
                    }
                    disabled={!canWrite}
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full shrink-0 transition-opacity ${canWrite ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'} ${
                      (activeStates[product.id] ?? product.is_active)
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-surface-secondary text-foreground'
                    }`}
                  >
                    {(activeStates[product.id] ?? product.is_active) ? 'Active' : 'Inactive'}
                  </button>
                  {canWrite && (
                    <FeaturedToggleButton
                      productId={product.id}
                      isFeatured={product.is_featured}
                      featuredCount={featuredCount}
                    />
                  )}
                </div>
              </td>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                <RowActions
                  size="sm"
                  actions={[
                    {
                      key: 'view',
                      kind: 'open',
                      label: 'View Details',
                      href: ap(`/admin/products/${product.id}`),
                    },
                    {
                      key: 'edit-active',
                      kind: 'edit',
                      label: 'Edit Product',
                      hidden: !canWrite || !product.is_active,
                      onSelect: () =>
                        setDraftProduct({
                          id: product.id,
                          name: String(product.name || ''),
                          sku: product.sku ? String(product.sku) : null,
                          backUrl,
                        }),
                    },
                    {
                      key: 'edit-inactive',
                      kind: 'edit',
                      label: 'Edit Product',
                      hidden: !canWrite || product.is_active,
                      href: ap(`/admin/products/${product.id}/edit?back=${encodeURIComponent(backUrl)}`),
                    },
                    {
                      key: 'print-label',
                      kind: 'print',
                      label: 'Print Label',
                      hidden: !canLabels,
                      onSelect: () =>
                        setLabelProduct({ id: product.id, name: product.name, has_variants: product.has_variants }),
                    },
                    {
                      key: 'download-ad',
                      kind: 'download',
                      label: 'Download Ad Image',
                      href: `/api/admin/products/${product.id}/ad-image`,
                      download: true,
                    },
                    {
                      key: 'delete',
                      kind: 'delete',
                      label: 'Delete Product',
                      hidden: !isSuperAdmin || !canWrite,
                      busy: deletingId === product.id,
                      onSelect: () => handleDelete(product.id),
                      confirm: {
                        message: `Permanently delete "${product.name}"? This cannot be undone.`,
                        confirmLabel: 'Delete',
                        variant: 'danger',
                      },
                    },
                  ]}
                />
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
      {draftProduct && (
        <DraftConfirmModal
          productId={draftProduct.id}
          productName={draftProduct.name}
          productSku={draftProduct.sku}
          existingDraftId={null}
          backUrl={draftProduct.backUrl}
          onClose={() => setDraftProduct(null)}
        />
      )}
    </>
  )
}
