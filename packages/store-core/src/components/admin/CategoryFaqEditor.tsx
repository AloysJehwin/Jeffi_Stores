'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { FormButton, TextArea, TextInput, useActionToast } from '@/components/admin/kit'

interface FaqRow {
  id?: string
  question: string
  answer: string
  published?: boolean
}

/** Category FAQs, saved on their own through /api/admin/categories/[id]/faqs (not part of the draft). */
export default function CategoryFaqEditor({ categoryId, disabled }: { categoryId: string; disabled?: boolean }) {
  const [rows, setRows] = useState<FaqRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const toast = useActionToast()
  const url = `/api/admin/categories/${categoryId}/faqs`

  useEffect(() => {
    let on = true
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load FAQs'))))
      .then(d => on && setRows(Array.isArray(d.faqs) ? d.faqs : []))
      .catch(e => on && toast.error(e.message))
      .finally(() => on && setLoading(false))
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const update = (fn: (r: FaqRow[]) => FaqRow[]) => {
    setRows(fn)
    setDirty(true)
  }
  const move = (i: number, d: number) =>
    update(r => {
      const j = i + d
      if (j < 0 || j >= r.length) return r
      const n = [...r]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ faqs: rows }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save FAQs')
      setRows(d.faqs ?? rows)
      setDirty(false)
      toast.success('FAQs saved')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const set = (i: number, patch: Partial<FaqRow>) => update(rs => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-foreground-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading FAQs…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-foreground-muted">No FAQs. Shown on the category page under the products.</p>
      ) : null}
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="rounded-lg border border-border-default p-3 space-y-2">
          <div className="flex items-start gap-2">
            <TextInput value={r.question} disabled={disabled} maxLength={300} onChange={e => set(i, { question: e.target.value })} placeholder="Question" />
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" title="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="p-1.5 text-foreground-muted hover:text-foreground disabled:opacity-30">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button type="button" title="Move down" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-foreground-muted hover:text-foreground disabled:opacity-30">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button type="button" title="Remove" disabled={disabled} onClick={() => update(rs => rs.filter((_, j) => j !== i))} className="p-1.5 text-foreground-muted hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <TextArea value={r.answer} disabled={disabled} rows={2} maxLength={2000} onChange={e => set(i, { answer: e.target.value })} placeholder="Answer" className="resize-y" />
          <label className="flex items-center gap-2 text-xs text-foreground-secondary">
            <input type="checkbox" checked={r.published !== false} disabled={disabled} onChange={e => set(i, { published: e.target.checked })} />
            Show on the category page
          </label>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => update(rs => [...rs, { question: '', answer: '', published: true }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add question
        </button>
        <RequireWrite scope="categories:write">
          <FormButton type="button" variant="secondary" onClick={save} disabled={disabled || loading || !dirty} pending={saving} pendingLabel="Saving…">
            Save FAQs
          </FormButton>
        </RequireWrite>
      </div>
    </div>
  )
}
