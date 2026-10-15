'use client'

import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { FileDown, FileUp, Loader2, X } from 'lucide-react'
import { Card } from '../_components/Card'
import BulkJobs, { type BulkItem } from '../_components/BulkJobs'
import { fmt } from '../_components/finance'
import { useToast } from '@/contexts/ToastContext'
import AIEnrichButton, { ECOM_ENRICH_ENDPOINT } from '@/components/admin/AIEnrichButton'

export interface Seller { name: string; gstin?: string; address?: string; phone?: string }
type Row = Record<string, string>

const BASE = '/api/ecom/svc/documents/documents/bulk'
const TYPES = [['invoice', 'Invoice'], ['quotation', 'Quotation'], ['receipt', 'Receipt'], ['packing_slip', 'Packing slip'], ['label', 'Label'], ['purchase_order', 'PO']] as const
const COLUMNS = ['reference', 'type', 'date', 'due_date', 'buyer_name', 'buyer_address', 'buyer_city', 'buyer_state', 'buyer_pincode', 'buyer_gstin', 'buyer_email', 'buyer_phone',
  'ship_to_name', 'ship_to_address', 'ship_to_city', 'ship_to_state', 'ship_to_pincode', 'item_description', 'hsn', 'quantity', 'unit', 'unit_price', 'gst_rate', 'discount', 'notes', 'terms']
const SAMPLE = [
  COLUMNS.join(','),
  'ORD-1001,invoice,,,Priya Sharma,"12 Lake View Rd",Chennai,Tamil Nadu,600042,,priya@example.com,,,,,,,Cordless drill 18V,8467,1,pc,6499,18,,Thank you!,',
  'ORD-1001,invoice,,,,,,,,,,,,,,,,Drill bit set (10 pc),8207,2,set,449,18,,,',
  'ORD-1002,invoice,,,Rahul Verma,"4 MG Road",Bengaluru,Karnataka,560001,29AAACR5055K1Z5,,,,,,,,Safety gloves,6116,10,pair,189,12,,,',
].join('\n')

const party = (r: Row, p: 'buyer' | 'ship_to') => {
  const v = (k: string) => r[`${p}_${k}`]?.trim() || undefined
  if (!v('name')) return undefined
  return { name: v('name'), address: v('address'), city: v('city'), state: v('state'), pincode: v('pincode'), gstin: v('gstin'), email: v('email'), phone: v('phone') }
}
const num = (s: string | undefined) => (s?.trim() ? Number(s.replace(/[,₹\s]/g, '')) : undefined)

/** CSV rows → one document per `reference` (rows sharing it are its line items). */
export function groupRows(rows: Row[], fallbackType: string) {
  const errors: string[] = []
  const docs = new Map<string, any>()
  rows.forEach((r, i) => {
    const line = i + 2
    const ref = r.reference?.trim()
    if (!ref) return void errors.push(`Row ${line}: reference is empty`)
    let d = docs.get(ref)
    if (!d) {
      const buyer = party(r, 'buyer')
      if (!buyer) errors.push(`Row ${line}: buyer_name is required on the first row of ${ref}`)
      d = { reference: ref, type: r.type?.trim() || fallbackType, buyer, ship_to: party(r, 'ship_to'), date: r.date?.trim() || undefined, due_date: r.due_date?.trim() || undefined, notes: r.notes?.trim() || undefined, terms: r.terms?.trim() || undefined, items: [] }
      docs.set(ref, d)
    }
    const quantity = num(r.quantity), unit_price = num(r.unit_price)
    if (!r.item_description?.trim()) return void errors.push(`Row ${line}: item_description is empty`)
    if (!quantity || quantity <= 0 || Number.isNaN(quantity)) return void errors.push(`Row ${line}: quantity must be a number above 0`)
    if (unit_price == null || Number.isNaN(unit_price) || unit_price < 0) return void errors.push(`Row ${line}: unit_price must be a number`)
    d.items.push({ description: r.item_description.trim(), hsn: r.hsn?.trim() || undefined, quantity, unit: r.unit?.trim() || undefined, unit_price, gst_rate: num(r.gst_rate) ?? 18, discount: num(r.discount) ?? 0 })
  })
  return { docs: [...docs.values()].filter(d => d.items.length), errors }
}

export default function BulkDocuments({ seller, prices, balance }: { seller: Seller | null; prices: Record<string, number>; balance: number }) {
  const { showToast } = useToast()
  const [type, setType] = useState('invoice')
  const [file, setFile] = useState<{ name: string; rows: Row[] } | null>(null)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [refresh, setRefresh] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => (file ? groupRows(file.rows, type) : null), [file, type])
  const cost = parsed ? parsed.docs.reduce((s, d) => s + (prices[d.type] ?? 0), 0) : 0

  function onFile(f: File | undefined) {
    if (!f) return
    Papa.parse<Row>(f, {
      header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: r => { setFile({ name: f.name, rows: r.data }); setServerErrors([]); setReference(f.name.replace(/\.csv$/i, '')) },
      error: () => showToast('Could not read that CSV', 'error'),
    })
    if (input.current) input.current.value = ''
  }

  function sample() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv' }))
    a.download = 'bulk-documents-sample.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function start() {
    if (!parsed?.docs.length || !seller) return
    setBusy(true)
    const r = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, seller, reference: reference || undefined, items: parsed.docs }) })
    const body = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) {
      setServerErrors((body.details ?? []).map((d: any) => `${parsed.docs[d.index]?.reference ?? `#${d.index + 1}`}: ${d.message}`))
      return showToast(body.message ?? 'Could not start the job', 'error')
    }
    showToast(`Rendering ${body.total} documents`, 'success')
    setFile(null)
    setRefresh(n => n + 1)
  }

  const errors = [...(parsed?.errors ?? []), ...serverErrors]
  const form = (
    <Card title="New bulk job">
      {!seller ? (
        <p className="text-sm text-foreground-secondary">Add your business details first — they are printed as the seller on every document.</p>
      ) : !file ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground-secondary">Upload a CSV with one row per line item. Rows with the same <code>reference</code> become one document. Seller: <strong>{seller.name}</strong>{seller.gstin ? ` · ${seller.gstin}` : ''}; design: your saved default.</p>
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-4 py-2 text-sm font-semibold text-white"><FileUp className="w-4 h-4" /> Upload CSV</button>
            <button type="button" onClick={sample} className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-sm font-semibold hover:bg-surface-secondary"><FileDown className="w-4 h-4" /> Sample CSV</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold">{file.name}</span>
            <span className="text-xs text-foreground-muted">{file.rows.length} rows → {parsed!.docs.length} documents</span>
            <button type="button" aria-label="Remove file" onClick={() => { setFile(null); setServerErrors([]) }} className="ml-auto rounded-full p-1.5 text-foreground-muted hover:bg-surface-secondary"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-foreground-muted">Type when the CSV has none</span>
            <div className="flex flex-wrap gap-1 rounded-full org-sand p-1">
              {TYPES.map(([k, l]) => <button key={k} type="button" onClick={() => setType(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${type === k ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary'}`}>{l}</button>)}
            </div>
          </div>
          <label className="block text-xs text-foreground-muted">Job name
            <div className="mt-1 flex max-w-sm items-center gap-2"><input value={reference} onChange={e => setReference(e.target.value.slice(0, 120))} className="block h-9 w-full rounded-lg border border-border-default bg-surface-elevated px-3 text-sm text-foreground" />
              <AIEnrichButton placement="inline" fieldLabel="Bulk job name" value={reference} onChange={v => setReference(v.slice(0, 120))} scope="mailer:write" endpoint={ECOM_ENRICH_ENDPOINT} format="plain" maxLength={120} write context={`A short internal name for a bulk document render job (${parsed?.docs.length ?? 0} documents of type ${type}).`} /></div>
          </label>
          {parsed!.docs.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-xs">
                <thead className="org-sand text-foreground-secondary"><tr>{['Reference', 'Type', 'Buyer', 'Items', 'Total (approx.)'].map(h => <th key={h} className="px-3 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border-default">
                  {parsed!.docs.slice(0, 5).map(d => (
                    <tr key={d.reference}><td className="px-3 py-1.5">{d.reference}</td><td className="px-3 py-1.5 capitalize">{d.type.replace('_', ' ')}</td><td className="px-3 py-1.5">{d.buyer?.name ?? '—'}</td><td className="px-3 py-1.5">{d.items.length}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmt(d.items.reduce((s: number, i: any) => s + i.quantity * i.unit_price - (i.discount ?? 0), 0))}</td></tr>
                  ))}
                </tbody>
              </table>
              {parsed!.docs.length > 5 && <p className="px-3 py-1.5 text-xs text-foreground-muted">…and {parsed!.docs.length - 5} more</p>}
            </div>
          )}
          {errors.length > 0 && (
            <div className="rounded-lg bg-[#f6d5cc]/60 p-3 text-xs text-[#8a2e1f]">
              <div className="mb-1 font-semibold">{errors.length} problem{errors.length > 1 ? 's' : ''} — fix the CSV and upload again</div>
              <ul className="list-disc space-y-0.5 pl-4">{errors.slice(0, 8).map(e => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className={`text-xs ${cost > balance ? 'text-[#8a2e1f]' : 'text-foreground-muted'}`}>
              Cost about {fmt(cost)} · wallet {fmt(balance)}{cost > balance ? ' — top up, or the job stops part-way' : ''}
            </span>
            <button type="button" disabled={busy || !parsed!.docs.length || parsed!.errors.length > 0 || parsed!.docs.length > 1000} onClick={start}
              className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Render {parsed!.docs.length} documents
            </button>
          </div>
        </div>
      )}
    </Card>
  )

  return (
    <BulkJobs
      base={BASE}
      form={form}
      refreshKey={refresh}
      columns={['Reference', 'Document', 'Total', '']}
      row={(it: BulkItem) => [
        <span key="r" className="text-xs">{it.reference ?? '—'}</span>,
        it.result ? <span key="n" className="font-mono text-xs">{it.result.number}<span className="ml-1.5 font-sans capitalize text-foreground-muted">{it.result.type.replace('_', ' ')}</span></span> : '—',
        it.result ? <span key="t" className="tabular-nums">{fmt(it.result.totals.total)}</span> : '—',
        it.result ? <span key="l" className="space-x-3 text-xs"><a href={it.result.view_url} target="_blank" rel="noreferrer" className="font-semibold org-brown hover:underline">View</a><a href={it.result.pdf_url} target="_blank" rel="noreferrer" className="font-semibold org-brown hover:underline">PDF</a></span> : null,
      ]}
    />
  )
}
