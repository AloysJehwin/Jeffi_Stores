'use client'

import SenderCard, { AUDIENCE_LABEL, CHANNEL_LABEL } from '@/components/admin/messaging/SenderCard'
import NumberBuyPanel from '@/components/admin/messaging/NumberBuyPanel'
import { Card } from '@/components/admin/kit/layout'
import { AUDIENCE_CHANNELS, PLATFORM_TENANT_ID, type SenderAudience } from '@/lib/messaging/audiences'
import type { TenantSenderMeta } from '@/lib/messaging/tenant-senders'

// The flagship's three numbers, edited by its administrator. Empty customer-facing = the platform default
// (the messaging env); empty admin-facing or ecom = the customer-facing number. Admin-facing and ecom can also be
// bought in one step; customer-facing can't: a bought one would take live shopper messages before WhatsApp approves it.

type Channel = 'sms' | 'whatsapp'

const GROUPS: { audience: SenderAudience; blurb: string }[] = [
  { audience: 'customer', blurb: 'Shoppers on the storefront: order updates, OTPs, campaigns, support and the shopping assistant. WhatsApp and SMS.' },
  { audience: 'admin', blurb: 'Flagship staff: the admin assistant and staff sign-in codes. WhatsApp only.' },
  { audience: 'ecom', blurb: 'Store owners on the ecom portal; messages to it reach the support inbox. WhatsApp and SMS.' },
]

export default function FlagshipNumbers({ senders, storeName }: { senders: TenantSenderMeta[]; storeName: string }) {
  const find = (ch: Channel, a: SenderAudience) => senders.find(s => s.channel === ch && s.audience === a) ?? null
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <p className="text-sm text-foreground-muted">
        One number per audience. Store numbers are assigned per store in Ecom → Customers → a store → SMS &amp; WhatsApp numbers. Point each
        number&apos;s incoming-message webhook at <code className="font-mono text-xs">https://jeffistores.in/api/webhooks/twilio</code> (Twilio) or the
        AWS SNS topic: the number messaged decides who answers. Get a number (admin-facing and ecom) buys one in the platform&apos;s Twilio account with the webhook already set.
      </p>
      {GROUPS.map(g => (
        <Card
          key={g.audience}
          title={AUDIENCE_LABEL[g.audience]}
          hint={g.blurb}
          action={
            g.audience === 'customer' ? undefined : (
              <NumberBuyPanel tenantId={PLATFORM_TENANT_ID} audience={g.audience} storeName={storeName} rows={senders.filter(s => s.audience === g.audience)} />
            )
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {AUDIENCE_CHANNELS[g.audience].map(ch => (
              <SenderCard
                key={`${g.audience}-${ch}-${find(ch, g.audience)?.updatedAt ?? 'none'}`}
                url={`/api/admin/settings/messaging-numbers/${ch}?audience=${g.audience}`}
                channel={ch}
                audience={g.audience}
                initial={find(ch, g.audience)}
                platformAccount
                empty={
                  g.audience === 'customer'
                    ? `Not set: ${CHANNEL_LABEL[ch]} goes out from the platform default number.`
                    : `Not set: uses the customer-facing ${CHANNEL_LABEL[ch]} number.`
                }
                badge={sender =>
                  sender?.status === 'pending'
                    ? { tone: 'amber', label: 'Waiting for WhatsApp' }
                    : sender
                      ? { tone: 'green', label: 'Own number' }
                      : { tone: 'muted', label: g.audience === 'customer' ? 'Platform default' : 'Uses customer number' }
                }
              />
            ))}
          </div>
        </Card>
      ))}
      <p className="text-xs text-foreground-muted">Credentials are stored encrypted and never shown again.</p>
    </div>
  )
}
