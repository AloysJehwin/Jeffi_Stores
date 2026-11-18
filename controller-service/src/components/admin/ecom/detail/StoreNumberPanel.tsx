'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, RefreshCw, Search, ShoppingCart, Trash2, RotateCcw } from 'lucide-react'
import { ActionButton, Badge, FormField, FormGrid, TextInput, useActionToast } from '@/components/admin/kit'
import type { SenderAudience, TenantSenderMeta } from '@/lib/messaging/tenant-senders'

// Get a number for a store's audience in one step (platform admin, store → Numbers): search the platform's Twilio
// account, buy, bind to every channel the audience has, register it on WhatsApp under a display name. A bought
// number shows its WhatsApp status and can be retried or released (charges stop).

interface Available {
  number: string
  locality: string | null
  region: string | null
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'muted'> = { ONLINE: 'green', OFFLINE: 'amber', NOT_REGISTERED: 'amber', UNKNOWN: 'amber' }

export default function StoreNumberPanel({
  tenantId,
  audience,
  storeName,
  rows,
}: {
  tenantId: string
  audience: Exclude<SenderAudience, 'ecom'>
  storeName: string
  rows: TenantSenderMeta[]
}) {
  const router = useRouter()
  const toast = useActionToast()
  const base = `/api/admin/ecom/${tenantId}/numbers`
  const defaultName = audience === 'admin' ? `${storeName} Team` : storeName
  const [open, setOpen] = useState(false)
  const [areaCode, setAreaCode] = useState('872')
  const [found, setFound] = useState<Available[] | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [live, setLive] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(defaultName)
  const [busy, setBusy] = useState(false)

  const wa = rows.find(r => r.channel === 'whatsapp')
  const bought = rows.find(r => r.meta.platform_account)
  const waStatus = typeof wa?.meta.wa_status === 'string' ? wa.meta.wa_status : null
  const waError = typeof wa?.meta.wa_error === 'string' ? wa.meta.wa_error : null

  async function send(method: string, url: string, body?: unknown) {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null)
      const json = await res?.json().catch(() => ({}))
      if (!res?.ok) {
        toast.error(json?.error || 'Request failed')
        return null
      }
      return json
    } finally {
      setBusy(false)
    }
  }

  async function search() {
    const json = await send('GET', `/api/admin/ecom/numbers/available?country=US&areaCode=${encodeURIComponent(areaCode)}`)
    if (!json) return
    setFound(json.numbers ?? [])
    setPrice(json.monthlyUsd ?? null)
    setLive(json.live !== false)
    setPick(json.numbers?.[0]?.number ?? null)
  }

  async function buy() {
    if (!pick) return
    const json = await send('POST', base, { audience, number: pick, displayName: displayName.trim() })
    if (!json) return
    if (json.result?.error) toast.error(`Number bought, WhatsApp registration failed: ${json.result.error}`)
    else toast.success(`${pick} bought and bound; WhatsApp registration started`)
    setOpen(false)
    setFound(null)
    router.refresh()
  }

  const refresh = async () => (await send('GET', base)) && router.refresh()
  const retry = async () => (await send('PATCH', base, { audience, displayName: String(wa?.meta.wa_display_name || defaultName) })) && (toast.success('WhatsApp registration restarted'), router.refresh())
  const release = async () => (await send('DELETE', `${base}?audience=${audience}`)) && (toast.success('Number released'), router.refresh())

  if (bought) {
    return (
      <div className="w-full flex flex-wrap items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-foreground-muted">
        <Phone className="w-3.5 h-3.5" />
        <span>Bought by the platform: {bought.sender}</span>
        {waStatus && <Badge tone={STATUS_TONE[waStatus] ?? 'muted'}>WhatsApp {waStatus.toLowerCase().replace('_', ' ')}</Badge>}
        {waError && <span className="text-amber-600 dark:text-amber-400">{waError}</span>}
        <ActionButton action={{ label: 'Refresh status', icon: RefreshCw, onClick: refresh, disabled: busy }} />
        {(waStatus === 'NOT_REGISTERED' || waStatus === 'OFFLINE') && <ActionButton action={{ label: 'Retry WhatsApp', icon: RotateCcw, onClick: retry, disabled: busy }} />}
        <ActionButton
          action={{
            label: 'Release number',
            icon: Trash2,
            danger: true,
            onClick: release,
            disabled: busy,
            confirm: { title: `Release ${bought.sender}?`, message: 'It is removed from WhatsApp and given back to Twilio (no refund for the current month). The store stops using it at once.' },
          }}
        />
      </div>
    )
  }

  if (!open) return <ActionButton action={{ label: 'Get a number', icon: ShoppingCart, onClick: () => setOpen(true) }} />

  return (
    <div className="w-full rounded-lg border border-dashed border-border-default p-4 space-y-3 min-w-0">
      <FormGrid cols={2}>
        <FormField label="US area code" hint="Twilio has no Indian numbers; leave empty for any US number.">
          <TextInput value={areaCode} onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
        </FormField>
        <FormField label="WhatsApp display name" hint="Meta reviews it; it should name the store.">
          <TextInput value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100} />
        </FormField>
      </FormGrid>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={{ label: 'Search numbers', icon: Search, onClick: search, disabled: busy }} />
        <ActionButton action={{ label: 'Cancel', onClick: () => { setOpen(false); setFound(null) } }} />
      </div>
      {!live && <p className="text-xs text-amber-600 dark:text-amber-400">Test mode: numbers here are fake and nothing is bought.</p>}
      {found && found.length === 0 && <p className="text-sm text-foreground-muted">No numbers found for that area code.</p>}
      {found && found.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {found.map(n => (
              <label key={n.number} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name={`num-${audience}`} checked={pick === n.number} onChange={() => setPick(n.number)} />
                <span className="font-medium text-foreground">{n.number}</span>
                <span className="text-xs text-foreground-muted">{[n.locality, n.region].filter(Boolean).join(', ')}</span>
              </label>
            ))}
          </div>
          <ActionButton
            variant="primary"
            action={{
              label: 'Buy and bind',
              icon: ShoppingCart,
              onClick: buy,
              disabled: busy || !pick || displayName.trim().length < 3,
              confirm: {
                title: `Buy ${pick ?? ''}?`,
                message: `${price != null ? `US$${price.toFixed(2)} a month` : 'The monthly number price'}, charged to the platform's Twilio account until released. It is bound to this store's ${audience === 'admin' ? 'admin-facing WhatsApp' : 'customer-facing WhatsApp and SMS'} and registered on WhatsApp as "${displayName.trim()}".`,
              },
            }}
          />
        </div>
      )}
    </div>
  )
}
