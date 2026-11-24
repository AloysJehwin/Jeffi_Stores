'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import { ActionButton, Badge, FormField, FormGrid, TextInput, useActionToast } from '@/components/admin/kit'
import AdminSelect from '@/components/admin/AdminSelect'
import type { SenderAudience, TenantSenderMeta } from '@/lib/messaging/tenant-senders'
import { DLT_ENTITY_RE, DLT_HEADER_RE, INDIA_DLT_COST_HINT, IN_DLT_REGION, isIndiaDltConfig } from '@/lib/messaging/dlt-sender'

// One sender (channel + audience) with its provider credentials: shown masked, assigned or replaced by
// entering every credential again, removed with a confirm. Used by the platform admin for a store
// (ecom → store → Numbers) and by the flagship administrator for the flagship's own numbers (Settings → Numbers).
// The endpoint answers PUT / DELETE with `{ sender, ...extra }`.

export type Channel = 'sms' | 'whatsapp'
type Provider = 'twilio' | 'aws'
// The form's provider choice: `in_dlt` is an AWS sender on the platform's own account in ap-south-1 (India DLT).
type FormProvider = Provider | 'in_dlt'
const OWN_HEADER = '__own__'
interface FieldDef {
  key: string
  label: string
  secret?: boolean
  required?: boolean
  hint?: string
  only?: Channel
}

export const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp' }
export const AUDIENCE_LABEL: Record<SenderAudience, string> = { customer: 'Customer-facing', admin: 'Admin-facing', ecom: 'Ecom portal' }
const PROVIDERS = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'aws', label: 'AWS' },
]
const IN_DLT_PROVIDER = { value: 'in_dlt', label: 'India SMS (DLT) via AWS' }
const FIELDS: Record<Provider, FieldDef[]> = {
  twilio: [
    { key: 'account_sid', label: 'Account SID', required: true },
    { key: 'auth_token', label: 'Auth token', secret: true, required: true, hint: 'Required even with an API key: Twilio signs incoming messages and delivery callbacks with it.' },
    { key: 'api_key_sid', label: 'API key SID', hint: 'Optional, with its secret: used to send instead of the auth token.' },
    { key: 'api_key_secret', label: 'API key secret', secret: true },
    { key: 'messaging_service_sid', label: 'Messaging service SID' },
  ],
  aws: [
    { key: 'region', label: 'Region', required: true, hint: 'e.g. ap-south-1' },
    { key: 'access_key_id', label: 'Access key ID', required: true },
    { key: 'secret_access_key', label: 'Secret access key', secret: true, required: true },
    { key: 'whatsapp_phone_number_id', label: 'WhatsApp phone number ID', required: true, only: 'whatsapp' },
    { key: 'waba_id', label: 'WABA ID', only: 'whatsapp' },
    { key: 'sms_origination', label: 'SMS origination identity', only: 'sms' },
    { key: 'dlt_entity_id', label: 'DLT entity ID', only: 'sms' },
    { key: 'configuration_set', label: 'Configuration set', only: 'sms' },
  ],
}
const fieldsFor = (provider: FormProvider, channel: Channel) => (provider === 'in_dlt' ? [] : FIELDS[provider].filter(f => !f.only || f.only === channel))

export const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function stored(meta: Record<string, unknown>, f: FieldDef): string | null {
  if (f.secret) return meta[`has_${f.key}`] ? 'set' : null
  const v = meta[`${f.key}_last4`] ?? meta[f.key]
  return v == null || v === '' ? null : String(v)
}

export interface SenderBadge {
  tone: 'green' | 'amber' | 'muted'
  label: string
}

const formProviderOf = (s: TenantSenderMeta | null): FormProvider => (s && isIndiaDltConfig(s.meta) ? 'in_dlt' : (s?.provider ?? 'twilio'))

export default function SenderCard({
  url,
  channel,
  audience,
  initial,
  badge,
  empty,
  note,
  onChange,
  platformAccount,
  dltHeaders = [],
  checkUrl,
  readOnly,
}: {
  /** PUT / DELETE target for this channel and audience. */
  url: string
  channel: Channel
  audience: SenderAudience
  initial: TenantSenderMeta | null
  badge: (sender: TenantSenderMeta | null, data: Record<string, unknown>) => SenderBadge
  /** Shown when nothing is assigned. */
  empty: string
  note?: (sender: TenantSenderMeta | null, data: Record<string, unknown>) => ReactNode
  onChange?: (data: Record<string, unknown>) => void
  /** The flagship: Twilio credentials may stay blank to send through the platform's own Twilio account. */
  platformAccount?: boolean
  /** The platform's registered DLT headers (Settings → Providers), offered for an India SMS sender. */
  dltHeaders?: string[]
  /** GET ?header= → { registered }: the read-only "Check sender ID" on AWS. */
  checkUrl?: string
  /** Show the sender without Assign / Replace / Remove (only the platform administrator edits). */
  readOnly?: boolean
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [sender, setSender] = useState(initial)
  const [data, setData] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<FormProvider>(formProviderOf(initial))
  const [pick, setPick] = useState(dltHeaders[0] ?? OWN_HEADER)
  const [entity, setEntity] = useState('')
  const [check, setCheck] = useState<{ registered: boolean; header: string } | null>(null)
  const [from, setFrom] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const inDlt = provider === 'in_dlt'
  const ownHeader = pick === OWN_HEADER
  const header = inDlt && !ownHeader ? pick : from.trim()
  const optional = !!platformAccount && provider === 'twilio'
  const fields = fieldsFor(provider, channel).map(f => (optional ? { ...f, required: false } : f))
  const filled = fields.some(f => !!config[f.key]?.trim())
  const valid = inDlt
    ? DLT_HEADER_RE.test(header) && (!ownHeader || DLT_ENTITY_RE.test(entity.trim()))
    : !!from.trim() &&
    (optional && filled
      ? !!config.account_sid?.trim() && (!!config.auth_token?.trim() || (!!config.api_key_sid?.trim() && !!config.api_key_secret?.trim()))
      : fields.every(f => !f.required || !!config[f.key]?.trim()))
  const label = `${AUDIENCE_LABEL[audience]} ${CHANNEL_LABEL[channel]}`

  function open() {
    setProvider(formProviderOf(sender))
    setFrom(sender?.sender ?? '')
    setPick(sender && isIndiaDltConfig(sender.meta) ? (!sender.meta.dlt_entity_id && dltHeaders.includes(sender.sender) ? sender.sender : OWN_HEADER) : (dltHeaders[0] ?? OWN_HEADER))
    setEntity('')
    setCheck(null)
    setConfig({})
    setEditing(true)
  }

  async function call(method: 'PUT' | 'DELETE', body?: unknown) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
    const json = await res?.json().catch(() => ({}))
    if (!res?.ok) {
      toast.error(json?.error || 'Could not update the number')
      return false
    }
    setSender(json.sender ?? null)
    setData(json)
    onChange?.(json)
    setEditing(false)
    router.refresh()
    return true
  }

  async function save() {
    if (inDlt) {
      const body = { provider: 'aws', sender: header, config: { credentials: 'platform', ...(ownHeader ? { dlt_entity_id: entity.trim() } : {}) } }
      if (await call('PUT', body)) toast.success(`${label} sender saved`)
      return
    }
    const clean = Object.fromEntries(fields.map(f => [f.key, config[f.key]?.trim() ?? '']).filter(([, v]) => v))
    if (await call('PUT', { provider, sender: from.trim(), config: clean })) toast.success(`${label} number saved`)
  }
  async function checkHeader(h: string) {
    const res = await fetch(`${checkUrl}?header=${encodeURIComponent(h)}`).catch(() => null)
    const json = await res?.json().catch(() => ({}))
    if (!res?.ok) return void toast.error(json?.error || 'Could not check the sender ID')
    setCheck({ registered: !!json.registered, header: h })
  }
  async function remove() {
    if (await call('DELETE')) toast.success(`${label} number removed`)
  }

  const senderLabel = channel === 'sms' ? 'DLT header / sender ID' : 'WhatsApp number'
  const b = badge(sender, data)

  return (
    <div className="rounded-lg border border-border-default p-4 min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{CHANNEL_LABEL[channel]}</h3>
          <Badge tone={b.tone}>{b.label}</Badge>
        </div>
        {!editing && !readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton action={{ label: sender ? 'Replace' : 'Assign', icon: sender ? Pencil : Plus, onClick: open }} />
            {sender && (
              <ActionButton
                action={{
                  label: 'Remove',
                  icon: Trash2,
                  danger: true,
                  onClick: remove,
                  confirm: { title: `Remove the ${label} number?`, message: 'Its stored credentials are deleted.' },
                }}
              />
            )}
          </div>
        )}
      </div>

      {note?.(sender, data)}

      {!editing &&
        (sender ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm min-w-0">
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Provider</dt>
              <dd className="font-medium text-foreground">{isIndiaDltConfig(sender.meta) ? 'India SMS (DLT) via AWS' : sender.provider === 'aws' ? 'AWS' : 'Twilio'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">{senderLabel}</dt>
              <dd className="font-medium text-foreground break-all">{sender.sender}</dd>
            </div>
            {sender.provider === 'twilio' && !sender.meta.account_sid_last4 && (
              <div className="min-w-0">
                <dt className="text-xs text-foreground-muted">Account</dt>
                <dd className="text-foreground">Platform Twilio account</dd>
              </div>
            )}
            {fieldsFor(sender.provider, channel).map(f => {
              const v = stored(sender.meta, f)
              return v ? (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs text-foreground-muted">{f.label}</dt>
                  <dd className="text-foreground break-all">{f.secret ? '•••••••• (stored)' : v}</dd>
                </div>
              ) : null
            })}
            {isIndiaDltConfig(sender.meta) && (
              <>
                <div className="min-w-0">
                  <dt className="text-xs text-foreground-muted">Account</dt>
                  <dd className="text-foreground">Platform AWS account · {IN_DLT_REGION}</dd>
                </div>
                {!sender.meta.dlt_entity_id && (
                  <div className="min-w-0">
                    <dt className="text-xs text-foreground-muted">DLT entity</dt>
                    <dd className="text-foreground">Jeffi Stores (shared)</dd>
                  </div>
                )}
                <div className="min-w-0 sm:col-span-2 flex flex-wrap items-center gap-2">
                  {checkUrl && <ActionButton action={{ label: 'Check sender ID', icon: ShieldCheck, onClick: () => checkHeader(sender.sender) }} />}
                  {check && check.header === sender.sender && <Badge tone={check.registered ? 'green' : 'amber'}>{check.registered ? 'Registered on AWS' : 'Not registered on AWS'}</Badge>}
                </div>
                <p className="sm:col-span-2 text-xs text-foreground-muted">{INDIA_DLT_COST_HINT}</p>
              </>
            )}
            <div className="min-w-0 sm:col-span-2 text-xs text-foreground-muted">Updated {day(sender.updatedAt)}</div>
          </dl>
        ) : (
          <p className="text-sm text-foreground-muted">{empty}</p>
        ))}

      {editing && (
        <div className="space-y-3">
          {sender && <p className="text-xs text-foreground-muted">Replacing overwrites the stored credentials: enter all of them again.</p>}
          {optional && <p className="text-xs text-foreground-muted">Leave the Twilio fields blank for a number bought in the platform&apos;s own Twilio account.</p>}
          <FormGrid cols={2}>
            <FormField label="Provider">
              <AdminSelect
                value={provider}
                options={channel === 'sms' ? [...PROVIDERS, IN_DLT_PROVIDER] : PROVIDERS}
                onChange={v => setProvider(v === 'aws' ? 'aws' : v === 'in_dlt' ? 'in_dlt' : 'twilio')}
              />
            </FormField>
            {inDlt ? (
              <>
                <FormField label="DLT header" required hint="The platform's registered headers share Jeffi's entity; or bring your own header and entity.">
                  <AdminSelect
                    value={pick}
                    options={[...dltHeaders.map(h => ({ value: h, label: `${h} (platform)` })), { value: OWN_HEADER, label: 'My own header' }]}
                    onChange={v => setPick(v)}
                  />
                </FormField>
                {ownHeader && (
                  <>
                    <FormField label="Your DLT header" required hint="3 to 11 letters or digits, registered on your own DLT entity.">
                      <TextInput value={from} onChange={e => setFrom(e.target.value)} maxLength={11} autoComplete="off" />
                    </FormField>
                    <FormField label="Your DLT entity ID" required hint="The Principal Entity ID from the Airtel DLT portal.">
                      <TextInput value={entity} onChange={e => setEntity(e.target.value)} maxLength={25} inputMode="numeric" autoComplete="off" />
                    </FormField>
                  </>
                )}
                <FormField label="Region" hint="Fixed: the only region with AWS's local India DLT route.">
                  <TextInput value={IN_DLT_REGION} disabled readOnly />
                </FormField>
                <FormField label="AWS account" hint="The platform's AWS account sends this: no keys to enter.">
                  <TextInput value="Platform account" disabled readOnly />
                </FormField>
              </>
            ) : (
            <FormField label={senderLabel} required hint={channel === 'sms' ? 'The DLT-registered header, or a Twilio number.' : 'In international format, e.g. +919876543210.'}>
              <TextInput value={from} onChange={e => setFrom(e.target.value)} maxLength={120} autoComplete="off" />
            </FormField>
            )}
            {fields.map(f => (
              <FormField key={f.key} label={f.label} required={f.required} hint={f.hint}>
                <TextInput
                  type={f.secret ? 'password' : 'text'}
                  value={config[f.key] ?? ''}
                  onChange={e => setConfig(c => ({ ...c, [f.key]: e.target.value }))}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                />
              </FormField>
            ))}
          </FormGrid>
          {inDlt && (
            <div className="flex flex-wrap items-center gap-2">
              {checkUrl && <ActionButton action={{ label: 'Check sender ID', icon: ShieldCheck, onClick: () => checkHeader(header), disabled: !DLT_HEADER_RE.test(header) }} />}
              {check && check.header === header && <Badge tone={check.registered ? 'green' : 'amber'}>{check.registered ? 'Registered on AWS' : 'Not registered on AWS'}</Badge>}
              <p className="text-xs text-foreground-muted w-full">{INDIA_DLT_COST_HINT}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              variant="primary"
              action={{
                label: sender ? 'Replace number' : 'Save number',
                icon: Save,
                onClick: save,
                disabled: !valid,
                confirm: sender ? { title: `Replace the ${label} number?`, message: 'New messages go out from the new number straight away.' } : undefined,
              }}
            />
            <ActionButton action={{ label: 'Cancel', icon: X, onClick: () => setEditing(false) }} />
          </div>
        </div>
      )}
    </div>
  )
}
