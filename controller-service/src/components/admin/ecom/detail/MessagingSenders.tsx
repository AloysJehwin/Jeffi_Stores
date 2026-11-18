'use client'

import { useState } from 'react'
import SenderCard, { CHANNEL_LABEL, day } from '@/components/admin/messaging/SenderCard'
import StoreNumberPanel from '@controller/components/admin/ecom/detail/StoreNumberPanel'
import { AUDIENCE_CHANNELS, type SenderAudience } from '@/lib/messaging/audiences'
import type { TenantSenderMeta } from '@/lib/messaging/tenant-senders'
import type { EntitlementState, MessagingAddonStatus } from '@/lib/billing/messaging-addon'

// A store's numbers, set by the platform administrator: customer-facing (shoppers: orders, OTPs, support, the
// shopper assistant) and admin-facing (staff: the admin assistant, staff OTPs). The store's own Settings → Numbers
// shows them read-only. An admin-facing number left empty falls back to the customer-facing one.

type Channel = 'sms' | 'whatsapp'

const TIER_LABEL: Record<MessagingAddonStatus['tier'], string> = { none: 'Not bought', sms: 'SMS', whatsapp: 'WhatsApp', both: 'SMS & WhatsApp' }

const GROUPS: { audience: SenderAudience; title: string; blurb: string }[] = [
  { audience: 'customer', title: 'Customer-facing', blurb: 'Shoppers: order updates, OTPs, campaigns, support and the shopper assistant. WhatsApp and SMS.' },
  { audience: 'admin', title: 'Admin-facing', blurb: 'Store staff: the admin assistant and staff sign-in codes. WhatsApp only; empty = the customer-facing number.' },
]

export default function MessagingSenders({
  tenantId,
  storeName,
  addon,
  senders,
  entitlement: initial,
}: {
  tenantId: string
  storeName: string
  addon: MessagingAddonStatus
  senders: TenantSenderMeta[]
  entitlement: Record<Channel, EntitlementState>
}) {
  const [entitlement, setEntitlement] = useState(initial)
  const find = (channel: Channel, audience: SenderAudience) => senders.find(s => s.channel === channel && s.audience === audience) ?? null
  const url = (channel: Channel, audience: SenderAudience) => `/api/admin/ecom/${tenantId}/messaging-senders/${channel}?audience=${audience}`

  return (
    <div className="space-y-5 min-w-0">
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

      {GROUPS.map((g, i) => (
        <section key={g.audience} className={`space-y-3 min-w-0 ${i > 0 ? 'border-t border-border-default pt-5' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{g.title}</h3>
              <p className="mt-0.5 text-xs text-foreground-muted">{g.blurb}</p>
            </div>
            <StoreNumberPanel tenantId={tenantId} audience={g.audience as 'customer' | 'admin'} storeName={storeName} rows={senders.filter(s => s.audience === g.audience)} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {AUDIENCE_CHANNELS[g.audience].map(ch => (
              <SenderCard
                key={`${g.audience}-${ch}-${find(ch, g.audience)?.updatedAt ?? 'none'}`}
                url={url(ch, g.audience)}
                channel={ch}
                audience={g.audience}
                initial={find(ch, g.audience)}
                onChange={d => d.entitlement && setEntitlement(e => ({ ...e, [ch]: d.entitlement as EntitlementState }))}
                empty={
                  g.audience === 'customer'
                    ? `No number assigned. The store can't send ${CHANNEL_LABEL[ch]} until one is.`
                    : `Not set: staff messages use the customer-facing ${CHANNEL_LABEL[ch]} number.`
                }
                badge={sender => {
                  const state = entitlement[ch]
                  if (state === 'addon') return sender ? { tone: 'amber', label: 'Assigned, add-on missing' } : { tone: 'muted', label: 'No number' }
                  if (!sender) return g.audience === 'customer' ? { tone: 'muted', label: 'No number' } : { tone: 'muted', label: 'Uses customer number' }
                  return { tone: 'green', label: 'Live' }
                }}
                note={sender =>
                  entitlement[ch] === 'addon' ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      The store&apos;s add-on doesn&apos;t cover {CHANNEL_LABEL[ch]}. {sender ? 'This number is not used' : 'A number assigned now is not used'} until the owner buys it in the ecom portal (Billing).
                    </p>
                  ) : null
                }
              />
            ))}
          </div>
        </section>
      ))}

      <p className="text-xs text-foreground-muted">
        Credentials are stored encrypted and never shown again. One number serves one audience. Point each number&apos;s incoming-message webhook at{' '}
        <code className="text-[11px]">/api/webhooks/twilio</code> (Twilio) or the AWS SNS topic: the number messaged decides the store and audience.
      </p>
    </div>
  )
}
