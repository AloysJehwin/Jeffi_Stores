'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'

export interface CustomShortcut {
  id: string
  label: string
  path: string
  combo: string
}

// Keys Chrome reserves with a plain Ctrl/⌘ modifier — blocked here. Use a
// ⌘/Ctrl + Shift combo to assign any of these.
const RESERVED_MOD_KEYS = new Set(['r','f','l','t','w','n','a','c','v','x','z','y','p','s','d','h','j','u','q'])

function parseComboDisplay(raw: string, isMac: boolean): string {
  const v = raw.toLowerCase().trim()
  const mod = isMac ? '⌘' : 'Ctrl'
  if (/^f([1-9]|1[0-2])$/.test(v)) return v.toUpperCase()
  if (v.startsWith('mod+shift+')) return `${mod}+⇧+${v.slice(10).toUpperCase()}`
  if (v.startsWith('mod+')) return `${mod}+${v.slice(4).toUpperCase()}`
  if (v.length === 1) return `${mod}+${v.toUpperCase()}`
  return '—'
}

function isBuiltinConflict(combo: string): boolean {
  if (typeof window === 'undefined') return false
  const registry = (window as any).__jeffiShortcutRegistry as Map<string, string> | undefined
  if (!registry) return false
  for (const [, v] of registry) {
    if (v === combo) return true
  }
  return false
}

function publishCustomList(shortcuts: CustomShortcut[]) {
  if (typeof window === 'undefined') return
  ;(window as any).__jeffiCustomShortcutList = shortcuts.map(s => s.combo.toLowerCase().trim())
}

function buildCombo(modifier: string, key: string): string {
  if (modifier === 'f') return key
  return `${modifier}+${key}`
}

function parseStored(raw: string): { modifier: string; key: string } {
  const v = raw.toLowerCase().trim()
  if (/^f([1-9]|1[0-2])$/.test(v)) return { modifier: 'f', key: v }
  if (v.startsWith('mod+shift+')) return { modifier: 'mod+shift', key: v.slice(10) }
  if (v.startsWith('mod+')) return { modifier: 'mod', key: v.slice(4) }
  if (v.length === 1) return { modifier: 'mod', key: v }
  return { modifier: 'mod', key: '' }
}

async function saveCustom(shortcuts: CustomShortcut[]): Promise<boolean> {
  const res = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ key: 'shortcut_custom', value: JSON.stringify(shortcuts) }),
  })
  return res.ok
}

function ShortcutRow({
  shortcut, isMac, allShortcuts, canWrite, onDelete, onChange,
}: {
  shortcut: CustomShortcut
  isMac: boolean
  allShortcuts: CustomShortcut[]
  canWrite: boolean
  onDelete: () => void
  onChange: (updated: CustomShortcut) => void
}) {
  const { showToast } = useToast()
  const parsed = parseStored(shortcut.combo)
  const [modifier, setModifier] = useState(parsed.modifier)
  const [key, setKey] = useState(parsed.key)
  const [display, setDisplay] = useState(parsed.key.toUpperCase())

  const modName = isMac ? '⌘' : 'Ctrl'
  const modifierOptions = [
    { value: 'mod',       label: `${modName} + key` },
    { value: 'mod+shift', label: `${modName} + Shift + key` },
    { value: 'f',         label: 'F-key only' },
  ]
  const fkeyOptions = Array.from({ length: 12 }, (_, i) => ({ value: `f${i + 1}`, label: `F${i + 1}` }))

  function isDuplicate(combo: string, excludeId: string) {
    if (allShortcuts.some(s => s.id !== excludeId && s.combo === combo)) return true
    return isBuiltinConflict(combo)
  }

  function applyKey(k: string, mod: string) {
    if (mod !== 'mod+shift' && RESERVED_MOD_KEYS.has(k)) {
      showToast(`${modName}+${k.toUpperCase()} is reserved by the browser`, 'error')
      return
    }
    const combo = buildCombo(mod, k)
    if (isDuplicate(combo, shortcut.id)) {
      showToast(`${parseComboDisplay(combo, isMac)} is already assigned to another shortcut`, 'error')
      return
    }
    setKey(k); setDisplay(k.toUpperCase())
    onChange({ ...shortcut, combo })
  }

  function handleModChange(mod: string) {
    setModifier(mod)
    if (mod === 'f') {
      const fkey = /^f([1-9]|1[0-2])$/.test(key) ? key : 'f1'
      setKey(fkey)
      if (isDuplicate(fkey, shortcut.id)) { showToast(`${fkey.toUpperCase()} is already assigned to another shortcut`, 'error'); return }
      onChange({ ...shortcut, combo: fkey })
    } else {
      if (key) {
        const combo = buildCombo(mod, key)
        if (isDuplicate(combo, shortcut.id)) { showToast(`${parseComboDisplay(combo, isMac)} is already assigned to another shortcut`, 'error'); return }
        onChange({ ...shortcut, combo })
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    const k = e.key.toLowerCase()
    if (/^[a-z0-9]$/.test(k)) applyKey(k, modifier)
  }

  const preview = parseComboDisplay(shortcut.combo, isMac)

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 py-2 px-3 rounded-lg border border-border-default bg-surface-secondary">
      <span className="w-32 shrink-0 text-sm font-medium text-foreground truncate" title={shortcut.label}>{shortcut.label}</span>
      <span className="flex-1 min-w-0 text-xs text-foreground-muted font-mono truncate" title={shortcut.path}>{shortcut.path}</span>
      <kbd className="w-24 shrink-0 inline-flex items-center justify-center px-2 py-1.5 rounded-lg border border-border-secondary bg-surface text-xs font-mono text-foreground-secondary select-none">
        {preview}
      </kbd>
      <div className="w-36 shrink-0">
        <AdminSelect value={modifier} options={modifierOptions} onChange={handleModChange} disabled={!canWrite} sm />
      </div>
      <div className="w-16 shrink-0">
        {modifier === 'f' ? (
          <AdminSelect
            value={/^f([1-9]|1[0-2])$/.test(key) ? key : 'f1'}
            options={fkeyOptions}
            onChange={k => {
              if (isDuplicate(k, shortcut.id)) { showToast(`${k.toUpperCase()} is already assigned to another shortcut`, 'error'); return }
              setKey(k)
              onChange({ ...shortcut, combo: k })
            }}
            disabled={!canWrite}
            sm
          />
        ) : (
          <input
            type="text"
            value={display}
            readOnly
            disabled={!canWrite}
            onKeyDown={handleKeyDown}
            placeholder="key"
            title="Click and press any letter or number"
            className="w-full text-center px-2 py-1.5 text-sm font-mono border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 cursor-pointer caret-transparent disabled:opacity-60"
          />
        )}
      </div>
      <RequireWrite scope="settings:write">
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-foreground-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="Remove"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </RequireWrite>
    </div>
  )
}

export default function CustomShortcutsCard({
  initial, isMac,
}: {
  initial: CustomShortcut[]
  isMac: boolean
}) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [shortcuts, setShortcuts] = useState<CustomShortcut[]>(initial)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newPath, setNewPath] = useState('/admin/')

  useEffect(() => { publishCustomList(shortcuts) }, [shortcuts])

  async function persist(next: CustomShortcut[]) {
    setSaving(true)
    const ok = await saveCustom(next)
    setSaving(false)
    showToast(ok ? 'Saved' : 'Failed to save', ok ? 'success' : 'error')
  }

  function handleChange(updated: CustomShortcut) {
    const next = shortcuts.map(s => s.id === updated.id ? updated : s)
    setShortcuts(next)
    persist(next)
  }

  function handleDelete(id: string) {
    const next = shortcuts.filter(s => s.id !== id)
    setShortcuts(next)
    persist(next)
  }

  function handleAdd() {
    const label = newLabel.trim()
    const path = newPath.trim()
    if (!label || !path) return
    // new entry starts with no combo — user must set a key before it fires
    const entry: CustomShortcut = {
      id: `custom_${Date.now()}`,
      label,
      path,
      combo: 'mod+',
    }
    const next = [...shortcuts, entry]
    setShortcuts(next)
    setNewLabel('')
    setNewPath('/admin/')
    persist(next)
  }

  return (
    <div className="space-y-2">
      {shortcuts.length === 0 && (
        <p className="text-xs text-foreground-muted px-1">No custom shortcuts yet. Add one below.</p>
      )}
      {shortcuts.map(s => (
        <ShortcutRow
          key={s.id}
          shortcut={s}
          isMac={isMac}
          allShortcuts={shortcuts}
          canWrite={canWrite}
          onDelete={() => handleDelete(s.id)}
          onChange={handleChange}
        />
      ))}
      {shortcuts.some(s => !parseStored(s.combo).key) && (
        <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
          ⚠ Some shortcuts have no key set — click the key field and press a letter or number to activate them.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pt-1">
        <input
          type="text"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="Label"
          className="w-36 px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <input
          type="text"
          value={newPath}
          onChange={e => {
            let v = e.target.value
            try {
              const u = new URL(v)
              let p = u.pathname + u.search + u.hash
              if (u.hostname.startsWith('admin.') && !p.startsWith('/admin')) p = '/admin' + p
              v = p
            } catch { /* not a full URL */ }
            setNewPath(v)
          }}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="/admin/... or paste full URL"
          className="flex-1 px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
        />
        <button
          type="button"
          disabled={saving || !canWrite || !newLabel.trim() || !newPath.trim()}
          onClick={handleAdd}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}
