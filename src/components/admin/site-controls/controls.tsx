'use client'

import { useState, ReactNode } from 'react'
import { useToast } from '@/contexts/ToastContext'
import Toggle from '@/components/ui/Toggle'

// Shared auto-save form primitives for the Site Controls page. Each field saves
// to PATCH /api/admin/settings on blur (text/number) or on change (toggle),
// mirroring DeliverySettingsForm's pattern.

async function patchSetting(key: string, value: string | number | boolean): Promise<boolean> {
  const res = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      key,
      value: typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
    }),
  })
  return res.ok
}

export function SectionCard({ title, description, children, columns }: { title: string; description?: string; children: ReactNode; columns?: boolean }) {
  return (
    <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
      <div className="px-5 py-4 border-b border-border-default">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="text-xs text-foreground-muted mt-0.5">{description}</p>}
      </div>
      <div className={columns
        ? 'p-5 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5'
        : 'p-5 space-y-5'}>
        {children}
      </div>
    </section>
  )
}

/** Wrap a control so it spans the full row inside a `columns` SectionCard (e.g. toggles, textareas, uploaders, dividers). */
export function FullSpan({ children }: { children: ReactNode }) {
  return <div className="lg:col-span-2">{children}</div>
}

export function TextControl({
  settingKey, label, hint, initial, placeholder, type = 'text',
}: { settingKey: string; label: string; hint?: string; initial: string; placeholder?: string; type?: string }) {
  const { showToast } = useToast()
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  async function save() {
    if (!dirty) return
    setSaving(true)
    const ok = await patchSetting(settingKey, value)
    setSaving(false)
    setDirty(false)
    showToast(ok ? 'Saved' : 'Failed to save', ok ? 'success' : 'error')
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-foreground-muted mb-2">{hint}</p>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={save}
        disabled={saving}
        className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
      />
    </div>
  )
}

export function TextAreaControl({
  settingKey, label, hint, initial, rows = 4,
}: { settingKey: string; label: string; hint?: string; initial: string; rows?: number }) {
  const { showToast } = useToast()
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  async function save() {
    if (!dirty) return
    setSaving(true)
    const ok = await patchSetting(settingKey, value)
    setSaving(false)
    setDirty(false)
    showToast(ok ? 'Saved' : 'Failed to save', ok ? 'success' : 'error')
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-foreground-muted mb-2">{hint}</p>}
      <textarea
        value={value}
        rows={rows}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={save}
        disabled={saving}
        className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 resize-y"
      />
    </div>
  )
}

export function NumberControl({
  settingKey, label, hint, initial, prefix, suffix, min = 0, max, step = 1,
}: { settingKey: string; label: string; hint?: string; initial: number; prefix?: string; suffix?: string; min?: number; max?: number; step?: number }) {
  const { showToast } = useToast()
  const [value, setValue] = useState<number>(initial)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  async function save() {
    if (!dirty) return
    setSaving(true)
    const ok = await patchSetting(settingKey, value)
    setSaving(false)
    setDirty(false)
    showToast(ok ? 'Saved' : 'Failed to save', ok ? 'success' : 'error')
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-foreground-muted mb-2">{hint}</p>}
      <div className="relative max-w-xs">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary text-sm">{prefix}</span>}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={e => { setValue(parseFloat(e.target.value) || 0); setDirty(true) }}
          onBlur={save}
          disabled={saving}
          className={`w-full ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-12' : 'pr-3'} py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary text-sm">{suffix}</span>}
      </div>
    </div>
  )
}

export function ToggleControl({
  settingKey, label, hint, initial, locked, lockedHint,
}: { settingKey: string; label: string; hint?: string; initial: boolean; locked?: boolean; lockedHint?: string }) {
  const { showToast } = useToast()
  const [checked, setChecked] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function onChange(next: boolean) {
    if (locked) return
    setChecked(next)
    setSaving(true)
    const ok = await patchSetting(settingKey, next)
    setSaving(false)
    if (!ok) { setChecked(!next); showToast('Failed to save', 'error') }
    else showToast('Saved', 'success')
  }

  return (
    <div className={`flex items-center justify-between gap-3 p-4 bg-surface-secondary rounded-lg border border-border-default ${locked ? 'opacity-60' : ''}`}>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {locked && lockedHint
          ? <p className="text-xs text-foreground-muted mt-0.5">{lockedHint}</p>
          : hint && <p className="text-xs text-foreground-muted mt-0.5">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={saving || !!locked} />
    </div>
  )
}
