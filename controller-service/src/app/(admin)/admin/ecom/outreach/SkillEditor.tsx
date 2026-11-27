'use client'

import { useEffect, useRef, useState } from 'react'
import { api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import { API, MAX_SKILL_BYTES, skillBytes, type SkillValidation } from './shared'
import { ValidationSummary } from './SkillValidationPanel'
import SkillPreview from './SkillPreview'

const DEBOUNCE_MS = 500

/** Validates the content 500 ms after the last keystroke (POST /skills/validate). */
export function useSkillValidation(content: string) {
  const [validation, setValidation] = useState<SkillValidation | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!content.trim()) {
      setValidation(null)
      setChecking(false)
      setError(null)
      return
    }
    setChecking(true)
    let live = true
    const t = setTimeout(async () => {
      const { ok, data } = await api<{ validation: SkillValidation }>(`${API}/skills/validate`, { method: 'POST', json: { content } })
      if (!live) return
      setChecking(false)
      if (!ok) {
        setValidation(null)
        return setError(data.error || 'Could not validate')
      }
      setError(null)
      setValidation(data.validation)
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [content])
  return { validation, checking, error }
}

export type SaveResult = { ok: boolean; error?: string; validation?: SkillValidation }

/** Editor + live validation + preview. `onSave` posts the content and reports back so a 400/409 can show here. */
export default function SkillEditor({
  title, hint, content, setContent, onSave, saveLabel, canWrite, existingSlugs = [], onCancel,
}: {
  title: string
  hint?: string
  content: string
  setContent: (s: string) => void
  onSave: (content: string) => Promise<SaveResult>
  saveLabel: string
  canWrite: boolean
  existingSlugs?: string[]
  onCancel?: () => void
}) {
  const toast = useActionToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const { validation, checking, error } = useSkillValidation(content)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<{ error: string; validation?: SkillValidation } | null>(null)
  const bytes = skillBytes(content)
  const tooBig = bytes > MAX_SKILL_BYTES
  const name = validation?.skill?.meta.name
  const taken = !!name && existingSlugs.includes(name)

  useEffect(() => setSaveError(null), [content])

  function pick(f: File | undefined) {
    if (!f) return
    if (f.size > MAX_SKILL_BYTES) return toast.error('That file is over 24 KB')
    const r = new FileReader()
    r.onload = () => setContent(String(r.result ?? ''))
    r.onerror = () => toast.error('Could not read the file')
    r.readAsText(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function save() {
    setSaving(true)
    const res = await onSave(content)
    setSaving(false)
    if (!res.ok) setSaveError({ error: res.error || 'Could not save', validation: res.validation })
  }

  const canSave = canWrite && !saving && !checking && !tooBig && !!validation && validation.ok

  return (
    <Card
      title={title}
      hint={hint}
      action={
        <div className="flex items-center gap-2">
          {onCancel && (
            <button type="button" className={btnGhost} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className={btnPrimary} disabled={!canSave} onClick={save}>
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} aria-label="Skill file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={!canWrite} onChange={e => pick(e.target.files?.[0])} className="block text-sm text-foreground-muted file:mr-3 file:rounded-lg file:border file:border-border-default file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground" />
            <span className={`ml-auto text-xs tabular-nums ${tooBig ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
              {(bytes / 1024).toFixed(1)} / 24 KB
            </span>
          </div>
          <textarea aria-label="Skill content" rows={24} spellCheck={false} placeholder="---&#10;name: my-skill&#10;title: My skill&#10;---" className={`${inputCls} font-mono text-xs leading-relaxed`} value={content} disabled={!canWrite} onChange={e => setContent(e.target.value)} />
          {tooBig && <p className="text-xs text-red-600 dark:text-red-400">The file is over 24 KB. Shorten it to save.</p>}
          {taken && <p className="text-xs text-amber-700 dark:text-amber-400">A skill named {name} already exists. Change the name in the file first.</p>}
          {saveError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {saveError.error}
            </p>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <ValidationSummary validation={validation} checking={checking} error={error} />
        </div>
      </div>
      {validation?.skill && (
        <div className="mt-5 border-t border-border-default pt-4">
          <SkillPreview content={content} languages={validation.skill.meta.languages} />
        </div>
      )}
    </Card>
  )
}
