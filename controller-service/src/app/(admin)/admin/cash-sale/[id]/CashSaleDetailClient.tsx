'use client'

import { useEffect, useState } from 'react'
import { variantLabel } from '@/lib/catalog/product-label'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { formatINR, formatDate } from '@/lib/shared/format'
import { fmtQty } from '@/lib/shared/number-display'
import { FileDown } from 'lucide-react'
import { Badge, Card, DetailHeader, DetailSkeleton, EmptyState, EntityPage, Field, Fields, badgeCls } from '@/components/admin/kit'

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  upi_qr: 'UPI (QR)',
  credit: 'Credit',
}

export default function CashSaleDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/cash-sale/${id}/detail`)
      .then(r => r.json())
      .then(j => {
        setData(j)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (!loading && !data?.sale) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="Sale not found." action={{ label: 'Back to Invoices', href: ap('/admin/invoices') }} />
      </div>
    )
  }

  if (loading || !data?.sale) {
    return (
      <div className="p-4 sm:p-6">
        <DetailSkeleton kpis={0} />
      </div>
    )
  }

  const s = data.sale
  const items: any[] = data.items || []
  const th = 'px-4 py-2.5 text-xs font-medium'
  const money = (v: string | null | undefined) => formatINR(parseFloat(v || '0'))

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/invoices'), label: 'Invoices' }}
          title={<span className="font-mono">{s.invoice_number || s.sale_number}</span>}
          status={
            <>
              <Badge tone="amber">Cash Sale</Badge>
              <span className={badgeCls(s.payment_status === 'paid' ? 'green' : 'red')}>{s.payment_status}</span>
            </>
          }
          actions={
            <a href={`/api/admin/cash-sale/${s.id}/receipt`} target="_blank" rel="noopener noreferrer" className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
              <FileDown className="h-4 w-4" />
              Receipt PDF
            </a>
          }
        />
      }
      main={
        <>
          <Card title="Line Items" flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50 text-foreground-muted">
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} text-center`}>GST%</th>
                    <th className={`${th} text-center`}>Qty</th>
                    <th className={`${th} text-right`}>Unit Price</th>
                    <th className={`${th} text-right`}>Taxable</th>
                    <th className={`${th} text-right`}>Tax</th>
                    <th className={`${th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{item.product_name}</div>
                        {variantLabel(item) && <div className="text-xs text-foreground-secondary">{variantLabel(item)}</div>}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{Number(item.gst_rate)}%</td>
                      <td className="px-4 py-3 text-center tabular-nums text-foreground">{fmtQty(item.quantity)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatINR(parseFloat(item.unit_price))}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground-secondary">{money(item.taxable_amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground-secondary">
                        {formatINR(parseFloat(item.cgst_amount || '0') + parseFloat(item.sgst_amount || '0') + parseFloat(item.igst_amount || '0'))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatINR(parseFloat(item.total_price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border-default px-5 py-3">
              <div className="ml-auto max-w-xs space-y-1.5 text-sm tabular-nums">
                <div className="flex justify-between gap-8">
                  <span className="text-foreground-secondary">Taxable Amount</span>
                  <span className="text-foreground">{money(s.taxable_amount)}</span>
                </div>
                {parseFloat(s.igst_amount || '0') > 0 ? (
                  <div className="flex justify-between gap-8">
                    <span className="text-foreground-secondary">IGST</span>
                    <span className="text-foreground">{formatINR(parseFloat(s.igst_amount))}</span>
                  </div>
                ) : (
                  <>
                    {parseFloat(s.cgst_amount || '0') > 0 && (
                      <div className="flex justify-between gap-8">
                        <span className="text-foreground-secondary">CGST</span>
                        <span className="text-foreground">{formatINR(parseFloat(s.cgst_amount))}</span>
                      </div>
                    )}
                    {parseFloat(s.sgst_amount || '0') > 0 && (
                      <div className="flex justify-between gap-8">
                        <span className="text-foreground-secondary">SGST</span>
                        <span className="text-foreground">{formatINR(parseFloat(s.sgst_amount))}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between gap-8 border-t border-border-default pt-1.5">
                  <span className="font-semibold text-foreground">Total</span>
                  <span className="text-base font-bold text-foreground">{formatINR(parseFloat(s.total_amount))}</span>
                </div>
              </div>
            </div>
          </Card>
          {s.notes && (
            <Card title="Notes">
              <p className="text-sm text-foreground">{s.notes}</p>
            </Card>
          )}
        </>
      }
      aside={
        <>
          <Card title="Sale Details">
            <Fields cols={1}>
              <Field label="Invoice #" value={s.invoice_number} mono />
              <Field label="Sale #" value={s.sale_number} mono />
              <Field label="Date" value={formatDate(s.invoice_date || s.created_at)} />
              <Field label="Payment" value={PAYMENT_MODE_LABELS[s.payment_mode] || s.payment_mode} />
            </Fields>
          </Card>
          <Card title="Customer">
            <Fields cols={1}>
              <Field label="Name" value={s.customer_name || 'Walk-in Customer'} />
            </Fields>
          </Card>
        </>
      }
    />
  )
}
