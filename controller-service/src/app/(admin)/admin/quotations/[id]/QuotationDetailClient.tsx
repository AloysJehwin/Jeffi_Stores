'use client'

import { useEffect, useState } from 'react'
import { Download, ExternalLink, Pencil } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useAgentChanges } from '@/lib/client/agent-events'
import { formatINR, formatDate } from '@/lib/shared/format'
import { ActionButton, Card, DetailHeader, DetailSkeleton, EmptyState, EntityPage, Field, Fields, PageBody, QUOTATION_STATUS, StatusBadge, badgeCls, useActionToast, type KitAction } from '@/components/admin/kit'

const th = 'px-4 py-2.5 text-xs font-medium text-foreground-muted whitespace-nowrap'

export default function QuotationDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const toast = useActionToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('quotations')
  const [nonce, setNonce] = useState(0)
  useAgentChanges(() => setNonce(n => n + 1))

  useEffect(() => {
    fetch(`/api/admin/quotations/${id}`)
      .then(r => r.json())
      .then(j => {
        setData(j)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id, nonce])

  async function finalize() {
    const ok = await confirm({
      title: 'Finalize Quotation?',
      message:
        'This will mark the quotation as Final and send a confirmation email to the customer if an email address is on record. This action cannot be undone.',
      confirmLabel: 'Yes, Finalize',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    setFinalizing(true)
    try {
      const res = await fetch(`/api/admin/quotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'final' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to finalize')
      setData((prev: any) => ({ ...prev, quotation: json.quotation }))
    } catch (e: any) {
      toast.error(e.message || 'Failed to finalize')
    } finally {
      setFinalizing(false)
    }
  }

  if (!loading && !data?.quotation) {
    return (
      <PageBody>
        <EmptyState title="Quotation not found." action={{ label: 'Back to Quotations', href: ap('/admin/quotations') }} />
      </PageBody>
    )
  }

  if (loading || !data?.quotation) {
    return (
      <PageBody>
        <DetailSkeleton kpis={3} />
      </PageBody>
    )
  }

  const q = data.quotation
  const items: any[] = data.items || []

  // Recompute totals from items when stored values are zero (e.g. legacy RFQ-converted quotations)
  const computedSubtotal = items.reduce((s, i) => s + parseFloat(i.amount || '0'), 0)
  const computedCgst = items.reduce(
    (s, i) => s + (parseFloat(i.amount || '0') * parseFloat(i.gst_rate || '0')) / 200,
    0
  )
  const computedSgst = computedCgst
  const storedSubtotal = parseFloat(q.subtotal || '0')
  const subtotal = storedSubtotal > 0 ? storedSubtotal : computedSubtotal
  const cgstAmount = storedSubtotal > 0 ? parseFloat(q.cgst_amount || '0') : computedCgst
  const sgstAmount = storedSubtotal > 0 ? parseFloat(q.sgst_amount || '0') : computedSgst
  const totalAmount =
    storedSubtotal > 0 ? parseFloat(q.total_amount || '0') : computedSubtotal + computedCgst + computedSgst

  const secondary: KitAction[] = []
  if (q.status === 'draft' && !q.from_rfq) secondary.push({ key: 'edit', label: 'Edit', icon: Pencil, href: ap(`/admin/quotations?view=editor&edit=${q.id}`) })
  if (q.converted_order_id) secondary.push({ key: 'invoice', label: 'View Invoice', icon: ExternalLink, href: ap(`/admin/invoices/${q.converted_order_id}/view`) })
  const addr = (...parts: any[]) => parts.filter(Boolean).join(', ')
  const totalsRow = (label: string, value: string) => (
    <div className="flex justify-between gap-8">
      <span className="text-foreground-muted">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  )

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/quotations'), label: 'Quotations' }}
          title={<span className="font-mono [overflow-wrap:anywhere]">{q.quote_number}</span>}
          status={<StatusBadge status={q.status} map={QUOTATION_STATUS} />}
          identifiers={[{ label: 'Date', value: formatDate(q.quote_date || q.created_at) }]}
          secondary={secondary}
          actions={
            <>
              {q.status === 'draft' && q.from_rfq && canWrite && <ActionButton variant="primary" action={{ label: finalizing ? 'Finalizing…' : 'Finalize Quotation', busy: finalizing, onClick: finalize }} />}
              <a href={`/api/admin/quotations/${q.id}/pdf`} target="_blank" rel="noopener noreferrer" className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
                <Download className="h-4 w-4" />
                Download PDF
              </a>
            </>
          }
        />
      }
      main={
        <>
          <Card title="Line items" flush>
            <div className="divide-y divide-border-default/60 md:hidden">
              {items.map((item: any, idx: number) => (
                <div key={idx} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground break-words">{item.description}</div>
                      {!item.product_id && <span className={badgeCls('amber')}>Custom – not in inventory</span>}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-foreground">{formatINR(parseFloat(item.amount))}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-foreground-secondary">
                    <span className="tabular-nums">Qty {parseFloat(item.quantity)} {item.unit || 'PCS'} × {formatINR(parseFloat(item.rate))}</span>
                    <span>GST {Number(item.gst_rate)}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50">
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} text-center`}>HSN</th>
                    <th className={`${th} text-center`}>GST%</th>
                    <th className={`${th} text-center`}>Unit</th>
                    <th className={`${th} text-center`}>Qty</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Disc%</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        {!item.product_id && <span className={badgeCls('amber')}>Custom – not in inventory</span>}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-xs text-foreground-secondary">{item.hsn_code || '—'}</td>
                      <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{Number(item.gst_rate)}%</td>
                      <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.unit || 'PCS'}</td>
                      <td className="px-4 py-3 text-center tabular-nums text-foreground">
                        {parseFloat(item.quantity)}
                        {item.sell_unit_dimension === 'count' && Number(item.sell_unit_factor) > 1 && (
                          <span className="ml-1 text-xs text-foreground-secondary">
                            × {parseFloat(item.sell_unit_factor)} = <span className="font-semibold text-foreground">{Math.round(Number(item.quantity) * Number(item.sell_unit_factor))} pcs</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatINR(parseFloat(item.rate))}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground-secondary">{Number(item.discount_pct) ? `${Number(item.discount_pct)}%` : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatINR(parseFloat(item.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border-default px-4 py-3">
              <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                {totalsRow('Subtotal', formatINR(subtotal))}
                {cgstAmount > 0 && totalsRow('CGST', formatINR(cgstAmount))}
                {sgstAmount > 0 && totalsRow('SGST', formatINR(sgstAmount))}
                <div className="flex justify-between gap-8 border-t border-border-default pt-1.5">
                  <span className="font-semibold text-foreground">Total</span>
                  <span className="text-base font-bold tabular-nums text-foreground">{formatINR(totalAmount)}</span>
                </div>
              </div>
            </div>
          </Card>
          {q.notes && (
            <Card title="Notes">
              <p className="text-sm text-foreground break-words">{q.notes}</p>
            </Card>
          )}
        </>
      }
      aside={
        <>
          <Card title="Quotation details">
            <Fields cols={1}>
              <Field label="Quote #" value={q.quote_number} mono copy={q.quote_number || undefined} />
              <Field label="Date" value={formatDate(q.quote_date || q.created_at)} />
              <Field label="Status" value={<StatusBadge status={q.status} map={QUOTATION_STATUS} />} />
              {q.converted_order_id && (
                <Field
                  label="Converted"
                  value={
                    <a href={ap(`/admin/invoices/${q.converted_order_id}/view`)} className="text-xs font-medium text-accent-500 hover:underline">
                      View Invoice ↗
                    </a>
                  }
                />
              )}
            </Fields>
          </Card>
          <Card title="Consignee">
            <Fields cols={1}>
              <Field label="Name" value={q.consignee_name} />
              {q.consignee_phone && <Field label="Phone" value={q.consignee_phone} />}
              {q.consignee_email && <Field label="Email" value={q.consignee_email} />}
              {q.consignee_gstin && <Field label="GSTIN" value={q.consignee_gstin} mono />}
              {q.consignee_addr1 && <Field label="Address" value={addr(q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode)} />}
            </Fields>
          </Card>
          {!q.buyer_same && q.buyer_name && (
            <Card title="Buyer">
              <Fields cols={1}>
                <Field label="Name" value={q.buyer_name} />
                {q.buyer_phone && <Field label="Phone" value={q.buyer_phone} />}
                {q.buyer_gstin && <Field label="GSTIN" value={q.buyer_gstin} mono />}
                {q.buyer_addr1 && <Field label="Address" value={addr(q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state, q.buyer_pincode)} />}
              </Fields>
            </Card>
          )}
        </>
      }
    />
  )
}
