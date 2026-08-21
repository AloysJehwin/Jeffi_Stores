export const dynamic = 'force-dynamic'

import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { hasScope, isPlatformAdmin, isPlatformOwner } from '@/lib/scopes'
import { getAdminSession } from '@/lib/admin-auth'
import AdminShell from '@/components/admin/AdminShell'
import AdminShortcutHandler from '@/components/admin/AdminShortcutHandler'
import { AdminMobileProvider } from '@/contexts/AdminMobileProvider'
import DesktopRequiredBanner from '@/components/admin/DesktopRequiredBanner'
import { getSiteControls } from '@/lib/site-controls'
import { getHost } from '@/lib/get-host'
import { LogOut } from 'lucide-react'

export const metadata = {
  title: 'Admin Panel - Jeffi Stores',
  description: 'Secure admin panel for Jeffi Stores',
  robots: 'noindex, nofollow',
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') || ''
  const cookieStore = await cookies()
  const ua = headersList.get('user-agent') || ''
  const isMobile = /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini/i.test(ua)

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
    { href: '/admin/merchant-sync', label: 'Merchant Sync', scope: 'products:read', group: 'Catalogue' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders:read', group: 'Sales' },
    { href: '/admin/quotations', label: 'Quotations', scope: 'quotations:read', group: 'Sales' },
    { href: '/admin/invoices', label: 'Invoices', scope: 'invoices:read', group: 'Sales' },
    { href: '/admin/cash-sale', label: 'Cash Sale', scope: 'invoices:read', group: 'Sales' },
    { href: '/admin/customers', label: 'Customers', scope: 'customers:read', group: 'Sales' },
    { href: '/admin/crm', label: 'CRM', scope: 'customers:read', group: 'Sales' },
    { href: '/admin/tasks', label: 'Tasks', scope: 'customers:read', group: 'Sales' },
    { href: '/admin/returns', label: 'Returns', scope: 'orders:read', group: 'Actions' },
    { href: '/admin/replacements', label: 'Replacements', scope: 'orders:read', group: 'Actions' },
    { href: '/admin/controls', label: 'Controls', scope: 'inflation:read', group: 'Actions' },
    { href: '/admin/delhivery', label: 'Pickup Request', scope: 'orders:read', group: 'Fulfilment' },
    { href: '/admin/packing-slips', label: 'Packing Slips', scope: 'packing_slips:read', group: 'Fulfilment' },
    { href: '/admin/labels', label: 'Labels', scope: 'labels:read', group: 'Fulfilment' },
    { href: '/admin/scan', label: 'QuickScan', scope: 'quick_scan:read', group: 'Fulfilment', mobileOnly: true },
    { href: '/admin/financial', label: 'Financial', scope: 'financial:read', group: 'Finance' },
    { href: '/admin/inventory', label: 'Inventory', scope: 'inventory:read', group: 'Finance' },
    { href: '/admin/shelving', label: 'Shelving', scope: 'inventory:read', group: 'Finance' },
    { href: '/admin/gst', label: 'GST Compliance', scope: 'gst:read', group: 'Finance' },
    { href: '/admin/traffic', label: 'Traffic', scope: 'dashboard:read', group: 'Marketing' },
    { href: '/admin/coupons', label: 'Coupons', scope: 'coupons:read', group: 'Marketing' },
    { href: '/admin/review-forms', label: 'Review Forms', scope: 'review_forms:read', group: 'Marketing' },
    { href: '/admin/mailer', label: 'Mailer', scope: 'mailer:read', group: 'Marketing' },
    { href: '/admin/campaigns', label: 'Campaigns', scope: 'mailer:read', group: 'Marketing' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews:read', group: 'Marketing' },
    { href: '/admin/agent', label: 'AI Agent', scope: 'agent:read', group: 'AI', exactMatch: true },
    { href: '/admin/agent/logs', label: 'Agent Logs', scope: 'agent:read', group: 'AI' },
    { href: '/admin/business/customers', label: 'Business Customers', scope: 'business_customers:read', group: 'Business' },
    { href: '/admin/business/rfqs', label: 'Business RFQs', scope: 'business_rfqs:read', group: 'Business' },
    // Ecom Store — SaaS control plane. superAdminOnly: only the platform operator sees this group.
    // Placed above Settings per nav ordering.
    { href: '/admin/ecom/customers', label: 'Customers', scope: 'ecom_customers:read', group: 'Ecom Store', platformAdminOnly: true },
    { href: '/admin/ecom/kyc', label: 'KYC Review', scope: 'ecom_customers:read', group: 'Ecom Store', platformAdminOnly: true },
    { href: '/admin/ecom/instances', label: 'Instances', scope: 'ecom_instances:read', group: 'Ecom Store', platformAdminOnly: true },
    { href: '/admin/ecom/store-status', label: 'Store Status', scope: 'ecom_customers:read', group: 'Ecom Store', platformAdminOnly: true },
    { href: '/admin/ecom/billing', label: 'Billing', scope: 'ecom_billing:read', group: 'Ecom Store', platformAdminOnly: true },
    { href: '/admin/audit', label: 'Audit Log', scope: 'audit:read', group: 'Settings' },
    { href: '/admin/service-accounts', label: 'Service Accounts', scope: 'service_accounts:read', group: 'Settings' },
    { href: '/admin/team', label: 'Team Members', scope: 'settings:read', group: 'Settings', ownerOnly: true },
    { href: '/admin/settings/site-controls', label: 'Site Controls', scope: 'settings:write', group: 'Settings' },
    { href: '/admin/settings', label: 'Settings', scope: 'settings:read', group: 'Settings', exactMatch: true },
  ]

  const filteredNavLinks = navLinks.filter(link => {
    if ('platformAdminOnly' in link && link.platformAdminOnly && !isPlatformAdmin(role)) return false
    if ('ownerOnly' in link && link.ownerOnly && !isPlatformOwner(role)) return false
    return hasScope(role, scopes, link.scope)
  })
  const desktopNavLinks = filteredNavLinks.filter(link => !('mobileOnly' in link && link.mobileOnly))

  const displayName = session?.displayName
    || (session?.first_name && session?.last_name ? `${session.first_name} ${session.last_name}` : null)
    || 'Admin'
  const usernameInitial = (displayName !== 'Admin' ? displayName : (session?.email || 'A'))[0].toUpperCase()

  const logoutForm = (
    <form action={logoutAction}>
      <button
        type="submit"
        className="h-9 inline-flex items-center gap-2 text-white/70 hover:bg-white/10 hover:text-white px-3 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500"
        title="Log out"
      >
        <LogOut className="w-5 h-5" />
        <span className="hidden sm:inline">Logout</span>
      </button>
    </form>
  )

  const sidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === 'true'
  const [controls, host] = await Promise.all([getSiteControls(), getHost()])

  return (
    <AdminMobileProvider isMobile={isMobile}>
      <AdminShortcutHandler shortcuts={controls.shortcuts} host={host} />
      <AdminShell
        desktopNavLinks={desktopNavLinks}
        allNavLinks={filteredNavLinks}
        displayName={displayName}
        usernameInitial={usernameInitial}
        role={role}
        scopes={scopes}
        host={host}
        canUseAgent={hasScope(role, scopes, 'agent:write')}
        logoutForm={logoutForm}
        initialCollapsed={sidebarCollapsed}
      >
        <DesktopRequiredBanner />
        {children}
      </AdminShell>
    </AdminMobileProvider>
  )
}
