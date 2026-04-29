import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import AdminMobileNav from '@/components/admin/AdminMobileNav'
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
    <div className="min-h-screen flex flex-col bg-surface-secondary">
      <nav className="bg-secondary-500 dark:bg-secondary-700 text-white shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2 shrink-0">
              <AdminMobileNav
                navLinks={filteredNavLinks}
                username={session?.username || 'Admin'}
                role={session?.role || 'user'}
              />
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
              </svg>
              <span className="text-base font-bold whitespace-nowrap">Jeffi Admin</span>
            </div>

            <div className="hidden md:flex items-center gap-1 overflow-x-auto">
              {filteredNavLinks.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <ThemeToggle variant="admin" />
              <span className="hidden lg:inline text-sm whitespace-nowrap">
                {session?.username || 'Admin'} <span className="text-gray-300 text-xs">({session?.role || 'user'})</span>
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>
      <main className="bg-surface-secondary flex-1 pb-20 md:pb-0">
        {children}
      </main>
    </div>
  )
}
