import { redirect } from 'next/navigation'
import {
  getTenantBilling,
  getTenantOwners,
  getTenantSocialAccounts,
  listIntegrationCredentials,
  getTenantBankAccount,
  lookupTenantContextById,
  hasService,
} from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { queryMany } from '@/lib/shared/db'
import type { ShipmentRow } from '@controller/lib/orders/tenant-shipments-shared'
import { listTenantAdminCerts, getTenantCa } from '@/lib/tenancy/tenant-ca'
import { DETAIL_PAGE_SIZE, loadInfraDetail, loadTenantDetail, pageParam, withParam } from '@controller/lib/ecom/detail'
import { TenantTabNav, isTenantTab, type TenantTab } from '@controller/components/admin/ecom/EcomUI'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import OverviewTab from '@controller/components/admin/ecom/tabs/OverviewTab'
import ProvisioningTab from '@controller/components/admin/ecom/tabs/ProvisioningTab'
import InfrastructureTab from '@controller/components/admin/ecom/tabs/InfrastructureTab'
import CommerceTab from '@controller/components/admin/ecom/tabs/CommerceTab'
import ShipmentsTab from '@controller/components/admin/ecom/tabs/ShipmentsTab'
import KycTab from '@controller/components/admin/ecom/tabs/KycTab'
import AccessTab from '@controller/components/admin/ecom/tabs/AccessTab'
import CertificatesTab from '@controller/components/admin/ecom/tabs/CertificatesTab'
import MessagingTab from '@controller/components/admin/ecom/tabs/MessagingTab'

export const dynamic = 'force-dynamic'

type Search = { tab?: string; tp?: string; lp?: string }

/**
 * The Store detail page: the tenant's header (shared with Instance, Status and Billing) and its tabs. Each tab
 * is a real URL (an alert email can point at ?tab=provisioning) and loads only its own data.
 *
 * It stays on /admin/ecom/customers/[id] because the sidebar marks a group active with startsWith(href + '/').
 */
export default async function TenantObjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const d = await loadTenantDetail(id)
  const { t } = d
  const tab: TenantTab = isTenantTab(sp.tab) ? sp.tab : 'overview'

  // API workspaces (Messaging/Documents only) have no store infrastructure to show or manage.
  const hiddenTabs: TenantTab[] = [
    ...(d.isStore ? [] : (['provisioning', 'infrastructure', 'commerce', 'shipments', 'access', 'certificates'] as TenantTab[])),
    ...(hasService(t, 'messaging') ? [] : (['messaging'] as TenantTab[])),
  ]
  if (hiddenTabs.includes(tab)) redirect(`/admin/ecom/customers/${id}/view?tab=overview`)

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-full min-w-0">
      <TenantObjectHeader d={d} back={{ href: '/admin/ecom/customers', label: 'Stores' }} section="store" />

      <TenantTabNav
        tenantId={t.id}
        active={tab}
        hidden={hiddenTabs}
        badges={{ kyc: d.kycPending ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block align-middle" /> : null }}
      />

      <div className="min-w-0">
        {tab === 'overview' && <OverviewTab d={d} owners={await getTenantOwners(id).catch(() => [])} />}
        {tab === 'provisioning' && <ProvisioningTab tenant={t} />}
        {tab === 'infrastructure' && <InfrastructureTab d={d} infra={await loadInfraDetail(d)} />}
        {tab === 'commerce' && <CommerceTab tenant={t} {...await commerceData(id, sp)} />}
        {tab === 'shipments' && <ShipmentsTab tenantId={t.id} ownDelhivery={t.own_delhivery === true} shipments={await shipmentData(id)} />}
        {tab === 'access' && <AccessTab {...await accessData(id)} />}
        {tab === 'certificates' && <CertificatesTab tenant={t} {...await certificatesData(id)} />}
        {tab === 'kyc' && <KycTab tenant={t} kyc={d.kyc} approvals={d.approvals} />}
        {tab === 'messaging' && hasService(t, 'messaging') && <MessagingTab tenantId={t.id} storeName={t.display_name} />}
      </div>
    </div>
  )
}

async function accessData(id: string) {
  const [social, integrations] = await Promise.all([
    getTenantSocialAccounts(id).catch(() => []),
    listIntegrationCredentials(id).catch(() => []),
  ])
  return { social, integrations }
}

async function certificatesData(id: string) {
  const [certs, ca, owners] = await Promise.all([
    listTenantAdminCerts(id).catch(() => []),
    getTenantCa(id).catch(() => null),
    getTenantOwners(id).catch(() => []),
  ])
  // getTenantCa carries caKeyPem, the tenant's CA private key. Only the two display fields cross into the
  // component, so the key cannot ride along into any future client boundary.
  const caSummary = ca ? { subject: ca.subject, expiresAt: ca.expiresAt } : null
  return { certs, ca: caSummary, ownerEmail: owners[0]?.email ?? null }
}

async function commerceData(id: string, sp: Search) {
  const tx = pageParam(sp.tp)
  const lp = pageParam(sp.lp)
  const [billing, bank] = await Promise.all([
    getTenantBilling(id, {
      transactions: { limit: DETAIL_PAGE_SIZE, offset: (tx - 1) * DETAIL_PAGE_SIZE },
      ledger: { limit: DETAIL_PAGE_SIZE, offset: (lp - 1) * DETAIL_PAGE_SIZE },
    }).catch(() => null),
    getTenantBankAccount(id).catch(() => null),
  ])
  const path = `/admin/ecom/customers/${id}/view`
  const q = { ...sp, tab: 'commerce' }
  return {
    billing,
    bank,
    txPage: { page: tx, pageSize: DETAIL_PAGE_SIZE, href: (n: number) => withParam(path, q, 'tp', n) },
    ledgerPage: { page: lp, pageSize: DETAIL_PAGE_SIZE, href: (n: number) => withParam(path, q, 'lp', n) },
  }
}

// Shipment charges live in the *tenant* DB orders table, which the control-plane detail page does not otherwise
// touch. Resolve the tenant's context by id and read inside it so query() hits the tenant pool. Read-only;
// [] for a tenant with no active infra (e.g. pending provisioning).
async function shipmentData(id: string): Promise<ShipmentRow[]> {
  const ctx = await lookupTenantContextById(id).catch(() => null)
  if (!ctx) return []
  return runWithTenantContext(ctx, async () => {
    const rows = await queryMany<ShipmentRow>(
      `SELECT id, order_number, awb_number, payment_mode, shipment_status,
              shipping_amount, delhivery_billed_amount, delhivery_extra_charge, delhivery_billed_at
         FROM orders
        WHERE awb_number IS NOT NULL
        ORDER BY COALESCE(delhivery_billed_at, created_at) DESC
        LIMIT 100`
    ).catch(() => [])
    return rows
  }).catch(() => [])
}
