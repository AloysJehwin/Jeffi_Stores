'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useOverviewData } from '@/components/admin/overview/kit'
import { badgeCls, fieldInputCls, useActionToast } from '@/components/admin/kit'
import type { RazorpayAccountInfo } from '@/lib/payments/rzp-account'

const fmtAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 1)} min ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

/** The Razorpay account this store collects on: keys, webhook URL and events, and whether webhooks arrive. */
export default function RazorpayAccountCard() {
  const { data, error, reload } = useOverviewData<RazorpayAccountInfo>('/api/admin/integrations/razorpay')
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ key_id: '', key_secret: '', webhook_secret: '' })

  if (error) return null
  if (!data) return <div className="h-14 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />

  const own = data.kind === 'own' || data.ownFlag
  const noKeys = own && !data.keyId
  const stale = !data.lastWebhookAt || Date.now() - new Date(data.lastWebhookAt).getTime() > 3 * 86400000

  async function post(body: unknown) {
    const res = await fetch('/api/admin/integrations/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  }

  async function test() {
    setTesting(true)
    const { ok, data: r } = await post({ action: 'test' })
    setTesting(false)
    if (ok && r.ok) toast.success(r.message)
    else toast.error(r.message || r.error || 'Could not reach Razorpay.')
  }

  async function save() {
    setSaving(true)
    const { ok, data: r } = await post({ action: 'save', ...form })
    setSaving(false)
    if (!ok) return toast.error(r.error || 'Could not save the keys.')
    toast.success(r.message || 'Razorpay keys saved.')
    setForm({ key_id: '', key_secret: '', webhook_secret: '' })
    setEditing(false)
    reload()
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="text-sm font-semibold text-foreground">Razorpay account</span>
          <span className="truncate text-xs text-foreground-muted">
            {own ? 'Your own account' : 'Platform account'}
            {data.keyId ? ` · ${data.keyId}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {data.mode && <span className={badgeCls(data.mode === 'live' ? 'green' : 'amber')}>{data.mode}</span>}
          {noKeys ? (
            <span className={badgeCls('red')}>keys not set</span>
          ) : (
            <span className={badgeCls(stale ? 'amber' : 'green')}>{data.lastWebhookAt ? `webhook ${fmtAgo(data.lastWebhookAt)}` : 'no webhook yet'}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-default px-4 py-4 text-sm">
          {data.kind === 'platform' && (
            <p className="text-xs text-foreground-muted">The platform&apos;s keys come from the server settings and can&apos;t be changed here.</p>
          )}
          {noKeys && <p className="text-xs text-red-600 dark:text-red-400">This store is set to collect on its own Razorpay account, but no keys are saved. Until they are, payments go through the platform account.</p>}

          {data.webhookUrl && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground-secondary">Webhook</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-surface-secondary px-2 py-1.5 text-xs">{data.webhookUrl}</code>
                <button
                  type="button"
                  title="Copy"
                  onClick={() => navigator.clipboard.writeText(data.webhookUrl!).then(() => toast.success('Copied.'))}
                  className="control-sm border border-border-default"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-foreground-muted">
                Add it in the Razorpay dashboard under Account &amp; Settings → Webhooks, with the webhook secret{' '}
                {data.webhookSecretSet ? '(set)' : <span className="text-red-600 dark:text-red-400">(not set — add one below)</span>}, and tick these events:
              </p>
              <div className="flex flex-wrap gap-1">
                {data.events.map(e => (
                  <span key={e} className="rounded border border-border-default px-1.5 py-0.5 font-mono text-[10px] text-foreground-secondary">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canWrite && data.keyId && (
              <button type="button" onClick={test} disabled={testing} className="control-md border border-border-default font-medium disabled:opacity-50">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            )}
            {data.editable && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="control-md border border-border-default font-medium">
                {data.keyId ? 'Change keys' : 'Add keys'}
              </button>
            )}
          </div>

          {editing && (
            <div className="space-y-3 rounded-lg border border-border-default p-3">
              <p className="text-[11px] text-foreground-muted">
                From the Razorpay dashboard → Account &amp; Settings → API keys. The keys are checked with Razorpay before they are saved. Checkouts already open
                when you change them may need the customer to try again.
              </p>
              {(['key_id', 'key_secret', 'webhook_secret'] as const).map(k => (
                <label key={k} className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground-secondary">
                    {k === 'key_id' ? 'Key id' : k === 'key_secret' ? 'Key secret' : 'Webhook secret'}
                    {k === 'webhook_secret' && data.webhookSecretSet ? ' (leave blank to keep the current one)' : ''}
                  </span>
                  <input
                    type={k === 'key_id' ? 'text' : 'password'}
                    autoComplete="off"
                    value={form[k]}
                    onChange={e => setForm({ ...form, [k]: e.target.value })}
                    placeholder={k === 'key_id' ? 'rzp_live_…' : ''}
                    className={fieldInputCls}
                  />
                </label>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !form.key_id || !form.key_secret}
                  className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? 'Checking…' : 'Save keys'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="control-md border border-border-default font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
