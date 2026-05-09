import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import AdminMobileNav from '@/components/admin/AdminMobileNav'
import AdminSidebarNav from '@/components/admin/AdminSidebarNav'
import ThemeToggle from '@/components/ThemeToggle'

export const metadata = {
  title: 'Admin Panel - Jeffi Stores',
  description: 'Secure admin panel for Jeffi Stores',
  robots: 'noindex, nofollow',
}

async function getAdminSession() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')

  if (!token) {
    return null
  }

  try {
    const payload = await verifyToken(token.value)
    return payload
  } catch (error) {
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

  const isLoginPage = pathname === '/admin/login'

  if (isLoginPage) {
    return children
  }

  const session = await getAdminSession()
  const role = session?.role || ''
  const scopes: string[] = session?.scopes || []

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard', scope: 'dashboard' },
    { href: '/admin/products', label: 'Products', scope: 'products', group: 'Catalogue' },
    { href: '/admin/categories', label: 'Categories', scope: 'categories', group: 'Catalogue' },
    { href: '/admin/brands', label: 'Brands', scope: 'brands', group: 'Catalogue' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders', group: 'Sales' },
    { href: '/admin/quotations', label: 'Quotations', scope: 'quotations', group: 'Sales' },
    { href: '/admin/invoices', label: 'Invoices', scope: 'invoices', group: 'Sales' },
    { href: '/admin/customers', label: 'Customers', scope: 'customers', group: 'Sales' },
    { href: '/admin/delhivery', label: 'Pickup Request', scope: 'orders', group: 'Fulfilment' },
    { href: '/admin/packing-slips', label: 'Packing Slips', scope: 'packing_slips', group: 'Fulfilment' },
    { href: '/admin/labels', label: 'Labels', scope: 'labels', group: 'Fulfilment' },
    { href: '/admin/scan', label: 'QuickScan', scope: 'quick_scan', group: 'Fulfilment', mobileOnly: true },
    { href: '/admin/financial', label: 'Financial', scope: 'settings', group: 'Finance' },
    { href: '/admin/inventory', label: 'Inventory', scope: 'settings', group: 'Finance' },
    { href: '/admin/gst', label: 'GST Compliance', scope: 'settings', group: 'Finance' },
    { href: '/admin/coupons', label: 'Coupons', scope: 'coupons', group: 'Marketing' },
    { href: '/admin/review-forms', label: 'Review Forms', scope: 'review_forms', group: 'Marketing' },
    { href: '/admin/mailer', label: 'Mailer', scope: 'mailer', group: 'Marketing' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews', group: 'Marketing' },
    { href: '/admin/inflation', label: 'Inflation', scope: 'inflation', group: 'Settings' },
    { href: '/admin/settings', label: 'Settings', scope: 'settings', group: 'Settings' },
  ]

  const filteredNavLinks = navLinks.filter(link => hasScope(role, scopes, link.scope))
  const desktopNavLinks = filteredNavLinks.filter(link => !('mobileOnly' in link && link.mobileOnly))

  const usernameInitial = (session?.username || 'A')[0].toUpperCase()

  return (
    <div className="h-screen overflow-hidden flex flex-row bg-surface-secondary">
      {/* Left sidebar — desktop only */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-secondary-500 dark:bg-secondary-700 text-white h-screen overflow-y-auto">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-white/10 shrink-0">
          <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
          </svg>
          <span className="text-base font-bold">Jeffi Admin</span>
        </div>

        <AdminSidebarNav navLinks={desktopNavLinks} />
      </aside>

      {/* Right column: top bar + content */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">

        {/* Top bar — admin profile & actions */}
        <div className="flex items-center justify-between px-4 h-12 bg-surface-elevated border-b border-border-default shrink-0 shadow-sm">
          {/* Mobile: hamburger + logo */}
          <div className="flex items-center gap-2 md:hidden">
            <AdminMobileNav
              navLinks={filteredNavLinks}
              username={session?.username || 'Admin'}
              role={session?.role || 'user'}
            />
            <span className="font-bold text-foreground text-sm">Jeffi Admin</span>
          </div>
          {/* Desktop: spacer */}
          <div className="hidden md:block" />

          {/* Right side: avatar + name + role + theme + logout */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-secondary-500 dark:bg-secondary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {usernameInitial}
              </div>
              <div className="hidden sm:block leading-tight">
                <p className="text-xs font-semibold text-foreground leading-none">{session?.username || 'Admin'}</p>
                <p className="text-[10px] text-foreground-muted capitalize">{session?.role || 'user'}</p>
              </div>
            </div>
            <ThemeToggle variant="admin" />
            <form action={logoutAction}>
              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              >
                Logout
              </button>
            </form>
          </div>
        </div>

        <main className="flex-1 bg-surface-secondary overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
