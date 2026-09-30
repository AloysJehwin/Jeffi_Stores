import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import {
  getTenant,
  getTenantBilling,
  getKyc,
  getProvisioningJob,
  getTenantOwners,
  getTenantSocialAccounts,
  listIntegrationCredentials,
  listCustomDomains,
  getTenantBankAccount,
  lookupTenantContextById,
} from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { queryMany } from '@/lib/shared/db'
import type { ShipmentRow } from '@/lib/orders/tenant-shipments-shared'
import { listTenantAdminCerts, getTenantCa } from '@/lib/tenancy/tenant-ca'
import { getTenantMigrationRuns } from '@/lib/tenant-migrations'
import { TenantTabNav, isTenantTab, type TenantTab } from '@/components/admin/ecom/EcomUI'
import TenantObjectHeader from '@/components/admin/ecom/TenantObjectHeader'
import OverviewTab from '@/components/admin/ecom/tabs/OverviewTab'
import ProvisioningTab from '@/components/admin/ecom/tabs/ProvisioningTab'
import InfrastructureTab from '@/components/admin/ecom/tabs/InfrastructureTab'
import CommerceTab from '@/components/admin/ecom/tabs/CommerceTab'
import ShipmentsTab from '@/components/admin/ecom/tabs/ShipmentsTab'
import KycTab from '@/components/admin/ecom/tabs/KycTab'
import AccessTab from '@/components/admin/ecom/tabs/AccessTab'

export const dynamic = 'force-dynamic'

/**
 * Single object page for a tenant. Replaces the four pages that each loaded the same
 * getTenant(id) and cross-linked to one another — instances and store-status now redirect
 * here with the matching tab, and the provisioning pages are gone.
 *
 * It stays on /admin/ecom/customers/[id] rather than a route of its own because the sidebar
 * marks a group active with startsWith(href + '/'); a separate path would never expand it.
 *
 * Only the header data is always fetched; each tab loads its own, so the page does not pay
 * for sections nobody is looking at.
 */
export default async function TenantObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const [{ id }, sp] = await Promise.all([params, searchParams])
  const tab: TenantTab = isTenantTab(sp.tab) ? sp.tab : 'overview'

  const t = await getTenant(id)
  if (!t) notFound()

  // Cheap single-row reads that feed the header or more than one tab: KYC drives the header
  // badge everywhere, the job feeds Overview's health and Infrastructure's resource ids.
  // Anything used by exactly one tab is loaded inside that tab's branch instead.
  const [kyc, headerJob] = await Promise.all([getKyc(id).catch(() => null), getProvisioningJob(id).catch(() => null)])
  const kycPending = kyc?.status === 'pending'

  return (
    <div className="p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader
        tenant={t}
        backHref="/admin/ecom/customers"
        backLabel="Stores"
        kycPending={kycPending}
        job={headerJob}
      />

      <TenantTabNav
        tenantId={t.id}
        active={tab}
        badges={{
          kyc: kycPending ? (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block align-middle" />
          ) : null,
        }}
      />

      <div className="mt-6">
        {tab === 'overview' && (
          <OverviewTab tenant={t} job={headerJob} owners={await getTenantOwners(id).catch(() => [])} />
        )}
        {tab === 'provisioning' && <ProvisioningTab tenant={t} />}
        {tab === 'infrastructure' && <InfrastructureTab tenant={t} job={headerJob} {...await infraData(id)} />}
        {tab === 'commerce' && <CommerceTab tenant={t} {...await commerceData(id)} />}
        {tab === 'shipments' && (
          <ShipmentsTab tenantId={t.id} ownDelhivery={t.own_delhivery === true} shipments={await shipmentData(id)} />
        )}
        {tab === 'access' && <AccessTab tenant={t} {...await accessData(id)} />}
        {tab === 'kyc' && <KycTab tenant={t} kyc={kyc} />}
      </div>
    </div>
  )
}

async function accessData(id: string) {
  const [certs, ca, social, integrations] = await Promise.all([
    listTenantAdminCerts(id).catch(() => []),
    getTenantCa(id).catch(() => null),
    getTenantSocialAccounts(id).catch(() => []),
    listIntegrationCredentials(id).catch(() => []),
  ])
  // getTenantCa carries caKeyPem — the tenant's CA private key. Only the two display fields
  // cross into the component, so the key cannot ride along into any future client boundary.
  const caSummary = ca ? { subject: ca.subject, expiresAt: ca.expiresAt } : null
  return { certs, ca: caSummary, social, integrations }
}

async function infraData(id: string) {
  const [domains, migrations] = await Promise.all([
    listCustomDomains(id).catch(() => []),
    getTenantMigrationRuns(id).catch(() => []),
  ])
  return { domains, migrations, currentSha: process.env.GIT_SHA || null }
}

async function commerceData(id: string) {
  const [billing, bank] = await Promise.all([
    getTenantBilling(id).catch(() => null),
    getTenantBankAccount(id).catch(() => null),
  ])
  return { billing, bank }
}

// Shipment charges live in the *tenant* DB orders table, which the control-plane detail page does
// not otherwise touch. Resolve the tenant's context by id and run the read inside it so query() hits
// the tenant pool. Read-only; returns [] for a tenant with no active infra (e.g. pending provisioning).
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
