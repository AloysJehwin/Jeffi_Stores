export interface ScopeDefinition {
  key: string
  label: string
  description: string
  routes: string[]
  group?: string
}

export const ADMIN_SCOPES: ScopeDefinition[] = [
  // Dashboard
  {
    key: 'dashboard:read',
    label: 'Dashboard (Read)',
    description: 'View dashboard analytics and traffic reports',
    routes: ['/admin/dashboard'],
    group: 'Dashboard',
  },

  // Catalogue
  {
    key: 'products:read',
    label: 'Products (Read)',
    description: 'View products, variants, images and units',
    routes: ['/admin/products'],
    group: 'Catalogue',
  },
  {
    key: 'products:write',
    label: 'Products (Write)',
    description: 'Create, edit and delete products, variants, images and units',
    routes: ['/admin/products'],
    group: 'Catalogue',
  },
  {
    key: 'categories:read',
    label: 'Categories (Read)',
    description: 'View product categories and brands',
    routes: ['/admin/categories'],
    group: 'Catalogue',
  },
  {
    key: 'categories:write',
    label: 'Categories (Write)',
    description: 'Create, edit and delete categories and brands',
    routes: ['/admin/categories'],
    group: 'Catalogue',
  },
  {
    key: 'brands:read',
    label: 'Brands (Read)',
    description: 'View product brands',
    routes: ['/admin/brands'],
    group: 'Catalogue',
  },
  {
    key: 'brands:write',
    label: 'Brands (Write)',
    description: 'Create, edit and delete product brands',
    routes: ['/admin/brands'],
    group: 'Catalogue',
  },
  {
    key: 'catalog_enrichment:read',
    label: 'AI Enrichment (Read)',
    description: 'View AI-powered catalog enrichment suggestions',
    routes: ['/admin/catalog-enrichment'],
    group: 'Catalogue',
  },
  {
    key: 'catalog_enrichment:write',
    label: 'AI Enrichment (Write)',
    description: 'Run, approve and reject AI-powered catalog enrichment in bulk',
    routes: ['/admin/catalog-enrichment'],
    group: 'Catalogue',
  },

  // Sales
  {
    key: 'orders:read',
    label: 'Orders (Read)',
    description: 'View orders, shipment status and documents',
    routes: ['/admin/orders'],
    group: 'Sales',
  },
  {
    key: 'orders:write',
    label: 'Orders (Write)',
    description: 'Update orders, create shipments, cancel and manage fulfilment',
    routes: ['/admin/orders'],
    group: 'Sales',
  },
  {
    key: 'quotations:read',
    label: 'Quotations (Read)',
    description: 'View and download B2B quotations',
    routes: ['/admin/quotations'],
    group: 'Sales',
  },
  {
    key: 'quotations:write',
    label: 'Quotations (Write)',
    description: 'Create, edit and convert B2B quotations to invoices',
    routes: ['/admin/quotations'],
    group: 'Sales',
  },
  {
    key: 'invoices:read',
    label: 'Invoices (Read)',
    description: 'View invoices and invoice details',
    routes: ['/admin/invoices'],
    group: 'Sales',
  },
  {
    key: 'invoices:write',
    label: 'Invoices (Write)',
    description: 'Create offline invoices, cash sales and manage invoice drafts',
    routes: ['/admin/invoices'],
    group: 'Sales',
  },
  {
    key: 'customers:read',
    label: 'Customers (Read)',
    description: 'View customer accounts, notes, tags and activity',
    routes: ['/admin/customers'],
    group: 'Sales',
  },
  {
    key: 'customers:write',
    label: 'Customers (Write)',
    description: 'Edit customer accounts, add notes, tags and manage CRM tasks',
    routes: ['/admin/customers'],
    group: 'Sales',
  },

  // Fulfilment
  {
    key: 'packing_slips:read',
    label: 'Packing Slips (Read)',
    description: 'View and download packing slips',
    routes: ['/admin/packing-slips'],
    group: 'Fulfilment',
  },
  {
    key: 'packing_slips:write',
    label: 'Packing Slips (Write)',
    description: 'Generate bulk packing slips',
    routes: ['/admin/packing-slips'],
    group: 'Fulfilment',
  },
  {
    key: 'labels:read',
    label: 'Labels (Read)',
    description: 'View label generator',
    routes: ['/admin/labels'],
    group: 'Fulfilment',
  },
  {
    key: 'labels:write',
    label: 'Labels (Write)',
    description: 'Generate and download product labels with QR codes and barcodes',
    routes: ['/admin/labels'],
    group: 'Fulfilment',
  },
  {
    key: 'quick_scan:read',
    label: 'QuickScan (Read)',
    description: 'View QuickScan interface',
    routes: ['/admin/scan'],
    group: 'Fulfilment',
  },
  {
    key: 'quick_scan:write',
    label: 'QuickScan (Write)',
    description: 'Scan and update order shipping status',
    routes: ['/admin/scan'],
    group: 'Fulfilment',
  },

  // Marketing
  {
    key: 'reviews:read',
    label: 'Reviews (Read)',
    description: 'View product reviews',
    routes: ['/admin/reviews'],
    group: 'Marketing',
  },
  {
    key: 'reviews:write',
    label: 'Reviews (Write)',
    description: 'Approve, reject and moderate product reviews',
    routes: ['/admin/reviews'],
    group: 'Marketing',
  },
  {
    key: 'coupons:read',
    label: 'Coupons (Read)',
    description: 'View discount coupons',
    routes: ['/admin/coupons'],
    group: 'Marketing',
  },
  {
    key: 'coupons:write',
    label: 'Coupons (Write)',
    description: 'Create, edit and delete discount coupons',
    routes: ['/admin/coupons'],
    group: 'Marketing',
  },
  {
    key: 'review_forms:read',
    label: 'Review Forms (Read)',
    description: 'View Google review incentive forms and submissions',
    routes: ['/admin/review-forms'],
    group: 'Marketing',
  },
  {
    key: 'review_forms:write',
    label: 'Review Forms (Write)',
    description: 'Create and manage Google review incentive forms',
    routes: ['/admin/review-forms'],
    group: 'Marketing',
  },
  {
    key: 'mailer:read',
    label: 'Mailer (Read)',
    description: 'View email campaigns and audience previews',
    routes: ['/admin/mailer'],
    group: 'Marketing',
  },
  {
    key: 'mailer:write',
    label: 'Mailer (Write)',
    description: 'Create, send and schedule email campaigns to customers',
    routes: ['/admin/mailer'],
    group: 'Marketing',
  },

  // Finance
  {
    key: 'financial:read',
    label: 'Financial (Read)',
    description: 'View payables, receivables, P&L and financial summaries',
    routes: ['/admin/financial'],
    group: 'Finance',
  },
  {
    key: 'financial:write',
    label: 'Financial (Write)',
    description: 'Record payments, process payouts and sync financial data',
    routes: ['/admin/financial'],
    group: 'Finance',
  },
  {
    key: 'inventory:read',
    label: 'Inventory (Read)',
    description: 'View stock levels, purchase orders, suppliers and movements',
    routes: ['/admin/inventory'],
    group: 'Finance',
  },
  {
    key: 'inventory:write',
    label: 'Inventory (Write)',
    description: 'Manage stock, raise purchase orders and update supplier records',
    routes: ['/admin/inventory'],
    group: 'Finance',
  },
  {
    key: 'gst:read',
    label: 'GST Compliance (Read)',
    description: 'View GST reports, GSTR summaries and tax compliance tools',
    routes: ['/admin/gst'],
    group: 'Finance',
  },
  {
    key: 'gst:write',
    label: 'GST Compliance (Write)',
    description: 'File GST returns and manage compliance actions',
    routes: ['/admin/gst'],
    group: 'Finance',
  },

  // AI
  {
    key: 'agent:read',
    label: 'AI Agent (Read)',
    description: 'View AI agent conversations and tool call logs',
    routes: ['/admin/agent'],
    group: 'AI',
  },
  {
    key: 'agent:write',
    label: 'AI Agent (Write)',
    description: 'Use the AI admin assistant; approve and reject proposed tool actions',
    routes: ['/admin/agent'],
    group: 'AI',
  },

  // Business
  {
    key: 'business_customers:read',
    label: 'Business Customers (Read)',
    description: 'View business partner accounts and approval status',
    routes: ['/admin/business/customers'],
    group: 'Business',
  },
  {
    key: 'business_customers:write',
    label: 'Business Customers (Write)',
    description: 'Manage business partner accounts, approvals and discounts',
    routes: ['/admin/business/customers'],
    group: 'Business',
  },
  {
    key: 'business_rfqs:read',
    label: 'Business RFQs (Read)',
    description: 'View business partner RFQ requests',
    routes: ['/admin/business/rfqs'],
    group: 'Business',
  },
  {
    key: 'business_rfqs:write',
    label: 'Business RFQs (Write)',
    description: 'Respond to and manage business partner RFQ requests',
    routes: ['/admin/business/rfqs'],
    group: 'Business',
  },

  // Settings
  {
    key: 'inflation:read',
    label: 'Inflation / Pricing (Read)',
    description: 'View bulk price adjustment history and logs',
    routes: ['/admin/inflation'],
    group: 'Settings',
  },
  {
    key: 'inflation:write',
    label: 'Inflation / Pricing (Write)',
    description: 'Run and rollback bulk price adjustments via inflation tool',
    routes: ['/admin/inflation'],
    group: 'Settings',
  },
  {
    key: 'settings:read',
    label: 'Settings (Read)',
    description: 'View system settings and configuration',
    routes: ['/admin/settings'],
    group: 'Settings',
  },
  {
    key: 'settings:write',
    label: 'Settings (Write)',
    description: 'Edit system settings, admin accounts and configuration',
    routes: ['/admin/settings'],
    group: 'Settings',
  },
  {
    key: 'audit:read',
    label: 'Audit Log (Read)',
    description: 'View system audit logs, cron job history and agent tool call logs',
    routes: ['/admin/audit'],
    group: 'Settings',
  },
  {
    key: 'audit:write',
    label: 'Audit Log (Write)',
    description: 'Post audit log entries from service accounts and automated systems',
    routes: ['/admin/audit'],
    group: 'Settings',
  },
  {
    key: 'replication:read',
    label: 'Replication (Read)',
    description: 'View nightly RDS→Razer ML-replica replication history',
    routes: ['/admin/replication'],
    group: 'Settings',
  },
  {
    key: 'service_accounts:read',
    label: 'Service Accounts (Read)',
    description: 'View M2M service accounts and their status',
    routes: ['/admin/service-accounts'],
    group: 'Settings',
  },
  {
    key: 'service_accounts:write',
    label: 'Service Accounts (Write)',
    description: 'Create, revoke and manage M2M service accounts and certificates',
    routes: ['/admin/service-accounts'],
    group: 'Settings',
  },
]

export const ALL_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key)

export function getScopeForPath(pathname: string): string | null {
  if (pathname === '/admin/login') return null
  if (pathname === '/admin') return 'dashboard:read'

  for (const scope of ADMIN_SCOPES) {
    for (const route of scope.routes) {
      if (pathname === route || pathname.startsWith(route + '/')) {
        return scope.key
      }
    }
  }

  if (pathname.startsWith('/api/admin/financial')) return 'financial:read'
  if (pathname.startsWith('/api/admin/inventory')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/gst')) return 'gst:read'
  if (pathname.startsWith('/api/admin/labels')) return 'labels:read'
  if (pathname.startsWith('/api/admin/quotations')) return 'quotations:read'
  if (pathname.startsWith('/api/admin/invoices')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/orders/create')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/orders')) return 'orders:read'
  if (pathname.startsWith('/api/admin/products')) return 'products:read'
  if (pathname.startsWith('/api/admin/categories')) return 'categories:read'
  if (pathname.startsWith('/api/admin/packing-slips')) return 'packing_slips:read'
  if (pathname.startsWith('/api/admin/cash-sale')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/inflation')) return 'inflation:read'
  if (pathname.startsWith('/api/admin/customers')) return 'customers:read'
  if (pathname.startsWith('/api/admin/suppliers')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/delhivery')) return 'orders:read'
  if (pathname.startsWith('/api/admin/support')) return 'customers:read'
  if (pathname.startsWith('/api/admin/users')) return 'settings:read'
  if (pathname.startsWith('/api/admin/certificates')) return 'settings:read'
  if (pathname.startsWith('/api/admin/reviews')) return 'reviews:read'
  if (pathname.startsWith('/api/admin/coupons')) return 'coupons:read'
  if (pathname.startsWith('/api/admin/review-forms')) return 'review_forms:read'
  if (pathname.startsWith('/api/admin/mailer')) return 'mailer:read'
  if (pathname.startsWith('/api/admin/suggest')) return null
  if (pathname.startsWith('/api/admin/traffic')) return 'dashboard:read'
  if (pathname.startsWith('/api/admin/agent')) return 'agent:read'
  if (pathname.startsWith('/api/admin/catalog-enrichment')) return 'catalog_enrichment:read'
  if (pathname.startsWith('/api/admin/audit')) return 'audit:read'
  if (pathname.startsWith('/api/admin/cron')) return 'audit:read'
  if (pathname.startsWith('/api/admin/replication')) return 'replication:read'
  if (pathname.startsWith('/api/admin/service-accounts')) return 'service_accounts:read'
  if (pathname.startsWith('/api/internal/cron-record')) return null
  if (pathname.startsWith('/api/admin/business/customers')) return 'business_customers:read'
  if (pathname.startsWith('/api/admin/business/discounts')) return 'business_customers:read'
  if (pathname.startsWith('/api/admin/business/rfqs')) return 'business_rfqs:read'
  if (pathname.startsWith('/api/brands')) return 'brands:read'
  if (pathname.startsWith('/api/customers')) return 'customers:read'

  return null
}

export function hasScope(role: string, scopes: string[], requiredScope: string): boolean {
  if (role === 'super_admin') return true
  if (scopes.includes(requiredScope)) return true
  // write implies read for all namespaced scopes (e.g. products:write grants products:read)
  if (requiredScope.endsWith(':read')) {
    const writeScope = requiredScope.replace(':read', ':write')
    if (scopes.includes(writeScope)) return true
  }
  return false
}
