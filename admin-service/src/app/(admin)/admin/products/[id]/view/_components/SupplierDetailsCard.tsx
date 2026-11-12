'use client'

import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { Pager, usePagedRows } from '@/components/admin/kit'
import { LoadingLines } from '@/components/admin/kit/skeleton'
import { CollapsibleCard } from './CollapsibleCard'
import { useSupplierDetails } from './hooks'
import { inr2, shortDate } from './product-view'

const NIL = '00000000-0000-0000-0000-000000000000'
const PO_PAGE_SIZE = 5
const supplierHref = (id: string) => `/admin/suppliers/${id}/view`

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{children}</p>
      {action}
    </div>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="text-xs italic text-foreground-muted">{children}</p>

function PrimarySupplier({ s }: { s: any }) {
  if (!s) return <Note>No primary supplier set — edit product to assign one.</Note>
  return (
    <div className="space-y-1.5 rounded-lg border border-border-default bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={supplierHref(s.id)} className="text-sm font-semibold text-accent-600 hover:underline">
          {s.name}
        </Link>
        {s.gstin && <span className="font-mono text-xs text-foreground-muted">{s.gstin}</span>}
      </div>
      {s.contact_name && <p className="text-xs text-foreground-secondary">{s.contact_name}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-muted">
        {s.phone && <span>{s.phone}</span>}
        {s.email && <span className="min-w-0 [overflow-wrap:anywhere]">{s.email}</span>}
      </div>
    </div>
  )
}

// One group per leaf (product / variant / sub-variant), in the price-ascending order the API returns.
function groupByLeaf(rows: any[]) {
  const groups = new Map<string, { label: string; rows: any[] }>()
  for (const row of rows) {
    const key = `${row.variant_id || NIL}:${row.sub_variant_id || NIL}`
    let g = groups.get(key)
    if (!g) {
      const label = row.sub_variant_id
        ? `Sub-variant: ${row.sub_variant_name || row.sub_variant_id}`
        : row.variant_id
          ? `Variant: ${row.variant_name || row.variant_id}`
          : 'Product'
      g = { label, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(row)
  }
  return Array.from(groups.entries())
}

function LeafSuppliers({ label, rows, best, lowest, last }: { label: string; rows: any[]; best?: string; lowest?: number | null; last?: { price: number; date: string } | null }) {
  return (
    <div className="space-y-2">
      <p className="mb-1 text-[11px] font-medium text-foreground-secondary">{label}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default text-foreground-muted">
              <th className="pb-1.5 pr-3 text-left font-medium">Supplier</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Buy Price</th>
              <th className="pb-1.5 pr-3 text-center font-medium">Preferred</th>
              <th className="pb-1.5 pr-3 text-right font-medium">MOQ</th>
              <th className="pb-1.5 text-right font-medium">Lead (days)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows.map((row: any) => {
              const isBest = row.supplier_id === best
              return (
                <tr key={row.id} className={isBest ? 'bg-accent-500/5' : 'transition-colors hover:bg-surface-secondary'}>
                  <td className="py-1.5 pr-3">
                    <Link href={supplierHref(row.supplier_id)} className="text-accent-600 hover:underline">
                      {row.supplier_name}
                    </Link>
                    {isBest && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-accent-500">Best</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold text-foreground">{inr2(Number(row.unit_cost))}</td>
                  <td className="py-1.5 pr-3 text-center">{row.is_preferred ? '★' : '—'}</td>
                  <td className="py-1.5 pr-3 text-right text-foreground-muted">{row.moq ?? '—'}</td>
                  <td className="py-1.5 text-right text-foreground-muted">{row.lead_time_days ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {(lowest != null || last) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {lowest != null && (
            <div className="min-w-[130px] flex-1 rounded-lg border border-border-default bg-surface px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-foreground-muted">Lowest ever paid (PO)</p>
              <p className="text-sm font-bold text-foreground">{inr2(lowest)}</p>
            </div>
          )}
          {last && (
            <div className="min-w-[130px] flex-1 rounded-lg border border-accent-500/30 bg-accent-500/5 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-accent-500">Last Purchase Price</p>
              <p className="text-sm font-bold text-accent-500">{inr2(last.price)}</p>
              <p className="text-[10px] text-foreground-muted">{shortDate(last.date)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PurchaseHistory({ rows }: { rows: any[] }) {
  const { shown, pager } = usePagedRows(rows, PO_PAGE_SIZE)
  if (rows.length === 0) return <Note>No purchase history found for this product.</Note>
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default text-foreground-muted">
              <th className="pb-1.5 pr-3 text-left font-medium">PO #</th>
              <th className="pb-1.5 pr-3 text-left font-medium">Date</th>
              <th className="pb-1.5 pr-3 text-left font-medium">Supplier</th>
              <th className="pb-1.5 pr-3 text-left font-medium">SKU</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Qty</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Unit Cost</th>
              <th className="pb-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {shown.map((row: any, idx: number) => (
              <tr key={`${row.po_id}-${pager.page}-${idx}`} className="transition-colors hover:bg-surface-secondary">
                <td className="py-1.5 pr-3 font-mono text-accent-600">
                  <Link href={`/admin/purchase-orders?tab=orders&po=${row.po_id}`} className="hover:underline">
                    {row.po_number}
                  </Link>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-foreground-secondary">{shortDate(row.order_date)}</td>
                <td className="py-1.5 pr-3 text-foreground">{row.supplier_name}</td>
                <td className="py-1.5 pr-3 text-foreground-muted">
                  {row.sku ? (
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
                      {row.sku}
                      <CopySku sku={row.sku} />
                    </span>
                  ) : row.sub_variant_name ? (
                    <span>
                      {row.variant_name ? `${row.variant_name} — ` : ''}
                      {row.sub_variant_name}
                    </span>
                  ) : (
                    row.variant_name || '—'
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-foreground">{row.quantity}</td>
                <td className="py-1.5 pr-3 text-right text-foreground">{inr2(Number(row.unit_cost))}</td>
                <td className="py-1.5 text-right text-foreground">{row.line_total_incl_gst != null ? inr2(Number(row.line_total_incl_gst)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager control={pager} noun="purchases" className="mt-2 border-t border-border-default" />
    </div>
  )
}

export function SupplierDetailsCard({ productId }: { productId: string }) {
  const { data, loading, loaded, load } = useSupplierDetails(productId)
  return (
    <CollapsibleCard title="Supplier Details" onOpen={load}>
      {loading && <LoadingLines lines={4} />}
      {!loading && data && (
        <div className="space-y-4">
          <div>
            <Heading>Primary Supplier</Heading>
            <PrimarySupplier s={data.primarySupplier} />
          </div>
          <div>
            <Heading>Suppliers (by price)</Heading>
            {data.suppliers?.length > 0 ? (
              <div className="space-y-4">
                {groupByLeaf(data.suppliers).map(([leafKey, g]) => (
                  <LeafSuppliers
                    key={leafKey}
                    label={g.label}
                    rows={g.rows}
                    best={(data.bestByLeaf || {})[leafKey]}
                    lowest={data.lowestHistByLeaf?.[leafKey]}
                    last={data.lastPurchaseByLeaf?.[leafKey]}
                  />
                ))}
              </div>
            ) : (
              <Note>No suppliers linked — edit product to add suppliers &amp; prices.</Note>
            )}
          </div>
          <div>
            <Heading
              action={
                <Link href="/admin/purchase-orders?tab=orders" className="text-xs text-accent-600 hover:underline">
                  View all POs →
                </Link>
              }
            >
              Purchase History
            </Heading>
            <PurchaseHistory rows={data.purchaseHistory || []} />
          </div>
        </div>
      )}
      {!loading && loaded && !data && <p className="text-xs text-foreground-muted">Failed to load supplier details.</p>}
    </CollapsibleCard>
  )
}
