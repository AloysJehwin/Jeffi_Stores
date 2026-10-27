'use client'

import { useEffect, useState } from 'react'
import { variantLabel } from '@/lib/catalog/product-label'
import { useRouter } from 'next/navigation'
import { Check, Download, ExternalLink, Pencil, QrCode } from 'lucide-react'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { formatINR, formatDate } from '@/lib/shared/format'
import { fmtQty } from '@/lib/shared/number-display'
import {
  ActionButton,
  Badge,
  Card,
  DetailHeader,
  DetailSkeleton,
  Dialog,
  EmptyState,
  EntityPage,
  Field,
  Fields,
  PageBody,
  PAYMENT_STATUS,
  StatusBadge,
  badgeCls,
  useActionToast,
  type KitAction,
} from '@/components/admin/kit'

const th = 'px-4 py-2.5 text-xs font-medium text-foreground-muted whitespace-nowrap'

export default function InvoiceDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [qrLoading, setQrLoading] = useState(false)
  const toast = useActionToast()
  const storeName = useStoreConfig().identity.name
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [amendDraft, setAmendDraft] = useState<{ id: string; order_number: string } | null | undefined>(undefined)
  const [amending, setAmending] = useState(false)
  const router = useRouter()
  const canWrite = useCanWrite('invoices')

  function loadData() {
    return fetch(`/api/admin/invoices/${id}/detail`)
      .then(r => r.json())
      .then(j => {
        if (j.redirect) {
          router.replace(j.redirect)
          return
        }
        setData(j)
        setQrImageUrl(j.order?.razorpay_qr_image_url || null)
        setLoading(false)
        // Check for amendment draft only for finalized invoices
        if (j.order?.invoice_number && j.order?.status !== 'draft') {
          fetch(`/api/admin/invoices/${id}/amendment-draft`, { credentials: 'include' })
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
              setAmendDraft(d?.draft ?? null)
            })
            .catch(() => {
              setAmendDraft(null)
            })
        } else {
          setAmendDraft(null)
        }
        return j
      })
      .catch(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    loadData()
  }, [id, router])

  // Poll every 4s while QR is shown and payment is unpaid
  useEffect(() => {
    const order = data?.order
    if (!order || order.payment_mode !== 'upi_qr' || order.payment_status === 'paid') return
    const interval = setInterval(async () => {
      const j = await fetch(`/api/admin/invoices/${id}/detail`)
        .then(r => r.json())
        .catch(() => null)
      if (!j?.order) return
      if (j.order.payment_status === 'paid') {
        setData(j)
        clearInterval(interval)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [id, data?.order?.payment_status, data?.order?.payment_mode])

  async function generateQr() {
    if (!data?.order) return
    setQrLoading(true)
    try {
      const res = await fetch('/api/admin/razorpay/qr', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: data.order.id,
          amountPaise: Math.round(parseFloat(data.order.total_amount) * 100),
          description: `${storeName} Invoice ${data.order.invoice_number}`,
        }),
      })
      const json = await res.json()
      if (res.ok && json.qrImageUrl) {
        setQrImageUrl(json.qrImageUrl)
        setQrModalOpen(true)
      } else toast.error(json.error || 'Failed to generate QR')
    } finally {
      setQrLoading(false)
    }
  }

  async function finalizeInvoice() {
    setFinalizing(true)
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${id}/finalize`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to finalize')
        return
      }
      await loadData()
    } catch {
      toast.error('Failed to finalize invoice')
    } finally {
      setFinalizing(false)
    }
  }

  async function createAmendmentDraft() {
    setAmending(true)
    try {
      const res = await fetch(`/api/admin/invoices/${id}/amendment-draft`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      // 409: the amendment draft already exists and is yours; 423: someone else holds it (read-only).
      if (!res.ok && !((res.status === 409 || res.status === 423) && json.draftId)) {
        toast.error(json.error || 'Failed to create amendment draft')
        return
      }
      if (res.status === 423) toast.info(json.error)
      router.push(ap(`/admin/invoices/${json.draftId}/view`))
    } catch {
      toast.error('Failed to create amendment draft')
    } finally {
      setAmending(false)
    }
  }

  if (!loading && !data?.order) {
    return (
      <PageBody>
        <EmptyState title="Invoice not found." action={{ label: 'Back to Invoices', href: ap('/admin/invoices') }} />
      </PageBody>
    )
  }

  if (loading || !data?.order) {
    return (
      <PageBody>
        <DetailSkeleton kpis={3} />
      </PageBody>
    )
  }

  const o = data.order
  const items: any[] = data.items || []
  const hasItemDiscount = items.some((it: any) => parseFloat(it.discount_amount || '0') > 0)
  const isVoided = o.status === 'cancelled' || o.status === 'returned'
  const showQrSection = o.payment_mode === 'upi_qr' && o.payment_status !== 'paid'

  const secondary: KitAction[] = []
  if (o.status === 'draft' && o.source === 'offline') secondary.push({ key: 'edit', label: 'Edit', icon: Pencil, href: ap(`/admin/invoices?view=edit&edit=${o.id}`) })
  if (showQrSection && canWrite)
    secondary.push({ key: 'qr', label: qrLoading ? 'Generating…' : 'QR', icon: QrCode, busy: qrLoading, onClick: () => (qrImageUrl ? setQrModalOpen(true) : generateQr()) })
  if (o.invoice_number && o.status !== 'draft' && o.source !== 'online' && !isVoided && amendDraft === null && canWrite)
    secondary.push({ key: 'amend', label: amending ? 'Creating…' : 'Amend Invoice', busy: amending, onClick: createAmendmentDraft })
  secondary.push({ key: 'order', label: 'View Order', icon: ExternalLink, href: ap(`/admin/orders/${o.id}/view`) })

  const qty = (item: any) => {
    const orderedQty = Number(item.quantity)
    const isCount = item.sell_unit_dimension === 'count'
    const factor = item.sell_unit_factor ? Number(item.sell_unit_factor) : 1
    const unitLabel = item.buy_unit && item.buy_unit !== 'unit' ? item.buy_unit : null
    if (isCount && unitLabel && factor > 1) return `${fmtQty(orderedQty)} ${unitLabel} (${fmtQty(orderedQty * factor)} pcs)`
    if (unitLabel && !isCount) return `${fmtQty(orderedQty)} ${unitLabel}`
    return fmtQty(orderedQty)
  }

  const totalsRow = (label: string, value: React.ReactNode, cls = 'text-foreground') => (
    <div className="flex justify-between gap-8">
      <span className="text-foreground-muted">{label}</span>
      <span className={`tabular-nums ${cls}`}>{value}</span>
    </div>
  )

  return (
    <>
      <Dialog open={qrModalOpen} onClose={() => setQrModalOpen(false)} size="sm" title={`UPI QR — ${formatINR(parseFloat(o.total_amount))}`} description="Scan with any UPI app to pay">
        <div className="flex flex-col items-center gap-4">
          {qrLoading ? (
            <div className="flex h-52 w-52 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
            </div>
          ) : qrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrImageUrl} alt="UPI QR Code" className="h-52 w-52 rounded-lg object-contain" />
          ) : (
            <p className="text-sm text-foreground-secondary">No QR available.</p>
          )}
          <button type="button" onClick={generateQr} disabled={qrLoading} className="text-xs text-foreground-secondary underline underline-offset-2 hover:text-foreground disabled:opacity-50">
            {qrLoading ? 'Regenerating…' : 'Regenerate QR'}
          </button>
        </div>
      </Dialog>

      <EntityPage
        header={
          <DetailHeader
            back={{ href: ap('/admin/invoices'), label: 'Invoices' }}
            title={<span className="font-mono [overflow-wrap:anywhere]">Invoice #{o.invoice_number}</span>}
            status={
              <>
                {isVoided && <Badge tone="red">{o.status}</Badge>}
                <StatusBadge status={o.payment_status} map={PAYMENT_STATUS} />
              </>
            }
            identifiers={[
              { label: 'Order', value: o.order_number, copy: true },
              { label: 'Date', value: formatDate(o.invoice_date || o.created_at) },
            ]}
            secondary={secondary}
            actions={
              <>
                {o.status === 'draft' && canWrite && <ActionButton action={{ label: finalizing ? 'Finalizing…' : 'Finalize Invoice', busy: finalizing, onClick: finalizeInvoice }} variant="primary" />}
                <a href={`/api/orders/${o.id}/invoice`} target="_blank" rel="noopener noreferrer" className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
                  <Download className="h-4 w-4" />
                  Download PDF
                </a>
              </>
            }
          />
        }
        notices={
          amendDraft && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm text-foreground">
              <span>An amendment draft is pending for this invoice.</span>
              <a href={ap(`/admin/invoices/${amendDraft.id}/view`)} className="shrink-0 font-semibold text-accent-500 hover:underline">
                View draft ({amendDraft.order_number})
              </a>
            </div>
          )
        }
        main={
          <>
            <Card title="Line items" flush>
              <div className="divide-y divide-border-default/60 md:hidden">
                {items.map((item: any, idx: number) => (
                  <div key={idx} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground break-words">{item.product_name}</div>
                        {!item.product_id && <span className={badgeCls('amber')}>Custom – not in inventory</span>}
                        {variantLabel(item) && <div className="text-xs text-foreground-secondary">{variantLabel(item)}</div>}
                        {item.product_sku && (
                          <div className="inline-flex items-center gap-1 font-mono text-xs text-foreground-muted">
                            {item.product_sku}
                            <CopySku sku={item.product_sku} />
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-foreground">{formatINR(parseFloat(item.total_price))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-foreground-secondary">
                      <span className="tabular-nums">Qty {qty(item)} × {formatINR(parseFloat(item.unit_price))}</span>
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
                      <th className={`${th} text-center`}>Qty</th>
                      <th className={`${th} text-right`}>Unit price</th>
                      {hasItemDiscount && <th className={`${th} text-right`}>Disc.</th>}
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
                          {!item.product_id && <span className={badgeCls('amber')}>Custom – not in inventory</span>}
                          {variantLabel(item) && <div className="text-xs text-foreground-secondary">{variantLabel(item)}</div>}
                          {item.product_sku && (
                            <div className="inline-flex items-center gap-1 font-mono text-xs text-foreground-muted">
                              {item.product_sku}
                              <CopySku sku={item.product_sku} />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-foreground-secondary">{item.hsn_code || '—'}</td>
                        <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{Number(item.gst_rate)}%</td>
                        <td className="px-4 py-3 text-center tabular-nums text-foreground">{qty(item)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatINR(parseFloat(item.unit_price))}</td>
                        {hasItemDiscount && (
                          <td className="px-4 py-3 text-right text-xs tabular-nums text-green-700 dark:text-green-400">
                            {parseFloat(item.discount_amount || '0') > 0 ? `−${formatINR(parseFloat(item.discount_amount))}` : '—'}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right tabular-nums text-foreground-secondary">{formatINR(parseFloat(item.taxable_amount || '0'))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground-secondary">{formatINR(parseFloat(item.tax_amount || '0'))}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatINR(parseFloat(item.total_price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border-default px-4 py-3">
                <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                  {totalsRow('Subtotal', formatINR(parseFloat(o.subtotal)))}
                  {parseFloat(o.discount_amount || '0') > 0 && totalsRow('Coupon discount', `−${formatINR(parseFloat(o.discount_amount))}`, 'text-green-700 dark:text-green-400')}
                  {parseFloat(o.business_discount_amount || '0') > 0 && totalsRow('Business discount', `−${formatINR(parseFloat(o.business_discount_amount))}`, 'text-green-700 dark:text-green-400')}
                  {parseFloat(o.shipping_amount || '0') > 0 && totalsRow('Shipping', formatINR(parseFloat(o.shipping_amount)))}
                  {o.is_igst ? (
                    totalsRow('IGST', formatINR(parseFloat(o.igst_amount || '0')))
                  ) : (
                    <>
                      {parseFloat(o.cgst_amount || '0') > 0 && totalsRow('CGST', formatINR(parseFloat(o.cgst_amount)))}
                      {parseFloat(o.sgst_amount || '0') > 0 && totalsRow('SGST', formatINR(parseFloat(o.sgst_amount)))}
                    </>
                  )}
                  <div className="flex justify-between gap-8 border-t border-border-default pt-1.5">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="text-base font-bold tabular-nums text-foreground">{formatINR(parseFloat(o.total_amount))}</span>
                  </div>
                </div>
              </div>
            </Card>
            {o.notes && (
              <Card title="Notes">
                <p className="text-sm text-foreground break-words">{o.notes}</p>
              </Card>
            )}
          </>
        }
        aside={
          <>
            <Card title="Invoice details">
              <Fields cols={1}>
                <Field label="Invoice #" value={o.invoice_number} mono copy={o.invoice_number || undefined} />
                <Field label="Order #" value={o.order_number} mono />
                <Field label="Date" value={formatDate(o.invoice_date || o.created_at)} />
                <Field label="Source" value={<span className="capitalize">{o.source}</span>} />
                {o.irn && (
                  <Field
                    label="IRN"
                    value={
                      <span className={badgeCls(o.irn_status === 'generated' ? 'green' : 'amber')}>
                        {o.irn_status === 'generated' ? (
                          <span className="inline-flex items-center gap-1">
                            <Check className="h-3 w-3" /> Generated
                          </span>
                        ) : (
                          'Stub'
                        )}
                      </span>
                    }
                  />
                )}
                {o.eway_bill_no && <Field label="E-Way Bill" value={o.eway_bill_no} mono />}
              </Fields>
            </Card>
            <Card title="Customer">
              <Fields cols={1}>
                <Field label="Name" value={o.customer_name} />
                <Field label="Phone" value={o.customer_phone} />
                <Field label="Email" value={o.customer_email} />
                {o.buyer_gstin && <Field label="GSTIN" value={o.buyer_gstin} mono />}
                {o.address_line1 && <Field label="Address" value={[o.address_line1, o.address_line2, o.city, o.state, o.postal_code].filter(Boolean).join(', ')} />}
              </Fields>
            </Card>
            {(o.tracking_number || o.shipping_method || o.shipped_at) && (
              <Card title="Shipping">
                <Fields cols={1}>
                  {o.shipping_method && <Field label="Method" value={<span className="capitalize">{o.shipping_method}</span>} />}
                  {o.tracking_number && <Field label="Tracking" value={o.tracking_number} mono copy={o.tracking_number} />}
                  {o.shipped_at && <Field label="Shipped" value={formatDate(o.shipped_at)} />}
                </Fields>
              </Card>
            )}
          </>
        }
      />
    </>
  )
}
