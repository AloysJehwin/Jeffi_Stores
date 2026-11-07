'use client'

import AdminSelect from '@/components/admin/AdminSelect'

// Maps an uploaded report's headers onto our fields: one select per field with a sample value from
// the file. Shared by the marketplace report imports (ads, settlements).

export interface MapperField {
  key: string
  label: string
  required?: boolean
  hint?: string
}

export type ColumnMapping = Record<string, string | null | undefined>

export default function ColumnMapper({
  fields,
  headers,
  value,
  onChange,
  samples = {},
  disabled,
}: {
  fields: MapperField[]
  headers: string[]
  value: ColumnMapping
  onChange: (next: Record<string, string | null>) => void
  samples?: Record<string, string>
  disabled?: boolean
}) {
  const options = [{ value: '', label: 'Not in this file' }, ...headers.map(h => ({ value: h, label: h }))]
  const counts = new Map<string, number>()
  for (const f of fields) {
    const h = value[f.key]
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  const set = (key: string, header: string) => {
    const next: Record<string, string | null> = {}
    for (const f of fields) next[f.key] = value[f.key] || null
    next[key] = header || null
    onChange(next)
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(f => {
        const h = value[f.key] || ''
        const dup = !!h && (counts.get(h) ?? 0) > 1
        const missing = f.required && !h
        return (
          <div key={f.key} className="min-w-0 space-y-1">
            <AdminSelect
              sm
              label={`${f.label}${f.required ? ' *' : ''}`}
              value={h}
              options={options}
              disabled={disabled}
              onChange={v => set(f.key, v)}
              error={missing ? 'Required' : dup ? 'Also mapped to another field' : undefined}
            />
            {h && samples[h] != null ? (
              <p className="truncate text-[11px] text-foreground-muted" title={samples[h]}>
                e.g. {samples[h]}
              </p>
            ) : f.hint ? (
              <p className="text-[11px] text-foreground-muted">{f.hint}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
