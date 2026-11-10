'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ActionButton, badgeCls, fieldInputCls, useActionToast, useOverviewData } from '@/components/admin/kit'
import AdminSelect from './AdminSelect'

// GET /api/admin/integrations/upi (docs/plans/UPI_UPG_V2.md §4). Kept here so the card doesn't pull in server types.
export interface UpiPhonePeInfo {
  kind?: 'platform' | 'store'
  editable?: boolean
  connected?: boolean
  env?: 'sandbox' | 'production' | null
  clientId?: string | null
  clientVersion?: string | null
  merchantId?: string | null
  webhookAuthSet?: boolean
  webhookUrl?: string | null
}

export interface UpiCollectionInfo {
  provider: 'phonepe' | 'upg' | 'none'
  killed: boolean
  reason?: string | null
  vpa: string | null
  vpaEditable: boolean
  alerts?: {
    address: string | null
    connected: boolean
    lastAlertAt: string | null
    trustedCount30d?: number
    gmailConfirmation?: { code?: string | null; link?: string | null; at?: string | null } | null
  } | null
  phonepe?: UpiPhonePeInfo | null
}

const PROVIDER: Record<UpiCollectionInfo['provider'], { label: string; why: string }> = {
  phonepe: {
    label: 'PhonePe',
    why: 'PhonePe credentials are saved, so customers pay on PhonePe’s page and payments are confirmed automatically.',
  },
  upg: {
    label: 'Direct to your UPI ID',
    why: 'No PhonePe account is connected, so customers pay your UPI ID from a QR code or their UPI app. A payment is confirmed automatically when your bank’s credit alert email reaches us (set up below); otherwise the customer enters the UTR and you approve it under Financial → UPI confirmations.',
  },
  none: {
    label: 'Not set up',
    why: 'Add a UPI ID or PhonePe credentials below to offer UPI at checkout.',
  },
}

const EMPTY = { env: 'sandbox', client_id: '', client_secret: '', client_version: '', merchant_id: '', webhook_username: '', webhook_password: '' }
const FIELDS: Array<{ k: Exclude<keyof typeof EMPTY, 'env'>; label: string; secret?: boolean; optional?: boolean }> = [
  { k: 'client_id', label: 'Client id' },
  { k: 'client_secret', label: 'Client secret', secret: true },
  { k: 'client_version', label: 'Client version' },
  { k: 'merchant_id', label: 'Merchant id', optional: true },
  { k: 'webhook_username', label: 'Webhook username', optional: true },
  { k: 'webhook_password', label: 'Webhook password', secret: true, optional: true },
]

const VPA_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null

/** Only Google's own confirmation links are made clickable. */
function googleLink(link?: string | null): string | null {
  try {
    const u = new URL(link || '')
    return u.protocol === 'https:' && (u.hostname === 'google.com' || u.hostname.endsWith('.google.com')) ? u.toString() : null
  } catch {
    return null
  }
}

const subhead = 'text-xs font-semibold uppercase tracking-wide text-foreground-muted'

/** How this store (or the platform) collects UPI: provider in effect, UPI ID, bank-alert forwarding and PhonePe credentials. */
export default function UpiCollectionCard() {
  const { data, error, reload } = useOverviewData<UpiCollectionInfo>('/api/admin/integrations/upi')
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const [openState, setOpen] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [vpaEdit, setVpaEdit] = useState<string | null>(null)
  const [vpaSaving, setVpaSaving] = useState(false)

  if (error) return null
  if (!data) return <div className="h-14 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />

  const pp: UpiPhonePeInfo = data.phonepe ?? {}
  const alerts = data.alerts ?? null
  const prov = PROVIDER[data.provider] ?? PROVIDER.none
  const needsSetup = !data.killed && (data.provider === 'none' || (data.provider === 'upg' && !alerts?.connected))
  const open = openState ?? needsSetup
  const confirmation = alerts?.gmailConfirmation ?? null
  const confirmLink = googleLink(confirmation?.link)
  const vpaValid = vpaEdit !== null && VPA_RE.test(vpaEdit.trim())

  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied.'))

  async function call(method: 'POST' | 'PUT' | 'DELETE', body?: unknown, qs = '') {
    const res = await fetch(`/api/admin/integrations/phonepe${qs}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  }

  async function test() {
    setTesting(true)
    const { ok, data: r } = await call('POST', undefined, '?action=test')
    setTesting(false)
    if (ok && r.ok) toast.success(r.message)
    else toast.error(r.message || r.error || 'Could not reach PhonePe.')
  }

  async function save() {
    setSaving(true)
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''))
    const { ok, data: r } = await call('PUT', body)
    setSaving(false)
    if (!ok) return toast.error(r.error || 'Could not save the credentials.')
    toast.success(r.message || 'PhonePe credentials saved. UPI is now collected through PhonePe.')
    setForm(EMPTY)
    setEditing(false)
    reload()
  }

  async function remove() {
    const { ok, data: r } = await call('DELETE')
    if (!ok) return toast.error(r.error || 'Could not remove the credentials.')
    toast.success('PhonePe credentials removed.')
    reload()
  }

  async function saveVpa() {
    if (!vpaValid) return
    setVpaSaving(true)
    const res = await fetch('/api/admin/integrations/upi/vpa', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vpa: vpaEdit!.trim() }) }).catch(() => null)
    const r = await res?.json().catch(() => ({}))
    setVpaSaving(false)
    if (!res?.ok) return toast.error(r?.error || 'Could not save the UPI ID.')
    toast.success('UPI ID saved.')
    setVpaEdit(null)
    reload()
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="shrink-0 text-sm font-semibold text-foreground">UPI collection</span>
          <span className="truncate text-xs text-foreground-muted">
            {prov.label}
            {data.provider === 'phonepe' ? (pp.clientId ? ` · ${pp.clientId}` : '') : data.vpa ? ` · ${data.vpa}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {data.provider === 'phonepe' && pp.env && <span className={badgeCls(pp.env === 'production' ? 'green' : 'amber')}>{pp.env}</span>}
          {data.killed ? (
            <span className={badgeCls('muted')}>off</span>
          ) : data.provider === 'none' ? (
            <span className={badgeCls('red')}>not set up</span>
          ) : data.provider === 'upg' && !alerts?.connected ? (
            <span className={badgeCls('amber')}>alerts not connected</span>
          ) : (
            <span className={badgeCls('green')}>active</span>
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border-default px-4 py-4 text-sm">
          <div className="space-y-1">
            <p className={subhead}>In effect</p>
            <p className="font-medium text-foreground">{data.killed ? `UPI is off (would use: ${prov.label})` : prov.label}</p>
            <p className="text-xs text-foreground-muted">
              {data.killed ? data.reason || 'UPI is switched off for this store, by the UPI switch above or by the platform. Nothing below is used until it is back on.' : data.reason || prov.why}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className={subhead}>UPI ID</p>
            {vpaEdit === null ? (
              <div className="flex flex-wrap items-center gap-2">
                {data.vpa ? <code className="break-all font-mono text-sm text-foreground">{data.vpa}</code> : <span className="text-xs text-red-600 dark:text-red-400">Not set</span>}
                {data.vpa && (
                  <button type="button" title="Copy UPI ID" aria-label="Copy UPI ID" onClick={() => copy(data.vpa!)} className="control-sm border border-border-default">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
                {data.vpaEditable && canWrite && (
                  <button type="button" onClick={() => setVpaEdit(data.vpa ?? '')} className="control-sm inline-flex items-center gap-1.5 border border-border-default font-medium">
                    <Pencil className="h-3.5 w-3.5" /> {data.vpa ? 'Change' : 'Add UPI ID'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    aria-label="UPI ID"
                    autoFocus
                    autoComplete="off"
                    placeholder="yourstore@bank"
                    value={vpaEdit}
                    onChange={e => setVpaEdit(e.target.value.replace(/\s+/g, ''))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void saveVpa()
                    }}
                    className={`${fieldInputCls} font-mono sm:max-w-xs`}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={saveVpa} disabled={vpaSaving || !vpaValid} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
                      {vpaSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setVpaEdit(null)} className="control-md border border-border-default font-medium">
                      Cancel
                    </button>
                  </div>
                </div>
                {vpaEdit !== '' && !vpaValid && <p className="text-xs text-red-600 dark:text-red-400">Enter a UPI ID like name@bank.</p>}
              </div>
            )}
            <p className="text-[11px] text-foreground-muted">
              {data.vpaEditable
                ? 'Customers pay this ID when PhonePe is not connected. Use the UPI ID of the bank account whose credit alerts you forward below.'
                : 'Only the owner can change the UPI ID.'}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Use a business UPI ID (PhonePe Business, Google Pay for Business, Paytm Business or BharatPe). Google Pay and PhonePe refuse payments
              opened from your checkout to a personal UPI ID as risky; customers can then only pay by scanning the QR.
            </p>
          </div>

          {alerts?.address && data.provider !== 'phonepe' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className={subhead}>Bank alerts</p>
                <span className={badgeCls(alerts.connected ? 'green' : 'amber')}>{alerts.connected ? 'connected' : 'not connected'}</span>
                <button type="button" onClick={reload} title="Refresh" aria-label="Refresh" className="control-sm border border-border-default">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-foreground-muted">
                Forward your bank&apos;s credit alert emails to this address and UPI payments are confirmed by themselves, within seconds of the alert.
                {alerts.lastAlertAt ? ` Last alert: ${when(alerts.lastAlertAt)}.` : ' No alert has arrived yet.'}
                {typeof alerts.trustedCount30d === 'number' && alerts.trustedCount30d > 0 ? ` ${alerts.trustedCount30d} verified in the last 30 days.` : ''}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-surface-secondary px-2 py-1.5 text-xs">{alerts.address}</code>
                <button type="button" title="Copy forwarding address" aria-label="Copy forwarding address" onClick={() => copy(alerts.address!)} className="control-sm border border-border-default">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs text-foreground-secondary">
                <li>
                  In Gmail on a computer (the mailbox your bank sends alerts to), open Settings → See all settings → Forwarding and POP/IMAP → <span className="font-medium">Add a forwarding address</span> and paste the address above.
                </li>
                <li>
                  Gmail emails a confirmation code to that address — it shows up here. Enter it in Gmail to verify.
                  {confirmation?.code || confirmLink ? (
                    <span className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-border-default bg-surface-secondary px-2 py-1.5">
                      {confirmation?.code && (
                        <>
                          <span className="text-foreground-muted">Code</span>
                          <code className="font-mono text-sm font-semibold text-foreground">{confirmation.code}</code>
                          <button type="button" title="Copy code" aria-label="Copy code" onClick={() => copy(confirmation.code!)} className="control-sm border border-border-default">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      {confirmLink && (
                        <a href={confirmLink} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-500 hover:underline">
                          Open Gmail&apos;s confirmation link
                        </a>
                      )}
                      {when(confirmation?.at) && <span className="text-foreground-muted">received {when(confirmation?.at)}</span>}
                    </span>
                  ) : (
                    <span className="mt-1 block text-foreground-muted">Nothing received yet — it usually takes under a minute; press Refresh.</span>
                  )}
                </li>
                <li>
                  Keep &quot;Disable forwarding&quot; selected there, then under Filters and blocked addresses → <span className="font-medium">Create a new filter</span>: From = your bank&apos;s alert address, Has the words = <span className="font-mono">credited</span> → Create filter → <span className="font-medium">Forward it to</span> the address above.
                </li>
                <li>Pay ₹1 to your UPI ID to test. The badge turns to connected when the first alert arrives.</li>
              </ol>
              <p className="text-[11px] text-foreground-muted">
                Only alerts genuinely sent by a bank are trusted. Until alerts are connected, customers enter their UTR and you approve each payment under Financial → UPI confirmations.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className={subhead}>PhonePe account</p>
              <span className={badgeCls(pp.connected ? 'green' : 'muted')}>{pp.connected ? 'connected' : 'not connected'}</span>
            </div>
            <p className="text-xs text-foreground-muted">
              Optional. Saving PhonePe Business credentials switches UPI collection to PhonePe at once; removing them switches back to paying your UPI ID directly.
            </p>

            {pp.webhookUrl && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground-secondary">Webhook</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-surface-secondary px-2 py-1.5 text-xs">{pp.webhookUrl}</code>
                  <button type="button" title="Copy" aria-label="Copy webhook URL" onClick={() => copy(pp.webhookUrl!)} className="control-sm border border-border-default">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-foreground-muted">
                  Register it on the PhonePe Business dashboard under Developer settings → Webhooks, with the webhook username and password{' '}
                  {pp.webhookAuthSet ? '(set)' : <span className="text-red-600 dark:text-red-400">(not set — add them below)</span>}, for the checkout order and refund events.
                </p>
              </div>
            )}

            {(pp.merchantId || pp.clientVersion) && (
              <p className="text-xs text-foreground-muted">
                {pp.merchantId ? <>Merchant id <span className="font-mono text-foreground">{pp.merchantId}</span></> : null}
                {pp.merchantId && pp.clientVersion ? ' · ' : ''}
                {pp.clientVersion ? <>client version <span className="font-mono text-foreground">{pp.clientVersion}</span></> : null}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {canWrite && pp.connected && (
                <button type="button" onClick={test} disabled={testing} className="control-md border border-border-default font-medium disabled:opacity-50">
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              )}
              {canWrite && pp.editable && !editing && (
                <button type="button" onClick={() => setEditing(true)} className="control-md border border-border-default font-medium">
                  {pp.connected ? 'Change credentials' : 'Add credentials'}
                </button>
              )}
              {canWrite && pp.editable && pp.connected && (
                <ActionButton
                  action={{
                    label: 'Remove',
                    icon: Trash2,
                    danger: true,
                    onClick: remove,
                    confirm: {
                      title: 'Remove PhonePe credentials?',
                      message: 'The saved client secret and webhook password are deleted. UPI collection switches back to your UPI ID straight away (or turns off if no UPI ID is set).',
                    },
                  }}
                />
              )}
            </div>

            {editing && (
              <div className="space-y-3 rounded-lg border border-border-default p-3">
                <p className="text-[11px] text-foreground-muted">
                  From the PhonePe Business dashboard → Developer settings → API keys. The credentials are checked with PhonePe before they are saved; secrets are encrypted and never shown again.
                </p>
                <AdminSelect
                  sm
                  label="Environment"
                  value={form.env}
                  options={[
                    { value: 'sandbox', label: 'Sandbox (test)' },
                    { value: 'production', label: 'Production' },
                  ]}
                  onChange={v => setForm({ ...form, env: v })}
                />
                {FIELDS.map(f => (
                  <label key={f.k} className="block">
                    <span className="mb-1 block text-xs font-medium text-foreground-secondary">
                      {f.label}
                      {f.optional ? (f.secret && pp.webhookAuthSet ? ' (leave blank to keep the current one)' : ' (optional)') : ''}
                    </span>
                    <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })} className={fieldInputCls} />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={saving || !form.client_id || !form.client_secret || !form.client_version} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
                    {saving ? 'Checking…' : 'Save credentials'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="control-md border border-border-default font-medium">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
