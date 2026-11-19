import { isPlatformAdmin } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { AUDIENCE_CHANNELS, PLATFORM_TENANT_ID, audiencesFor, type SenderAudience } from '@/lib/messaging/audiences'
import { listTenantSenders } from '@/lib/messaging/tenant-senders'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { AUDIENCE_LABEL, CHANNEL_LABEL } from '@/components/admin/messaging/SenderCard'
import { Card } from '@/components/admin/kit/layout'
import FlagshipNumbers from './FlagshipNumbers'

// Settings → Numbers. The flagship's administrator manages the flagship's customer-facing, admin-facing and ecom
// portal numbers here. Everyone else sees the numbers in use, read-only: a store's numbers and their credentials
// are set by the platform administrator (ecom → store → Numbers).

const USE: Record<SenderAudience, string> = {
  customer: 'Shoppers: order updates, OTPs, campaigns, support and the shopping assistant. WhatsApp and SMS.',
  admin: 'Store staff: the admin assistant and staff sign-in codes. WhatsApp only.',
  ecom: 'Store owners on the ecom portal. WhatsApp and SMS.',
}

export default async function NumbersPanel({ role }: { role: string }) {
  const tenantId = (await resolveTenantId().catch(() => null)) ?? PLATFORM_TENANT_ID
  const flagship = tenantId === PLATFORM_TENANT_ID
  // Uncached read: Get a number's router.refresh() shows the bought number at once.
  const senders = await listTenantSenders(tenantId)
  if (flagship && isPlatformAdmin(role)) return <FlagshipNumbers senders={senders} storeName={await currentBrandNameAsync()} />

  const number = (a: SenderAudience, ch: 'whatsapp' | 'sms') => senders.find(s => s.audience === a && s.channel === ch && s.status === 'active')?.sender ?? null
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <p className="text-sm text-foreground-muted">
        {flagship
          ? 'The numbers this store sends from. Only the administrator can change them.'
          : 'The numbers your store sends from. They are assigned to your store by the platform; contact platform support to change one.'}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {audiencesFor(tenantId).map(a => (
          <Card key={a} title={AUDIENCE_LABEL[a]} hint={USE[a]}>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {AUDIENCE_CHANNELS[a].map(ch => {
                const n = number(a, ch)
                return (
                  <div key={ch} className="min-w-0">
                    <dt className="text-xs text-foreground-muted">{CHANNEL_LABEL[ch]}</dt>
                    <dd className="mt-0.5 font-medium text-foreground break-all">
                      {n ?? (a === 'customer' ? (flagship ? 'Platform default' : 'Not assigned yet') : 'Same as customer-facing')}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  )
}
