export interface ScopeDefinition {
  key: string
  label: string
  description: string
  routes: string[]
}

export const ADMIN_SCOPES: ScopeDefinition[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'View dashboard and analytics',
    routes: ['/admin/dashboard'],
  },
  {
    key: 'products',
    label: 'Products',
    description: 'Manage products, add/edit/delete',
    routes: ['/admin/products'],
  },
  {
    key: 'categories',
    label: 'Categories',
    description: 'Manage categories, add/edit/delete',
    routes: ['/admin/categories'],
  },
  {
    key: 'orders',
    label: 'Orders',
    description: 'View and manage orders',
    routes: ['/admin/orders'],
  },
  {
    key: 'reviews',
    label: 'Reviews',
    description: 'Moderate product reviews',
    routes: ['/admin/reviews'],
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'System settings and admin management',
    routes: ['/admin/settings'],
  },
]

export const ALL_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key)

/**
 * Determine which scope is required for a given admin path.
 * Returns null if no scope is required (e.g. login page, root admin).
 */
export function getScopeForPath(pathname: string): string | null {
  // No scope required for login
  if (pathname === '/admin/login') return null
  // Root admin redirects to dashboard
  if (pathname === '/admin') return 'dashboard'

  for (const scope of ADMIN_SCOPES) {
    for (const route of scope.routes) {
      if (pathname === route || pathname.startsWith(route + '/')) {
        return scope.key
      }
    }
  }

  // API routes for admin
  if (pathname.startsWith('/api/admin/users')) return 'settings'
  if (pathname.startsWith('/api/admin/certificates')) return 'settings'
  if (pathname.startsWith('/api/admin/reviews')) return 'reviews'

  return null
}

/**
 * Check if an admin with the given role and scopes has access to the required scope.
 * super_admin always has access to everything.
 */
export function hasScope(role: string, scopes: string[], requiredScope: string): boolean {
  if (role === 'super_admin') return true
  return scopes.includes(requiredScope)
}
