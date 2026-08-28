import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import {
  getTenant, getTenantBilling, getKyc, getProvisioningJob,
  getTenantOwners, getTenantSocialAccounts, listIntegrationCredentials,
  listCustomDomains, getTenantBankAccount,
} from '@/lib/tenant-registry'
import { listTenantAdminCerts, getTenantCa } from '@/lib/tenant-ca'
import { getTenantMigrationRuns } from '@/lib/tenant-migrations'
import { StatusPill, TenantTabNav, isTenantTab, type TenantTab } from '@/components/admin/ecom/EcomUI'
import TenantActions from '@/components/admin/ecom/TenantActions'
import OverviewTab from '@/components/admin/ecom/tabs/OverviewTab'
import ProvisioningTab from '@/components/admin/ecom/tabs/ProvisioningTab'
import InfrastructureTab from '@/components/admin/ecom/tabs/InfrastructureTab'
import CommerceTab from '@/components/admin/ecom/tabs/CommerceTab'
import KycTab from '@/components/admin/ecom/tabs/KycTab'
import AccessTab from '@/components/admin/ecom/tabs/AccessTab'

export const dynamic = 'force-dynamic'

/**
 * Single object page for a tenant. Replaces the four pages that each loaded the same
 * getTenant(id) and cross-linked to one another (customers, instances, store-status,
 * provisioning) — those now redirect here with the matching tab.
 *
 * Only the header data is always fetched; each tab loads its own, so the page does not pay
 * for sections nobody is looking at.
 */
export default async function TenantObjectPage({
  params, searchParams,
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
  const [kyc, headerJob] = await Promise.all([
    getKyc(id).catch(() => null),
    getProvisioningJob(id).catch(() => null),
  ])
  const kycPending = kyc?.status === 'pending'

  return (
    <div className="p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <Link href="/admin/ecom/customers" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">
        ← Stores
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground truncate">{t.display_name}</h1>
            <StatusPill status={t.status} />
            {kycPending && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                KYC pending review
              </span>
            )}
          </div>
          <p className="text-sm text-foreground-muted mt-1 break-all">{t.slug}.jeffistores.in</p>
        </div>

        <div className="shrink-0">
          <TenantActions tenantId={t.id} slug={t.slug} status={t.status} instanceState={t.instance_state} />
        </div>
      </div>

      <TenantTabNav
        tenantId={t.id}
        active={tab}
        badges={{ kyc: kycPending ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block align-middle" /> : null }}
      />

      <div className="mt-6">
        {tab === 'overview' && <OverviewTab tenant={t} job={headerJob} owners={await getTenantOwners(id).catch(() => [])} />}
        {tab === 'provisioning' && <ProvisioningTab tenant={t} />}
        {tab === 'infrastructure' && <InfrastructureTab tenant={t} job={headerJob} {...await infraData(id)} />}
        {tab === 'commerce' && <CommerceTab tenant={t} {...await commerceData(id)} />}
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
