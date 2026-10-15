'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

interface CategoryRow {
  categoryId: string
  name: string
  parentId: string | null
  parentName: string | null
  products: number
  days: number | null
}

const inputClass =
  'field-sm w-32 border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent disabled:opacity-60'

// Which categories are consumables, and how often they're typically reordered. The Replenishment
// campaign only reminds customers about products in a category with a value here (or its parent's).
export default function ReorderIntervalsPanel() {
  const { showToast } = useToast()
  const canWrite = useCanWrite('campaigns')
  const [rows, setRows] = useState<CategoryRow[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = (categories: CategoryRow[]) => {
    setRows(categories)
    setValues(Object.fromEntries(categories.map(c => [c.categoryId, c.days == null ? '' : String(c.days)])))
  }

  useEffect(() => {
    fetch('/api/admin/campaigns/reorder-intervals', { credentials: 'include' })
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || 'Could not load the categories')
        load(body.categories)
      })
      .catch(err => setError(err.message))
  }, [])

  const parentDays = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows ?? []) map.set(row.categoryId, values[row.categoryId] ?? '')
    return map
  }, [rows, values])

  const changed = (rows ?? []).filter(row => (values[row.categoryId] ?? '') !== (row.days == null ? '' : String(row.days)))
  const invalid = changed.some(row => {
    const text = values[row.categoryId] ?? ''
    if (text === '') return false
    const n = Number(text)
    return !Number.isInteger(n) || n < 1 || n > 365
  })
  const consumables = (rows ?? []).filter(row => (values[row.categoryId] ?? '') !== '').length

  const save = async () => {
    if (saving || invalid || changed.length === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/campaigns/reorder-intervals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          intervals: changed.map(row => {
            const text = values[row.categoryId] ?? ''
            return { categoryId: row.categoryId, days: text === '' ? null : Number(text) }
          }),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showToast(body?.error || 'Could not save the reorder intervals', 'error')
        return
      }
      load(body.categories)
      showToast('Reorder intervals saved', 'success')
    } catch {
      showToast('Could not save the reorder intervals', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default">
      <div className="p-4 sm:p-5 border-b border-border-default space-y-1">
        <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Reorder intervals</h2>
        <p className="text-sm text-foreground-secondary">
          Set how often customers typically rebuy from a category, for things that get used up (screws, drill bits,
          belts). Leave tools and other one-off buys empty: nobody is reminded about them. A subcategory without its own
          value uses its parent&apos;s.
        </p>
        {rows && (
          <p className="text-xs text-foreground-muted">
            {consumables === 0
              ? 'No categories set yet, so this campaign has nobody to remind.'
              : `${consumables} ${consumables === 1 ? 'category' : 'categories'} set as consumables.`}
          </p>
        )}
      </div>

      {error ? (
        <p className="p-6 text-sm text-red-600">{error}</p>
      ) : !rows ? (
        <div className="p-4 space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-surface-secondary" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-foreground-muted">No categories yet.</p>
      ) : (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-elevated">
              <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium text-right">Products</th>
                <th className="px-4 py-2 font-medium">Reorder every (days)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const inherited = row.parentId ? parentDays.get(row.parentId) : ''
                return (
                  <tr key={row.categoryId} className="border-t border-border-default">
                    <td className={`px-4 py-2 ${row.parentId ? 'pl-8 text-foreground-secondary' : 'font-medium text-foreground'}`}>
                      {row.name}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground-secondary tabular-nums">{row.products}</td>
                    <td className="px-4 py-2">
                      <input
                        inputMode="numeric"
                        aria-label={`${row.name} reorder interval in days`}
                        value={values[row.categoryId] ?? ''}
                        onChange={e =>
                          setValues(v => ({ ...v, [row.categoryId]: e.target.value.replace(/\D/g, '').slice(0, 3) }))
                        }
                        placeholder={inherited ? `${inherited} (parent)` : '—'}
                        disabled={!canWrite}
                        className={inputClass}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="p-4 flex flex-wrap items-center gap-3 border-t border-border-default">
          {canWrite ? (
            <button
              type="button"
              onClick={save}
              disabled={saving || invalid || changed.length === 0}
              className="control-sm bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving' : 'Save intervals'}
            </button>
          ) : (
            <p className="text-xs text-foreground-muted">Read-only access: these settings cannot be changed.</p>
          )}
          {invalid && <p className="text-xs text-red-500">Use a whole number of days from 1 to 365.</p>}
        </div>
      )}
    </div>
  )
}
