export interface AppItem {
  slug: string
  name: string
  blurb: string
  icon: string
  benefits?: string[]
  /** The plan_features key that gates the app in the admin (lib/auth/scopes routes). None: not mapped, so no plan tag. */
  scope?: string
}

export interface AppGroup {
  group: string
  apps: AppItem[]
}

export const APP_GROUPS: AppGroup[] = [
  {
    group: 'Catalogue',
    apps: [
      {
        slug: 'products',
        name: 'Products & variants',
        blurb: 'Rich products with variants, images and stock',
        icon: 'Package',
        scope: 'products:read',
      },
      {
        slug: 'categories',
        name: 'Categories & brands',
        blurb: 'Organise your catalogue your way',
        icon: 'FolderTree',
        scope: 'categories:read',
      },
      {
        slug: 'inventory',
        name: 'Inventory & batches',
        blurb: 'Stock levels, low-stock alerts, batches & serials',
        icon: 'Boxes',
        scope: 'inventory:read',
      },
      {
        slug: 'suppliers',
        name: 'Suppliers & purchase orders',
        blurb: 'Reorder and receive stock with GRNs',
        icon: 'Warehouse',
        scope: 'inventory:read',
      },
      {
        slug: 'enrichment',
        name: 'AI catalogue enrichment',
        blurb: 'Let AI write product copy in bulk',
        icon: 'Sparkles',
        scope: 'catalog_enrichment:read',
      },
    ],
  },
  {
    group: 'Sales',
    apps: [
      { slug: 'orders', name: 'Orders', blurb: 'From cart to doorstep in one place', icon: 'ShoppingCart', scope: 'orders:read' },
      { slug: 'cash-sale', name: 'Cash sale (POS)', blurb: 'Walk-in billing with GST', icon: 'Store', scope: 'invoices:read' },
      { slug: 'quotations', name: 'Quotations', blurb: 'Draft, send and convert quotes', icon: 'FileSignature', scope: 'quotations:read' },
      {
        slug: 'coupons',
        name: 'Coupons & discounts',
        blurb: 'Percentage or fixed, with limits',
        icon: 'TicketPercent',
        scope: 'coupons:read',
      },
      { slug: 'reviews', name: 'Reviews', blurb: 'Collect and moderate product reviews', icon: 'Star', scope: 'reviews:read' },
    ],
  },
  {
    group: 'Fulfilment',
    apps: [
      { slug: 'delivery', name: 'Delhivery shipping', blurb: 'Create shipments and track AWBs', icon: 'Truck', scope: 'delhivery:read' },
      { slug: 'packing-slips', name: 'Packing slips', blurb: 'GST tax-invoice slips, auto', icon: 'ScrollText', scope: 'packing_slips:read' },
      { slug: 'labels', name: 'Shipping & product labels', blurb: 'Barcodes and shipping labels', icon: 'Barcode', scope: 'labels:read' },
      { slug: 'returns', name: 'Returns & replacements', blurb: 'Approve, receive, refund or replace', icon: 'Undo2', scope: 'returns:read' },
    ],
  },
  {
    group: 'Finance',
    apps: [
      { slug: 'gst', name: 'GST invoicing', blurb: 'CGST/SGST/IGST invoices, GSTR-ready', icon: 'FileText', scope: 'gst:read' },
      {
        slug: 'payments',
        name: 'Payments & settlement',
        blurb: 'Online + COD, captured to settled',
        icon: 'CreditCard',
      },
      { slug: 'financial', name: 'Financial reports', blurb: 'Receivables, P&L, cashflow', icon: 'LineChart', scope: 'financial:read' },
      { slug: 'payouts', name: 'Payouts', blurb: 'Pay suppliers via IMPS/NEFT/UPI', icon: 'Banknote', scope: 'financial:read' },
    ],
  },
  {
    group: 'Marketing',
    apps: [
      { slug: 'campaigns', name: 'Campaigns', blurb: 'Triggered email & WhatsApp journeys', icon: 'Megaphone', scope: 'campaigns:read' },
      { slug: 'mailer', name: 'Mailer', blurb: 'Broadcast to your audience', icon: 'Mail', scope: 'mailer:read' },
      { slug: 'social', name: 'Social posts', blurb: 'Compose and schedule posts', icon: 'Share2', scope: 'social:read' },
      { slug: 'offers', name: 'Bank & card offers', blurb: 'Show Razorpay offers at checkout', icon: 'BadgePercent', scope: 'coupons:read' },
    ],
  },
  {
    group: 'B2B',
    apps: [
      { slug: 'business', name: 'Business customers', blurb: 'Approve B2B accounts with GST', icon: 'Building2', scope: 'business_customers:read' },
      { slug: 'rfqs', name: 'RFQ & negotiation', blurb: 'Quote and negotiate bulk orders', icon: 'Handshake', scope: 'business_rfqs:read' },
      { slug: 'b2b-pricing', name: 'Per-customer pricing', blurb: 'Category discounts for businesses', icon: 'Tags', scope: 'business_customers:read' },
    ],
  },
  {
    group: 'Growth & ops',
    apps: [
      { slug: 'crm', name: 'CRM', blurb: 'Health, segments and lifetime value', icon: 'Users', scope: 'crm:read' },
      {
        slug: 'dashboard',
        name: 'Dashboard & analytics',
        blurb: 'Revenue, orders and what needs attention',
        icon: 'LayoutDashboard',
        scope: 'dashboard:read',
      },
      { slug: 'agent', name: 'AI assistant', blurb: 'Ask your store anything', icon: 'Bot', scope: 'agent:read' },
      { slug: 'team', name: 'Team & roles', blurb: 'Staff accounts with scoped access', icon: 'UserCog', scope: 'settings:read' },
      { slug: 'traffic', name: 'Traffic analytics', blurb: 'See where your visitors come from', icon: 'Activity', scope: 'traffic:read' },
    ],
  },
]

export type ResolvedApp = AppItem & { group: string }

export function findApp(slug: string): ResolvedApp | undefined {
  for (const g of APP_GROUPS) {
    const app = g.apps.find(a => a.slug === slug)
    if (app) return { ...app, group: g.group }
  }
  return undefined
}

/** slug → the lowest plan that has each app's scope ("Grow+", or the top plan's bare name). Apps on the lowest plan, or with no scope, get none. */
export function appPlanTags(plans: { slug: string; name: string; tier: number }[], matrix: Record<string, Set<string>>): Record<string, string> {
  const ordered = [...plans].sort((a, b) => a.tier - b.tier)
  const tags: Record<string, string> = {}
  for (const g of APP_GROUPS) {
    for (const a of g.apps) {
      if (!a.scope) continue
      const i = ordered.findIndex(p => matrix[p.slug]?.has(a.scope!))
      if (i <= 0) continue
      tags[a.slug] = i === ordered.length - 1 ? ordered[i].name : `${ordered[i].name}+`
    }
  }
  return tags
}
