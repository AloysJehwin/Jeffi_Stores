'use client'

import type { StaffNoteDraft } from '@/app/(portal)/staff/notes/_lib/useStaffNoteDraft'

const inputClass =
  'w-full px-4 py-3 border border-border-secondary rounded-xl bg-surface text-foreground text-base placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'

export default function StaffCustomerPicker({ d, autoFocus = false }: { d: StaffNoteDraft; autoFocus?: boolean }) {
  if (d.customer) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-accent-500 bg-accent-500/5 p-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{d.customer.name}</p>
          <p className="text-xs text-foreground-muted truncate">
            {[d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={d.clearCustomer} className="text-xs text-accent-600 hover:underline shrink-0">
          Change
        </button>
      </div>
    )
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          value={d.query}
          onChange={e => d.setQuery(e.target.value)}
          placeholder="Name, phone, email or order number"
          className={inputClass}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => d.setScanning(true)}
          className="px-3 rounded-xl border border-border-secondary text-xs font-medium shrink-0"
        >
          Scan
        </button>
      </div>
      {(d.results.length > 0 || d.searching) && (
        <ul className="mt-2 rounded-xl border border-border-default divide-y divide-border-default overflow-hidden bg-surface-elevated">
          {d.searching && d.results.length === 0 && (
            <li className="px-3 py-2 text-xs text-foreground-muted">Searching…</li>
          )}
          {d.results.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => d.selectCustomer(c)}
                className="w-full text-left px-3 py-2.5 hover:bg-surface-secondary"
              >
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-foreground-muted">
                  {[c.phone, c.email, c.lastOrderNumber ? `Last order ${c.lastOrderNumber}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
