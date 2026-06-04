export const dynamic = 'force-dynamic'

import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import AdminShell from '@/components/admin/AdminShell'

export const metadata = {
  title: 'Admin Panel - Jeffi Stores',
  description: 'Secure admin panel for Jeffi Stores',
  robots: 'noindex, nofollow',
}

async function getAdminSession() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  if (!token) return null
  try {
    return await verifyToken(token.value)
  } catch {
    return null
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = headers()
  const pathname = headersList.get('x-pathname') || ''

  const session = await getAdminSession()

  // Show bare children (no shell) on login page or when session is absent/expired
  if (pathname === '/admin/login' || !session) {
    return <>{children}</>
  }

  const role = session?.role || ''
  const scopes: string[] = session?.scopes || []

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard', scope: 'dashboard' },
    { href: '/admin/products', label: 'Products', scope: 'products', group: 'Catalogue' },
    { href: '/admin/categories', label: 'Categories', scope: 'categories', group: 'Catalogue' },
    { href: '/admin/brands', label: 'Brands', scope: 'brands', group: 'Catalogue' },
    { href: '/admin/catalog-enrichment', label: 'AI Enrichment', scope: 'catalog_enrichment', group: 'Catalogue' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders', group: 'Sales' },
    { href: '/admin/quotations', label: 'Quotations', scope: 'quotations', group: 'Sales' },
    { href: '/admin/invoices', label: 'Invoices', scope: 'invoices', group: 'Sales' },
    { href: '/admin/cash-sale', label: 'Cash Sale', scope: 'invoices', group: 'Sales' },
    { href: '/admin/customers', label: 'Customers', scope: 'customers', group: 'Sales' },
    { href: '/admin/crm', label: 'CRM', scope: 'customers', group: 'Sales' },
    { href: '/admin/tasks', label: 'Tasks', scope: 'customers', group: 'Sales' },
    { href: '/admin/delhivery', label: 'Pickup Request', scope: 'orders', group: 'Fulfilment' },
    { href: '/admin/packing-slips', label: 'Packing Slips', scope: 'packing_slips', group: 'Fulfilment' },
    { href: '/admin/labels', label: 'Labels', scope: 'labels', group: 'Fulfilment' },
    { href: '/admin/scan', label: 'QuickScan', scope: 'quick_scan', group: 'Fulfilment', mobileOnly: true },
    { href: '/admin/financial', label: 'Financial', scope: 'financial', group: 'Finance' },
    { href: '/admin/inventory', label: 'Inventory', scope: 'inventory', group: 'Finance' },
    { href: '/admin/shelving', label: 'Shelving', scope: 'inventory', group: 'Finance' },
    { href: '/admin/gst', label: 'GST Compliance', scope: 'gst', group: 'Finance' },
    { href: '/admin/traffic', label: 'Traffic', scope: 'dashboard', group: 'Marketing' },
    { href: '/admin/coupons', label: 'Coupons', scope: 'coupons', group: 'Marketing' },
    { href: '/admin/review-forms', label: 'Review Forms', scope: 'review_forms', group: 'Marketing' },
    { href: '/admin/mailer', label: 'Mailer', scope: 'mailer', group: 'Marketing' },
    { href: '/admin/campaigns', label: 'Campaigns', scope: 'mailer', group: 'Marketing' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews', group: 'Marketing' },
    { href: '/admin/agent', label: 'AI Agent', scope: 'agent', group: 'AI' },
    { href: '/admin/audit?tab=tools', label: 'Agent Logs', scope: 'agent', group: 'AI' },
    { href: '/admin/inflation', label: 'Inflation', scope: 'inflation', group: 'Settings' },
    { href: '/admin/audit', label: 'Audit Log', scope: 'audit', group: 'Settings', superAdminOnly: true },
    { href: '/admin/team', label: 'Team Members', scope: 'settings', group: 'Settings', superAdminOnly: true },
    { href: '/admin/settings', label: 'Settings', scope: 'settings', group: 'Settings' },
  ]

  const filteredNavLinks = navLinks.filter(link => {
    if ('superAdminOnly' in link && link.superAdminOnly && role !== 'super_admin') return false
    return hasScope(role, scopes, link.scope)
  })
  const desktopNavLinks = filteredNavLinks.filter(link => !('mobileOnly' in link && link.mobileOnly))

  const displayName = session?.first_name && session?.last_name
    ? `${session.first_name} ${session.last_name}`
    : session?.username || 'Admin'
  const usernameInitial = (session?.first_name || session?.username || 'A')[0].toUpperCase()

  const logoutForm = (
    <form action={logoutAction}>
      <button
        type="submit"
        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors"
      >
        Logout
      </button>
    </form>
  )

  return (
    <AdminShell
      desktopNavLinks={desktopNavLinks}
      allNavLinks={filteredNavLinks}
      displayName={displayName}
      usernameInitial={usernameInitial}
      role={role}
      canUseAgent={role === 'super_admin' || scopes.includes('agent')}
      logoutForm={logoutForm}
    >
      {children}
    </AdminShell>
  )
}
