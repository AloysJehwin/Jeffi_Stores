'use client'

import { useState } from 'react'

interface Props {
  po: any
  items: any[]
  settings: Record<string, string>
  token: string
}

export default function PurchaseOrderViewClient({ po, items, settings, token }: Props) {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1a3a4a] text-white px-6 py-4 flex items-center justify-between">
        <div>
          <div className="font-bold text-lg">{tradeName}</div>
          <div className="text-sm text-gray-300">{settings.business_address}</div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="bg-white text-[#1a3a4a] font-semibold px-5 py-2 rounded hover:bg-gray-100 disabled:opacity-60 text-sm"
        >
          {downloading ? 'Downloading…' : 'Download PDF'}
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Purchase Order</h1>
              <p className="text-gray-500 text-sm">#{po.po_number}</p>
            </div>
            <div className="text-right text-sm text-gray-600">
              <div>{new Date(po.order_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              {po.expected_date && (
                <div className="text-xs text-gray-400">Expected by {new Date(po.expected_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="font-semibold text-gray-700 mb-1">From</div>
              <div className="text-gray-600">{tradeName}</div>
              {settings.business_address && <div className="text-gray-500">{settings.business_address}</div>}
              {settings.business_gstin && <div className="text-gray-500">GSTIN: {settings.business_gstin}</div>}
            </div>
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="font-semibold text-gray-700 mb-1">Supplier</div>
              <div className="text-gray-600">{po.supplier_name}</div>
              {po.contact_name && <div className="text-gray-500">Attn: {po.contact_name}</div>}
              {po.supplier_address && <div className="text-gray-500">{po.supplier_address}</div>}
              {po.supplier_gstin && <div className="text-gray-500">GSTIN: {po.supplier_gstin}</div>}
            </div>
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="bg-[#1a3a4a] text-white">
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Unit Cost</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const lineTotal = Number(item.quantity) * Number(item.unit_cost)
                const label = item.variant_name ? `${item.product_name} / ${item.variant_name}` : item.product_name
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{label}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{item.quantity}</td>
                    <td className="px-3 py-2 text-right text-gray-600">₹{Number(item.unit_cost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right text-gray-800 font-medium">₹{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-56 text-sm">
              <div className="flex justify-between py-2 border-t border-gray-200 font-bold text-gray-800">
                <span>Total</span>
                <span>₹{Number(po.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {po.notes && (
            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <span className="font-semibold">Notes: </span>{po.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
