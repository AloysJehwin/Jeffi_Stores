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
    key: 'brands',
    label: 'Brands',
    description: 'Manage product brands',
    routes: ['/admin/brands'],
  },
  {
    key: 'customers',
    label: 'Customers',
    description: 'View and manage customer accounts',
    routes: ['/admin/customers'],
  },
  {
    key: 'packing_slips',
    label: 'Packing Slips',
    description: 'Download and print packing slips',
    routes: ['/admin/packing-slips'],
  },
  {
    key: 'labels',
    label: 'Label Generator',
    description: 'Generate and download product labels with QR codes and barcodes',
    routes: ['/admin/labels'],
  },
  {
    key: 'quick_scan',
    label: 'QuickScan',
    description: 'Scan and update order shipping status',
    routes: ['/admin/scan'],
  },
  {
    key: 'quotations',
    label: 'Quotations',
    description: 'Create and download B2B quotations',
    routes: ['/admin/quotations'],
  },
  {
    key: 'inflation',
    label: 'Inflation / Pricing',
    description: 'Bulk price adjustments via inflation tool',
    routes: ['/admin/inflation'],
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'System settings and admin management',
    routes: ['/admin/settings'],
  },
  {
    key: 'coupons',
    label: 'Coupons',
    description: 'Create and manage discount coupons',
    routes: ['/admin/coupons'],
  },
  {
    key: 'review_forms',
    label: 'Review Forms',
    description: 'Manage Google review incentive forms',
    routes: ['/admin/review-forms'],
  },
]

export const ALL_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key)

export function getScopeForPath(pathname: string): string | null {
  if (pathname === '/admin/login') return null
  if (pathname === '/admin') return 'dashboard'

  for (const scope of ADMIN_SCOPES) {
    for (const route of scope.routes) {
      if (pathname === route || pathname.startsWith(route + '/')) {
        return scope.key
      }
    }
  }

  if (pathname.startsWith('/api/admin/labels')) return 'labels'
  if (pathname.startsWith('/api/admin/quotations')) return 'quotations'
  if (pathname.startsWith('/api/admin/users')) return 'settings'
  if (pathname.startsWith('/api/admin/certificates')) return 'settings'
  if (pathname.startsWith('/api/admin/reviews')) return 'reviews'
  if (pathname.startsWith('/api/admin/coupons')) return 'coupons'
  if (pathname.startsWith('/api/admin/review-forms')) return 'review_forms'
  if (pathname.startsWith('/api/brands')) return 'brands'
  if (pathname.startsWith('/api/customers')) return 'customers'

  return null
}

export function hasScope(role: string, scopes: string[], requiredScope: string): boolean {
  if (role === 'super_admin') return true
  return scopes.includes(requiredScope)
}
