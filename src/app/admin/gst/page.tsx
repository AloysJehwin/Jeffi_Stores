'use client'

import { useState } from 'react'

interface GSTSummary {
  totalInvoices: number
  totalTaxable: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalTax: number
  b2bCount?: number
  b2cCount?: number
}

interface IRNRow {
  invoice_number: string
  invoice_date: string
  customer_name: string
  order_number: string
  irn: string | null
  irn_ack_no: string | null
  irn_ack_dt: string | null
  irn_status: string | null
  total_amount: number
}

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)
}

function formatDate(str: string) {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function GSTPage() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
  const todayStr = today.toISOString().slice(0, 10)

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(todayStr)
  const [summary, setSummary] = useState<GSTSummary | null>(null)
  const [irnRows, setIrnRows] = useState<IRNRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/gst/gstr1?from=${from}&to=${to}`, {
        headers: { 'x-admin-token': document.cookie.match(/admin_token=([^;]+)/)?.[1] || '' },
        credentials: 'include',
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const data = await res.json()
      setSummary(data.summary)

      const allOrders: IRNRow[] = [...(data.b2b || []), ...(data.b2c || [])].map((r: any) => ({
        invoice_number: r.invoice_number,
        invoice_date: r.invoice_date,
        customer_name: r.customer_name,
        order_number: r.order_number,
        irn: r.irn,
        irn_ack_no: r.irn_ack_no,
        irn_ack_dt: r.irn_ack_dt,
        irn_status: r.irn_status,
        total_amount: parseFloat(r.total_amount || '0'),
      }))
      setIrnRows(allOrders)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function downloadCSV(reportType: 'gstr1' | 'gstr3b') {
    const url = `/api/admin/gst/${reportType}?from=${from}&to=${to}&format=csv`
    const a = document.createElement('a')
    a.href = url
    a.download = `${reportType.toUpperCase()}_${from}_to_${to}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const irnWithStatus = irnRows.filter(r => r.irn)
  const irnPending = irnRows.filter(r => !r.irn)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-foreground">GST Compliance</h1>
        <p className="text-foreground-secondary mt-1 text-sm">GSTR-1, GSTR-3B reports and e-Invoice status</p>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-foreground-secondary mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs text-foreground-secondary mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground"
            />
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-primary text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Fetch Report'}
          </button>
          <button
            onClick={() => downloadCSV('gstr1')}
            className="px-4 py-2 bg-surface border border-border rounded text-sm font-medium text-foreground hover:bg-surface-elevated"
          >
            Download GSTR-1 CSV
          </button>
          <button
            onClick={() => downloadCSV('gstr3b')}
            className="px-4 py-2 bg-surface border border-border rounded text-sm font-medium text-foreground hover:bg-surface-elevated"
          >
            Download GSTR-3B CSV
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Invoices', value: summary.totalInvoices, raw: true },
            { label: 'Taxable Value', value: summary.totalTaxable },
            { label: 'CGST', value: summary.totalCgst },
            { label: 'SGST', value: summary.totalSgst },
            { label: 'IGST', value: summary.totalIgst },
            { label: 'Total Tax', value: summary.totalTax },
          ].map(card => (
            <div key={card.label} className="bg-surface-elevated rounded-lg shadow p-4">
              <p className="text-xs text-foreground-secondary">{card.label}</p>
              <p className="text-lg font-bold text-foreground mt-1">
                {(card as any).raw ? card.value : formatINR(card.value as number)}
              </p>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-elevated rounded-lg shadow p-4">
            <p className="text-xs text-foreground-secondary">B2B Invoices (with GSTIN)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summary.b2bCount ?? 0}</p>
          </div>
          <div className="bg-surface-elevated rounded-lg shadow p-4">
            <p className="text-xs text-foreground-secondary">B2C Invoices (without GSTIN)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summary.b2cCount ?? 0}</p>
          </div>
        </div>
      )}

      {irnRows.length > 0 && (
        <div className="bg-surface-elevated rounded-lg shadow">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">
              e-Invoice (IRN) Status
              <span className="ml-2 text-sm font-normal text-foreground-secondary">
                {irnWithStatus.length} generated · {irnPending.length} pending
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left">
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Invoice No</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Customer</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">IRN</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Ack No</th>
                  <th className="px-4 py-3 text-xs font-medium text-foreground-secondary">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {irnRows.map((row, i) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="px-4 py-3 font-medium text-foreground">{row.invoice_number}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{formatDate(row.invoice_date)}</td>
                    <td className="px-4 py-3 text-foreground">{row.customer_name}</td>
                    <td className="px-4 py-3 text-foreground">{formatINR(row.total_amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary max-w-xs truncate">
                      {row.irn ? row.irn.slice(0, 20) + '...' : <span className="text-yellow-600">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground-secondary">{row.irn_ack_no || '—'}</td>
                    <td className="px-4 py-3">
                      {row.irn_status === 'generated' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Generated</span>
                      )}
                      {row.irn_status === 'stub' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Stub</span>
                      )}
                      {row.irn_status === 'cancelled' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Cancelled</span>
                      )}
                      {!row.irn_status && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">No IRN</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
