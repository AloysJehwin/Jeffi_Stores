'use client'

import { useState } from 'react'

interface Props {
  po: any
  items: any[]
  settings: Record<string, string>
  token: string
  grns: any[]
}

function fmt(n: any, decimals = 2) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtDate(d: any) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PurchaseOrderViewClient({ po, items, settings, token, grns }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/public/purchaseorder/${token}/pdf`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `po-${po.po_number.replace(/\//g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const tradeName = settings.business_trade_name || settings.business_legal_name || ''

  const subtotal = Number(po.subtotal) || items.reduce((s, i) => s + Number(i.total_cost || 0), 0)
  const taxAmount = Number(po.tax_amount) || 0
  const total = Number(po.total_amount) || subtotal + taxAmount

  // Aggregate GST lines
  const gstLines: Record<string, { taxable: number; gst: number }> = {}
  for (const item of items) {
    const rate = Number(item.tax_rate) || 0
    if (!rate) continue
    const lineTotal = Number(item.total_cost) || 0
    const taxable = item.gst_inclusive ? lineTotal / (1 + rate / 100) : lineTotal
    const gstAmt = item.gst_inclusive ? lineTotal - taxable : lineTotal * (rate / 100)
    const key = `${rate}`
    if (!gstLines[key]) gstLines[key] = { taxable: 0, gst: 0 }
    gstLines[key].taxable += taxable
    gstLines[key].gst += gstAmt
  }
  const hasGst = Object.keys(gstLines).length > 0

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">

        {/* Header */}
        <div className="bg-[#1a3a4a] text-white px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PURCHASE ORDER</h1>
            <p className="text-[#7ecde4] font-mono text-sm mt-0.5">#{po.po_number}</p>
            <div className="text-sm mt-1 space-y-0.5">
              <div className="text-gray-300">Date: <span className="text-white font-medium">{fmtDate(po.order_date)}</span></div>
              {po.expected_date && (
                <div className="text-gray-400 text-xs">Expected by: {fmtDate(po.expected_date)}</div>
              )}
              {po.status === 'draft' && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-400/20 text-yellow-300 text-xs font-semibold rounded">Draft</span>
              )}
            </div>
          </div>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            Download PDF
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">

          {/* From + Supplier */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Supplier</p>
              <p className="font-semibold text-gray-800">{po.supplier_name}</p>
              {po.contact_name && <p className="text-gray-500 mt-0.5">Attn: {po.contact_name}</p>}
              {po.supplier_address && <p className="text-gray-500 mt-0.5">{po.supplier_address}</p>}
              {po.supplier_gstin && <p className="text-gray-500 mt-0.5">GSTIN: {po.supplier_gstin}</p>}
              {po.supplier_email && <p className="text-gray-500 mt-0.5">{po.supplier_email}</p>}
            </div>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[#1a3a4a] text-white">
                  <th className="text-left px-4 py-3 font-medium w-8">#</th>
                  <th className="text-left px-4 py-3 font-medium">Product</th>
                  <th className="text-right px-4 py-3 font-medium">Purchase Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Selling Units</th>
                  <th className="text-right px-4 py-3 font-medium">Unit Cost</th>
                  <th className="text-right px-4 py-3 font-medium">GST%</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item, i) => {
                  const label = item.variant_name ? `${item.product_name} / ${item.variant_name}` : item.product_name
                  // quantity in DB is always base units; purchase_unit_factor = base units per purchase unit
                  const baseQty = Number(item.quantity)
                  const purchaseFactor = Number(item.purchase_unit_factor) || 1
                  const purchaseQty = baseQty / purchaseFactor
                  const purchaseUnit = item.purchase_unit || item.base_unit || 'unit'
                  const sellFactor = Number(item.sell_unit_factor) || 1
                  const sellUnit = item.sell_unit_label || item.sell_unit || item.base_unit || 'unit'
                  const sellingUnits = baseQty / sellFactor
                  const lineTotal = Number(item.total_cost) || baseQty * Number(item.unit_cost)
                  const taxRate = Number(item.tax_rate) || 0
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium leading-snug">
                        {label}
                        {item.sku && <div className="text-xs text-gray-400 font-normal mt-0.5">{item.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium">
                        {fmt(purchaseQty, purchaseQty % 1 === 0 ? 0 : 3)}
                        <span className="ml-1 text-gray-400 text-xs">{purchaseUnit}</span>
                        {purchaseFactor > 1 && (
                          <div className="text-xs text-gray-400 font-normal">
                            1 {purchaseUnit} = {fmt(purchaseFactor, purchaseFactor % 1 === 0 ? 0 : 3)} {item.base_unit || 'units'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {fmt(sellingUnits, sellingUnits % 1 === 0 ? 0 : 3)}
                        <span className="ml-1 text-gray-400 text-xs">{sellUnit}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        ₹{fmt(item.unit_cost)}
                        {item.gst_inclusive && taxRate > 0 && (
                          <div className="text-xs text-gray-400 font-normal">incl. GST</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {taxRate > 0 ? `${taxRate}%` : '—'}
                        {item.gst_inclusive && taxRate > 0 && (
                          <div className="text-xs text-gray-400">(incl.)</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800 font-semibold">₹{fmt(lineTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-72 text-sm divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex justify-between px-4 py-2.5 bg-gray-50">
                <span className="text-gray-500">Subtotal (excl. GST)</span>
                <span className="text-gray-700 font-medium">₹{fmt(subtotal)}</span>
              </div>
              {hasGst && Object.entries(gstLines).map(([rate, { gst }]) => (
                <div key={rate} className="flex justify-between px-4 py-2 text-gray-500">
                  <span>GST @ {rate}%</span>
                  <span>₹{fmt(gst)}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3 bg-[#1a3a4a] text-white font-bold">
                <span>Total</span>
                <span>₹{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Receipt History */}
          {grns.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Receipt History</h3>
              <div className="space-y-3">
                {grns.map((grn: any) => {
                  const grnItems: any[] = grn.grn_items || []
                  return (
                    <div key={grn.id} className="rounded-lg border border-gray-200 overflow-hidden text-sm">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-semibold text-gray-700">{grn.grn_number}</span>
                          <span className="text-xs text-gray-500">{fmtDate(grn.received_date)}</span>
                        </div>
                        {grn.notes && <span className="text-xs text-gray-400 italic truncate max-w-xs">{grn.notes}</span>}
                      </div>
                      <div className="divide-y divide-gray-100">
                        {grnItems.map((gi: any, idx: number) => {
                          const matchItem = items.find((it: any) => it.id === gi.po_item_id)
                          const factor = Number(gi.purchase_unit_factor) || 1
                          const recvBase = Number(gi.quantity_received) || 0
                          const recvPu = factor > 1 ? Math.round((recvBase / factor) * 1000) / 1000 : recvBase
                          const puLabel = matchItem?.purchase_unit || matchItem?.base_unit || 'unit'
                          const productLabel = matchItem
                            ? `${matchItem.product_name}${matchItem.variant_name ? ' / ' + matchItem.variant_name : ''}`
                            : `Item #${idx + 1}`
                          return (
                            <div key={idx} className="flex items-center justify-between px-4 py-2">
                              <span className="text-gray-600">{productLabel}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-gray-800 font-medium">
                                  {fmt(recvPu, recvPu % 1 === 0 ? 0 : 3)}
                                  <span className="ml-1 text-xs text-gray-400">{puLabel}</span>
                                </span>
                                {gi.unit_cost && <span className="text-xs text-gray-400">@ ₹{fmt(gi.unit_cost)}/{puLabel}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {po.notes && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-gray-700">
              <p className="font-semibold text-gray-600 mb-1">Notes</p>
              <p className="whitespace-pre-line">{po.notes}</p>
            </div>
          )}

          {/* Bank details */}
          {settings.bank_name && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm">
              <p className="font-semibold text-gray-600 mb-2">Bank Details</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-gray-500">
                {settings.bank_name && <><span className="text-gray-400">Bank</span><span>{settings.bank_name}</span></>}
                {settings.bank_account && <><span className="text-gray-400">Account No.</span><span className="font-mono">{settings.bank_account}</span></>}
                {settings.bank_ifsc && <><span className="text-gray-400">IFSC</span><span className="font-mono">{settings.bank_ifsc}</span></>}
                {settings.bank_branch && <><span className="text-gray-400">Branch</span><span>{settings.bank_branch}</span></>}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-gray-400 pt-2 border-t border-gray-100">
            This is a computer-generated purchase order. For queries contact {settings.business_email || tradeName}.
          </div>

        </div>
      </div>
    </div>
  )
}
