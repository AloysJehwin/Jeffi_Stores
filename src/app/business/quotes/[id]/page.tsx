'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { bp } from '@/lib/business-path'

interface RFQItem {
  id: string
  description: string
  quantity: number
  unit: string
  requested_price: number | null
  notes: string | null
}

interface RFQItemEdit {
  id: string
  quantity: number | ''
  requested_price: number | '' | null
  notes: string
}

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  admin_note: string | null
  created_at: string
  converted_quotation_id: string | null
  quotation_view_token: string | null
  quote_number: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/20 text-yellow-600 dark:text-yellow-300',
  reviewed:  'bg-blue-400/20 text-blue-600 dark:text-blue-300',
  converted: 'bg-green-400/20 text-green-600 dark:text-green-300',
  rejected:  'bg-red-400/20 text-red-600 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pending Review',
  reviewed:  'Under Review',
  converted: 'Quotation Ready',
  rejected:  'Rejected',
}

const EDITABLE_STATUSES = ['pending', 'reviewed']

export default function BusinessRFQDetail({ params }: { params: { id: string } }) {
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editItems, setEditItems] = useState<RFQItemEdit[]>([])
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = () => {
    setLoading(true)
    fetch(`/api/business/rfqs/${params.id}`)
      .then(r => r.json())
      .then(d => {
        setRfq(d.rfq)
        setItems(d.items || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [params.id])

  const startEdit = () => {
    setEditItems(items.map(item => ({
      id: item.id,
      quantity: item.quantity,
      requested_price: item.requested_price,
      notes: item.notes || '',
    })))
    setEditNotes(rfq?.notes || '')
    setSaveError('')
    setSaved(false)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setSaveError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/business/rfqs/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: editNotes || null,
          items: editItems.map(item => ({
            id: item.id,
            quantity: item.quantity === '' ? null : Number(item.quantity),
            requested_price: item.requested_price === '' || item.requested_price == null ? null : Number(item.requested_price),
            notes: item.notes || null,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setSaveError(d.error || 'Failed to save')
        return
      }
      setSaved(true)
      setEditing(false)
      load()
    } catch {
      setSaveError('Network error, please try again')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
    </div>
  )

  if (!rfq) return <div className="text-center text-foreground-muted py-16">Quote not found.</div>

  const canEdit = EDITABLE_STATUSES.includes(rfq.status)
  const totalRequested = items.reduce((sum, i) => sum + (i.requested_price ? Number(i.requested_price) * i.quantity : 0), 0)

  return (
    <div className="max-w-3xl space-y-5 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={bp('/business/quotes')} className="text-accent-500 hover:text-accent-600 transition-colors">My Quotes</Link>
        <span>/</span>
        <span className="text-foreground font-mono">{rfq.rfq_number}</span>
      </div>

      {/* Header card */}
      <div className="bg-zinc-800 rounded-2xl p-5 text-white border border-zinc-700">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold font-mono">{rfq.rfq_number}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                {STATUS_LABEL[rfq.status] || rfq.status}
              </span>
            </div>
            <p className="text-zinc-400 text-xs mt-1">
              Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          {rfq.status === 'converted' && rfq.quotation_view_token && (
            <a
              href={`https://quotation.jeffistores.in/${rfq.quotation_view_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-accent-500 text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-900/20 transition-colors shrink-0"
            >
              View Quotation →
            </a>
          )}
        </div>

        {rfq.admin_note && (
          <div className={`mt-4 rounded-lg p-3 text-sm ${rfq.status === 'rejected' ? 'bg-red-900/30 border border-red-800 text-red-300' : 'bg-blue-900/30 border border-blue-800 text-blue-300'}`}>
            <p className="font-semibold mb-1">{rfq.status === 'rejected' ? 'Reason for rejection:' : 'Note from our team:'}</p>
            <p className="font-normal">{rfq.admin_note}</p>
          </div>
        )}
      </div>

      {/* Save success banner */}
      {saved && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Changes saved successfully.
        </div>
      )}

      {/* Items table */}
      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Requested Items</h2>
          {canEdit && !editing && (
            <button
              onClick={startEdit}
              className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-3 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
            >
              Edit Request
            </button>
          )}
        </div>

        {!editing ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted w-8">#</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted">Description</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Qty</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Target Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {items.map((item, i) => (
                <tr key={item.id}>
                  <td className="px-5 py-3.5 text-foreground-muted font-mono text-xs">{i + 1}</td>
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-foreground">{item.description}</p>
                    {item.notes && <p className="text-xs text-foreground-muted italic mt-0.5">{item.notes}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-right text-foreground">
                    {item.quantity} <span className="text-foreground-muted text-xs">{item.unit}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-foreground">
                    {item.requested_price != null
                      ? `₹${Number(item.requested_price).toLocaleString('en-IN')}`
                      : <span className="text-foreground-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {totalRequested > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border-default bg-surface-secondary/40">
                  <td colSpan={3} className="px-5 py-3 text-right text-sm font-semibold text-foreground-secondary">Total Target Value</td>
                  <td className="px-5 py-3 text-right font-bold text-foreground">₹{totalRequested.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            )}
          </table>
        ) : (
          <div className="divide-y divide-border-default">
            {editItems.map((item, i) => {
              const orig = items[i]
              return (
                <div key={item.id} className="p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-foreground-muted font-mono mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                    <p className="font-medium text-foreground text-sm">{orig.description}</p>
                  </div>
                  <div className="pl-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-muted mb-1">Quantity <span className="text-foreground-secondary">({orig.unit})</span></label>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, quantity: e.target.value === '' ? '' : Number(e.target.value) } : it))}
                        className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-muted mb-1">Target Price (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="Optional"
                        value={item.requested_price ?? ''}
                        onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, requested_price: e.target.value === '' ? null : Number(e.target.value) } : it))}
                        className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-foreground-muted mb-1">Item Notes</label>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={item.notes}
                        onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, notes: e.target.value } : it))}
                        className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notes section */}
      {!editing ? (
        rfq.notes && (
          <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Your Notes</h2>
            <p className="text-sm text-foreground">{rfq.notes}</p>
          </div>
        )
      ) : (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Overall Notes</label>
          <textarea
            rows={3}
            placeholder="Any additional notes for this request…"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500 resize-none"
          />
        </div>
      )}

      {/* Sticky save/cancel bar */}
      {editing && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface-elevated border-t border-border-default px-4 py-3 flex items-center gap-3 shadow-lg">
          {saveError && <p className="text-xs text-red-600 dark:text-red-400 flex-1">{saveError}</p>}
          {!saveError && <span className="flex-1 text-xs text-foreground-muted">Review your changes before saving</span>}
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-border-secondary text-foreground-secondary text-sm font-medium hover:bg-surface-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
