'use client'

import { useState } from 'react'

interface Props {
  order: any
  items: any[]
  settings: Record<string, string>
  token: string
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
              <h1 className="text-xl font-bold text-gray-800">
                {isCashSale ? 'Cash Sale Receipt' : 'Tax Invoice'}
              </h1>
              <p className="text-gray-500 text-sm">#{order.invoice_number}</p>
              {!isCashSale && order.order_number && (
                <p className="text-gray-400 text-xs">Order #{order.order_number}</p>
              )}
            </div>
            <div className="text-right text-sm text-gray-600">
              <div>{new Date(order.invoice_date || order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              {isCancelled && (
                <div className="mt-1 text-xs font-bold text-red-600 border border-red-400 px-2 py-0.5 rounded">
                  {order.status === 'returned' ? 'RETURNED' : 'CANCELLED'}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="font-semibold text-gray-700 mb-1">
                {isCashSale ? 'Customer' : 'Bill To'}
              </div>
              <div className="text-gray-600">{order.full_name || order.customer_name}</div>
              {order.address_line1 && <div className="text-gray-500">{order.address_line1}</div>}
              {order.address_line2 && <div className="text-gray-500">{order.address_line2}</div>}
              {order.city && <div className="text-gray-500">{order.city}{order.state ? `, ${order.state}` : ''} {order.postal_code}</div>}
              {order.address_phone && <div className="text-gray-500">{order.address_phone}</div>}
              {order.buyer_gstin && <div className="text-gray-500">GSTIN: {order.buyer_gstin}</div>}
            </div>
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="font-semibold text-gray-700 mb-1">Details</div>
              <div className="text-gray-600">Payment: {order.payment_mode || (order.payment_status === 'paid' ? 'Online' : 'Pending')}</div>
              {order.tracking_number && <div className="text-gray-500">Tracking: {order.tracking_number}</div>}
              {settings.business_gstin && <div className="text-gray-500">Our GSTIN: {settings.business_gstin}</div>}
            </div>
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="bg-[#1a3a4a] text-white">
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-2 text-gray-700">
                    {item.product_name}
                    {item.hsn_code && <span className="text-gray-400 text-xs ml-2">HSN: {item.hsn_code}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-gray-600">₹{Number(item.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right text-gray-800 font-medium">₹{Number(item.total_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-56 text-sm">
              {order.taxable_amount && Number(order.taxable_amount) > 0 && (
                <div className="flex justify-between py-1 text-gray-600">
                  <span>Taxable</span>
                  <span>₹{Number(order.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {Number(order.cgst_amount) > 0 && (
                <div className="flex justify-between py-1 text-gray-500 text-xs">
                  <span>CGST</span>
                  <span>₹{Number(order.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {Number(order.sgst_amount) > 0 && (
                <div className="flex justify-between py-1 text-gray-500 text-xs">
                  <span>SGST</span>
                  <span>₹{Number(order.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {Number(order.igst_amount) > 0 && (
                <div className="flex justify-between py-1 text-gray-500 text-xs">
                  <span>IGST</span>
                  <span>₹{Number(order.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-t border-gray-200 font-bold text-gray-800">
                <span>Total</span>
                <span>₹{Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {settings.bank_name && !isCashSale && (
            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <div className="font-semibold text-gray-700 mb-1">Bank Details</div>
              <div>{settings.bank_name} — A/C {settings.bank_account}</div>
              <div>IFSC: {settings.bank_ifsc}{settings.bank_branch ? ` | Branch: ${settings.bank_branch}` : ''}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
