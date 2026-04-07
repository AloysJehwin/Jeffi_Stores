import { cookies, headers } from 'next/headers'
import { logoutAction } from './logout-action'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

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

  // If it's the login page, render without navigation
  const isLoginPage = pathname === '/admin/login'

  if (isLoginPage) {
    return children
  }

  // For all other admin pages, get session and show navigation
  const session = await getAdminSession()
  const role = session?.role || ''
  const scopes: string[] = session?.scopes || []

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard', scope: 'dashboard' },
    { href: '/admin/products', label: 'Products', scope: 'products' },
    { href: '/admin/categories', label: 'Categories', scope: 'categories' },
    { href: '/admin/orders', label: 'Orders', scope: 'orders' },
    { href: '/admin/reviews', label: 'Reviews', scope: 'reviews' },
    { href: '/admin/settings', label: 'Settings', scope: 'settings' },
  ]

  return (
    <div className="min-h-screen">
      <nav className="bg-secondary-500 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center">
              <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
              </svg>
              <h2 className="text-xl font-bold">Jeffi Stores Admin</h2>
            </div>

            {/* Nav Links */}
            <div className="hidden md:block">
              <div className="flex items-center space-x-6">
                {navLinks
                  .filter(link => hasScope(role, scopes, link.scope))
                  .map(link => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="hover:text-primary-500 transition-colors font-medium"
                    >
                      {link.label}
                    </a>
                  ))}
              </div>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-4">
              <span className="text-sm">
                {session?.username || 'Admin'} <span className="text-gray-300">({session?.role || 'user'})</span>
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>
      <main className="bg-gray-100 min-h-screen">
        {children}
      </main>
    </div>
  )
}
