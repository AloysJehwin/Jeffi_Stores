'use client'

// Review AI proposals for brand / category fields. Written copy is ticked by default; facts start
// unticked until the admin checks them (lib/catalog/entity-enrichment.ts).
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Loader2, Play, XCircle } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { EmptyState, badgeCls, fetchJson } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'

interface ProposedField {
  key: string
  label: string
  role: 'draft' | 'suggest'
  value: unknown
  current: unknown
  source: string | null
}

interface Proposal {
  id: string
  entityType: 'brand' | 'category'
  entityId: string
  entityName: string | null
  status: string
  error: string | null
  proposedAt: string
  faqs: Array<{ question: string; answer: string }>
  fields: ProposedField[]
}

const show = (v: unknown) =>
  v == null || v === ''
    ? '—'
    : Array.isArray(v)
      ? v.join(', ')
      : typeof v === 'object'
        ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`).join(' · ')
        : String(v)

export default function EntityEnrichmentPanel() {
  const { showToast } = useToast()
  const [type, setType] = useState<'all' | 'brand' | 'category'>('all')
  const [status, setStatus] = useState('proposed')
  const [items, setItems] = useState<Proposal[] | null>(null)
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, ...(type !== 'all' ? { type } : {}) })
    try {
      const data = await fetchJson<{ proposals: Proposal[] }>(`/api/admin/catalog-enrichment/entities?${qs}`)
      setItems(data.proposals)
      setPicked(Object.fromEntries(data.proposals.map(p => [p.id, new Set(p.fields.filter(f => f.role === 'draft').map(f => f.key))])))
    } catch (err: any) {
      showToast(err?.message || 'Could not load proposals', 'error')
      setItems([])
    }
  }, [type, status, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (t: 'brand' | 'category') => {
    setBusy(`run-${t}`)
    try {
      const data = await fetchJson<{ message: string }>('/api/admin/catalog-enrichment/entities', undefined, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: t }),
      })
      showToast(data.message, 'success')
    } catch (err: any) {
      showToast(err?.message || 'Run failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const decide = async (p: Proposal, action: 'approve' | 'reject') => {
    setBusy(p.id)
    try {
      const data = await fetchJson<{ applied?: string[]; faqsAdded?: number }>(`/api/admin/catalog-enrichment/entities/${p.id}`, undefined, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, fields: [...(picked[p.id] ?? [])] }),
      })
      showToast(
        action === 'approve'
          ? `Saved ${data.applied?.length ?? 0} field(s)${data.faqsAdded ? ` and ${data.faqsAdded} FAQs` : ''} on ${p.entityName}`
          : `Rejected suggestions for ${p.entityName}`,
        'success'
      )
      setItems(prev => (prev ?? []).filter(x => x.id !== p.id))
    } catch (err: any) {
      showToast(err?.message || 'Failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: string, key: string) =>
    setPicked(prev => {
      const next = new Set(prev[id] ?? [])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...prev, [id]: next }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <AdminSelect
            sm
            value={type}
            onChange={v => setType(v as typeof type)}
            options={[
              { value: 'all', label: 'Brands and categories' },
              { value: 'brand', label: 'Brands' },
              { value: 'category', label: 'Categories' },
            ]}
          />
          <AdminSelect
            sm
            value={status}
            onChange={setStatus}
            options={[
              { value: 'proposed', label: 'To review' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </div>
        <RequireWrite scope="catalog_enrichment:write">
          <div className="flex gap-2">
            {(['brand', 'category'] as const).map(t => (
              <button
                key={t}
                onClick={() => run(t)}
                disabled={!!busy}
                className="control-md bg-surface-elevated hover:bg-surface-secondary text-foreground border border-border-default font-semibold disabled:opacity-50"
              >
                {busy === `run-${t}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Enrich {t === 'brand' ? 'brands' : 'categories'}
              </button>
            ))}
          </div>
        </RequireWrite>
      </div>

      {items == null ? (
        <div className="flex justify-center py-10 text-foreground-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={status === 'proposed' ? 'Nothing to review' : 'No proposals'}
          body="Run enrichment to have AI suggest taglines, stories, SEO copy, HSN and other empty fields."
        />
      ) : (
        items.map(p => (
          <div key={p.id} className="rounded-xl border border-border-default bg-surface-elevated">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={badgeCls(p.entityType === 'brand' ? 'blue' : 'green')}>{p.entityType}</span>
                <a
                  href={ap(`/admin/${p.entityType === 'brand' ? 'brands' : 'categories'}/${p.entityId}/edit`)}
                  className="truncate text-sm font-semibold text-foreground hover:text-accent-500"
                >
                  {p.entityName ?? p.entityId}
                </a>
                {p.error && <span className={badgeCls('red')}>{p.error}</span>}
              </div>
              {p.status === 'proposed' && (
                <RequireWrite scope="catalog_enrichment:write">
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(p, 'approve')}
                      disabled={busy === p.id || !(picked[p.id]?.size || p.faqs.length)}
                      className="control-md bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50"
                    >
                      {busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      Save selected
                    </button>
                    <button
                      onClick={() => decide(p, 'reject')}
                      disabled={busy === p.id}
                      className="control-md bg-surface-elevated hover:bg-surface-secondary text-foreground border border-border-default font-semibold disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </RequireWrite>
              )}
            </div>
            <div className="divide-y divide-border-default">
              {p.fields.map(f => (
                <label key={f.key} className="flex gap-3 px-4 py-2.5 text-sm">
                  {p.status === 'proposed' && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked[p.id]?.has(f.key) ?? false}
                      onChange={() => toggle(p.id, f.key)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{f.label}</span>
                      {f.role === 'suggest' && <span className={badgeCls('amber')}>check this</span>}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-foreground-secondary">{show(f.value)}</p>
                    {f.source && <p className="mt-0.5 text-xs text-foreground-muted">Why: {f.source}</p>}
                    {f.current != null && f.current !== '' && (
                      <p className="mt-0.5 text-xs text-foreground-muted">Now: {show(f.current)} (kept; only empty fields are filled)</p>
                    )}
                  </div>
                </label>
              ))}
              {p.faqs.length > 0 && (
                <div className="px-4 py-2.5 text-sm">
                  <p className="font-medium text-foreground">FAQs ({p.faqs.length}), added when you save</p>
                  <ul className="mt-1 space-y-1 text-foreground-secondary">
                    {p.faqs.map((q, i) => (
                      <li key={i}>
                        <span className="font-medium">{q.question}</span> {q.answer}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
