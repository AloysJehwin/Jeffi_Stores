'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { KeyboardShortcuts } from '@/lib/site-controls'
import { hasScope } from '@/lib/scopes'
import { BUILTIN_SHORTCUT_SCOPES } from '@/lib/shortcut-scopes'
import { ap } from '@/lib/admin-path'

interface Combo { modifier: 'mod' | 'mod+shift' | 'f'; key: string }

function parseCombo(raw: string): Combo | null {
  const v = raw.toLowerCase().trim()
  if (!v) return null
  if (/^f([1-9]|1[0-2])$/.test(v)) return { modifier: 'f', key: v }
  if (v.startsWith('mod+shift+')) return { modifier: 'mod+shift', key: v.slice(10) }
  if (v.startsWith('mod+')) return { modifier: 'mod', key: v.slice(4) }
  if (v.length === 1) return { modifier: 'mod', key: v }
  return null
}

function matches(combo: Combo, e: KeyboardEvent): boolean {
  if (combo.modifier === 'f') {
    return e.key.toLowerCase() === combo.key && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  }
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return false
  if (combo.modifier === 'mod+shift' && !e.shiftKey) return false
  if (combo.modifier === 'mod' && e.shiftKey) return false
  return e.key.toLowerCase() === combo.key
}

export default function AdminShortcutHandler({
  shortcuts,
  host,
  role,
  scopes,
}: {
  shortcuts: KeyboardShortcuts
  host: string
  role: string
  scopes: string[]
}) {
  const router = useRouter()

  useEffect(() => {
    const entries: Array<{ combo: Combo; path: string }> = []

    // Custom shortcuts take priority over built-ins so a user-defined combo
    // always wins over a stale/default built-in on the same keys.
    try {
      const custom: Array<{ id: string; label: string; path: string; combo: string }> =
        JSON.parse(shortcuts.customShortcuts || '[]')
      for (const c of custom) {
        const combo = parseCombo(c.combo)
        if (combo && c.path) entries.push({ combo, path: c.path })
      }
    } catch { /* malformed JSON — skip */ }

    for (const [field, { path, scope }] of Object.entries(BUILTIN_SHORTCUT_SCOPES)) {
      // Skip binding a shortcut the session's plan/role can't reach — an out-of-plan
      // key must be inert, not silently route into a 403.
      if (!hasScope(role, scopes, scope)) continue
      const raw = shortcuts[field as keyof typeof BUILTIN_SHORTCUT_SCOPES]
      const combo = parseCombo(raw)
      if (combo) entries.push({ combo, path })
    }

    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      for (const { combo, path } of entries) {
        if (matches(combo, e)) {
          e.preventDefault()
          router.push(ap(path, host))
          return
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [shortcuts, host, router, role, scopes])

  return null
}
