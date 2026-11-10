'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { ActionButton, Badge, FormField, FormGrid, TextInput, useActionToast } from '@/components/admin/kit'
import AdminSelect from '@/components/admin/AdminSelect'
import type { TenantSenderMeta } from '@/lib/messaging/tenant-senders'
import type { EntitlementState, MessagingAddonStatus } from '@/lib/billing/messaging-addon'

type Channel = 'sms' | 'whatsapp'
type Provider = 'twilio' | 'aws'
interface FieldDef {
  key: string
  label: string
  secret?: boolean
  required?: boolean
  hint?: string
  /** Shown for one channel only. */
  only?: Channel
}

const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp' }
const PROVIDERS = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'aws', label: 'AWS' },
]
const FIELDS: Record<Provider, FieldDef[]> = {
  twilio: [
    { key: 'account_sid', label: 'Account SID', required: true },
    { key: 'auth_token', label: 'Auth token', secret: true, required: true, hint: 'Required even with an API key: Twilio signs delivery callbacks with it, so without it there is no delivery status or price true-up.' },
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
const fieldsFor = (provider: Provider, channel: Channel) => FIELDS[provider].filter(f => !f.only || f.only === channel)

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** What is stored, masked: secrets as "set", ids by their last 4. */
function stored(meta: Record<string, unknown>, f: FieldDef): string | null {
  if (f.secret) return meta[`has_${f.key}`] ? 'set' : null
  const v = meta[`${f.key}_last4`] ?? meta[f.key]
  return v == null || v === '' ? null : String(v)
}

function ChannelCard({ tenantId, channel, initial, initialState }: { tenantId: string; channel: Channel; initial: TenantSenderMeta | null; initialState: EntitlementState }) {
  const router = useRouter()
  const toast = useActionToast()
  const [sender, setSender] = useState(initial)
  const [state, setState] = useState(initialState)
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? 'twilio')
  const [from, setFrom] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const url = `/api/admin/ecom/${tenantId}/messaging-senders/${channel}`
  const fields = fieldsFor(provider, channel)
  const valid = !!from.trim() && fields.every(f => !f.required || !!config[f.key]?.trim())

  function open() {
    setProvider(sender?.provider ?? 'twilio')
    setFrom(sender?.sender ?? '')
    setConfig({})
    setEditing(true)
  }

  async function call(method: 'PUT' | 'DELETE', body?: unknown) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) {
      toast.error(data?.error || 'Could not update the sender')
      return false
    }
    setSender(data.sender ?? null)
    setState(data.entitlement)
    setEditing(false)
    router.refresh()
    return true
  }

  async function save() {
    const clean = Object.fromEntries(fields.map(f => [f.key, config[f.key]?.trim() ?? '']).filter(([, v]) => v))
    if (await call('PUT', { provider, sender: from.trim(), config: clean })) toast.success(`${CHANNEL_LABEL[channel]} sender saved`)
  }
  async function remove() {
    if (await call('DELETE')) toast.success(`${CHANNEL_LABEL[channel]} sender removed`)
  }

  const senderLabel = channel === 'sms' ? 'DLT header / sender ID' : 'WhatsApp number'

  return (
    <div className="rounded-lg border border-border-default p-4 min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{CHANNEL_LABEL[channel]}</h3>
          <Badge tone={state === 'ok' ? 'green' : sender ? 'amber' : 'muted'}>{state === 'ok' ? 'Live' : sender ? 'Assigned, add-on missing' : 'No number'}</Badge>
        </div>
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton action={{ label: sender ? 'Replace' : 'Assign', icon: sender ? Pencil : Plus, onClick: open }} />
            {sender && (
              <ActionButton
                action={{
                  label: 'Remove',
                  icon: Trash2,
                  danger: true,
                  onClick: remove,
                  confirm: { title: `Remove the ${CHANNEL_LABEL[channel]} sender?`, message: `The store stops sending ${CHANNEL_LABEL[channel]} until a new sender is assigned. The stored credentials are deleted.` },
                }}
              />
            )}
          </div>
        )}
      </div>

      {state === 'addon' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          The store&apos;s add-on doesn&apos;t cover {CHANNEL_LABEL[channel]}. {sender ? 'This sender is not used' : 'A sender assigned now is not used'} until the owner buys it in the ecom portal (Billing).
        </p>
      )}

      {!editing &&
        (sender ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm min-w-0">
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Provider</dt>
              <dd className="font-medium text-foreground">{sender.provider === 'aws' ? 'AWS' : 'Twilio'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">{senderLabel}</dt>
              <dd className="font-medium text-foreground break-all">{sender.sender}</dd>
            </div>
            {fieldsFor(sender.provider, channel).map(f => {
              const v = stored(sender.meta, f)
              return v ? (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs text-foreground-muted">{f.label}</dt>
                  <dd className="text-foreground break-all">{f.secret ? '•••••••• (stored)' : v}</dd>
                </div>
              ) : null
            })}
            <div className="min-w-0 sm:col-span-2 text-xs text-foreground-muted">Updated {day(sender.updatedAt)}</div>
          </dl>
        ) : (
          <p className="text-sm text-foreground-muted">No sender assigned. The store can&apos;t send {CHANNEL_LABEL[channel]} until one is.</p>
        ))}

      {editing && (
        <div className="space-y-3">
          {sender && <p className="text-xs text-foreground-muted">Replacing overwrites the stored credentials: enter all of them again.</p>}
          <FormGrid cols={2}>
            <FormField label="Provider">
              <AdminSelect value={provider} options={PROVIDERS} onChange={v => setProvider(v === 'aws' ? 'aws' : 'twilio')} />
            </FormField>
            <FormField label={senderLabel} required hint={channel === 'sms' ? 'The DLT-registered header, or a Twilio number.' : 'In international format, e.g. +919876543210.'}>
              <TextInput value={from} onChange={e => setFrom(e.target.value)} maxLength={120} autoComplete="off" />
            </FormField>
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
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              variant="primary"
              action={{
                label: sender ? 'Replace sender' : 'Save sender',
                icon: Save,
                onClick: save,
                disabled: !valid,
                confirm: sender ? { title: `Replace the ${CHANNEL_LABEL[channel]} sender?`, message: 'New messages go out from the new sender straight away.' } : undefined,
              }}
            />
            <ActionButton action={{ label: 'Cancel', icon: X, onClick: () => setEditing(false) }} />
          </div>
        </div>
      )}
    </div>
  )
}

const TIER_LABEL: Record<MessagingAddonStatus['tier'], string> = { none: 'Not bought', sms: 'SMS', whatsapp: 'WhatsApp', both: 'SMS & WhatsApp' }

export default function MessagingSenders({
  tenantId,
  addon,
  senders,
  entitlement,
}: {
  tenantId: string
  addon: MessagingAddonStatus
  senders: TenantSenderMeta[]
  entitlement: Record<Channel, EntitlementState>
}) {
  return (
    <div className="space-y-4 min-w-0">
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-foreground-muted font-medium">Add-on</dt>
          <dd className="font-semibold text-foreground mt-0.5">{addon.active ? TIER_LABEL[addon.tier] : addon.tier === 'none' ? 'Not bought' : `${TIER_LABEL[addon.tier]} (lapsed)`}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-foreground-muted font-medium">{addon.active ? 'Paid until' : 'Ended'}</dt>
          <dd className="font-semibold text-foreground mt-0.5">{addon.until ? day(addon.until) : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-foreground-muted font-medium">Auto-renew</dt>
          <dd className="font-semibold text-foreground mt-0.5">{addon.renew ? 'On' : 'Off'}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(['sms', 'whatsapp'] as const).map(ch => (
          <ChannelCard key={ch} tenantId={tenantId} channel={ch} initial={senders.find(s => s.channel === ch) ?? null} initialState={entitlement[ch]} />
        ))}
      </div>
      <p className="text-xs text-foreground-muted">Credentials are stored encrypted and never shown again. A channel goes live when the add-on covers it and a sender is assigned.</p>
    </div>
  )
}
