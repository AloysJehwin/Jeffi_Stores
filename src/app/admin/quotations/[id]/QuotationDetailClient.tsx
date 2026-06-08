'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Pencil, X, Check, Plus, Trash2 } from 'lucide-react'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-surface-secondary text-foreground-secondary',
  final:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
}

const STATUSES = ['draft', 'final', 'accepted', 'rejected', 'expired']

function inputCls(extra = '') {
  return `w-full rounded-lg border border-border-default bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 ${extra}`
}

function calcTotals(items: any[]) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.rate)), 0)
  const cgst = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.rate) * Number(i.gst_rate) / 200), 0)
  const sgst = cgst
  const total = Math.round(subtotal + cgst + sgst)
  return { subtotal, cgst_amount: cgst, sgst_amount: sgst, total_amount: total }
}

export default function QuotationDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Edit state mirrors the quotation fields
  const [fields, setFields] = useState<any>({})
  const [editItems, setEditItems] = useState<any[]>([])

  useEffect(() => {
    fetch(`/api/admin/quotations/${id}`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  function enterEdit() {
    const q = data.quotation
    setFields({
      quote_date: q.quote_date ? q.quote_date.slice(0, 10) : '',
      status: q.status,
      consignee_name: q.consignee_name || '',
      consignee_email: q.consignee_email || '',
      consignee_phone: q.consignee_phone || '',
      consignee_gstin: q.consignee_gstin || '',
      consignee_addr1: q.consignee_addr1 || '',
      consignee_addr2: q.consignee_addr2 || '',
      consignee_city: q.consignee_city || '',
      consignee_state: q.consignee_state || '',
      consignee_pincode: q.consignee_pincode || '',
      buyer_same: q.buyer_same ?? true,
      buyer_name: q.buyer_name || '',
      buyer_email: q.buyer_email || '',
      buyer_phone: q.buyer_phone || '',
      buyer_gstin: q.buyer_gstin || '',
      buyer_addr1: q.buyer_addr1 || '',
      buyer_addr2: q.buyer_addr2 || '',
      buyer_city: q.buyer_city || '',
      buyer_state: q.buyer_state || '',
      buyer_pincode: q.buyer_pincode || '',
      notes: q.notes || '',
    })
    setEditItems((data.items || []).map((item: any) => ({
      description: item.description || '',
      hsn_code: item.hsn_code || '',
      gst_rate: item.gst_rate ?? 18,
      quantity: item.quantity ?? 1,
      unit: item.unit || 'PCS',
      rate: item.rate ?? 0,
      discount_pct: item.discount_pct ?? 0,
      product_id: item.product_id || null,
      variant_id: item.variant_id || null,
      sub_variant_id: item.sub_variant_id || null,
    })))
    setSaveError(null)
    setEditMode(true)
  }

  function cancelEdit() {
    setEditMode(false)
    setSaveError(null)
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        ...fields,
        buyer_same: fields.buyer_same,
        ...(fields.buyer_same ? {
          buyer_name: null, buyer_email: null, buyer_phone: null, buyer_gstin: null,
          buyer_addr1: null, buyer_addr2: null, buyer_city: null, buyer_state: null, buyer_pincode: null,
        } : {}),
        items: editItems.map(i => ({
          ...i,
          quantity: Number(i.quantity),
          rate: Number(i.rate),
          gst_rate: Number(i.gst_rate),
          discount_pct: Number(i.discount_pct),
        })),
      }
      const res = await fetch(`/api/admin/quotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setData(json)
      setEditMode(false)
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function setField(key: string, val: any) {
    setFields((prev: any) => ({ ...prev, [key]: val }))
  }

  function setItem(idx: number, key: string, val: any) {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [key]: val } : item))
  }

  function addItem() {
    setEditItems(prev => [...prev, {
      description: '', hsn_code: '', gst_rate: 18, quantity: 1, unit: 'PCS',
      rate: 0, discount_pct: 0, product_id: null, variant_id: null, sub_variant_id: null,
    }])
  }

  function removeItem(idx: number) {
    setEditItems(prev => prev.filter((_, i) => i !== idx))
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data?.quotation) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Quotation not found.</p>
        <Link href="/admin/quotations" className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Quotations</Link>
      </div>
    )
  }

  const q = data.quotation
  const items: any[] = data.items || []
  const previewTotals = editMode ? calcTotals(editItems) : null

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <a href="/admin/quotations" className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Quotations
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Quotation #{q.quote_number}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground font-mono">{q.quote_number}</h1>
          {editMode ? (
            <select
              value={fields.status}
              onChange={e => setField('status', e.target.value)}
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[q.status] || 'bg-surface-secondary text-foreground-secondary'}`}>
              {q.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={enterEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
              <a
                href={`/api/admin/quotations/${q.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </a>
              {q.converted_order_id && (
                <a
                  href={`/admin/invoices/${q.converted_order_id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
                >
                  View Invoice →
                </a>
              )}
              <Link
                href="/admin/quotations"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
              >
                ← All Quotations
              </Link>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
          {saveError}
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Quotation Details */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Quotation Details</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary shrink-0">Quote #</span>
              <span className="font-mono font-medium text-foreground">{q.quote_number}</span>
            </div>
            <div className="flex justify-between gap-4 items-center">
              <span className="text-foreground-secondary shrink-0">Date</span>
              {editMode ? (
                <input type="date" value={fields.quote_date} onChange={e => setField('quote_date', e.target.value)} className={inputCls('text-right')} />
              ) : (
                <span className="text-foreground">{formatDate(q.quote_date || q.created_at)}</span>
              )}
            </div>
            <div className="flex justify-between gap-4 items-center">
              <span className="text-foreground-secondary shrink-0">Status</span>
              {editMode ? (
                <select value={fields.status} onChange={e => setField('status', e.target.value)} className={inputCls()}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <span className="capitalize text-foreground">{q.status}</span>
              )}
            </div>
            {q.converted_order_id && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Converted</span>
                <a href={`/admin/invoices/${q.converted_order_id}`} className="text-green-600 dark:text-green-400 text-xs font-medium hover:underline">
                  View Invoice ↗
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Consignee */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Consignee</p>
          {editMode ? (
            <div className="space-y-2">
              {[
                { key: 'consignee_name',    label: 'Name',    type: 'text' },
                { key: 'consignee_email',   label: 'Email',   type: 'email' },
                { key: 'consignee_phone',   label: 'Phone',   type: 'text' },
                { key: 'consignee_gstin',   label: 'GSTIN',   type: 'text' },
                { key: 'consignee_addr1',   label: 'Addr 1',  type: 'text' },
                { key: 'consignee_addr2',   label: 'Addr 2',  type: 'text' },
                { key: 'consignee_city',    label: 'City',    type: 'text' },
                { key: 'consignee_state',   label: 'State',   type: 'text' },
                { key: 'consignee_pincode', label: 'Pincode', type: 'text' },
              ].map(({ key, label, type }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-foreground-secondary text-xs w-14 shrink-0">{label}</span>
                  <input type={type} value={fields[key]} onChange={e => setField(key, e.target.value)} className={inputCls()} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {q.consignee_name && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">Name</span><span className="font-medium text-foreground text-right">{q.consignee_name}</span></div>}
              {q.consignee_phone && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">Phone</span><span className="text-foreground">{q.consignee_phone}</span></div>}
              {q.consignee_email && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">Email</span><span className="text-foreground text-right text-xs">{q.consignee_email}</span></div>}
              {q.consignee_gstin && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">GSTIN</span><span className="font-mono text-xs text-foreground">{q.consignee_gstin}</span></div>}
              {q.consignee_addr1 && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary shrink-0">Address</span>
                  <span className="text-foreground text-right text-xs">
                    {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buyer */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Buyer</p>
            {editMode && (
              <label className="flex items-center gap-1.5 text-xs text-foreground-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={fields.buyer_same}
                  onChange={e => setField('buyer_same', e.target.checked)}
                  className="rounded border-border-default accent-accent-500"
                />
                Same as consignee
              </label>
            )}
          </div>
          {editMode ? (
            fields.buyer_same ? (
              <p className="text-sm text-foreground-secondary italic">Same as consignee</p>
            ) : (
              <div className="space-y-2">
                {[
                  { key: 'buyer_name',    label: 'Name',    type: 'text' },
                  { key: 'buyer_email',   label: 'Email',   type: 'email' },
                  { key: 'buyer_phone',   label: 'Phone',   type: 'text' },
                  { key: 'buyer_gstin',   label: 'GSTIN',   type: 'text' },
                  { key: 'buyer_addr1',   label: 'Addr 1',  type: 'text' },
                  { key: 'buyer_addr2',   label: 'Addr 2',  type: 'text' },
                  { key: 'buyer_city',    label: 'City',    type: 'text' },
                  { key: 'buyer_state',   label: 'State',   type: 'text' },
                  { key: 'buyer_pincode', label: 'Pincode', type: 'text' },
                ].map(({ key, label, type }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-foreground-secondary text-xs w-14 shrink-0">{label}</span>
                    <input type={type} value={fields[key]} onChange={e => setField(key, e.target.value)} className={inputCls()} />
                  </div>
                ))}
              </div>
            )
          ) : (
            !q.buyer_same && q.buyer_name ? (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4"><span className="text-foreground-secondary">Name</span><span className="font-medium text-foreground text-right">{q.buyer_name}</span></div>
                {q.buyer_phone && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">Phone</span><span className="text-foreground">{q.buyer_phone}</span></div>}
                {q.buyer_gstin && <div className="flex justify-between gap-4"><span className="text-foreground-secondary">GSTIN</span><span className="font-mono text-xs text-foreground">{q.buyer_gstin}</span></div>}
                {q.buyer_addr1 && (
                  <div className="flex justify-between gap-4">
                    <span className="text-foreground-secondary shrink-0">Address</span>
                    <span className="text-foreground text-right text-xs">
                      {[q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state, q.buyer_pincode].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-foreground-secondary italic">Same as consignee</p>
            )
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Line Items</p>
          {editMode && (
            <button
              onClick={addItem}
              className="inline-flex items-center gap-1 text-xs text-accent-500 hover:text-accent-600 font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Item</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">HSN</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">GST%</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Unit</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Rate</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Disc%</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amount</th>
                {editMode && <th className="px-2 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {editMode ? editItems.map((item: any, idx: number) => {
                const amt = Number(item.quantity) * Number(item.rate)
                return (
                  <tr key={idx} className="bg-surface">
                    <td className="px-2 py-2">
                      <input value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} placeholder="Description" className={inputCls('min-w-[180px]')} />
                    </td>
                    <td className="px-2 py-2">
                      <input value={item.hsn_code} onChange={e => setItem(idx, 'hsn_code', e.target.value)} placeholder="HSN" className={inputCls('w-20 text-center font-mono')} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.gst_rate} onChange={e => setItem(idx, 'gst_rate', e.target.value)} className={inputCls('w-14 text-center')} />
                    </td>
                    <td className="px-2 py-2">
                      <input value={item.unit} onChange={e => setItem(idx, 'unit', e.target.value)} className={inputCls('w-14 text-center')} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} className={inputCls('w-14 text-center')} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.rate} onChange={e => setItem(idx, 'rate', e.target.value)} className={inputCls('w-24 text-right')} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.discount_pct} onChange={e => setItem(idx, 'discount_pct', e.target.value)} className={inputCls('w-14 text-right')} />
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-foreground whitespace-nowrap">
                      {formatINR(amt)}
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => removeItem(idx)} className="text-foreground-muted hover:text-red-500 transition-colors p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              }) : items.map((item: any, idx: number) => (
                <tr key={idx} className="hover:bg-surface-secondary/40 transition-colors">
                  <td className="px-4 py-3"><div className="font-medium text-foreground">{item.description}</div></td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary font-mono">{item.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.gst_rate}%</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.unit || 'PCS'}</td>
                  <td className="px-4 py-3 text-center text-foreground">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(item.rate))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">{item.discount_pct ? `${item.discount_pct}%` : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(item.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border-t border-border-default px-4 py-3">
          <div className="ml-auto max-w-xs space-y-1.5 text-sm">
            {(() => {
              const sub = editMode ? previewTotals!.subtotal : parseFloat(q.subtotal || '0')
              const cgst = editMode ? previewTotals!.cgst_amount : parseFloat(q.cgst_amount || '0')
              const sgst = editMode ? previewTotals!.sgst_amount : parseFloat(q.sgst_amount || '0')
              const total = editMode ? previewTotals!.total_amount : parseFloat(q.total_amount || '0')
              return (
                <>
                  <div className="flex justify-between gap-8"><span className="text-foreground-secondary">Subtotal</span><span className="text-foreground">{formatINR(sub)}</span></div>
                  {cgst > 0 && <div className="flex justify-between gap-8"><span className="text-foreground-secondary">CGST</span><span className="text-foreground">{formatINR(cgst)}</span></div>}
                  {sgst > 0 && <div className="flex justify-between gap-8"><span className="text-foreground-secondary">SGST</span><span className="text-foreground">{formatINR(sgst)}</span></div>}
                  <div className="flex justify-between gap-8 pt-1.5 border-t border-border-default">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold text-foreground text-base">{formatINR(total)}</span>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Notes</p>
        {editMode ? (
          <textarea
            value={fields.notes}
            onChange={e => setField('notes', e.target.value)}
            rows={3}
            placeholder="Add notes…"
            className={inputCls('resize-y')}
          />
        ) : (
          q.notes ? (
            <p className="text-sm text-foreground whitespace-pre-line">{q.notes}</p>
          ) : (
            <p className="text-sm text-foreground-muted italic">No notes</p>
          )
        )}
      </div>
    </div>
  )
}
