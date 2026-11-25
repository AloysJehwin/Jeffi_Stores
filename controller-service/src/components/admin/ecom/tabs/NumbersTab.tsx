import { Section } from '@controller/components/admin/ecom/EcomUI'
import MessagingSenders from '@controller/components/admin/ecom/detail/MessagingSenders'
import { listTenantSenders } from '@/lib/messaging/tenant-senders'
import { getSmsDltConfig } from '@/lib/providers/sms-dlt'
import { getMessagingAddon, messagingEntitlement } from '@/lib/billing/messaging-addon'

/** Store page → SMS & WhatsApp numbers: the store's add-on and the senders the platform assigns it. */
export default async function NumbersTab({ tenantId, storeName }: { tenantId: string; storeName: string }) {
  const data = await Promise.all([getMessagingAddon(tenantId), listTenantSenders(tenantId), messagingEntitlement(tenantId, { maxAgeMs: 0 }), getSmsDltConfig(null).catch(() => null)])
    .then(([addon, senders, entitlement, dlt]) => ({ addon, senders, entitlement, dltHeaders: dlt?.senderIds ?? [] }))
    .catch(() => null)
  return (
    <Section title="SMS & WhatsApp numbers">
      {data ? (
        <MessagingSenders tenantId={tenantId} storeName={storeName} addon={data.addon} senders={data.senders} entitlement={data.entitlement} dltHeaders={data.dltHeaders} />
      ) : (
        <p className="text-sm text-foreground-muted">Could not load this store&apos;s messaging senders. Try again in a moment.</p>
      )}
    </Section>
  )
}
