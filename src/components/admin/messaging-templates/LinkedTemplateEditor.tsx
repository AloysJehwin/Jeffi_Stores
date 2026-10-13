'use client'

import { useEffect, useState } from 'react'
import TemplateEditor, { toEditorTemplate, type EditorTemplate } from './TemplateEditor'
import { useToast } from '@/contexts/ToastContext'

const API = '/api/admin/messaging-templates'

/**
 * The Templates-page editor, embedded in a campaign / Messaging send and bound to one library template.
 * Saving writes the same library record (a standard template becomes this store's copy on first save),
 * so an edit here and an edit on the Templates page are the same edit.
 */
export default function LinkedTemplateEditor({
  channel, slug, currentKind, campaignKind, variableNames, onMirror,
}: {
  channel: 'email' | 'sms' | 'whatsapp'
  slug: string
  /** The campaign doing the editing (excluded from the "also used by" count). */
  currentKind?: string
  /** Campaign kind whose variables the template must keep using. */
  campaignKind?: string | null
  /** Variables the host fills (offered in the editor's insert menu). */
  variableNames?: string[]
  /** Called with the template on load and on every edit (the host's preview reads it). */
  onMirror?: (t: EditorTemplate) => void
}) {
  const { showToast } = useToast()
  const [value, setValue] = useState<EditorTemplate | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [usedBy, setUsedBy] = useState<string[]>([])

  useEffect(() => {
    let live = true
    setValue(null); setMissing(false)
    fetch(`${API}/${channel}/${encodeURIComponent(slug)}`).then(r => (r.ok ? r.json() : null)).then(a => {
      if (!live) return
      if (!a) { setMissing(true); return }
      const t = toEditorTemplate(a)
      setValue(t); onMirror?.(t)
    }).catch(() => live && setMissing(true))
    fetch('/api/admin/campaigns?limit=500').then(r => (r.ok ? r.json() : { campaigns: [] })).then(d => {
      if (!live) return
      const col = channel === 'email' ? 'email_template_slug' : channel === 'sms' ? 'sms_template_slug' : 'wa_template_slug'
      setUsedBy((d.campaigns ?? []).filter((c: any) => c[col] === slug && c.kind !== currentKind).map((c: any) => c.name))
    }).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, slug, currentKind])

  async function save(): Promise<EditorTemplate | null> {
    if (!value?.id) return null
    setSaving(true)
    try {
      const r = await fetch(`${API}/${value.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...value, publish: true }) })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        showToast(`Template not saved: ${err?.message || err?.error || r.status}`, 'error')
        return null
      }
      const saved = toEditorTemplate(await r.json())
      setValue(saved); onMirror?.(saved)
      showToast('Template saved to the library.', 'success')
      return saved
    } finally { setSaving(false) }
  }

  if (missing) return <p className="text-xs text-red-600">This template no longer exists in the library — pick another one.</p>
  if (!value) return <div className="h-40 rounded-lg bg-surface-secondary animate-pulse" />

  return (
    <div className="space-y-2">
      {usedBy.length > 0 && (
        <p className="text-[11px] text-yellow-700 dark:text-yellow-300">
          Also used by {usedBy.slice(0, 3).join(', ')}{usedBy.length > 3 ? ` and ${usedBy.length - 3} more` : ''} — saving changes them too.
        </p>
      )}
      <TemplateEditor
        embedded
        campaignKind={campaignKind}
        variableNames={variableNames}
        value={value}
        apiBase={API}
        onChange={t => { setValue(t); onMirror?.(t) }}
        onSave={save}
        saving={saving}
      />
    </div>
  )
}
