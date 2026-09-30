'use client'

import { useState } from 'react'

interface Props {
  order: any
  items: any[]
  settings: Record<string, string>
  token: string
}

function fmt(n: any, decimals = 2) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtDate(d: any) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function InvoiceViewClient({ order, items, settings, token }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/public/invoice/${token}/pdf`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${order.invoice_number.replace(/\//g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const tradeName = settings.business_trade_name || settings.business_legal_name || ''
  const isCashSale = order.source === 'cash_sale'
  const isCancelled = order.status === 'cancelled' || order.status === 'returned'

  const taxable = Number(order.taxable_amount) || 0
  const cgst = Number(order.cgst_amount) || 0
  const sgst = Number(order.sgst_amount) || 0
  const igst = Number(order.igst_amount) || 0
  const total = Number(order.total_amount) || 0
  const hasGst = cgst > 0 || sgst > 0 || igst > 0

  const discount = Number(order.discount_amount) || 0
  const bizDiscount = Number(order.business_discount_amount) || 0
  const shipping = Number(order.shipping_amount) || 0

  // Prorate business discount across items by their share of items subtotal
  const itemsSubtotal = items.reduce((s, it) => s + (Number(it.total_price) || 0), 0)

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#1a3a4a] text-white px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isCashSale ? 'CASH SALE RECEIPT' : 'TAX INVOICE'}</h1>
            <p className="text-[#7ecde4] font-mono text-sm mt-0.5">#{order.invoice_number}</p>
            <div className="text-sm mt-1 space-y-0.5">
              {!isCashSale && order.order_number && (
                <div className="text-gray-400 text-xs">Order #{order.order_number}</div>
              )}
              <div className="text-gray-300">
                Date: <span className="text-white font-medium">{fmtDate(order.invoice_date || order.created_at)}</span>
              </div>
              {isCancelled && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-red-500/30 text-red-300 text-xs font-semibold rounded uppercase">
                  {order.status === 'returned' ? 'Returned' : 'Cancelled'}
                </span>
              )}
            </div>
          </div>
          {/* Download PDF button */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download PDF"
            className="shrink-0 self-start inline-flex items-center gap-2 px-4 py-2 rounded border border-white/30 bg-white/10 text-white text-sm font-semibold hover:bg-white/20 disabled:opacity-60 transition-colors"
          >
            {downloading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
            Download PDF
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {/* Seller + Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* From (seller) */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">From</p>
              <p className="font-semibold text-gray-800">{tradeName}</p>
              {settings.business_legal_name && settings.business_legal_name !== tradeName && (
                <p className="text-gray-500 text-xs">{settings.business_legal_name}</p>
              )}
              {settings.business_address && <p className="text-gray-500 mt-0.5">{settings.business_address}</p>}
              {settings.business_gstin && <p className="text-gray-500 mt-0.5">GSTIN: {settings.business_gstin}</p>}
              {settings.business_phone && <p className="text-gray-500 mt-0.5">Ph: {settings.business_phone}</p>}
              {settings.business_email && <p className="text-gray-500 mt-0.5">{settings.business_email}</p>}
            </div>

            {/* Bill To (customer) */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {isCashSale ? 'Customer' : 'Bill To'}
              </p>
              <p className="font-semibold text-gray-800">{order.full_name || order.customer_name || '—'}</p>
              {order.address_line1 && <p className="text-gray-500 mt-0.5">{order.address_line1}</p>}
              {order.address_line2 && <p className="text-gray-500">{order.address_line2}</p>}
              {(order.city || order.state) && (
                <p className="text-gray-500">
                  {[order.city, order.state].filter(Boolean).join(', ')}
                  {order.postal_code ? ` - ${order.postal_code}` : ''}
                </p>
              )}
              {order.address_phone && <p className="text-gray-500 mt-0.5">Ph: {order.address_phone}</p>}
              {order.buyer_gstin && <p className="text-gray-500 mt-0.5">GSTIN: {order.buyer_gstin}</p>}
            </div>
          </div>

          {/* Payment info row */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Payment Details</p>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-gray-600">
              <span>
                Mode:{' '}
                <span className="font-medium">
                  {order.payment_mode || (order.payment_status === 'paid' ? 'Online' : 'Pending')}
                </span>
              </span>
              <span>
                Status:{' '}
                <span
                  className={`font-medium ${order.payment_status === 'paid' ? 'text-green-600' : 'text-orange-500'}`}
                >
                  {order.payment_status || 'Pending'}
                </span>
              </span>
              {order.tracking_number && (
                <span>
                  Tracking: <span className="font-medium font-mono">{order.tracking_number}</span>
                </span>
              )}
            </div>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[#1a3a4a] text-white">
                  <th className="text-left px-4 py-3 font-medium w-8">#</th>
                  <th className="text-left px-4 py-3 font-medium">Item</th>
                  <th className="text-right px-4 py-3 font-medium">HSN</th>
                  <th className="text-right px-4 py-3 font-medium">Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Rate</th>
                  <th className="text-right px-4 py-3 font-medium">Disc.%</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any, i: number) => {
                  const itemDiscount = Number(item.discount_amount) || 0
                  const mrpVal = item.mrp != null ? Number(item.mrp) : null
                  const qty = Number(item.quantity)
                  const itemTotal = Number(item.total_price)
                  // Prorate order-level business discount to this line by its share of subtotal
                  const itemBizDiscount = itemsSubtotal > 0 ? bizDiscount * (itemTotal / itemsSubtotal) : 0
                  const netSellingTotal = itemTotal - itemBizDiscount
                  let discPct = 0
                  if (mrpVal != null && mrpVal > 0 && qty > 0) {
                    const mrpTotal = mrpVal * qty
                    discPct = mrpTotal > netSellingTotal ? ((mrpTotal - netSellingTotal) / mrpTotal) * 100 : 0
                  } else {
                    const grossTotal = netSellingTotal + itemDiscount + itemBizDiscount
                    discPct =
                      grossTotal > 0 && itemDiscount + itemBizDiscount > 0
                        ? ((itemDiscount + itemBizDiscount) / grossTotal) * 100
                        : 0
                  }
                  const discLabel = discPct >= 0.01 ? `${discPct.toFixed(2)}%` : '—'
                  // Rate = MRP incl. GST when available, otherwise unit price incl. GST
                  const unitExclGST =
                    mrpVal != null && mrpVal > 0
                      ? mrpVal
                      : Number(item.taxable_amount) > 0 && qty > 0
                        ? Number(item.taxable_amount) / qty
                        : Number(item.unit_price)
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium leading-snug">{item.product_name}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">{item.hsn_code || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {item.quantity} {item.unit || ''}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">₹{fmt(unitExclGST)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">{discLabel}</td>
                      <td className="px-4 py-3 text-right text-gray-800 font-semibold">₹{fmt(item.total_price)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 text-sm divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              {discount > 0 && (
                <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                  <span className="text-gray-500">Coupon Discount</span>
                  <span className="text-green-600 font-medium">-₹{fmt(discount)}</span>
                </div>
              )}
              {bizDiscount > 0 && (
                <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                  <span className="text-gray-500">Business Discount</span>
                  <span className="text-green-600 font-medium">-₹{fmt(bizDiscount)}</span>
                </div>
              )}
              {taxable > 0 && (
                <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                  <span className="text-gray-500">Taxable Amount</span>
                  <span className="text-gray-700 font-medium">₹{fmt(taxable)}</span>
                </div>
              )}
              {hasGst && cgst > 0 && (
                <div className="flex justify-between px-4 py-2 text-gray-500">
                  <span>CGST</span>
                  <span>₹{fmt(cgst)}</span>
                </div>
              )}
              {hasGst && sgst > 0 && (
                <div className="flex justify-between px-4 py-2 text-gray-500">
                  <span>SGST</span>
                  <span>₹{fmt(sgst)}</span>
                </div>
              )}
              {hasGst && igst > 0 && (
                <div className="flex justify-between px-4 py-2 text-gray-500">
                  <span>IGST</span>
                  <span>₹{fmt(igst)}</span>
                </div>
              )}
              {shipping > 0 && (
                <div className="flex justify-between px-4 py-2 text-gray-500">
                  <span>Shipping</span>
                  <span>₹{fmt(shipping)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 bg-[#1a3a4a] text-white font-bold">
                <span>Total</span>
                <span>₹{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Bank details (non-cash) */}
          {settings.bank_name && !isCashSale && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm">
              <p className="font-semibold text-gray-600 mb-2">Bank Details</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-gray-500">
                {settings.bank_name && (
                  <>
                    <span className="text-gray-400">Bank</span>
                    <span>{settings.bank_name}</span>
                  </>
                )}
                {settings.bank_account && (
                  <>
                    <span className="text-gray-400">Account No.</span>
                    <span className="font-mono">{settings.bank_account}</span>
                  </>
                )}
                {settings.bank_ifsc && (
                  <>
                    <span className="text-gray-400">IFSC</span>
                    <span className="font-mono">{settings.bank_ifsc}</span>
                  </>
                )}
                {settings.bank_branch && (
                  <>
                    <span className="text-gray-400">Branch</span>
                    <span>{settings.bank_branch}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
            This is a computer-generated {isCashSale ? 'receipt' : 'invoice'}. For queries contact{' '}
            {settings.business_email || tradeName}.
          </div>
        </div>
      </div>
    </div>
  )
}
