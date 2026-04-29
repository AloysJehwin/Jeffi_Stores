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
    { href: '/admin/products', label: 'Products', scope: 'products' },
    { href: '/admin/categories', label: 'Categories', scope: 'categories' },
    { href: '/admin/brands', label: 'Brands', scope: 'brands' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders' },
    { href: '/admin/customers', label: 'Customers', scope: 'customers' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews' },
    { href: '/admin/settings', label: 'Settings', scope: 'settings' },
  ]

  const filteredNavLinks = navLinks.filter(link => hasScope(role, scopes, link.scope))

  return (
    <div className="min-h-screen flex flex-row bg-surface-secondary">
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-secondary-500 dark:bg-secondary-700 text-white min-h-screen sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-white/10">
          <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
          </svg>
          <span className="text-base font-bold">Jeffi Admin</span>
        </div>

        <AdminSidebarNav navLinks={filteredNavLinks} />

        <div className="p-3 border-t border-white/10 space-y-2">
          <p className="text-xs text-gray-300 px-2">
            {session?.username || 'Admin'}{' '}
            <span className="text-gray-400">({session?.role || 'user'})</span>
          </p>
          <div className="px-2">
            <ThemeToggle variant="admin" />
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </form>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between px-4 h-14 bg-secondary-500 dark:bg-secondary-700 text-white shadow-lg shrink-0">
          <div className="flex items-center gap-2">
            <AdminMobileNav
              navLinks={filteredNavLinks}
              username={session?.username || 'Admin'}
              role={session?.role || 'user'}
            />
            <span className="font-bold">Jeffi Admin</span>
          </div>
          <ThemeToggle variant="admin" />
        </div>

        <main className="flex-1 bg-surface-secondary">
          {children}
        </main>
      </div>
    </div>
  )
}
