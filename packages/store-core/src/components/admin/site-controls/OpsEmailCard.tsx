'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Lock, Loader2 } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  OPS_ATTACHMENTS,
  OPS_EMAIL_KEY,
  OPS_SECTIONS,
  type OpsEmailConfig,
  type OpsSection,
} from '@/lib/shared/ops-email-config'

// Site Controls > Daily email: when the daily ops email goes, to whom, what it shows and attaches, with a
// live preview and a test send of the unsaved settings.

export interface OpsEmailAdmin {
  id: string
  name: string
  email: string
  role: string
}

const inputCls =
  'w-full px-2.5 h-control-sm rounded-lg border border-border-secondary bg-surface text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00 IST` }))
const ROLE_LABEL = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function OpsEmailCard({
  initial,
  admins,
  lockedSections,
  lockedAttachments,
}: {
  initial: OpsEmailConfig
  admins: OpsEmailAdmin[]
  /** Sections the plan doesn't include, with the plan that does. */
  lockedSections: Partial<Record<OpsSection['id'], string>>
  lockedAttachments: Partial<Record<keyof typeof OPS_ATTACHMENTS, string>>
}) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [cfg, setCfg] = useState<OpsEmailConfig>(initial)
  const [extra, setExtra] = useState(initial.recipients.extra.join(', '))
  const [saved, setSaved] = useState(JSON.stringify(initial))
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string; note: string } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const seq = useRef(0)

  const draft: OpsEmailConfig = {
    ...cfg,
    recipients: { ...cfg.recipients, extra: extra.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean) },
  }
  const draftJson = JSON.stringify(draft)
  const dirty = draftJson !== saved
  const roles = [...new Set(admins.map(a => a.role))].sort()

  const set = (patch: Partial<OpsEmailConfig>) => setCfg(c => ({ ...c, ...patch }))
  const setSection = (id: OpsSection['id'], patch: Partial<OpsSection>) =>
    setCfg(c => ({ ...c, sections: c.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) }))
  const move = (i: number, by: -1 | 1) =>
    setCfg(c => {
      const sections = [...c.sections]
      const j = i + by
      if (j < 0 || j >= sections.length) return c
      ;[sections[i], sections[j]] = [sections[j], sections[i]]
      return { ...c, sections }
    })

  // Preview of the unsaved settings, refreshed shortly after each change.
  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(async () => {
      setLoadingPreview(true)
      const res = await fetch('/api/admin/site-controls/ops-email/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config: JSON.parse(draftJson) }),
      }).catch(() => null)
      const data = await res?.json().catch(() => null)
      if (id !== seq.current) return
      setLoadingPreview(false)
      if (res?.ok && data) {
        setPreview(data)
        setPreviewError(null)
      } else setPreviewError(data?.error || 'Could not build the preview')
    }, 700)
    return () => clearTimeout(t)
  }, [draftJson])

  async function save() {
    setBusy('save')
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ key: OPS_EMAIL_KEY, value: draftJson }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(null)
    if (res?.ok) {
      setSaved(draftJson)
      showToast('Daily email saved', 'success')
    } else showToast(data?.error || 'Could not save', 'error')
  }

  async function test() {
    setBusy('test')
    const res = await fetch('/api/admin/site-controls/ops-email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ config: draft }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(null)
    if (res?.ok) showToast(`Test sent to ${data.sentTo}`, 'success')
    else showToast(data?.error || 'Could not send the test', 'error')
  }

  const disabled = !canWrite
  return (
    <section className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Daily ops email</h2>
          <p className="text-xs text-foreground-muted mt-1">
            A morning summary for your team: yesterday&apos;s numbers, what needs shipping, and anything stuck. Choose the time, the people,
            the sections and their order, and the documents to attach.
          </p>
        </div>
        <Toggle checked={cfg.enabled} onChange={v => set({ enabled: v })} disabled={disabled} label={cfg.enabled ? 'On' : 'Off'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AdminSelect sm label="Send at" value={String(cfg.hour)} onChange={v => set({ hour: Number(v) })} options={HOURS} disabled={disabled} />
            <AdminSelect
              sm
              label="Send to"
              value={cfg.recipients.mode}
              onChange={v => set({ recipients: { ...cfg.recipients, mode: v as OpsEmailConfig['recipients']['mode'] } })}
              options={[
                { value: 'all', label: 'Every active admin' },
                { value: 'roles', label: 'Admins with these roles' },
                { value: 'admins', label: 'Chosen admins' },
              ]}
              disabled={disabled}
            />
          </div>
          {cfg.recipients.mode === 'roles' && (
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <label key={r} className="inline-flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent-500"
                    checked={cfg.recipients.roles.includes(r)}
                    disabled={disabled}
                    onChange={e =>
                      set({ recipients: { ...cfg.recipients, roles: e.target.checked ? [...cfg.recipients.roles, r] : cfg.recipients.roles.filter(x => x !== r) } })
                    }
                  />
                  {ROLE_LABEL(r)}
                </label>
              ))}
            </div>
          )}
          {cfg.recipients.mode === 'admins' && (
            <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-border-default p-2">
              {admins.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent-500"
                    checked={cfg.recipients.adminIds.includes(a.id)}
                    disabled={disabled}
                    onChange={e =>
                      set({
                        recipients: {
                          ...cfg.recipients,
                          adminIds: e.target.checked ? [...cfg.recipients.adminIds, a.id] : cfg.recipients.adminIds.filter(x => x !== a.id),
                        },
                      })
                    }
                  />
                  <span className="truncate">{a.name || a.email}</span>
                  <span className="text-xs text-foreground-muted truncate">{a.email}</span>
                </label>
              ))}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground-secondary">Also send to (up to 10 addresses)</span>
            <input className={inputCls} value={extra} onChange={e => setExtra(e.target.value)} placeholder="ops@yourstore.com, owner@yourstore.com" disabled={disabled} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground-secondary">Subject</span>
            <input className={inputCls} value={cfg.subject} maxLength={150} onChange={e => set({ subject: e.target.value })} disabled={disabled} />
            <span className="text-xs text-foreground-muted">Fills in {'{store}'}, {'{date}'}, {'{orders}'} and {'{revenue}'}.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground-secondary">Opening note (optional)</span>
            <textarea
              className={`${inputCls} h-auto py-2 resize-y`}
              rows={2}
              maxLength={1000}
              value={cfg.intro}
              onChange={e => set({ intro: e.target.value })}
              placeholder="Shown above the sections, e.g. who to call about late orders."
              disabled={disabled}
            />
          </label>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Sections, in order</p>
            {cfg.sections.map((s, i) => {
              const meta = OPS_SECTIONS[s.id] as { label: string; hint: string; days?: string; limit?: string; threshold?: string }
              const lock = lockedSections[s.id]
              return (
                <div key={s.id} className={`rounded-lg border border-border-default p-3 ${lock ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-accent-500"
                      checked={s.on && !lock}
                      disabled={disabled || !!lock}
                      onChange={e => setSection(s.id, { on: e.target.checked })}
                      aria-label={meta.label}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {meta.label}
                        {lock && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-foreground-muted">
                            <Lock className="h-3 w-3" /> {lock}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-foreground-muted">{meta.hint}</p>
                      {s.on && !lock && (meta.days || meta.limit || meta.threshold) && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {(['days', 'threshold', 'limit'] as const).map(k =>
                            meta[k] && s[k] !== undefined ? (
                              <label key={k} className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                                <span className="whitespace-nowrap">{meta[k]}</span>
                                <input
                                  type="number"
                                  min={k === 'threshold' ? 0 : 1}
                                  max={k === 'days' ? 60 : k === 'limit' ? 50 : 100000}
                                  className={`${inputCls} w-20`}
                                  value={s[k]}
                                  disabled={disabled}
                                  onChange={e => setSection(s.id, { [k]: Math.max(k === 'threshold' ? 0 : 1, Number(e.target.value) || 0) })}
                                />
                              </label>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0} className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-surface-secondary disabled:opacity-30" aria-label={`Move ${meta.label} up`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={disabled || i === cfg.sections.length - 1} className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-surface-secondary disabled:opacity-30" aria-label={`Move ${meta.label} down`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Attach for the orders waiting to ship</p>
            <div className="flex flex-wrap gap-4">
              {(Object.keys(OPS_ATTACHMENTS) as Array<keyof typeof OPS_ATTACHMENTS>).map(k => {
                const lock = lockedAttachments[k]
                return (
                  <label key={k} className={`inline-flex items-center gap-1.5 text-sm text-foreground ${lock ? 'opacity-60' : ''}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent-500"
                      checked={cfg.attachments[k] && !lock}
                      disabled={disabled || !!lock}
                      onChange={e => set({ attachments: { ...cfg.attachments, [k]: e.target.checked } })}
                    />
                    {OPS_ATTACHMENTS[k].label}
                    {lock && <span className="text-xs text-foreground-muted">({lock})</span>}
                  </label>
                )
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <AdminSelect
                sm
                label="Label size"
                value={cfg.attachments.labelSize}
                onChange={v => set({ attachments: { ...cfg.attachments, labelSize: v as '4x6' | 'a4' } })}
                options={[
                  { value: '4x6', label: '4 × 6 in (thermal)' },
                  { value: 'a4', label: 'A4' },
                ]}
                disabled={disabled || !cfg.attachments.labels}
              />
              <label className="block space-y-1">
                <span className="text-xs font-medium text-foreground-secondary">Largest attachment (MB)</span>
                <input
                  type="number"
                  min={1}
                  max={7}
                  className={inputCls}
                  value={cfg.attachments.maxMb}
                  disabled={disabled}
                  onChange={e => set({ attachments: { ...cfg.attachments, maxMb: Math.min(7, Math.max(1, Number(e.target.value) || 1)) } })}
                />
              </label>
            </div>
            <p className="text-xs text-foreground-muted">One PDF per email. When it would be larger, the email links to Packing slips instead.</p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={test}
              disabled={disabled || busy !== null}
              className="h-control px-4 rounded-lg text-sm font-semibold border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50"
            >
              {busy === 'test' ? 'Sending…' : 'Send me a test'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={disabled || busy !== null || !dirty}
              className="h-control px-4 rounded-lg text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>

        <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Preview</p>
            {loadingPreview && <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />}
          </div>
          {previewError && <p className="text-xs text-red-600">{previewError}</p>}
          {preview && (
            <>
              <p className="text-sm text-foreground">
                <span className="text-foreground-muted">Subject:</span> {preview.subject}
              </p>
              <iframe title="Daily email preview" sandbox="" srcDoc={preview.html} className="w-full h-[720px] rounded-lg border border-border-default bg-white" />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
