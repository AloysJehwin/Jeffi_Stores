'use client'

import { useState, ReactNode, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import Toggle from '@/components/ui/Toggle'
import AdminSelect from '@/components/admin/AdminSelect'
import { useCanWrite } from '@/contexts/AdminScopesContext'

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
  const canWrite = useCanWrite('settings:write')
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
      <label className="flex items-baseline gap-2 mb-1 min-w-0">
        <span className="text-sm font-medium text-foreground shrink-0">{label}</span>
        {hint && <span className="text-xs text-foreground-muted truncate">{hint}</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={save}
        disabled={saving || !canWrite}
        className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
      />
    </div>
  )
}

export function TextAreaControl({
  settingKey, label, hint, initial, rows = 4,
}: { settingKey: string; label: string; hint?: string; initial: string; rows?: number }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
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
      <label className="flex items-baseline gap-2 mb-1 min-w-0">
        <span className="text-sm font-medium text-foreground shrink-0">{label}</span>
        {hint && <span className="text-xs text-foreground-muted truncate">{hint}</span>}
      </label>
      <textarea
        value={value}
        rows={rows}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={save}
        disabled={saving || !canWrite}
        className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 resize-y"
      />
    </div>
  )
}

export function NumberControl({
  settingKey, label, hint, initial, prefix, suffix, min = 0, max, step = 1,
}: { settingKey: string; label: string; hint?: string; initial: number; prefix?: string; suffix?: string; min?: number; max?: number; step?: number }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
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
      <label className="flex items-baseline gap-2 mb-1 min-w-0">
        <span className="text-sm font-medium text-foreground shrink-0">{label}</span>
        {hint && <span className="text-xs text-foreground-muted truncate">{hint}</span>}
      </label>
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
          disabled={saving || !canWrite}
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
  const canWrite = useCanWrite('settings:write')
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
    <div className={`flex items-center justify-between gap-3 p-4 bg-surface-secondary rounded-lg border border-border-default ${locked || !canWrite ? 'opacity-60' : ''}`}>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {locked && lockedHint
          ? <p className="text-xs text-foreground-muted mt-0.5">{lockedHint}</p>
          : hint && <p className="text-xs text-foreground-muted mt-0.5">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={saving || !!locked || !canWrite} />
    </div>
  )
}

// Keys Chrome/browsers reserve with a plain Ctrl/⌘ modifier — these keep their
// default browser behavior and cannot be used for our shortcuts. Add Shift to the
// combo (⌘/Ctrl + Shift + key) to use any of these instead.
const RESERVED_MOD_KEYS = new Set(['r','f','l','t','w','n','a','c','v','x','z','y','p','s','d','h','j','u','q'])

function comboLabel(raw: string, isMac: boolean): string {
  const v = raw.toLowerCase().trim()
  const mod = isMac ? '⌘' : 'Ctrl'
  if (/^f([1-9]|1[0-2])$/.test(v)) return v.toUpperCase()
  if (v.startsWith('mod+shift+')) return `${mod}+⇧+${v.slice(10).toUpperCase()}`
  if (v.startsWith('mod+')) return `${mod}+${v.slice(4).toUpperCase()}`
  return v.toUpperCase()
}

function findShortcutConflict(combo: string, ownKey: string): string | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  const registry = w.__jeffiShortcutRegistry as Map<string, string> | undefined
  if (registry) {
    for (const [k, v] of registry) {
      if (k === ownKey) continue
      if (v === combo) return k
    }
  }
  const customList = w.__jeffiCustomShortcutList as string[] | undefined
  if (Array.isArray(customList) && customList.includes(combo)) return 'custom'
  return null
}

function registerShortcut(ownKey: string, combo: string) {
  if (typeof window === 'undefined') return
  const w = window as any
  if (!w.__jeffiShortcutRegistry) w.__jeffiShortcutRegistry = new Map<string, string>()
  w.__jeffiShortcutRegistry.set(ownKey, combo)
}

export function KeyboardShortcutControl({
  settingKey, label, initial,
}: { settingKey: string; label: string; initial: string }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [isMac, setIsMac] = useState(false)
  const [saving, setSaving] = useState(false)

  function parse(raw: string): { modifier: string; key: string } {
    const v = raw.toLowerCase().trim()
    if (/^f([1-9]|1[0-2])$/.test(v)) return { modifier: 'f', key: v }
    if (v.startsWith('mod+shift+')) return { modifier: 'mod+shift', key: v.slice(10) }
    if (v.startsWith('mod+')) return { modifier: 'mod', key: v.slice(4) }
    if (v.length === 1) return { modifier: 'mod', key: v }
    return { modifier: 'mod', key: '' }
  }

  const parsed = parse(initial)
  const [modifier, setModifier] = useState(parsed.modifier)
  const [key, setKey] = useState(parsed.key)
  const [inputDisplay, setInputDisplay] = useState(parsed.key.toUpperCase())

  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent))
    registerShortcut(settingKey, initial.toLowerCase().trim())
  }, [settingKey, initial])

  async function save(mod: string, k: string) {
    if (!k) return
    const stored = mod === 'f' ? k : `${mod}+${k}`
    const conflict = findShortcutConflict(stored, settingKey)
    if (conflict) {
      showToast(`${comboLabel(stored, isMac)} is already assigned to another shortcut`, 'error')
      return
    }
    registerShortcut(settingKey, stored)
    setSaving(true)
    const ok = await patchSetting(settingKey, stored)
    setSaving(false)
    showToast(ok ? 'Saved' : 'Failed to save', ok ? 'success' : 'error')
  }

  function handleModifierChange(mod: string) {
    if (mod === 'f') {
      const fkey = /^f([1-9]|1[0-2])$/.test(key) ? key : 'f1'
      const conflict = findShortcutConflict(fkey, settingKey)
      if (conflict) {
        showToast(`${fkey.toUpperCase()} is already assigned to another shortcut`, 'error')
        return
      }
      setModifier(mod)
      setKey(fkey)
      save(mod, fkey)
    } else {
      if (!key) { setModifier(mod); return }
      const stored = `${mod}+${key}`
      const conflict = findShortcutConflict(stored, settingKey)
      if (conflict) {
        showToast(`${comboLabel(stored, isMac)} is already assigned to another shortcut`, 'error')
        return
      }
      setModifier(mod)
      save(mod, key)
    }
  }

  function applyKey(k: string, mod: string) {
    if (mod !== 'mod+shift' && RESERVED_MOD_KEYS.has(k)) {
      showToast(`${isMac ? '⌘' : 'Ctrl'}+${k.toUpperCase()} is reserved by the browser — use a Shift combo or another key`, 'error')
      return
    }
    const stored = mod === 'f' ? k : `${mod}+${k}`
    const conflict = findShortcutConflict(stored, settingKey)
    if (conflict) {
      showToast(`${comboLabel(stored, isMac)} is already assigned to another shortcut`, 'error')
      return
    }
    setKey(k)
    setInputDisplay(k.toUpperCase())
    save(mod, k)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    const k = e.key.toLowerCase()
    if (/^[a-z0-9]$/.test(k)) applyKey(k, modifier)
  }

  const modName = isMac ? '⌘' : 'Ctrl'

  const comboPreview = modifier === 'f'
    ? key.toUpperCase()
    : modifier === 'mod+shift'
      ? `${modName}+⇧+${key.toUpperCase()}`
      : `${modName}+${key.toUpperCase()}`

  const modifierOptions = [
    { value: 'mod',       label: `${modName} + key` },
    { value: 'mod+shift', label: `${modName} + Shift + key` },
    { value: 'f',         label: 'F-key only' },
  ]

  const fkeyOptions = Array.from({ length: 12 }, (_, i) => ({
    value: `f${i + 1}`,
    label: `F${i + 1}`,
  }))

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border-default bg-surface-secondary">
      <span className="w-24 shrink-0 text-sm font-medium text-foreground truncate">{label}</span>
      <kbd className="w-20 shrink-0 inline-flex items-center justify-center px-2 py-1.5 rounded-lg border border-border-secondary bg-surface text-xs font-mono text-foreground-secondary select-none">
        {comboPreview || '—'}
      </kbd>
      <div className="flex-1 min-w-0">
        <AdminSelect
          value={modifier}
          options={modifierOptions}
          onChange={handleModifierChange}
          disabled={saving || !canWrite}
          sm
        />
      </div>
      <div className="w-16 shrink-0">
        {modifier === 'f' ? (
          <AdminSelect
            value={/^f([1-9]|1[0-2])$/.test(key) ? key : 'f1'}
            options={fkeyOptions}
            onChange={k => {
              const conflict = findShortcutConflict(k, settingKey)
              if (conflict) { showToast(`${k.toUpperCase()} is already assigned to another shortcut`, 'error'); return }
              setKey(k); save('f', k)
            }}
            disabled={saving || !canWrite}
            sm
          />
        ) : (
          <input
            type="text"
            value={inputDisplay}
            disabled={saving || !canWrite}
            readOnly
            onKeyDown={handleKeyDown}
            placeholder="key"
            title="Click and press any letter or number"
            className="w-full text-center px-2 py-1.5 text-sm font-mono border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 disabled:opacity-60 cursor-pointer caret-transparent"
          />
        )}
      </div>
    </div>
  )
}
