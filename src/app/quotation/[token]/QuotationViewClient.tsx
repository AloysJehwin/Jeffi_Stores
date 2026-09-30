'use client'

import { useState } from 'react'

interface Props {
  qt: any
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

export default function QuotationViewClient({ qt, items, settings, token }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/public/quotation/${token}/pdf`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `quotation-${qt.quote_number.replace(/\//g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const tradeName = settings.business_trade_name || settings.business_legal_name || ''

  // Compute from items when DB aggregate columns are NULL
  const itemsSubtotal = items.reduce((s: number, i: any) => s + Number(i.amount), 0)
  const itemsTaxable = items.reduce((s: number, i: any) => {
    return s + Number(i.amount) / (1 + Number(i.gst_rate) / 100)
  }, 0)
  const itemsCgst = items.reduce((s: number, i: any) => {
    const base = Number(i.amount) / (1 + Number(i.gst_rate) / 100)
    return s + (base * (Number(i.gst_rate) / 100)) / 2
  }, 0)
  const itemsSgst = itemsCgst

  const subtotal = Number(qt.subtotal) || itemsTaxable
  const cgst = Number(qt.cgst_amount) || itemsCgst
  const sgst = Number(qt.sgst_amount) || itemsSgst
  const total = Number(qt.total_amount) || itemsSubtotal
  const hasGst = cgst > 0 || sgst > 0

  const totalDiscount = items.reduce((s: number, i: any) => {
    const d = Number(i.discount_pct)
    if (!d) return s
    return s + Number(i.rate) * Number(i.quantity) * (d / 100)
  }, 0)

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#1a3a4a] text-white px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">QUOTATION</h1>
            <p className="text-[#7ecde4] font-mono text-sm mt-0.5">#{qt.quote_number}</p>
            <div className="text-sm mt-1 space-y-0.5">
              <div className="text-gray-300">
                Date: <span className="text-white font-medium">{fmtDate(qt.quote_date)}</span>
              </div>
              {qt.valid_until && <div className="text-gray-400 text-xs">Valid until: {fmtDate(qt.valid_until)}</div>}
              {qt.status === 'draft' && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-400/20 text-yellow-300 text-xs font-semibold rounded">
                  Draft
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 self-start bg-white text-[#1a3a4a] font-semibold px-4 sm:px-5 py-2 rounded hover:bg-gray-100 disabled:opacity-60 text-sm whitespace-nowrap"
          >
            {downloading ? 'Downloading…' : 'Download PDF'}
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {/* Seller + Consignee */}
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

            {/* To (consignee) */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">To (Consignee)</p>
              <p className="font-semibold text-gray-800">{qt.consignee_name || '—'}</p>
              {qt.consignee_addr1 && <p className="text-gray-500 mt-0.5">{qt.consignee_addr1}</p>}
              {qt.consignee_addr2 && <p className="text-gray-500">{qt.consignee_addr2}</p>}
              {(qt.consignee_city || qt.consignee_state) && (
                <p className="text-gray-500">
                  {[qt.consignee_city, qt.consignee_state].filter(Boolean).join(', ')}
                  {qt.consignee_pincode ? ` - ${qt.consignee_pincode}` : ''}
                </p>
              )}
              {qt.consignee_gstin && <p className="text-gray-500 mt-0.5">GSTIN: {qt.consignee_gstin}</p>}
              {qt.consignee_phone && <p className="text-gray-500 mt-0.5">Ph: {qt.consignee_phone}</p>}
              {qt.consignee_email && <p className="text-gray-500 mt-0.5">{qt.consignee_email}</p>}
            </div>

            {/* Buyer (only if different) */}
            {!qt.buyer_same && qt.buyer_name && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm sm:col-span-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Buyer</p>
                <p className="font-semibold text-gray-800">{qt.buyer_name}</p>
                {qt.buyer_addr1 && <p className="text-gray-500 mt-0.5">{qt.buyer_addr1}</p>}
                {qt.buyer_addr2 && <p className="text-gray-500">{qt.buyer_addr2}</p>}
                {(qt.buyer_city || qt.buyer_state) && (
                  <p className="text-gray-500">
                    {[qt.buyer_city, qt.buyer_state].filter(Boolean).join(', ')}
                    {qt.buyer_pincode ? ` - ${qt.buyer_pincode}` : ''}
                  </p>
                )}
                {qt.buyer_gstin && <p className="text-gray-500 mt-0.5">GSTIN: {qt.buyer_gstin}</p>}
                {qt.buyer_phone && <p className="text-gray-500 mt-0.5">Ph: {qt.buyer_phone}</p>}
                {qt.buyer_email && <p className="text-gray-500 mt-0.5">{qt.buyer_email}</p>}
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-[#1a3a4a] text-white">
                  <th className="text-left px-4 py-3 font-medium w-8">#</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-right px-4 py-3 font-medium">HSN</th>
                  <th className="text-right px-4 py-3 font-medium">Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Rate</th>
                  {items.some(i => Number(i.discount_pct) > 0) && (
                    <th className="text-right px-4 py-3 font-medium">Disc%</th>
                  )}
                  <th className="text-right px-4 py-3 font-medium">GST%</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium leading-snug">{item.description}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">{item.hsn_code || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {Number(item.quantity)} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">₹{fmt(item.rate)}</td>
                    {items.some(i => Number(i.discount_pct) > 0) && (
                      <td className="px-4 py-3 text-right text-gray-500">
                        {Number(item.discount_pct) > 0 ? `${item.discount_pct}%` : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right text-gray-500">{item.gst_rate}%</td>
                    <td className="px-4 py-3 text-right text-gray-800 font-semibold">₹{fmt(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 text-sm divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-700 font-medium">₹{fmt(subtotal)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between px-4 py-2 text-green-600">
                  <span>Discount</span>
                  <span>−₹{fmt(totalDiscount)}</span>
                </div>
              )}
              {hasGst && (
                <>
                  <div className="flex justify-between px-4 py-2 text-gray-500">
                    <span>CGST</span>
                    <span>₹{fmt(cgst)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2 text-gray-500">
                    <span>SGST</span>
                    <span>₹{fmt(sgst)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between px-4 py-3 bg-[#1a3a4a] text-white font-bold">
                <span>Total</span>
                <span>₹{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {qt.notes && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-gray-700">
              <p className="font-semibold text-gray-600 mb-1">Notes</p>
              <p className="whitespace-pre-line">{qt.notes}</p>
            </div>
          )}

          {/* Bank details */}
          {settings.bank_name && (
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
            This is a computer-generated quotation. For queries contact {settings.business_email || tradeName}.
          </div>
        </div>
      </div>
    </div>
  )
}
