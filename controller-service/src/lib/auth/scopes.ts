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
    // /admin/drafts lists only the draft types the admin can read.
    routes: ['/admin/dashboard', '/admin/drafts'],
    group: 'Dashboard',
  },

  {
    key: 'notifications:read',
    label: 'Notifications (Read)',
    description: 'View the admin notification feed (bell)',
    routes: ['/admin/notifications'],
    group: 'Dashboard',
  },

  // Catalogue
  {
    key: 'products:read',
    label: 'Products (Read)',
    description: 'View products, variants, images and units',
    routes: ['/admin/products', '/admin/data-source'],
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
    description:
      'Use AI tools (field enrichment, AI fill, email and campaign copy, images) and run bulk catalog enrichment',
    routes: ['/admin/catalog-enrichment'],
    group: 'Catalogue',
  },
  // Merchant Sync — previously piggybacked on products:read. Dedicated key for tiering.
  {
    key: 'merchant_sync:read',
    label: 'Merchant Sync (Read)',
    description: 'View Google/Amazon merchant feed sync status',
    routes: ['/admin/merchant-sync', '/admin/merchant'],
    group: 'Catalogue',
  },
  {
    key: 'merchant_sync:write',
    label: 'Merchant Sync (Write)',
    description: 'Run and manage Google/Amazon merchant feed synchronization',
    routes: ['/admin/merchant-sync', '/admin/merchant'],
    group: 'Catalogue',
  },
  {
    key: 'merchant_sync:settings_write',
    label: 'Merchant Center Settings (Write)',
    description: 'Change Google Merchant Center shipping settings, return policies and promotions',
    routes: ['/admin/merchant'],
    group: 'Catalogue',
  },
  {
    key: 'amazon:read',
    label: 'Amazon (Read)',
    description: 'View Amazon listing health, Buy Box, fees, orders and sales reports',
    routes: ['/admin/amazon'],
    group: 'Catalogue',
  },
  {
    key: 'amazon:write',
    label: 'Amazon (Write)',
    description: 'Connect Amazon, refresh data and fix listings',
    routes: ['/admin/amazon'],
    group: 'Catalogue',
  },
  {
    key: 'amazon_pricing:write',
    label: 'Amazon Pricing (Write)',
    description: 'Change Amazon prices and manage repricer rules',
    routes: ['/admin/amazon'],
    group: 'Catalogue',
  },
  {
    key: 'amazon_orders:write',
    label: 'Amazon Orders & Stock (Write)',
    description: 'Import Amazon orders into Orders and push stock to Amazon',
    routes: ['/admin/amazon'],
    group: 'Orders',
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
    routes: ['/admin/delhivery', '/admin/wallet'],
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
    routes: ['/admin/invoices', '/admin/cash-sale'],
    group: 'Sales',
  },
  {
    key: 'invoices:write',
    label: 'Invoices (Write)',
    description: 'Create offline invoices, cash sales and manage invoice drafts',
    routes: ['/admin/invoices', '/admin/cash-sale'],
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
    label: 'Messaging (Read)',
    description: 'View email campaigns and audience previews',
    routes: ['/admin/marketing/messaging', '/admin/mailer'],
    group: 'Marketing',
  },
  {
    key: 'mailer:write',
    label: 'Messaging (Write)',
    description: 'Create, send and schedule email campaigns to customers',
    routes: ['/admin/marketing/messaging', '/admin/mailer'],
    group: 'Marketing',
  },
  // Messaging templates library (email / SMS / WhatsApp bodies). Sold with Mailer.
  {
    key: 'templates:read',
    label: 'Messaging Templates (Read)',
    description: 'View email, SMS and WhatsApp message templates',
    routes: ['/admin/marketing/messaging-templates'],
    group: 'Marketing',
  },
  {
    key: 'templates:write',
    label: 'Messaging Templates (Write)',
    description: 'Edit message templates and submit WhatsApp templates for approval',
    routes: ['/admin/marketing/messaging-templates'],
    group: 'Marketing',
  },
  // Campaigns — previously piggybacked on mailer:read. Dedicated key for tiering.
  {
    key: 'campaigns:read',
    label: 'Campaigns (Read)',
    description: 'View marketing campaigns',
    routes: ['/admin/campaigns', '/admin/customer-programs', '/admin/loyalty', '/admin/referrals'],
    group: 'Marketing',
  },
  {
    key: 'campaigns:write',
    label: 'Campaigns (Write)',
    description: 'Create and manage marketing campaigns',
    routes: ['/admin/campaigns', '/admin/customer-programs', '/admin/loyalty', '/admin/referrals'],
    group: 'Marketing',
  },
  // Customer subscriptions (Razorpay recurring). On every plan; the renewal-reminder campaign
  // still needs campaigns:read (Pro+).
  {
    key: 'subscriptions:read',
    label: 'Subscriptions (Read)',
    description: 'View customer subscriptions and their cycles',
    routes: ['/admin/subscriptions'],
    group: 'Orders',
  },
  {
    key: 'subscriptions:write',
    label: 'Subscriptions (Write)',
    description: 'Cancel, pause, resume and sync customer subscriptions',
    routes: ['/admin/subscriptions'],
    group: 'Orders',
  },
  // Vault — private digital files served through the authenticated vault host. On every plan.
  {
    key: 'vault:read',
    label: 'Vault (Read)',
    description: 'View digital files and vault access logs',
    routes: ['/admin/vault'],
    group: 'Catalogue',
  },
  {
    key: 'vault:write',
    label: 'Vault (Write)',
    description: 'Upload, replace and delete digital files; set download permissions',
    routes: ['/admin/vault'],
    group: 'Catalogue',
  },
  // Traffic analytics — previously piggybacked on dashboard:read. Dedicated key.
  {
    key: 'traffic:read',
    label: 'Traffic (Read)',
    description: 'View storefront traffic and visitor analytics',
    routes: ['/admin/traffic'],
    group: 'Marketing',
  },
  {
    key: 'google_ads:read',
    label: 'Google Ads (Read)',
    description: 'View Google Ads performance, campaigns, keywords and sync status',
    routes: ['/admin/google-ads'],
    group: 'Marketing',
  },
  {
    key: 'google_ads:write',
    label: 'Google Ads (Write)',
    description: 'Connect or disconnect a Google Ads account and run an Ads sync',
    routes: ['/admin/google-ads'],
    group: 'Marketing',
  },
  {
    key: 'google_ads_campaigns:write',
    label: 'Google Ads Campaigns (Write)',
    description: 'Create Google Ads campaigns and change budgets, bids, keywords, ads, assets and recommendations',
    routes: ['/admin/google-ads'],
    group: 'Marketing',
  },
  {
    key: 'amazon_ads:read',
    label: 'Amazon Ads (Read)',
    description: 'View Amazon Sponsored Products performance, campaigns, keywords and search terms',
    routes: ['/admin/amazon-ads'],
    group: 'Marketing',
  },
  {
    key: 'amazon_ads:write',
    label: 'Amazon Ads (Write)',
    description: 'Connect Amazon Ads and change campaigns, budgets, bids, keywords and negatives',
    routes: ['/admin/amazon-ads'],
    group: 'Marketing',
  },
  {
    key: 'meta_ads:read',
    label: 'Meta Ads (Read)',
    description: 'View Facebook and Instagram ads performance and Conversions API health',
    routes: ['/admin/meta-ads'],
    group: 'Marketing',
  },
  {
    key: 'meta_ads:write',
    label: 'Meta Ads (Write)',
    description: 'Connect a Meta ad account and run a Meta Ads sync',
    routes: ['/admin/meta-ads'],
    group: 'Marketing',
  },
  {
    key: 'meta_ads_campaigns:write',
    label: 'Meta Ads Campaigns (Write)',
    description: 'Create Meta campaigns and change budgets, ad sets and ads',
    routes: ['/admin/meta-ads'],
    group: 'Marketing',
  },
  {
    key: 'social:read',
    label: 'Social (Read)',
    description: 'View social posts, the calendar, insights and the social inbox',
    routes: ['/admin/social-posts'],
    group: 'Marketing',
  },
  {
    key: 'social:write',
    label: 'Social (Write)',
    description: 'Connect social accounts, write and schedule posts, reply to comments',
    routes: ['/admin/social-posts'],
    group: 'Marketing',
  },
  {
    key: 'social:approve',
    label: 'Social (Approve)',
    description: 'Approve social posts that need sign-off before they publish',
    routes: ['/admin/social-posts'],
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
    routes: ['/admin/inventory', '/admin/suppliers', '/admin/purchase-orders'],
    group: 'Finance',
  },
  {
    key: 'inventory:write',
    label: 'Inventory (Write)',
    description: 'Manage stock, raise purchase orders and update supplier records',
    routes: ['/admin/inventory', '/admin/suppliers', '/admin/purchase-orders'],
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
    routes: ['/admin/ecom/customers', '/admin/ecom/store-status'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_customers:write',
    label: 'Ecom Customers (Write)',
    description: 'Manage SaaS tenants: suspend, resume, terminate, change plan',
    routes: ['/admin/ecom/customers', '/admin/ecom/store-status'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_instances:read',
    label: 'Ecom Instances (Read)',
    description: 'View per-tenant EC2/RDS/nginx/CDN/cert infrastructure status',
    routes: ['/admin/ecom/instances', '/admin/ecom/google-ads'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_billing:read',
    label: 'Ecom Billing (Read)',
    description: 'View tenant subscriptions, settlement ledger and payouts',
    routes: ['/admin/ecom/billing', '/admin/ecom/ai-pricing', '/admin/settings/ai-pricing'],
    group: 'Ecom Store',
    platformOnly: true,
  },
  {
    key: 'ecom_billing:write',
    label: 'Ecom Billing (Write)',
    description: 'Manage tenant subscriptions, adjust settlements, trigger payouts and edit the AI price list',
    routes: ['/admin/ecom/billing', '/admin/ecom/ai-pricing', '/admin/settings/ai-pricing'],
    group: 'Ecom Store',
    platformOnly: true,
  },
]

export const ALL_SCOPE_KEYS = ADMIN_SCOPES.map(s => s.key)

/** Scopes a tenant admin may hold. Granting a tenant the control-plane scopes is meaningless
 *  at best — the routes they gate are 404 on a tenant host — and misleading in the team UI. */
export const TENANT_SCOPE_KEYS = ADMIN_SCOPES.filter(s => !s.platformOnly).map(s => s.key)

/**
 * The scopes safe to fall back to when a tenant's plan entitlement cannot be resolved (control-
 * plane error or empty plan). Every plan — including Basic — sells these, so falling back to them
 * keeps the admin shell and settings reachable during a blip without exposing any feature page a
 * plan may not have bought. Fail closed: never fall back to the full grant.
 */
export const SAFE_CORE_SCOPE_KEYS = ['dashboard:read', 'settings:read']

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
  // Under /admin/settings but gated as the control-plane billing page, not settings:*.
  if (pathname === '/admin/settings/ai-pricing' || pathname.startsWith('/admin/settings/ai-pricing/')) return 'ecom_billing:read'

  for (const scope of ADMIN_SCOPES) {
    for (const route of scope.routes) {
      if (pathname === route || pathname.startsWith(route + '/')) {
        return scope.key
      }
    }
  }

  if (pathname.startsWith('/api/admin/notifications')) return 'notifications:read'
  // Wallet top-up for shared-Delhivery shipping cost — a delhivery-flow helper that lives under
  // /financial but is gated on delhivery:write (see the route handlers), so it must be reachable on
  // plans without financial:* (basic/growth). Keep this above the generic financial match.
  if (pathname.startsWith('/api/admin/financial/wallet/topup')) return 'delhivery:read'
  if (pathname.startsWith('/api/admin/financial')) return 'financial:read'
  // Batch allocation for an order line / invoice create — an orders-flow helper that
  // lives under /inventory but is gated on orders:read (see the route handler), so it
  // must be reachable on plans without inventory:*. Keep this above the generic match.
  if (pathname.startsWith('/api/admin/inventory/batches/available')) return 'orders:read'
  if (pathname.startsWith('/api/admin/inventory')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/gst')) return 'gst:read'
  if (pathname.startsWith('/api/admin/labels')) return 'labels:read'
  if (pathname.startsWith('/api/admin/quotations')) return 'quotations:read'
  if (pathname.startsWith('/api/admin/invoices')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/orders/create')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/orders')) return 'orders:read'
  if (pathname.startsWith('/api/admin/subscriptions')) return 'subscriptions:read'
  if (pathname.startsWith('/api/admin/data-source')) return 'products:read'
  if (pathname.startsWith('/api/admin/products')) return 'products:read'
  if (pathname.startsWith('/api/admin/categories')) return 'categories:read'
  if (pathname.startsWith('/api/admin/brands')) return 'brands:read'
  if (pathname.startsWith('/api/admin/packing-slips')) return 'packing_slips:read'
  if (pathname.startsWith('/api/admin/cash-sale')) return 'invoices:read'
  if (pathname.startsWith('/api/admin/inflation')) return 'inflation:read'
  if (pathname.startsWith('/api/admin/controls')) return 'controls:read'
  if (pathname.startsWith('/api/admin/customers')) return 'customers:read'
  if (pathname.startsWith('/api/admin/crm')) return 'crm:read'
  if (pathname.startsWith('/api/admin/tasks')) return 'tasks:read'
  if (pathname.startsWith('/api/admin/suppliers')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/purchase-orders')) return 'inventory:read'
  if (pathname.startsWith('/api/admin/shelving')) return 'shelving:read'
  if (pathname.startsWith('/api/admin/merchant')) return 'merchant_sync:read'
  if (pathname.startsWith('/api/admin/channels')) return null
  if (pathname.startsWith('/api/admin/amazon-ads')) return 'amazon_ads:read'
  if (pathname.startsWith('/api/admin/integrations/amazon-ads')) return 'amazon_ads:read'
  if (pathname.startsWith('/api/admin/amazon')) return 'amazon:read'
  if (pathname.startsWith('/api/admin/meta-ads')) return 'meta_ads:read'
  if (pathname.startsWith('/api/admin/integrations/meta-ads')) return 'meta_ads:read'
  if (pathname.startsWith('/api/admin/social')) return 'social:read'
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
  if (pathname.startsWith('/api/admin/messaging-templates')) return 'templates:read'
  if (pathname.startsWith('/api/admin/suggest')) return null
  // Generic list filters and saved views: the handlers check the registered list's own scope.
  if (pathname.startsWith('/api/admin/filters') || pathname.startsWith('/api/admin/saved-views')) return null
  if (pathname.startsWith('/api/admin/traffic')) return 'traffic:read'
  if (pathname.startsWith('/api/admin/google-ads')) return 'google_ads:read'
  if (pathname.startsWith('/api/admin/integrations/google-ads')) return 'google_ads:read'
  if (pathname.startsWith('/api/admin/campaigns')) return 'campaigns:read'
  if (pathname.startsWith('/api/admin/customer-programs')) return 'campaigns:read'
  if (pathname.startsWith('/api/admin/loyalty')) return 'campaigns:read'
  if (pathname.startsWith('/api/admin/referrals')) return 'campaigns:read'
  if (pathname.startsWith('/api/admin/agent')) return 'agent:read'
  if (pathname.startsWith('/api/admin/catalog-enrichment')) return 'catalog_enrichment:read'
  if (pathname.startsWith('/api/admin/audit')) return 'audit:read'
  if (pathname.startsWith('/api/admin/cron')) return 'audit:read'
  if (pathname.startsWith('/api/admin/service-accounts')) return 'service_accounts:read'
  if (pathname.startsWith('/api/admin/ecom/customers')) return 'ecom_customers:read'
  if (pathname.startsWith('/api/admin/ecom/instances')) return 'ecom_instances:read'
  if (pathname.startsWith('/api/admin/ecom/billing')) return 'ecom_billing:read'
  if (pathname.startsWith('/api/admin/ecom/ai-pricing')) return 'ecom_billing:read'
  if (pathname.startsWith('/api/admin/ecom/store-status')) return 'ecom_customers:read'
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
// the legacy parent scope still satisfies the new child scope.
//
// ONLY safe when the parent is sold at the same-or-narrower plan tier than the
// child — otherwise this fallback re-grants a scope that plan-tier gating
// deliberately withheld. merchant_sync (Pro+) on products (all plans) let
// Basic/Growth reach Merchant Sync; crm/tasks (Growth+) on customers (Basic+),
// returns/replacements (Growth+) on orders (Basic+), and traffic (Growth+) on
// dashboard (all) leaked the same way. Those children are gated purely by the
// plan now. The entries kept below are same-tier splits where back-compat is safe.
const LEGACY_SCOPE_PARENTS: Record<string, string> = {
  'delhivery:read': 'orders:read',
  'delhivery:write': 'orders:write',
  'shelving:read': 'inventory:read',
  'shelving:write': 'inventory:write',
  'campaigns:read': 'mailer:read',
  'campaigns:write': 'mailer:write',
  'social:read': 'campaigns:read',
  'social:write': 'campaigns:write',
  'templates:read': 'mailer:read',
  'templates:write': 'mailer:write',
  'controls:read': 'inflation:read',
  'controls:write': 'inflation:write',
}

export function hasScope(role: string, scopes: string[], requiredScope: string): boolean {
  // Only the platform operator short-circuits. A tenant owner is also 'super_admin', so the
  // wider isPlatformOwner() check let every tenant past its plan entitlement entirely.
  if (isPlatformAdmin(role)) return true
  // The notification bell is admin-shell chrome present on every admin page, sells with every
  // plan, and exposes no tenant-specific feature data (rows are still filtered per-scope in
  // admin-notify). Grant it to any authenticated admin so no tenant is locked out of the feed.
  if (requiredScope === 'notifications:read') return true
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
