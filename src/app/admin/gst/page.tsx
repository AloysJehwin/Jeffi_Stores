'use client'

import { useState, useEffect, useCallback } from 'react'

type Tab = 'gstr1' | 'gstr3b' | 'irn' | 'itc'

interface GSTSummary {
  totalInvoices: number; totalTaxable: number; totalCgst: number
  totalSgst: number; totalIgst: number; totalTax: number
  b2bCount: number; b2cCount: number; totalInvoiceValue: number
}
interface HsnRow { hsnCode: string; gstRate: number; taxableVal: number; cgstAmt: number; sgstAmt: number; igstAmt: number; totalTax: number }
interface InvoiceRow {
  invoice_number: string; invoice_date: string; customer_name: string
  buyer_gstin: string | null; taxable_amount: string; cgst_amount: string
  sgst_amount: string; igst_amount: string; total_amount: string
  irn: string | null; irn_ack_no: string | null; irn_ack_dt: string | null; irn_status: string | null
}
interface GSTR3BData {
  gstin: string; legalName: string
  table31: { outwardTaxable: { taxableValue: number; integratedTax: number; centralTax: number; stateTax: number } }
  summary: { totalInvoices: number; totalTaxable: number; totalCgst: number; totalSgst: number; totalIgst: number; totalTax: number; byGstRate: { gstRate: number; isIgst: boolean; taxable: number; cgst: number; sgst: number; igst: number }[] }
}
interface ITCRow {
  po_number: string; order_date: string; supplier_name: string; supplier_gstin: string | null
  product_name: string; quantity: number; unit_cost: string; tax_rate: string; taxable_amount: string; tax_amount: string
}
interface ITCData {
  summary: { lineCount: number; totalTaxable: number; totalTax: number }
  supplierSummary: { supplierName: string; gstin: string | null; poCount: number; taxable: number; tax: number }[]
  rows: ITCRow[]
}

const INR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function getPresetRange(preset: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (preset === 'this_month') {
    return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
  }
  if (preset === 'last_month') {
    const last = new Date(y, m, 0)
    return { from: new Date(y, m - 1, 1).toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
  }
  if (preset === 'this_quarter') {
    const qStart = Math.floor(m / 3) * 3
    return { from: new Date(y, qStart, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
  }
  return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4 shadow-sm">
      <p className="text-xs text-foreground-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-foreground mt-1">{value}</p>
      {sub && <p className="text-xs text-foreground-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function Badge({ status }: { status: string | null }) {
  if (status === 'generated') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Generated</span>
  if (status === 'stub') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">Stub</span>
  if (status === 'cancelled') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Cancelled</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary dark:bg-surface-secondary text-foreground-muted">No IRN</span>
}

export default function GSTPage() {
  const [tab, setTab] = useState<Tab>('gstr1')
  const [preset, setPreset] = useState('this_month')
  const initial = getPresetRange('this_month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [gstr1Summary, setGstr1Summary] = useState<GSTSummary | null>(null)
  const [gstr1B2B, setGstr1B2B] = useState<InvoiceRow[]>([])
  const [gstr1B2C, setGstr1B2C] = useState<InvoiceRow[]>([])
  const [hsnSummary, setHsnSummary] = useState<HsnRow[]>([])
  const [gstr3b, setGstr3b] = useState<GSTR3BData | null>(null)
  const [itcData, setItcData] = useState<ITCData | null>(null)

  const fetchAll = useCallback(async (f: string, t: string) => {
    setLoading(true)
    setError('')
    try {
      const [r1, r3b, itc] = await Promise.all([
        fetch(`/api/admin/gst/gstr1?from=${f}&to=${t}`, { credentials: 'include' }),
        fetch(`/api/admin/gst/gstr3b?from=${f}&to=${t}`, { credentials: 'include' }),
        fetch(`/api/admin/gst/itc?from=${f}&to=${t}`, { credentials: 'include' }),
      ])
      const [d1, d3b, ditc] = await Promise.all([r1.json(), r3b.json(), itc.json()])
      if (!r1.ok) throw new Error(d1.error || 'GSTR-1 failed')
      if (!r3b.ok) throw new Error(d3b.error || 'GSTR-3B failed')
      setGstr1Summary(d1.summary)
      setGstr1B2B(d1.b2b || [])
      setGstr1B2C(d1.b2c || [])
      setHsnSummary(d1.hsnSummary || [])
      setGstr3b(d3b)
      if (itc.ok) setItcData(ditc)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll(from, to) }, [])

  function applyPreset(p: string) {
    setPreset(p)
    if (p !== 'custom') {
      const range = getPresetRange(p)
      setFrom(range.from)
      setTo(range.to)
    }
  }

  function handleFetch() { fetchAll(from, to) }

  function downloadCSV(type: 'gstr1' | 'gstr3b' | 'itc') {
    const a = document.createElement('a')
    a.href = `/api/admin/gst/${type}?from=${from}&to=${to}&format=csv`
    a.download = `${type.toUpperCase()}_${from}_to_${to}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'gstr1', label: 'GSTR-1' },
    { id: 'gstr3b', label: 'GSTR-3B' },
    { id: 'irn', label: 'e-Invoice / IRN' },
    { id: 'itc', label: 'ITC Ledger' },
  ]

  const allInvoices = [...gstr1B2B, ...gstr1B2C]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">GST Compliance</h1>
        <p className="text-foreground-secondary mt-1 text-sm">GSTR-1 · GSTR-3B · e-Invoice status · ITC Ledger</p>
      </div>

      <div className="bg-surface-elevated rounded-lg border border-border-default p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: 'this_month', label: 'This Month' },
            { key: 'last_month', label: 'Last Month' },
            { key: 'this_quarter', label: 'This Quarter' },
            { key: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                preset === p.key
                  ? 'bg-accent-500 text-white'
                  : 'bg-surface-elevated border border-border-default text-foreground hover:bg-surface-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-foreground-secondary mb-1">From</label>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom') }}
              className="border border-border-default rounded-lg px-3 py-2 text-sm bg-surface text-foreground" />
          </div>
          <div>
            <label className="block text-xs text-foreground-secondary mb-1">To</label>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset('custom') }}
              className="border border-border-default rounded-lg px-3 py-2 text-sm bg-surface text-foreground" />
          </div>
          <button onClick={handleFetch} disabled={loading}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
            {loading ? 'Loading…' : 'Fetch Report'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {gstr1Summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard label="Invoices" value={String(gstr1Summary.totalInvoices)} sub={`${gstr1Summary.b2bCount} B2B · ${gstr1Summary.b2cCount} B2C`} />
          <SummaryCard label="Taxable Value" value={INR(gstr1Summary.totalTaxable)} />
          <SummaryCard label="CGST" value={INR(gstr1Summary.totalCgst)} />
          <SummaryCard label="SGST" value={INR(gstr1Summary.totalSgst)} />
          <SummaryCard label="IGST" value={INR(gstr1Summary.totalIgst)} />
          <SummaryCard label="Total Tax" value={INR(gstr1Summary.totalTax)} />
        </div>
      )}

      <div className="bg-surface-elevated rounded-lg border border-border-default shadow-sm overflow-hidden">
        <div className="flex border-b border-border-default overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-accent-500 text-accent-500'
                  : 'text-foreground-secondary hover:text-foreground'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          {tab === 'gstr1' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Outward Supplies</h2>
                <button onClick={() => downloadCSV('gstr1')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border-default rounded-lg hover:bg-surface-secondary transition-colors text-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download CSV
                </button>
              </div>

              {gstr1B2B.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">B2B Invoices ({gstr1B2B.length})</p>
                  <div className="overflow-x-auto rounded-lg border border-border-default">
                    <table className="min-w-full text-sm divide-y divide-border-default">
                      <thead className="bg-surface-secondary">
                        <tr>
                          {['Invoice No', 'Date', 'Customer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {gstr1B2B.map((r, i) => (
                          <tr key={i} className="hover:bg-surface-secondary/50">
                            <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{r.invoice_number}</td>
                            <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap">{fmtDate(r.invoice_date)}</td>
                            <td className="px-4 py-2.5 text-foreground max-w-[160px] truncate">{r.customer_name}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-foreground-secondary">{r.buyer_gstin}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.taxable_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.cgst_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.sgst_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.igst_amount))}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-foreground">{INR(parseFloat(r.total_amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {gstr1B2C.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">B2C Invoices ({gstr1B2C.length})</p>
                  <div className="overflow-x-auto rounded-lg border border-border-default">
                    <table className="min-w-full text-sm divide-y divide-border-default">
                      <thead className="bg-surface-secondary">
                        <tr>
                          {['Invoice No', 'Date', 'Customer', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {gstr1B2C.map((r, i) => (
                          <tr key={i} className="hover:bg-surface-secondary/50">
                            <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{r.invoice_number}</td>
                            <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap">{fmtDate(r.invoice_date)}</td>
                            <td className="px-4 py-2.5 text-foreground max-w-[200px] truncate">{r.customer_name}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.taxable_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.cgst_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.sgst_amount))}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.igst_amount))}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-foreground">{INR(parseFloat(r.total_amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {hsnSummary.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">HSN Summary</p>
                  <div className="overflow-x-auto rounded-lg border border-border-default">
                    <table className="min-w-full text-sm divide-y divide-border-default">
                      <thead className="bg-surface-secondary">
                        <tr>
                          {['HSN Code', 'GST Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {hsnSummary.map((r, i) => (
                          <tr key={i} className="hover:bg-surface-secondary/50">
                            <td className="px-4 py-2.5 font-mono font-medium text-foreground">{r.hsnCode}</td>
                            <td className="px-4 py-2.5 text-foreground">{r.gstRate}%</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(r.taxableVal)}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(r.cgstAmt)}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(r.sgstAmt)}</td>
                            <td className="px-4 py-2.5 text-right text-foreground">{INR(r.igstAmt)}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-foreground">{INR(r.totalTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!gstr1Summary && !loading && (
                <p className="text-sm text-foreground-muted text-center py-8">Select a date range and click Fetch Report.</p>
              )}
            </div>
          )}

          {tab === 'gstr3b' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">GSTR-3B Summary</h2>
                <button onClick={() => downloadCSV('gstr3b')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border-default rounded-lg hover:bg-surface-secondary transition-colors text-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download CSV
                </button>
              </div>

              {gstr3b ? (
                <>
                  {(gstr3b.gstin || gstr3b.legalName) && (
                    <div className="flex gap-6 text-sm text-foreground-secondary">
                      {gstr3b.legalName && <span><span className="font-medium text-foreground">Entity:</span> {gstr3b.legalName}</span>}
                      {gstr3b.gstin && <span><span className="font-medium text-foreground">GSTIN:</span> {gstr3b.gstin}</span>}
                    </div>
                  )}

                  <div className="rounded-lg border border-border-default overflow-hidden">
                    <div className="px-4 py-3 bg-surface-secondary border-b border-border-default">
                      <p className="text-sm font-semibold text-foreground">3.1 Details of Outward Supplies</p>
                    </div>
                    <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <SummaryCard label="Taxable Value" value={INR(gstr3b.table31.outwardTaxable.taxableValue)} />
                      <SummaryCard label="Integrated Tax (IGST)" value={INR(gstr3b.table31.outwardTaxable.integratedTax)} />
                      <SummaryCard label="Central Tax (CGST)" value={INR(gstr3b.table31.outwardTaxable.centralTax)} />
                      <SummaryCard label="State/UT Tax (SGST)" value={INR(gstr3b.table31.outwardTaxable.stateTax)} />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-default overflow-hidden">
                    <div className="px-4 py-3 bg-surface-secondary border-b border-border-default">
                      <p className="text-sm font-semibold text-foreground">Tax Breakup by GST Rate</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm divide-y divide-border-default">
                        <thead className="bg-surface-secondary/50">
                          <tr>
                            {['GST Rate', 'Supply Type', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total Tax'].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {gstr3b.summary.byGstRate.map((r, i) => (
                            <tr key={i} className="hover:bg-surface-secondary/50">
                              <td className="px-4 py-2.5 font-medium text-foreground">{r.gstRate}%</td>
                              <td className="px-4 py-2.5 text-foreground-secondary">{r.isIgst ? 'Inter-State' : 'Intra-State'}</td>
                              <td className="px-4 py-2.5 text-right text-foreground">{INR(r.taxable)}</td>
                              <td className="px-4 py-2.5 text-right text-foreground">{INR(r.cgst)}</td>
                              <td className="px-4 py-2.5 text-right text-foreground">{INR(r.sgst)}</td>
                              <td className="px-4 py-2.5 text-right text-foreground">{INR(r.igst)}</td>
                              <td className="px-4 py-2.5 text-right font-medium text-foreground">{INR(r.cgst + r.sgst + r.igst)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-default overflow-hidden">
                    <div className="px-4 py-3 bg-surface-secondary border-b border-border-default flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">6. Payment of Tax</p>
                    </div>
                    <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <SummaryCard label="IGST Payable" value={INR(gstr3b.summary.totalIgst)} />
                      <SummaryCard label="CGST Payable" value={INR(gstr3b.summary.totalCgst)} />
                      <SummaryCard label="SGST Payable" value={INR(gstr3b.summary.totalSgst)} />
                      <SummaryCard label="Total Payable" value={INR(gstr3b.summary.totalTax)} />
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                    <span className="font-semibold">Note (Table 4 — ITC): </span>
                    Input Tax Credit values are shown in the ITC Ledger tab. ITC is eligible only from received POs. Verify with purchase invoices before filing.
                  </div>
                </>
              ) : (
                <p className="text-sm text-foreground-muted text-center py-8">Fetch data to view GSTR-3B.</p>
              )}
            </div>
          )}

          {tab === 'irn' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">
                  e-Invoice (IRN) Status
                  {allInvoices.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-foreground-secondary">
                      {allInvoices.filter(r => r.irn).length} generated · {allInvoices.filter(r => !r.irn).length} pending
                    </span>
                  )}
                </h2>
              </div>
              {allInvoices.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border-default">
                  <table className="min-w-full text-sm divide-y divide-border-default">
                    <thead className="bg-surface-secondary">
                      <tr>
                        {['Invoice No', 'Date', 'Customer', 'Type', 'Amount', 'IRN', 'Ack No', 'Ack Date', 'Status'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {allInvoices.map((r, i) => (
                        <tr key={i} className="hover:bg-surface-secondary/50">
                          <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{r.invoice_number}</td>
                          <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap">{fmtDate(r.invoice_date)}</td>
                          <td className="px-4 py-2.5 text-foreground max-w-[160px] truncate">{r.customer_name}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.buyer_gstin ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-surface-secondary text-foreground-muted'}`}>
                              {r.buyer_gstin ? 'B2B' : 'B2C'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-foreground">{INR(parseFloat(r.total_amount))}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-foreground-secondary max-w-[120px] truncate" title={r.irn || ''}>
                            {r.irn ? r.irn.slice(0, 16) + '…' : <span className="text-yellow-600 dark:text-yellow-400">Pending</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-foreground-secondary">{r.irn_ack_no || '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-foreground-secondary whitespace-nowrap">{r.irn_ack_dt ? fmtDate(r.irn_ack_dt) : '—'}</td>
                          <td className="px-4 py-2.5"><Badge status={r.irn_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-foreground-muted text-center py-8">No invoices in this period.</p>
              )}
            </div>
          )}

          {tab === 'itc' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Input Tax Credit Ledger</h2>
                <button onClick={() => downloadCSV('itc')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border-default rounded-lg hover:bg-surface-secondary transition-colors text-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download CSV
                </button>
              </div>

              {itcData ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <SummaryCard label="PO Line Items" value={String(itcData.summary.lineCount)} sub="From received POs" />
                    <SummaryCard label="Total Taxable Purchases" value={INR(itcData.summary.totalTaxable)} />
                    <SummaryCard label="Total ITC Claimable" value={INR(itcData.summary.totalTax)} sub="Verify with supplier invoices" />
                  </div>

                  {itcData.supplierSummary.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">By Supplier</p>
                      <div className="overflow-x-auto rounded-lg border border-border-default">
                        <table className="min-w-full text-sm divide-y divide-border-default">
                          <thead className="bg-surface-secondary">
                            <tr>
                              {['Supplier', 'GSTIN', 'POs', 'Taxable', 'ITC (Tax)'].map(h => (
                                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-default">
                            {itcData.supplierSummary.map((r, i) => (
                              <tr key={i} className="hover:bg-surface-secondary/50">
                                <td className="px-4 py-2.5 font-medium text-foreground">{r.supplierName}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-foreground-secondary">{r.gstin || <span className="text-foreground-muted italic">No GSTIN</span>}</td>
                                <td className="px-4 py-2.5 text-foreground">{r.poCount}</td>
                                <td className="px-4 py-2.5 text-right text-foreground">{INR(r.taxable)}</td>
                                <td className="px-4 py-2.5 text-right font-medium text-green-700 dark:text-green-400">{INR(r.tax)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {itcData.rows.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">Line-level Detail</p>
                      <div className="overflow-x-auto rounded-lg border border-border-default">
                        <table className="min-w-full text-sm divide-y divide-border-default">
                          <thead className="bg-surface-secondary">
                            <tr>
                              {['PO No', 'Date', 'Supplier', 'Product', 'Qty', 'Unit Cost', 'GST %', 'Taxable', 'ITC'].map(h => (
                                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-default">
                            {itcData.rows.map((r, i) => (
                              <tr key={i} className="hover:bg-surface-secondary/50">
                                <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{r.po_number}</td>
                                <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap">{fmtDate(r.order_date)}</td>
                                <td className="px-4 py-2.5 text-foreground max-w-[140px] truncate">{r.supplier_name}</td>
                                <td className="px-4 py-2.5 text-foreground max-w-[160px] truncate">{r.product_name}</td>
                                <td className="px-4 py-2.5 text-right text-foreground">{r.quantity}</td>
                                <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.unit_cost))}</td>
                                <td className="px-4 py-2.5 text-right text-foreground">{parseFloat(r.tax_rate)}%</td>
                                <td className="px-4 py-2.5 text-right text-foreground">{INR(parseFloat(r.taxable_amount))}</td>
                                <td className="px-4 py-2.5 text-right font-medium text-green-700 dark:text-green-400">{INR(parseFloat(r.tax_amount))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {itcData.rows.length === 0 && (
                    <p className="text-sm text-foreground-muted text-center py-8">No received purchase orders in this period.</p>
                  )}

                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                    <span className="font-semibold">Note: </span>
                    ITC is claimable only from suppliers with valid GSTIN. Verify all amounts against supplier tax invoices before filing GSTR-3B Table 4.
                  </div>
                </>
              ) : (
                <p className="text-sm text-foreground-muted text-center py-8">No ITC data available. Ensure purchase orders are marked as received.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
