'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, MessagesSquare, PhoneCall, RotateCcw } from 'lucide-react'
import Select from '@/components/ui/Select'
import { Badge } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import { asText, clearSettings, isOverridden, keyStatus, providerLabel, putSettings, type ProvidersData } from './model'
import { SaveButton, StatusLine, btnSmall, useSectionSave } from './parts'

// Row 1 of Settings → Providers: who sends SMS and WhatsApp, and who places Outreach calls.
// The flagship administrator edits them; a store sees its messaging providers read-only and no calling.

type Key = 'sms_provider' | 'whatsapp_provider' | 'voice_provider'
const CHANNELS: { key: Key; label: string; icon: typeof MessageSquare; options: string[] }[] = [
  { key: 'sms_provider', label: 'SMS', icon: MessageSquare, options: ['twilio', 'aws'] },
  { key: 'whatsapp_provider', label: 'WhatsApp', icon: MessagesSquare, options: ['twilio', 'aws'] },
  { key: 'voice_provider', label: 'Calling', icon: PhoneCall, options: ['exotel', 'twilio_test'] },
]

export default function ChannelProviders({ data, flagship, canWrite, onSaved }: { data: ProvidersData; flagship: boolean; canWrite: boolean; onSaved: () => Promise<void> }) {
  const toast = useActionToast()
  const store = data.scope.kind === 'store'
  const tenantId = store ? (data.scope.tenantId ?? null) : null
  const shown = CHANNELS.filter(c => c.key !== 'voice_provider' || (flagship && !store))
  const editable = (k: Key) => canWrite && (k === 'voice_provider' ? data.canEdit.calling : data.canEdit.messaging)

  const saved = useMemo<Record<Key, string>>(
    () => ({
      sms_provider: asText(data.settings.sms_provider),
      whatsapp_provider: asText(data.settings.whatsapp_provider),
      voice_provider: asText(data.settings.voice_provider) || data.voice?.provider || '',
    }),
    [data]
  )
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const { state, run, touch } = useSectionSave('Providers')
  const changed = shown.filter(c => editable(c.key) && draft[c.key] && draft[c.key] !== saved[c.key])
  const anyEditable = shown.some(c => editable(c.key))

  const save = () => run(() => putSettings(tenantId, changed.map(c => [c.key, draft[c.key]])), onSaved)
  async function reset(k: Key) {
    const r = await clearSettings(tenantId, [k])
    toast.result({ ok: r.ok, text: r.ok ? `${CHANNELS.find(c => c.key === k)!.label} reset to the platform default` : r.error })
    if (r.ok) await onSaved()
  }

  return (
    <section aria-labelledby="providers-channels" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="providers-channels" className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Messaging{shown.length > 2 ? ' and calling' : ''}
        </h3>
        {anyEditable && <SaveButton label="Save providers" dirty={changed.length > 0} state={state} onSave={save} />}
      </div>
      <div className={`grid grid-cols-1 gap-3 ${shown.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {shown.map(c => {
          const value = draft[c.key]
          const canEdit = editable(c.key)
          const override = isOverridden(data, c.key)
          const ready = c.key === 'voice_provider' ? undefined : data.messaging?.[c.key === 'sms_provider' ? 'sms' : 'whatsapp']
          const status = !flagship ? null : value ? keyStatus(data.secrets, value, ready?.[value as 'twilio' | 'aws']) : null
          const Icon = c.icon
          return (
            <div key={c.key} className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  <Icon aria-hidden className="h-3.5 w-3.5" />
                  {c.label}
                </span>
                {store && flagship && (override ? <Badge tone="blue">Store override</Badge> : <Badge>Inherited from platform</Badge>)}
              </div>
              {canEdit ? (
                <Select
                  className="w-full"
                  size="sm"
                  aria-label={`${c.label} provider`}
                  value={value}
                  placeholder="Not set"
                  onChange={v => {
                    touch()
                    setDraft(d => ({ ...d, [c.key]: v }))
                  }}
                  options={c.options.map(o => {
                    const ok = ready?.[o as 'twilio' | 'aws']
                    return { value: o, label: providerLabel(o), disabled: ok === false && o !== saved[c.key], hint: ok === false ? 'Not ready' : undefined }
                  })}
                />
              ) : (
                <p className="text-base font-semibold text-foreground">{value ? providerLabel(value) : 'Platform default'}</p>
              )}
              <div className="mt-2 flex min-h-5 items-center justify-between gap-2">
                {status ? (
                  <StatusLine ok={status.ok} mono={status.secret}>
                    {status.text}
                  </StatusLine>
                ) : !flagship ? (
                  <span className="text-xs text-foreground-muted">Managed by the platform</span>
                ) : !value ? (
                  <span className="text-xs text-foreground-muted">Not set: stores keep their earlier choice</span>
                ) : (
                  <span />
                )}
                {store && override && canEdit && (
                  <button type="button" className={btnSmall} onClick={() => reset(c.key)} aria-label={`Reset ${c.label} to the platform default`}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
