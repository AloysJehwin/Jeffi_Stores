'use client'

import { useEffect, useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { api } from '@/components/admin/kit/core'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

const ENDPOINT = '/api/admin/site-builder/admin-theme'

export default function AdminThemeToggle({
  label = 'Use this theme in the admin panel too',
  hint = 'Off: the admin keeps its own look.',
}: { label?: string; hint?: string }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [on, setOn] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    api<{ enabled: boolean }>(ENDPOINT).then(r => {
      if (!live) return
      if (r.ok) setOn(!!r.data.enabled)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [])

  const change = async (next: boolean) => {
    setSaving(true)
    const r = await api<{ enabled: boolean }>(ENDPOINT, { method: 'POST', json: { enabled: next } })
    setSaving(false)
    if (!r.ok) return showToast(r.data.error || 'Could not save', 'error')
    setOn(next)
    showToast(next ? 'Admin panel now uses this theme' : 'Admin panel back to its own look', 'success')
    // The theme lives in the root layout, which a soft refresh does not re-render.
    window.location.reload()
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor="admin-theme-toggle" className="block text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-xs text-foreground-secondary">{hint}</p>
      </div>
      <Toggle id="admin-theme-toggle" checked={on} onChange={change} disabled={!canWrite || !loaded || saving} />
    </div>
  )
}
