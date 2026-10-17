'use client'

import { pageHrefFrom, type PageUrls } from '@/lib/admin/page-urls'
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
import ProductsMobileList from './_components/ProductsMobileList'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import HoverCard from '@/components/ui/HoverCard'
import CopySku from '@/components/ui/CopySku'
import { DataTable, badgeCls, useActionToast, type DataCol } from '@/components/admin/kit'

interface Props {
  products: any[]
  featuredCount: number
  total: number
  page: number
  pageSize: number
  pageUrls: PageUrls
  backUrl?: string
  isSuperAdmin?: boolean
  canWrite?: boolean
}

const rs = (n: unknown) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Inventory / listed / online stock for one row, with the per-variant hover breakdown. */
function StockCell({ product }: { product: any }) {
  const invStock = product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)
  const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
  const stockStatus: string = product.stock_status || 'In Stock'
  const isOut = invStock === 0 || stockStatus === 'Out of Stock'
  const isLow = !isOut && (stockStatus === 'Low Stock' || (product.has_variants && invStock > 0 && invStock <= 3))
  const invColor = isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'
  const statusColor = isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-orange-500 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
  const qtyColor = (n: number) => (n === 0 ? 'text-red-600 dark:text-red-400' : n <= 3 ? 'text-orange-500 dark:text-orange-400' : 'text-foreground')
  return (
    <div className="text-xs space-y-0.5 tabular-nums">
      <div className="flex items-center gap-1">
        <span className="text-foreground-muted shrink-0">Inv:</span>
        <span className={`font-semibold ${invColor}`}>{invStock}</span>
        {product.has_variants && (
          <HoverCard
            trigger={<span className="text-[10px] text-accent-500 underline decoration-dotted underline-offset-2 cursor-default">(v)</span>}
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
                    return (
                      <div key={v.id} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground font-medium truncate">{v.variant_name}</span>
                          {!hasSubs && <span className={`font-semibold shrink-0 ${qtyColor(vInv)}`}>{vInv}</span>}
                        </div>
                        {hasSubs && (
                          <div className="ml-2 mt-0.5 space-y-0.5">
                            {v.sub_variants.map((sv: any) => {
                              const svInv = Number(sv.inventory_quantity || 0)
                              return (
                                <div key={sv.id} className="flex items-center justify-between gap-2">
                                  <span className="text-foreground-muted truncate">{sv.sub_variant_name}</span>
                                  <span className={`font-semibold shrink-0 ${qtyColor(svInv)}`}>{svInv}</span>
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
        <span className={`font-semibold ${statusColor}`}>{stockStatus === 'Out of Stock' ? 'Out' : stockStatus === 'Low Stock' ? 'Low' : 'In Stock'}</span>
      </div>
    </div>
  )
}

function PriceCell({ product }: { product: any }) {
  const price = product.has_variants ? product.variant_min_price : product.base_price
  const mrp = product.has_variants ? product.variant_min_mrp : product.mrp
  return (
    <div className="flex items-baseline justify-end gap-1.5 text-sm font-semibold text-foreground tabular-nums">
      <span>
        {product.has_variants ? 'From ' : ''}Rs. {rs(price)}
      </span>
      {mrp && Number(mrp) > Number(price || 0) && <span className="text-xs text-foreground-muted line-through font-normal">Rs. {rs(mrp)}</span>}
    </div>
  )
}

export default function ProductsTableClient({
  products,
  featuredCount,
  total,
  page,
  pageSize,
  pageUrls,
  backUrl = '/admin/products',
  isSuperAdmin = false,
  canWrite = false,
}: Props) {
  const canLabels = useHasScope('labels:read')
  const toast = useActionToast()
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
      if (!res.ok) {
        setActiveStates(prev => ({ ...prev, [productId]: currentActive }))
        toast.error('Failed to update status')
      }
    } catch {
      setActiveStates(prev => ({ ...prev, [productId]: currentActive }))
      toast.error('Failed to update status')
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
        toast.error(data.error || 'Failed to delete product.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const thumb = (product: any) =>
    product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url

  const cols: DataCol<any>[] = [
    {
      key: 'name',
      label: 'Product',
      sortParam: 'name',
      render: product => (
        <div className="flex items-center gap-2 min-w-0 max-w-[320px]">
          <div className="flex-shrink-0 h-10 w-10">
            <ProductImage thumbnailUrl={thumb(product)} altText={product.name} />
          </div>
          <div className="min-w-0 overflow-hidden">
            <HoverCard
              trigger={
                <Link
                  href={ap(`/admin/products/${product.id}`)}
                  onClick={e => e.stopPropagation()}
                  className="text-sm font-medium text-foreground hover:text-accent-500 transition-colors truncate block w-full"
                >
                  {product.is_featured && <Star className="inline w-3 h-3 mr-1 -mt-0.5 fill-current text-yellow-500" />}
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(product)} alt={product.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight truncate">{product.name}</p>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      <span className="inline-flex items-center gap-1 font-mono">
                        {product.sku}
                        {product.sku && <CopySku sku={product.sku} />}
                      </span>
                    </p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      <span className={badgeCls(product.is_active ? 'green' : 'muted')}>{product.is_active ? 'Active' : 'Inactive'}</span>
                      {product.is_featured && (
                        <span className={`${badgeCls('amber')} inline-flex items-center gap-1`}>
                          <Star className="w-3 h-3 fill-current" /> Featured
                        </span>
                      )}
                    </div>
                    <ProductWarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} size="xs" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs border-t border-border-default pt-2">
                  <div>
                    <p className="text-foreground-muted">Category</p>
                    <p className="text-foreground font-medium">{product.categories?.name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted">Brand</p>
                    <p className="text-foreground font-medium">{product.brands?.name || '-'}</p>
                  </div>
                </div>
                {product.description && <p className="text-xs text-foreground-secondary leading-snug line-clamp-2 border-t border-border-default pt-2">{product.description}</p>}
                <p className="text-xs text-accent-500 font-medium">Click row to view full details</p>
              </div>
            </HoverCard>
            <ProductWarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} size="xs" />
          </div>
        </div>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      sortParam: 'sku',
      render: product => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground-secondary">
          {product.sku}
          {product.sku && <CopySku sku={product.sku} />}
        </span>
      ),
    },
    { key: 'category', label: 'Category', sortParam: 'category', hideBelow: 'lg', render: product => <span className="text-foreground">{product.categories?.name || 'N/A'}</span> },
    { key: 'brand', label: 'Brand', sortParam: 'brand', hideBelow: 'xl', render: product => <span className="text-foreground">{product.brands?.name || 'N/A'}</span> },
    { key: 'price', label: 'Price', sortParam: 'price', num: true, render: product => <PriceCell product={product} /> },
    { key: 'stock', label: 'Stock', sortParam: 'stock', render: product => <StockCell product={product} /> },
    {
      key: 'status',
      label: 'Status',
      sortParam: 'status',
      render: product => {
        const active = activeStates[product.id] ?? product.is_active
        return (
          <div className="flex items-center gap-1.5 flex-nowrap whitespace-nowrap" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => canWrite && handleToggleActive(product.id, active)}
              disabled={!canWrite}
              title={canWrite ? (active ? 'Click to deactivate' : 'Click to activate') : undefined}
              className={`${badgeCls(active ? 'green' : 'muted')} transition-opacity ${canWrite ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'}`}
            >
              {active ? 'Active' : 'Inactive'}
            </button>
            {canWrite && <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />}
          </div>
        )
      },
    },
  ]

  return (
    <>
      <DataTable<any>
        mode="server"
        rows={products}
        cols={cols}
        rowKey={p => p.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHrefFrom(pageUrls)}
        onRowClick={setSelected}
        mobile={<ProductsMobileList products={products} featuredCount={featuredCount} backUrl={backUrl} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />}
        empty={{ title: 'No products found.', body: 'Try clearing a filter or add a new product.' }}
        rowActions={product => [
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
            onSelect: () => setLabelProduct({ id: product.id, name: product.name, has_variants: product.has_variants }),
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
