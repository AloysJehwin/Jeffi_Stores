export interface ScopeDefinition {
  key: string
  label: string
  description: string
  routes: string[]
  group?: string
  /** SaaS control plane — meaningful only on the platform's own admin, never in a tenant. */
  platformOnly?: boolean
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
  // Merchant Sync — previously piggybacked on products:read. Dedicated key for tiering.
  {
    key: 'merchant_sync:read',
    label: 'Merchant Sync (Read)',
    description: 'View Google/Amazon merchant feed sync status',
    routes: ['/admin/merchant-sync'],
    group: 'Catalogue',
  },
  {
    key: 'merchant_sync:write',
    label: 'Merchant Sync (Write)',
    description: 'Run and manage Google/Amazon merchant feed synchronization',
    routes: ['/admin/merchant-sync'],
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
  // Returns / Replacements / Delhivery pickup — previously piggybacked on
  // orders:read. Given dedicated keys so plan tiers can enable them independently.
  // Still implied by orders:write via hasScope's write⇒read for the same feature? No —
  // these are distinct features, so they get their own read/write keys. Basic plan
  // can grant orders:* without returns:* etc.
  {
    key: 'returns:read',
    label: 'Returns (Read)',
    description: 'View return requests',
    routes: ['/admin/returns'],
    group: 'Sales',
  },
  {
    key: 'returns:write',
    label: 'Returns (Write)',
    description: 'Approve, reject and process return requests and refunds',
    routes: ['/admin/returns'],
    group: 'Sales',
  },
  {
    key: 'replacements:read',
    label: 'Replacements (Read)',
    description: 'View replacement requests',
    routes: ['/admin/replacements'],
    group: 'Sales',
  },
  {
    key: 'replacements:write',
    label: 'Replacements (Write)',
    description: 'Process replacement requests and issue replacement orders',
    routes: ['/admin/replacements'],
    group: 'Sales',
  },
  {
    key: 'delhivery:read',
    label: 'Pickup Requests (Read)',
    description: 'View Delhivery pickup requests and scheduling',
    routes: ['/admin/delhivery'],
    group: 'Fulfilment',
  },
  {
    key: 'delhivery:write',
    label: 'Pickup Requests (Write)',
    description: 'Schedule and manage Delhivery pickup requests',
    routes: ['/admin/delhivery'],
    group: 'Fulfilment',
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
  // CRM & Tasks — previously piggybacked on customers:read. Dedicated keys for tiering.
  {
    key: 'crm:read',
    label: 'CRM (Read)',
    description: 'View the CRM pipeline, deals and customer relationship data',
    routes: ['/admin/crm'],
    group: 'Sales',
  },
  {
    key: 'crm:write',
    label: 'CRM (Write)',
    description: 'Manage CRM pipeline stages, deals and customer relationships',
    routes: ['/admin/crm'],
    group: 'Sales',
  },
  {
    key: 'tasks:read',
    label: 'Tasks (Read)',
    description: 'View team tasks and follow-ups',
    routes: ['/admin/tasks'],
    group: 'Sales',
  },
  {
    key: 'tasks:write',
    label: 'Tasks (Write)',
    description: 'Create, assign and complete team tasks',
    routes: ['/admin/tasks'],
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
    description: 'View discount coupons and Razorpay bank offers',
    routes: ['/admin/coupons', '/admin/offers'],
    group: 'Marketing',
  },
  {
    key: 'coupons:write',
    label: 'Coupons (Write)',
    description: 'Create, edit and delete discount coupons',
    routes: ['/admin/coupons', '/admin/offers'],
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
  // Campaigns — previously piggybacked on mailer:read. Dedicated key for tiering.
  {
    key: 'campaigns:read',
    label: 'Campaigns (Read)',
    description: 'View marketing campaigns',
    routes: ['/admin/campaigns'],
    group: 'Marketing',
  },
  {
    key: 'campaigns:write',
    label: 'Campaigns (Write)',
    description: 'Create and manage marketing campaigns',
    routes: ['/admin/campaigns'],
    group: 'Marketing',
  },
  // Traffic analytics — previously piggybacked on dashboard:read. Dedicated key.
  {
    key: 'traffic:read',
    label: 'Traffic (Read)',
    description: 'View storefront traffic and visitor analytics',
    routes: ['/admin/traffic'],
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
  // Shelving — previously piggybacked on inventory:read. Dedicated key for tiering.
  {
    key: 'shelving:read',
    label: 'Shelving (Read)',
    description: 'View warehouse shelving and bin locations',
    routes: ['/admin/shelving'],
    group: 'Finance',
  },
  {
    key: 'shelving:write',
    label: 'Shelving (Write)',
    description: 'Manage warehouse shelving, bins and stock locations',
    routes: ['/admin/shelving'],
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
  // Site Controls — previously piggybacked on inflation:read. Dedicated key for tiering.
  {
    key: 'controls:read',
    label: 'Site Controls (Read)',
    description: 'View site controls, feature flags and background job status',
    routes: ['/admin/controls'],
    group: 'Settings',
  },
  {
    key: 'controls:write',
    label: 'Site Controls (Write)',
    description: 'Toggle feature flags, site controls and run background jobs',
    routes: ['/admin/controls'],
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

  // Ecom Store (SaaS control plane) — platform-operator only (superAdminOnly nav).
  // These gate the multi-tenant control-plane admin pages, NOT tenant features.
  {
    key: 'ecom_customers:read',
    label: 'Ecom Customers (Read)',
    description: 'View SaaS tenant stores, plans and status',
    routes: ['/admin/ecom/customers'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_customers:write',
    label: 'Ecom Customers (Write)',
    description: 'Manage SaaS tenants: suspend, resume, terminate, change plan',
    routes: ['/admin/ecom/customers'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_instances:read',
    label: 'Ecom Instances (Read)',
    description: 'View per-tenant EC2/RDS/nginx/CDN/cert infrastructure status',
    routes: ['/admin/ecom/instances'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_billing:read',
    label: 'Ecom Billing (Read)',
    description: 'View tenant subscriptions, settlement ledger and payouts',
    routes: ['/admin/ecom/billing'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_billing:write',
    label: 'Ecom Billing (Write)',
    description: 'Manage tenant subscriptions, adjust settlements and trigger payouts',
    routes: ['/admin/ecom/billing'],
    group: 'Ecom Store',
    platformOnly: true,
  },
]

export const ALL_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key)

/** Scopes a tenant admin may hold. Granting a tenant the control-plane scopes is meaningless
 *  at best — the routes they gate are 404 on a tenant host — and misleading in the team UI. */
export const TENANT_SCOPE_KEYS = ADMIN_SCOPES.filter(s => !s.platformOnly).map(s => s.key)

export function assignableScopes(includePlatform: boolean): ScopeDefinition[] {
  return includePlatform ? ADMIN_SCOPES : ADMIN_SCOPES.filter(s => !s.platformOnly)
}

export const SUPER_ROLES = ['administrator', 'super_admin'] as const

export function isPlatformOwner(role: string): boolean {
  return role === 'administrator' || role === 'super_admin'
}

export function isPlatformAdmin(role: string): boolean {
  return role === 'administrator'
}

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
  if (pathname.startsWith('/api/admin/controls')) return 'controls:read'
  if (pathname.startsWith('/api/admin/customers')) return 'customers:read'
  if (pathname.startsWith('/api/admin/crm')) return 'crm:read'
  if (pathname.startsWith('/api/admin/tasks')) return 'tasks:read'
  if (pathname.startsWith('/api/admin/suppliers')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/shelving')) return 'shelving:read'
  if (pathname.startsWith('/api/admin/merchant-sync')) return 'merchant_sync:read'
  if (pathname.startsWith('/api/admin/returns')) return 'returns:read'
  if (pathname.startsWith('/api/admin/replacements')) return 'replacements:read'
  if (pathname.startsWith('/api/admin/delhivery')) return 'delhivery:read'
  if (pathname.startsWith('/api/admin/support')) return 'customers:read'
  if (pathname.startsWith('/api/admin/users')) return 'settings:read'
  if (pathname.startsWith('/api/admin/site-controls')) return 'settings:read'
  if (pathname.startsWith('/api/admin/certificates')) return 'settings:read'
  if (pathname.startsWith('/api/admin/reviews')) return 'reviews:read'
  if (pathname.startsWith('/api/admin/coupons')) return 'coupons:read'
  if (pathname.startsWith('/api/admin/offers')) return 'coupons:read'
  if (pathname.startsWith('/api/admin/review-forms')) return 'review_forms:read'
  if (pathname.startsWith('/api/admin/mailer')) return 'mailer:read'
  if (pathname.startsWith('/api/admin/suggest')) return null
  if (pathname.startsWith('/api/admin/traffic')) return 'traffic:read'
  if (pathname.startsWith('/api/admin/campaigns')) return 'campaigns:read'
  if (pathname.startsWith('/api/admin/agent')) return 'agent:read'
  if (pathname.startsWith('/api/admin/catalog-enrichment')) return 'catalog_enrichment:read'
  if (pathname.startsWith('/api/admin/audit')) return 'audit:read'
  if (pathname.startsWith('/api/admin/cron')) return 'audit:read'
  if (pathname.startsWith('/api/admin/replication')) return 'replication:read'
  if (pathname.startsWith('/api/admin/service-accounts')) return 'service_accounts:read'
  if (pathname.startsWith('/api/admin/ecom/customers')) return 'ecom_customers:read'
  if (pathname.startsWith('/api/admin/ecom/instances')) return 'ecom_instances:read'
  if (pathname.startsWith('/api/admin/ecom/billing')) return 'ecom_billing:read'
  if (pathname.startsWith('/api/internal/cron-record')) return null
  if (pathname.startsWith('/api/admin/business/customers')) return 'business_customers:read'
  if (pathname.startsWith('/api/admin/business/discounts')) return 'business_customers:read'
  if (pathname.startsWith('/api/admin/business/rfqs')) return 'business_rfqs:read'
  if (pathname.startsWith('/api/brands')) return 'brands:read'
  if (pathname.startsWith('/api/customers')) return 'customers:read'

  return null
}

// Newly-split scopes used to piggyback on a parent feature's scope. To avoid
// locking out existing admins whose stored scopes predate the split, a grant of
// the legacy parent scope still satisfies the new child scope. Plan-tier gating
// (which builds fresh scope sets) can still withhold the child independently.
const LEGACY_SCOPE_PARENTS: Record<string, string> = {
  'crm:read': 'customers:read',
  'crm:write': 'customers:write',
  'tasks:read': 'customers:read',
  'tasks:write': 'customers:write',
  'returns:read': 'orders:read',
  'returns:write': 'orders:write',
  'replacements:read': 'orders:read',
  'replacements:write': 'orders:write',
  'delhivery:read': 'orders:read',
  'delhivery:write': 'orders:write',
  'shelving:read': 'inventory:read',
  'shelving:write': 'inventory:write',
  'merchant_sync:read': 'products:read',
  'merchant_sync:write': 'products:write',
  'campaigns:read': 'mailer:read',
  'campaigns:write': 'mailer:write',
  'traffic:read': 'dashboard:read',
  'controls:read': 'inflation:read',
  'controls:write': 'inflation:write',
}

export function hasScope(role: string, scopes: string[], requiredScope: string): boolean {
  // Only the platform operator short-circuits. A tenant owner is also 'super_admin', so the
  // wider isPlatformOwner() check let every tenant past its plan entitlement entirely.
  if (isPlatformAdmin(role)) return true
  if (scopes.includes(requiredScope)) return true
  // write implies read for all namespaced scopes (e.g. products:write grants products:read)
  if (requiredScope.endsWith(':read')) {
    const writeScope = requiredScope.replace(':read', ':write')
    if (scopes.includes(writeScope)) return true
  }
  // Legacy fallback: a grant of the pre-split parent scope satisfies the new child.
  const parent = LEGACY_SCOPE_PARENTS[requiredScope]
  if (parent) {
    if (scopes.includes(parent)) return true
    if (parent.endsWith(':read') && scopes.includes(parent.replace(':read', ':write'))) return true
  }
  return false
}
