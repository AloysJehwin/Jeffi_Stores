'use client'

import { useState } from 'react'
import { api, btnGhost, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import type { LlmToolSchema } from '@controller/lib/outreach/agent/types'
import { API, CHANNEL_LABEL, LANGUAGE_LABEL } from './shared'

type Out = { systemPrompt: string; greeting: string | null; tools: LlmToolSchema[]; language: string; validation: { ok: boolean } }

/** The exact prompt, greeting and tools the agent would get: for the editor text or a stored version. No AI call. */
export default function SkillPreview({ content, versionId, languages }: { content?: string; versionId?: string; languages: string[] }) {
  const toast = useActionToast()
  const [channel, setChannel] = useState<'voice' | 'whatsapp' | 'follow_up'>('voice')
  const [language, setLanguage] = useState('')
  const [contactId, setContactId] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<Out | null>(null)

  async function run() {
    setBusy(true)
    const json = { ...(versionId ? { versionId } : { content }), channel, ...(language ? { language } : {}), ...(contactId.trim() ? { contactId: contactId.trim() } : {}) }
    const { ok, data } = await api<Out>(`${API}/skills/preview`, { method: 'POST', json })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'Could not preview')
    setOut(data)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(out?.systemPrompt ?? '')
      toast.success('Prompt copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Preview</h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:items-end">
        <label className="text-xs text-foreground-muted space-y-1">
          Channel
          <select aria-label="Preview channel" className={inputCls} value={channel} onChange={e => setChannel(e.target.value as typeof channel)}>
            {Object.entries(CHANNEL_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-foreground-muted space-y-1">
          Language
          <select aria-label="Preview language" className={inputCls} value={language} onChange={e => setLanguage(e.target.value)}>
            <option value="">Skill default</option>
            {languages.map(l => (
              <option key={l} value={l}>{LANGUAGE_LABEL[l] ?? l}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-foreground-muted space-y-1">
          Contact id (optional)
          <input aria-label="Preview contact id" className={inputCls} placeholder="Sample business" value={contactId} onChange={e => setContactId(e.target.value)} />
        </label>
        <button type="button" className={btnGhost} disabled={busy} onClick={run}>
          {busy ? 'Rendering…' : 'Preview prompt'}
        </button>
      </div>
      {out && !out.systemPrompt && <p className="text-sm text-red-600 dark:text-red-400">The skill does not parse yet. Fix the errors first.</p>}
      {out?.systemPrompt && (
        <div className="space-y-3">
          {out.greeting && (
            <div>
              <div className="text-xs text-foreground-muted mb-1">Greeting</div>
              <p className="rounded-lg bg-surface-secondary p-2 text-sm">{out.greeting}</p>
            </div>
          )}
          <div>
            <div className="text-xs text-foreground-muted mb-1">{`Tools the agent gets (${out.tools.length})`}</div>
            {!out.tools.length ? (
              <p className="text-sm text-foreground-muted">None on this channel.</p>
            ) : (
              <ul className="space-y-1">
                {out.tools.map(t => (
                  <li key={t.name}>
                    <details className="text-sm">
                      <summary className="cursor-pointer font-mono text-xs" title={t.description}>{t.name}</summary>
                      <p className="mt-1 text-xs text-foreground-muted">{t.description}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-foreground-muted">System prompt</span>
              <button type="button" className={btnGhost} onClick={copy}>
                Copy
              </button>
            </div>
            <pre aria-label="System prompt" className="max-h-96 overflow-auto rounded-lg bg-surface-secondary p-3 text-xs font-mono whitespace-pre-wrap break-words">{out.systemPrompt}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
