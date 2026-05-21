'use client'

import { useState } from 'react'

interface Props {
  qt: any
  items: any[]
  settings: Record<string, string>
  token: string
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
  const subtotal = items.reduce((s, i) => s + Number(i.amount), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1a3a4a] text-white px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-lg truncate">{tradeName}</div>
          <div className="text-sm text-gray-300 truncate">{settings.business_address}</div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 bg-white text-[#1a3a4a] font-semibold px-4 sm:px-5 py-2 rounded hover:bg-gray-100 disabled:opacity-60 text-sm whitespace-nowrap"
        >
          {downloading ? 'Downloading…' : 'Download PDF'}
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Quotation</h1>
              <p className="text-gray-500 text-sm">#{qt.quote_number}</p>
            </div>
            <div className="text-right text-sm text-gray-600">
              <div>{new Date(qt.quote_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              {qt.valid_until && (
                <div className="text-xs text-gray-400">Valid until {new Date(qt.valid_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="font-semibold text-gray-700 mb-1">Consignee</div>
              <div className="text-gray-600">{qt.consignee_name}</div>
              {qt.consignee_addr1 && <div className="text-gray-500">{qt.consignee_addr1}</div>}
              {qt.consignee_city && <div className="text-gray-500">{qt.consignee_city}, {qt.consignee_state}</div>}
              {qt.consignee_gstin && <div className="text-gray-500">GSTIN: {qt.consignee_gstin}</div>}
            </div>
            {!qt.buyer_same && (
              <div className="bg-gray-50 rounded p-3 text-sm">
                <div className="font-semibold text-gray-700 mb-1">Buyer</div>
                <div className="text-gray-600">{qt.buyer_name}</div>
                {qt.buyer_addr1 && <div className="text-gray-500">{qt.buyer_addr1}</div>}
                {qt.buyer_city && <div className="text-gray-500">{qt.buyer_city}, {qt.buyer_state}</div>}
                {qt.buyer_gstin && <div className="text-gray-500">GSTIN: {qt.buyer_gstin}</div>}
              </div>
            )}
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm mb-4 min-w-[480px] sm:min-w-0">
              <thead>
                <tr className="bg-[#1a3a4a] text-white">
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-700">
                      {item.description}
                      {item.hsn_code && <span className="text-gray-400 text-xs ml-2">HSN: {item.hsn_code}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{item.quantity} {item.unit}</td>
                    <td className="px-3 py-2 text-right text-gray-600">₹{Number(item.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right text-gray-800 font-medium">₹{Number(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-56 text-sm">
              <div className="flex justify-between py-1 text-gray-600">
                <span>Subtotal</span>
                <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              {qt.total_amount && (
                <div className="flex justify-between py-2 border-t border-gray-200 font-bold text-gray-800">
                  <span>Total</span>
                  <span>₹{Number(qt.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>
          </div>

          {qt.notes && (
            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <span className="font-semibold">Notes: </span>{qt.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
