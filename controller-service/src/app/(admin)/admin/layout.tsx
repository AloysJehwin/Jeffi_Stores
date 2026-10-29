export const dynamic = 'force-dynamic'

import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { hasScope, isPlatformAdmin, isPlatformOwner } from '@/lib/auth/scopes'
import { getAdminSession } from '@/lib/auth/admin-auth'
import AdminShell from '@/components/admin/AdminShell'
import AdminShortcutHandler from '@/components/admin/AdminShortcutHandler'
import DesktopRequiredBanner from '@/components/admin/DesktopRequiredBanner'
import { getSiteControls, getStoreIdentity } from '@/lib/catalog/site-controls'
import { getHost } from '@/lib/tenancy/get-host'
import { LogOut } from 'lucide-react'
import { SETTINGS_HUB_TABS, visibleSettingsHubTabs } from '@/lib/admin/settings-hub'

function managedAdsReady(): boolean {
  const e = process.env
  return !!(e.GOOGLE_ADS_DEVELOPER_TOKEN && e.GOOGLE_ADS_LOGIN_CUSTOMER_ID && e.GOOGLE_ADS_MANAGER_REFRESH_TOKEN)
}

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return {
    title: `Admin Panel - ${name}`,
    description: `Secure admin panel for ${name}`,
    robots: 'noindex, nofollow',
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') || ''
  const cookieStore = await cookies()

  const session = await getAdminSession()

  // Show bare children (no shell) on login page or when session is absent/expired
  if (pathname === '/admin/login' || !session) {
    return <>{children}</>
  }
  const role = session?.role || ''
  const scopes: string[] = session?.scopes || []

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard', scope: 'dashboard:read' },
    { href: '/admin/products', label: 'Products', scope: 'products:read', group: 'Catalogue' },
    { href: '/admin/categories', label: 'Categories', scope: 'categories:read', group: 'Catalogue' },
    { href: '/admin/brands', label: 'Brands', scope: 'brands:read', group: 'Catalogue' },
    { href: '/admin/catalog-enrichment', label: 'AI Enrichment', scope: 'catalog_enrichment:read', group: 'Catalogue' },
    { href: '/admin/merchant', label: 'Google Merchant', scope: 'merchant_sync:read', group: 'Catalogue' },
    { href: '/admin/amazon', label: 'Amazon', scope: 'amazon:read', group: 'Catalogue' },
    { href: '/admin/data-source', label: 'Data Source', scope: 'products:read', group: 'Catalogue' },
    { href: '/admin/social-posts', label: 'Social Posts', scope: 'social:read', group: 'Catalogue' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders:read', group: 'Sales' },
    { href: '/admin/subscriptions', label: 'Subscriptions', scope: 'subscriptions:read', group: 'Sales' },
    { href: '/admin/quotations', label: 'Quotations', scope: 'quotations:read', group: 'Sales' },
    { href: '/admin/invoices', label: 'Invoices', scope: 'invoices:read', group: 'Sales' },
    { href: '/admin/cash-sale', label: 'Cash Sale', scope: 'invoices:read', group: 'Sales' },
    { href: '/admin/customers', label: 'Customers', scope: 'customers:read', group: 'Sales' },
    { href: '/admin/crm', label: 'CRM', scope: 'crm:read', group: 'Sales' },
    { href: '/admin/tasks', label: 'Tasks', scope: 'tasks:read', group: 'Sales' },
    { href: '/admin/returns', label: 'Returns', scope: 'returns:read', group: 'Actions' },
    { href: '/admin/replacements', label: 'Replacements', scope: 'replacements:read', group: 'Actions' },
    { href: '/admin/controls', label: 'Controls', scope: 'controls:read', group: 'Actions' },
    { href: '/admin/delhivery', label: 'Pickup Request', scope: 'delhivery:read', group: 'Fulfilment' },
    { href: '/admin/packing-slips', label: 'Packing Slips', scope: 'packing_slips:read', group: 'Fulfilment' },
    { href: '/admin/labels', label: 'Labels', scope: 'labels:read', group: 'Fulfilment' },
    { href: '/admin/scan', label: 'QuickScan', scope: 'quick_scan:read', group: 'Fulfilment', mobileOnly: true },
    { href: '/admin/financial', label: 'Financial', scope: 'financial:read', group: 'Finance' },
    { href: '/admin/inventory', label: 'Inventory', scope: 'inventory:read', group: 'Finance' },
    { href: '/admin/suppliers', label: 'Suppliers', scope: 'inventory:read', group: 'Finance' },
    { href: '/admin/purchase-orders', label: 'Purchase Orders', scope: 'inventory:read', group: 'Finance' },
    { href: '/admin/shelving', label: 'Shelving', scope: 'shelving:read', group: 'Finance' },
    { href: '/admin/gst', label: 'GST Compliance', scope: 'gst:read', group: 'Finance' },
    { href: '/admin/traffic', label: 'Traffic', scope: 'traffic:read', group: 'Marketing' },
    { href: '/admin/google-ads', label: 'Google Ads', scope: 'google_ads:read', group: 'Marketing' },
    { href: '/admin/amazon-ads', label: 'Amazon Ads', scope: 'amazon_ads:read', group: 'Marketing' },
    { href: '/admin/meta-ads', label: 'Meta Ads', scope: 'meta_ads:read', group: 'Marketing' },
    { href: '/admin/coupons', label: 'Coupons', scope: 'coupons:read', group: 'Marketing' },
    { href: '/admin/offers', label: 'Offers', scope: 'coupons:read', group: 'Marketing' },
    { href: '/admin/review-forms', label: 'Review Forms', scope: 'review_forms:read', group: 'Marketing' },
    { href: '/admin/marketing/messaging', label: 'Messaging', scope: 'mailer:read', group: 'Marketing' },
    { href: '/admin/marketing/messaging-templates', label: 'Templates', scope: 'templates:read', group: 'Marketing' },
    { href: '/admin/campaigns', label: 'Campaigns', scope: 'campaigns:read', group: 'Marketing' },
    { href: '/admin/customer-programs', label: 'Programs', scope: 'campaigns:read', group: 'Marketing' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews:read', group: 'Marketing' },
    { href: '/admin/agent', label: 'AI Agent', scope: 'agent:read', group: 'AI', exactMatch: true },
    { href: '/admin/agent/logs', label: 'Agent Logs', scope: 'agent:read', group: 'AI' },
    {
      href: '/admin/business/customers',
      label: 'Business Customers',
      scope: 'business_customers:read',
      group: 'Business',
    },
    { href: '/admin/business/rfqs', label: 'Business RFQs', scope: 'business_rfqs:read', group: 'Business' },
    // Ecom Store — SaaS control plane. superAdminOnly: only the platform operator sees this group.
    // Placed above Settings per nav ordering.
    {
      href: '/admin/ecom/customers',
      label: 'Customers',
      scope: 'ecom_customers:read',
      group: 'Ecom Store',
      platformAdminOnly: true,
    },
    {
      href: '/admin/ecom/instances',
      label: 'Instances',
      scope: 'ecom_instances:read',
      group: 'Ecom Store',
      platformAdminOnly: true,
    },
    {
      href: '/admin/ecom/store-status',
      label: 'Store Status',
      scope: 'ecom_customers:read',
      group: 'Ecom Store',
      platformAdminOnly: true,
    },
    {
      href: '/admin/ecom/google-ads',
      label: 'Google Ads Accounts',
      scope: 'ecom_instances:read',
      group: 'Ecom Store',
      platformAdminOnly: true,
      // Only for "managed by Jeffi" Ads; hidden until the manager account keys are set.
      requiresManagedAds: true,
    },
    {
      href: '/admin/ecom/billing',
      label: 'Billing',
      scope: 'ecom_billing:read',
      group: 'Ecom Store',
      platformAdminOnly: true,
    },
    { href: '/admin/settings/homepage', label: 'Homepage', scope: 'settings:write', group: 'Settings' },
    { href: '/admin/settings/site-controls', label: 'Site Controls', scope: 'settings:write', group: 'Settings' },
    {
      href: '/admin/settings/ai-pricing',
      label: 'AI Pricing',
      scope: 'ecom_billing:read',
      group: 'Settings',
      platformAdminOnly: true,
    },
    // The Settings hub: Account, Team, Service accounts and Audit log tabs (lib/admin/settings-hub).
    { href: '/admin/settings', label: 'Settings', scope: 'settings:read', group: 'Settings', exactMatch: true },
  ]
  const settingsTabs = visibleSettingsHubTabs(role, scopes)

  const filteredNavLinks = navLinks
    .filter(link => {
      // Shown when any hub tab is reachable; points at the first one.
      if (link.href === '/admin/settings') return settingsTabs.length > 0
      if ('platformAdminOnly' in link && link.platformAdminOnly && !isPlatformAdmin(role)) return false
      if ('ownerOnly' in link && link.ownerOnly && !isPlatformOwner(role)) return false
      if ('requiresManagedAds' in link && link.requiresManagedAds && !managedAdsReady()) return false
      return hasScope(role, scopes, link.scope)
    })
    .map(link =>
      link.href === '/admin/settings'
        ? {
            ...link,
            href: settingsTabs[0].href,
            matchPaths: SETTINGS_HUB_TABS.map(t => t.href).filter(h => h !== '/admin/settings'),
          }
        : link
    )
  const desktopNavLinks = filteredNavLinks.filter(link => !('mobileOnly' in link && link.mobileOnly))

  const displayName =
    session?.displayName ||
    (session?.first_name && session?.last_name ? `${session.first_name} ${session.last_name}` : null) ||
    'Admin'
  const usernameInitial = (displayName !== 'Admin' ? displayName : session?.email || 'A')[0].toUpperCase()

  const logoutForm = (
    <form key="admin-logout" action={logoutAction}>
      <button
        type="submit"
        className="h-control inline-flex items-center gap-2 text-white/70 hover:bg-white/10 hover:text-white px-3 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500"
        title="Log out"
      >
        <LogOut className="w-5 h-5" />
        <span className="hidden sm:inline">Logout</span>
      </button>
    </form>
  )

  const sidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === 'true'
  const [controls, host] = await Promise.all([getSiteControls(), getHost()])

  // The shipping wallet pays for Delhivery on the platform account, for EVERY plan — so gate the
  // badge + Wallet nav on platform-Delhivery + delhivery:read (which every plan has), NOT on
  // financial:* (Pro+ only). getSiteControls already resolved ownDelhivery (flagship reads as own).
  // AI usage is charged to the wallet too, so every tenant sees it; the flagship has no wallet.
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  const walletTenantId = await resolveTenantId().catch(() => null)
  const showWallet = !!walletTenantId && hasScope(role, scopes, 'delhivery:read')
  let wallet: { balance: number; minBalance: number } | null = null
  if (showWallet) {
    const tenantId = walletTenantId
    if (tenantId) {
      const { getWalletBalance } = await import('@/lib/payments/wallet')
      const w = await getWalletBalance(tenantId).catch(() => null)
      if (w) wallet = { balance: w.balance, minBalance: w.minBalance }
    }
  }

  if (showWallet) {
    // Lives in the Finance group visually, but gated on delhivery:read (every plan) — not
    // financial:* (Pro+) — because the shipping wallet applies to all platform-Delhivery tenants.
    const walletLink = { href: '/admin/wallet', label: 'Wallet', scope: 'delhivery:read', group: 'Finance' }
    const at = (arr: typeof desktopNavLinks) => {
      // Place it just before Financial when that link is present (Pro+), else at the group's head.
      const i = arr.findIndex(l => l.href === '/admin/financial')
      arr.splice(i >= 0 ? i : arr.length, 0, walletLink)
    }
    at(desktopNavLinks)
    at(filteredNavLinks)
  }

  return (
    <>
      <AdminShortcutHandler shortcuts={controls.shortcuts} host={host} role={role} scopes={scopes} />
      <AdminShell
        brandName={controls.identity.name}
        desktopNavLinks={desktopNavLinks}
        allNavLinks={filteredNavLinks}
        displayName={displayName}
        usernameInitial={usernameInitial}
        role={role}
        scopes={scopes}
        host={host}
        canUseAgent={hasScope(role, scopes, 'agent:write')}
        adminId={session.adminId}
        agentDockButton={controls.flags.agentDockEnabled}
        logoutForm={logoutForm}
        initialCollapsed={sidebarCollapsed}
        wallet={wallet}
      >
        <DesktopRequiredBanner />
        {children}
      </AdminShell>
    </>
  )
}
