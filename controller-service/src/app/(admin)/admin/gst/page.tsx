'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Download, Loader2 } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/shared/admin-path'
import { Card, DataTable, EmptyState, Field, Fields, FormField, Kpi, KpiGrid, PageBody, PageHeader, StatusBadge, Tabs, TableSkeleton, badgeCls, useActionToast, type DataCol, type StatusMap } from '@/components/admin/kit'
import { fmtQty } from '@/lib/shared/number-display'

type Tab = 'gstr1' | 'gstr3b' | 'irn' | 'itc'

interface GSTSummary {
  totalInvoices: number
  totalTaxable: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalTax: number
  b2bCount: number
  b2cCount: number
  totalInvoiceValue: number
}
interface HsnRow {
  hsnCode: string
  gstRate: number
  taxableVal: number
  cgstAmt: number
  sgstAmt: number
  igstAmt: number
  totalTax: number
}
interface InvoiceRow {
  invoice_number: string
  invoice_date: string
  customer_name: string
  buyer_gstin: string | null
  taxable_amount: string
  cgst_amount: string
  sgst_amount: string
  igst_amount: string
  total_amount: string
  irn: string | null
  irn_ack_no: string | null
  irn_ack_dt: string | null
  irn_status: string | null
}
interface GSTR3BData {
  gstin: string
  legalName: string
  table31: { outwardTaxable: { taxableValue: number; integratedTax: number; centralTax: number; stateTax: number } }
  summary: {
    totalInvoices: number
    totalTaxable: number
    totalCgst: number
    totalSgst: number
    totalIgst: number
    totalTax: number
    byGstRate: { gstRate: number; isIgst: boolean; taxable: number; cgst: number; sgst: number; igst: number }[]
  }
}
interface ITCRow {
  po_number: string
  order_date: string
  supplier_name: string
  supplier_gstin: string | null
  product_name: string
  quantity: number
  unit_cost: string
  tax_rate: string
  taxable_amount: string
  tax_amount: string
}
interface ITCData {
  summary: { lineCount: number; totalTaxable: number; totalTax: number }
  supplierSummary: { supplierName: string; gstin: string | null; poCount: number; taxable: number; tax: number }[]
  rows: ITCRow[]
}

const INR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function getPresetRange(preset: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear(),
    m = now.getMonth()
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

// e-invoice statuses as stored on invoices.irn_status.
const IRN_STATUS: StatusMap = {
  generated: { label: 'Generated', tone: 'green' },
  stub: { label: 'Stub', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}

type K = { _k: string }
const keyed = <T,>(rows: T[]): (T & K)[] => rows.map((r, i) => ({ ...r, _k: String(i) }))
const kk = (r: K) => r._k

const money = (v: string | number) => INR(typeof v === 'string' ? parseFloat(v) : v)
type Tax = { taxable: number; cgst: number; sgst: number; igst: number; total: number }
function taxCols<T>(pick: (r: T) => Tax, totalLabel = 'Total'): DataCol<T>[] {
  return [
    { key: 'taxable', label: 'Taxable', num: true, render: r => INR(pick(r).taxable) },
    { key: 'cgst', label: 'CGST', num: true, render: r => INR(pick(r).cgst) },
    { key: 'sgst', label: 'SGST', num: true, render: r => INR(pick(r).sgst) },
    { key: 'igst', label: 'IGST', num: true, render: r => INR(pick(r).igst) },
    { key: 'total', label: totalLabel, num: true, render: r => <span className="font-medium text-foreground">{INR(pick(r).total)}</span> },
  ]
}
const invTax = (r: InvoiceRow): Tax => ({ taxable: parseFloat(r.taxable_amount), cgst: parseFloat(r.cgst_amount), sgst: parseFloat(r.sgst_amount), igst: parseFloat(r.igst_amount), total: parseFloat(r.total_amount) })
function invoiceCols(b2b: boolean): DataCol<InvoiceRow & K>[] {
  const gstin: DataCol<InvoiceRow & K>[] = b2b ? [{ key: 'gstin', label: 'GSTIN', render: r => <span className="font-mono text-xs text-foreground-secondary">{r.buyer_gstin}</span> }] : []
  return [
    { key: 'no', label: 'Invoice No', render: r => <span className="whitespace-nowrap font-medium text-foreground">{r.invoice_number}</span> },
    { key: 'date', label: 'Date', render: r => <span className="whitespace-nowrap text-foreground-secondary">{fmtDate(r.invoice_date)}</span> },
    { key: 'customer', label: 'Customer', render: r => <span className="block max-w-[200px] truncate">{r.customer_name}</span> },
    ...gstin,
    ...taxCols<InvoiceRow & K>(invTax),
  ]
}
const hsnCols: DataCol<HsnRow & K>[] = [
  { key: 'hsn', label: 'HSN Code', render: r => <span className="font-mono font-medium text-foreground">{r.hsnCode}</span> },
  { key: 'rate', label: 'GST Rate', num: true, render: r => `${r.gstRate}%` },
  ...taxCols<HsnRow & K>(r => ({ taxable: r.taxableVal, cgst: r.cgstAmt, sgst: r.sgstAmt, igst: r.igstAmt, total: r.totalTax }), 'Total Tax'),
]
type RateRow = GSTR3BData['summary']['byGstRate'][number] & K
const rateCols: DataCol<RateRow>[] = [
  { key: 'rate', label: 'GST Rate', render: r => <span className="font-medium text-foreground">{r.gstRate}%</span> },
  { key: 'type', label: 'Supply Type', render: r => <span className="text-foreground-secondary">{r.isIgst ? 'Inter-State' : 'Intra-State'}</span> },
  ...taxCols<RateRow>(r => ({ taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total: r.cgst + r.sgst + r.igst }), 'Total Tax'),
]
const irnCols: DataCol<InvoiceRow & K>[] = [
  { key: 'no', label: 'Invoice No', render: r => <span className="whitespace-nowrap font-medium text-foreground">{r.invoice_number}</span> },
  { key: 'date', label: 'Date', render: r => <span className="whitespace-nowrap text-foreground-secondary">{fmtDate(r.invoice_date)}</span> },
  { key: 'customer', label: 'Customer', render: r => <span className="block max-w-[160px] truncate">{r.customer_name}</span> },
  { key: 'type', label: 'Type', render: r => <span className={badgeCls(r.buyer_gstin ? 'blue' : 'muted')}>{r.buyer_gstin ? 'B2B' : 'B2C'}</span> },
  { key: 'amount', label: 'Amount', num: true, render: r => <span className="font-medium text-foreground">{money(r.total_amount)}</span> },
  {
    key: 'irn',
    label: 'IRN',
    render: r => (
      <span className="block max-w-[120px] truncate font-mono text-xs text-foreground-secondary" title={r.irn || ''}>
        {r.irn ? r.irn.slice(0, 16) + '…' : <span className="text-amber-600 dark:text-amber-400">Pending</span>}
      </span>
    ),
  },
  { key: 'ack', label: 'Ack No', render: r => <span className="text-xs text-foreground-secondary">{r.irn_ack_no || '—'}</span> },
  { key: 'ackdt', label: 'Ack Date', render: r => <span className="whitespace-nowrap text-xs text-foreground-secondary">{r.irn_ack_dt ? fmtDate(r.irn_ack_dt) : '—'}</span> },
  { key: 'status', label: 'Status', render: r => <StatusBadge status={r.irn_status} map={IRN_STATUS} label={r.irn_status && IRN_STATUS[r.irn_status] ? undefined : 'No IRN'} /> },
]
type SupRow = ITCData['supplierSummary'][number] & K
const supplierCols: DataCol<SupRow>[] = [
  { key: 'supplier', label: 'Supplier', render: r => <span className="font-medium text-foreground">{r.supplierName}</span> },
  { key: 'gstin', label: 'GSTIN', render: r => <span className="font-mono text-xs text-foreground-secondary">{r.gstin || <span className="italic text-foreground-muted">No GSTIN</span>}</span> },
  { key: 'pos', label: 'POs', num: true, render: r => r.poCount },
  { key: 'taxable', label: 'Taxable', num: true, render: r => INR(r.taxable) },
  { key: 'tax', label: 'ITC (Tax)', num: true, render: r => <span className="font-medium text-green-700 dark:text-green-400">{INR(r.tax)}</span> },
]
const itcCols: DataCol<ITCRow & K>[] = [
  { key: 'po', label: 'PO No', render: r => <span className="whitespace-nowrap font-medium text-foreground">{r.po_number}</span> },
  { key: 'date', label: 'Date', render: r => <span className="whitespace-nowrap text-foreground-secondary">{fmtDate(r.order_date)}</span> },
  { key: 'supplier', label: 'Supplier', render: r => <span className="block max-w-[140px] truncate">{r.supplier_name}</span> },
  { key: 'product', label: 'Product', render: r => <span className="block max-w-[160px] truncate">{r.product_name}</span> },
  { key: 'qty', label: 'Qty', num: true, render: r => fmtQty(r.quantity) },
  { key: 'unit', label: 'Unit Cost', num: true, render: r => money(r.unit_cost) },
  { key: 'rate', label: 'GST %', num: true, render: r => `${parseFloat(r.tax_rate)}%` },
  { key: 'taxable', label: 'Taxable', num: true, render: r => money(r.taxable_amount) },
  { key: 'itc', label: 'ITC', num: true, render: r => <span className="font-medium text-green-700 dark:text-green-400">{money(r.tax_amount)}</span> },
]

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
      <Download className="h-4 w-4" />
      Download CSV
    </button>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">{children}</div>
)

export default function GSTPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab') as Tab | null
  const validTabs: Tab[] = ['gstr1', 'gstr3b', 'irn', 'itc']
  const [tab, setTab] = useState<Tab>(tabParam && validTabs.includes(tabParam) ? tabParam : 'gstr1')

  function handleTabChange(id: Tab) {
    setTab(id)
    router.push(ap(`/admin/gst?tab=${id}`), { scroll: false })
  }
  const [preset, setPreset] = useState('this_month')
  const initial = getPresetRange('this_month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [loading, setLoading] = useState(false)
  const toast = useActionToast()

  const [gstr1Summary, setGstr1Summary] = useState<GSTSummary | null>(null)
  const [gstr1B2B, setGstr1B2B] = useState<InvoiceRow[]>([])
  const [gstr1B2C, setGstr1B2C] = useState<InvoiceRow[]>([])
  const [hsnSummary, setHsnSummary] = useState<HsnRow[]>([])
  const [gstr3b, setGstr3b] = useState<GSTR3BData | null>(null)
  const [itcData, setItcData] = useState<ITCData | null>(null)

  const fetchAll = useCallback(async (f: string, t: string) => {
    setLoading(true)
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
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAll(from, to)
  }, [])

  function applyPreset(p: string) {
    setPreset(p)
    if (p !== 'custom') {
      const range = getPresetRange(p)
      setFrom(range.from)
      setTo(range.to)
    }
  }

  function handleFetch() {
    fetchAll(from, to)
  }

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
    <PageBody>
      <PageHeader title="GST Compliance" description="GSTR-1 · GSTR-3B · e-Invoice status · ITC Ledger" />

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex h-control items-center rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {[
            { key: 'this_month', label: 'This Month' },
            { key: 'last_month', label: 'Last Month' },
            { key: 'this_quarter', label: 'This Quarter' },
            { key: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`h-full rounded-md px-3 text-sm font-medium transition-colors ${preset === p.key ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:text-foreground'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <FormField label="From">
          <DatePicker
            value={from}
            onChange={v => {
              setFrom(v)
              setPreset('custom')
            }}
          />
        </FormField>
        <FormField label="To">
          <DatePicker
            value={to}
            onChange={v => {
              setTo(v)
              setPreset('custom')
            }}
          />
        </FormField>
        <button type="button" onClick={handleFetch} disabled={loading} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Fetching…' : 'Fetch Report'}
        </button>
      </div>

      {loading && (
        <div className="grid animate-pulse grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
          ))}
        </div>
      )}

      {gstr1Summary && !loading && (
        <KpiGrid>
          <Kpi label="Invoices" value={String(gstr1Summary.totalInvoices)} sub={`${gstr1Summary.b2bCount} B2B · ${gstr1Summary.b2cCount} B2C`} highlight />
          <Kpi label="Taxable Value" value={INR(gstr1Summary.totalTaxable)} />
          <Kpi label="CGST" value={INR(gstr1Summary.totalCgst)} />
          <Kpi label="SGST" value={INR(gstr1Summary.totalSgst)} />
          <Kpi label="IGST" value={INR(gstr1Summary.totalIgst)} />
          <Kpi label="Total Tax" value={INR(gstr1Summary.totalTax)} />
        </KpiGrid>
      )}

      <Tabs tabs={tabs} value={tab} onChange={handleTabChange} />

      {loading && <TableSkeleton rows={8} cols={6} />}

      {!loading && tab === 'gstr1' && (
        <div className="space-y-4">
          {!gstr1Summary ? (
            <EmptyState title="Select a date range and click Fetch Report." />
          ) : (
            <>
              <Card title={`B2B Invoices (${gstr1B2B.length})`} flush action={<CsvButton onClick={() => downloadCSV('gstr1')} />}>
                <DataTable bare rows={keyed(gstr1B2B)} cols={invoiceCols(true)} rowKey={kk} empty="No B2B invoices in this period." />
              </Card>
              <Card title={`B2C Invoices (${gstr1B2C.length})`} flush>
                <DataTable bare rows={keyed(gstr1B2C)} cols={invoiceCols(false)} rowKey={kk} empty="No B2C invoices in this period." />
              </Card>
              <Card title="HSN Summary" flush>
                <DataTable bare rows={keyed(hsnSummary)} cols={hsnCols} rowKey={kk} empty="No HSN lines in this period." />
              </Card>
            </>
          )}
        </div>
      )}

      {!loading && tab === 'gstr3b' && (
        <div className="space-y-4">
          {gstr3b ? (
            <>
              <Card title="GSTR-3B Summary" action={<CsvButton onClick={() => downloadCSV('gstr3b')} />}>
                <Fields>
                  <Field label="Entity" value={gstr3b.legalName} />
                  <Field label="GSTIN" value={gstr3b.gstin} mono />
                </Fields>
              </Card>
              <Card title="3.1 Details of Outward Supplies">
                <KpiGrid>
                  <Kpi label="Taxable Value" value={INR(gstr3b.table31.outwardTaxable.taxableValue)} />
                  <Kpi label="Integrated Tax (IGST)" value={INR(gstr3b.table31.outwardTaxable.integratedTax)} />
                  <Kpi label="Central Tax (CGST)" value={INR(gstr3b.table31.outwardTaxable.centralTax)} />
                  <Kpi label="State/UT Tax (SGST)" value={INR(gstr3b.table31.outwardTaxable.stateTax)} />
                </KpiGrid>
              </Card>
              <Card title="Tax Breakup by GST Rate" flush>
                <DataTable bare rows={keyed(gstr3b.summary.byGstRate)} cols={rateCols} rowKey={kk} empty="No tax lines in this period." />
              </Card>
              <Card title="6. Payment of Tax">
                <KpiGrid>
                  <Kpi label="IGST Payable" value={INR(gstr3b.summary.totalIgst)} />
                  <Kpi label="CGST Payable" value={INR(gstr3b.summary.totalCgst)} />
                  <Kpi label="SGST Payable" value={INR(gstr3b.summary.totalSgst)} />
                  <Kpi label="Total Payable" value={INR(gstr3b.summary.totalTax)} highlight />
                </KpiGrid>
              </Card>
              <Note>
                <span className="font-semibold">Note (Table 4 — ITC): </span>
                Input Tax Credit values are shown in the ITC Ledger tab. ITC is eligible only from received POs. Verify with purchase invoices before filing.
              </Note>
            </>
          ) : (
            <EmptyState title="Fetch data to view GSTR-3B." />
          )}
        </div>
      )}

      {!loading && tab === 'irn' && (
        <Card
          title="e-Invoice (IRN) Status"
          hint={allInvoices.length > 0 ? `${allInvoices.filter(r => r.irn).length} generated · ${allInvoices.filter(r => !r.irn).length} pending` : undefined}
          flush
        >
          <DataTable bare rows={keyed(allInvoices)} cols={irnCols} rowKey={kk} empty="No invoices in this period." />
        </Card>
      )}

      {!loading && tab === 'itc' && (
        <div className="space-y-4">
          {itcData ? (
            <>
              <Card title="Input Tax Credit Ledger" action={<CsvButton onClick={() => downloadCSV('itc')} />}>
                <KpiGrid>
                  <Kpi label="PO Line Items" value={String(itcData.summary.lineCount)} sub="From received POs" />
                  <Kpi label="Total Taxable Purchases" value={INR(itcData.summary.totalTaxable)} />
                  <Kpi label="Total ITC Claimable" value={INR(itcData.summary.totalTax)} sub="Verify with supplier invoices" highlight />
                </KpiGrid>
              </Card>
              <Card title="By Supplier" flush>
                <DataTable bare rows={keyed(itcData.supplierSummary)} cols={supplierCols} rowKey={kk} empty="No suppliers in this period." />
              </Card>
              <Card title="Line-level Detail" flush>
                <DataTable bare rows={keyed(itcData.rows)} cols={itcCols} rowKey={kk} empty="No received purchase orders in this period." />
              </Card>
              <Note>
                <span className="font-semibold">Note: </span>
                ITC is claimable only from suppliers with valid GSTIN. Verify all amounts against supplier tax invoices before filing GSTR-3B Table 4.
              </Note>
            </>
          ) : (
            <EmptyState title="No ITC data available." body="Ensure purchase orders are marked as received." />
          )}
        </div>
      )}
    </PageBody>
  )
}
