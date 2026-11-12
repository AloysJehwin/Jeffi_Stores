'use client'

import { Fragment } from 'react'
import HoverCard from '@/components/ui/HoverCard'
import CopySku from '@/components/ui/CopySku'
import { Card, badgeCls } from '@/components/admin/kit'
import { formatINR } from '@/lib/shared/format'
import { ImagePlaceholderIcon } from './ProductGallery'
import { ShelfBadges } from './ShelfBadges'
import { ORANGE, RED, primaryImage, shelfFor, variantSubsShown, type ShelfRow } from './product-view'

const th = 'px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-foreground'
const price = (v: unknown) => (v ? formatINR(Number(v)) : '—')

function StatusToggle({
  active,
  blockedBy,
  canWrite,
  busy,
  onToggle,
}: {
  active: boolean
  blockedBy: string | null
  canWrite: boolean
  busy: boolean
  onToggle: () => void
}) {
  const shownActive = active && !blockedBy
  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={() => canWrite && !busy && onToggle()}
        disabled={!canWrite || busy}
        title={blockedBy ? `Set to ${active ? 'Active' : 'Inactive'}, but hidden because the ${blockedBy} is inactive` : undefined}
        className={`${badgeCls(shownActive ? 'green' : 'muted')} transition-opacity ${canWrite ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'} ${busy ? 'opacity-50' : ''}`}
      >
        {shownActive ? 'Active' : 'Inactive'}
      </button>
      {blockedBy && active && <span className="text-[10px] text-foreground-muted">{blockedBy} inactive</span>}
    </div>
  )
}

/** Variant name that lists its sub-variants (price, stock, shelf) on hover. */
function SubVariantHover({ v, subs, shelfStock }: { v: any; subs: any[]; shelfStock: ShelfRow[] }) {
  return (
    <HoverCard
      trigger={
        <span className="cursor-help">
          {v.variant_name}
          <span className="ml-2 text-xs font-normal text-foreground-muted underline decoration-dotted">({subs.length} sub-variants)</span>
        </span>
      }
      align="left"
      side="bottom"
      width="360px"
    >
      <div className="space-y-2 p-3">
        <p className="text-sm font-semibold text-foreground">{v.variant_name}</p>
        <div className="space-y-2 border-t border-border-default pt-2">
          {subs.map((sv: any) => {
            const svShelf = shelfFor(shelfStock, v.id, sv.id)
            const qty = Number(sv.inventory_quantity || 0)
            return (
              <div key={sv.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">{sv.sub_variant_name}</span>
                    {sv.sku && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-foreground-muted">
                        {sv.sku}
                        <CopySku sku={sv.sku} />
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-right">
                    <span className="text-foreground-secondary">{price(sv.price)}</span>
                    <span className={`font-medium ${qty === 0 ? 'text-red-600' : qty <= 3 ? 'text-orange-600' : 'text-foreground'}`}>Inv: {qty}</span>
                    <span className="text-foreground-muted">Listed: {sv.stock_status || '—'}</span>
                  </div>
                </div>
                {svShelf.length > 0 && <ShelfBadges rows={svShelf} small />}
              </div>
            )
          })}
        </div>
      </div>
    </HoverCard>
  )
}

export interface VariantsTableProps {
  productId: string
  productActive: boolean
  variants: any[]
  shelfStock: ShelfRow[]
  canWrite: boolean
  status: { overrides: Record<string, boolean>; busy: string | null; toggle: (rowId: string, url: string, next: boolean) => void }
}

export function VariantsTable({ productId, productActive, variants, shelfStock, canWrite, status }: VariantsTableProps) {
  const hasVariantShelf = shelfStock.some(r => r.variant_id !== null)
  const isOn = (row: any) => status.overrides[row.id] ?? row.is_active
  return (
    <Card title={<>Variants ({variants.length})</>} flush>
      <div className="overflow-x-auto border-t border-border-default">
        <table className="w-full text-sm">
          <thead className="border-b border-border-default bg-surface-secondary">
            <tr>
              <th className={`${th} text-left`}>Image</th>
              <th className={`${th} text-left`}>Variant</th>
              <th className={`${th} hidden text-left sm:table-cell`}>SKU</th>
              <th className={`${th} hidden text-left lg:table-cell`}>Amazon ASIN</th>
              <th className={`${th} hidden text-left xl:table-cell`}>ISBN</th>
              <th className={`${th} text-right`}>Price (incl. GST)</th>
              <th className={`${th} hidden text-right md:table-cell`}>Ex-GST</th>
              <th className={`${th} hidden text-right md:table-cell`}>MRP</th>
              <th className={`${th} text-right`}>Inventory</th>
              <th className={`${th} hidden text-right lg:table-cell`}>Stock Status</th>
              {hasVariantShelf && <th className={`${th} hidden text-left xl:table-cell`}>Shelf</th>}
              <th className={`${th} text-center`}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {variants.map((v: any) => {
              const subs = variantSubsShown(v)
              const hasSubs = subs.length > 0
              const vInventory = hasSubs ? Number(v.sub_variant_inventory_total || 0) : Number(v.inventory_quantity || 0)
              const vStockColor = vInventory === 0 ? RED : v.stock_status === 'Low Stock' ? ORANGE : 'text-foreground'
              const vMinPrice = hasSubs ? Number(v.sub_variant_min_price || 0) : Number(v.price || 0)
              const vImg = primaryImage(Array.isArray(v.variant_images) ? v.variant_images : [])
              return (
                <Fragment key={v.id}>
                  <tr className="transition-colors hover:bg-surface-secondary/50">
                    <td className="px-4 py-3">
                      {vImg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={vImg.thumbnail_url || vImg.image_url} alt={v.variant_name || ''} className="h-12 w-12 rounded border border-border-default object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-border-secondary text-foreground-muted">
                          <ImagePlaceholderIcon className="h-5 w-5" strokeWidth={2} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{hasSubs ? <SubVariantHover v={v} subs={subs} shelfStock={shelfStock} /> : v.variant_name}</td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-foreground-secondary sm:table-cell">
                      <span className="inline-flex items-center gap-1">
                        {v.sku || '—'}
                        {v.sku && <CopySku sku={v.sku} />}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-foreground-muted lg:table-cell">
                      {v.asin ? <span title={v.asin_match ? `matched via ${v.asin_match}` : undefined}>{v.asin}</span> : '—'}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-foreground-muted xl:table-cell">{v.isbn || '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground">{!hasSubs && vMinPrice > 0 ? formatINR(vMinPrice) : '—'}</td>
                    <td className="hidden px-4 py-3 text-right text-foreground-secondary md:table-cell">{!hasSubs ? price(v.price_ex_gst) : '—'}</td>
                    <td className="hidden px-4 py-3 text-right text-foreground-secondary md:table-cell">{!hasSubs ? price(v.mrp) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${vStockColor}`}>{vInventory}</td>
                    <td className="hidden px-4 py-3 text-right text-foreground-muted lg:table-cell">{v.stock_status || '—'}</td>
                    {hasVariantShelf && (
                      <td className="hidden px-4 py-3 xl:table-cell">
                        {hasSubs ? <span className="text-xs italic text-foreground-muted">see sub-variants</span> : <ShelfBadges rows={shelfFor(shelfStock, v.id, null)} />}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <StatusToggle
                        active={isOn(v)}
                        blockedBy={!productActive ? 'product' : null}
                        canWrite={canWrite}
                        busy={status.busy === v.id}
                        onToggle={() => status.toggle(v.id, `/api/admin/products/${productId}/variants/${v.id}`, !isOn(v))}
                      />
                    </td>
                  </tr>
                  {subs.map((sv: any) => {
                    const svInventory = Number(sv.inventory_quantity || 0)
                    const svStockColor = svInventory === 0 ? RED : svInventory <= 3 ? ORANGE : 'text-foreground'
                    return (
                      <tr key={sv.id} className="bg-surface-secondary/30 transition-colors hover:bg-surface-secondary/50">
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 pl-10 text-sm text-foreground-secondary">↳ {sv.sub_variant_name}</td>
                        <td className="hidden px-4 py-2 font-mono text-xs text-foreground-muted sm:table-cell">
                          <span className="inline-flex items-center gap-1">
                            {sv.sku || '—'}
                            {sv.sku && <CopySku sku={sv.sku} />}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2 lg:table-cell" />
                        <td className="hidden px-4 py-2 xl:table-cell" />
                        <td className="px-4 py-2 text-right text-sm text-foreground">{price(sv.price)}</td>
                        <td className="hidden px-4 py-2 text-right text-sm text-foreground-secondary md:table-cell">{price(sv.price_ex_gst)}</td>
                        <td className="hidden px-4 py-2 text-right text-sm text-foreground-secondary md:table-cell">{price(sv.mrp)}</td>
                        <td className={`px-4 py-2 text-right text-sm font-medium ${svStockColor}`}>{svInventory}</td>
                        <td className="hidden px-4 py-2 text-right text-sm text-foreground-muted lg:table-cell">{sv.stock_status || '—'}</td>
                        {hasVariantShelf && (
                          <td className="hidden px-4 py-2 xl:table-cell">
                            <ShelfBadges rows={shelfFor(shelfStock, v.id, sv.id)} />
                          </td>
                        )}
                        <td className="px-4 py-2 text-center">
                          <StatusToggle
                            active={isOn(sv)}
                            blockedBy={!productActive ? 'product' : !isOn(v) ? 'variant' : null}
                            canWrite={canWrite}
                            busy={status.busy === sv.id}
                            onToggle={() => status.toggle(sv.id, `/api/admin/products/${productId}/variants/${v.id}/sub-variants/${sv.id}`, !isOn(sv))}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
