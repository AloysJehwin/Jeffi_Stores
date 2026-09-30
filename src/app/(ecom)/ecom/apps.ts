export interface AppItem {
  slug: string
  name: string
  blurb: string
  icon: string
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
      },
      {
        slug: 'categories',
        name: 'Categories & brands',
        blurb: 'Organise your catalogue your way',
        icon: 'FolderTree',
      },
      {
        slug: 'inventory',
        name: 'Inventory & batches',
        blurb: 'Stock levels, low-stock alerts, batches & serials',
        icon: 'Boxes',
      },
      {
        slug: 'suppliers',
        name: 'Suppliers & purchase orders',
        blurb: 'Reorder and receive stock with GRNs',
        icon: 'Warehouse',
      },
      {
        slug: 'enrichment',
        name: 'AI catalogue enrichment',
        blurb: 'Let AI write product copy in bulk',
        icon: 'Sparkles',
      },
    ],
  },
  {
    group: 'Sales',
    apps: [
      { slug: 'orders', name: 'Orders', blurb: 'From cart to doorstep in one place', icon: 'ShoppingCart' },
      { slug: 'cash-sale', name: 'Cash sale (POS)', blurb: 'Walk-in billing with GST', icon: 'Store' },
      { slug: 'quotations', name: 'Quotations', blurb: 'Draft, send and convert quotes', icon: 'FileSignature' },
      {
        slug: 'coupons',
        name: 'Coupons & discounts',
        blurb: 'Percentage or fixed, with limits',
        icon: 'TicketPercent',
      },
      { slug: 'reviews', name: 'Reviews', blurb: 'Collect and moderate product reviews', icon: 'Star' },
    ],
  },
  {
    group: 'Fulfilment',
    apps: [
      { slug: 'delivery', name: 'Delhivery shipping', blurb: 'Create shipments and track AWBs', icon: 'Truck' },
      { slug: 'packing-slips', name: 'Packing slips', blurb: 'GST tax-invoice slips, auto', icon: 'ScrollText' },
      { slug: 'labels', name: 'Shipping & product labels', blurb: 'Barcodes and shipping labels', icon: 'Barcode' },
      { slug: 'returns', name: 'Returns & replacements', blurb: 'Approve, receive, refund or replace', icon: 'Undo2' },
    ],
  },
  {
    group: 'Finance',
    apps: [
      { slug: 'gst', name: 'GST invoicing', blurb: 'CGST/SGST/IGST invoices, GSTR-ready', icon: 'FileText' },
      {
        slug: 'payments',
        name: 'Payments & settlement',
        blurb: 'Online + COD, captured to settled',
        icon: 'CreditCard',
      },
      { slug: 'financial', name: 'Financial reports', blurb: 'Receivables, P&L, cashflow', icon: 'LineChart' },
      { slug: 'payouts', name: 'Payouts', blurb: 'Pay suppliers via IMPS/NEFT/UPI', icon: 'Banknote' },
    ],
  },
  {
    group: 'Marketing',
    apps: [
      { slug: 'campaigns', name: 'Campaigns', blurb: 'Triggered email & WhatsApp journeys', icon: 'Megaphone' },
      { slug: 'mailer', name: 'Mailer', blurb: 'Broadcast to your audience', icon: 'Mail' },
      { slug: 'social', name: 'Social posts', blurb: 'Compose and schedule posts', icon: 'Share2' },
      { slug: 'offers', name: 'Bank & card offers', blurb: 'Show Razorpay offers at checkout', icon: 'BadgePercent' },
    ],
  },
  {
    group: 'B2B',
    apps: [
      { slug: 'business', name: 'Business customers', blurb: 'Approve B2B accounts with GST', icon: 'Building2' },
      { slug: 'rfqs', name: 'RFQ & negotiation', blurb: 'Quote and negotiate bulk orders', icon: 'Handshake' },
      { slug: 'b2b-pricing', name: 'Per-customer pricing', blurb: 'Category discounts for businesses', icon: 'Tags' },
    ],
  },
  {
    group: 'Growth & ops',
    apps: [
      { slug: 'crm', name: 'CRM', blurb: 'Health, segments and lifetime value', icon: 'Users' },
      {
        slug: 'dashboard',
        name: 'Dashboard & analytics',
        blurb: 'Revenue, orders and what needs attention',
        icon: 'LayoutDashboard',
      },
      { slug: 'agent', name: 'AI assistant', blurb: 'Ask your store anything', icon: 'Bot' },
      { slug: 'team', name: 'Team & roles', blurb: 'Staff accounts with scoped access', icon: 'UserCog' },
      { slug: 'traffic', name: 'Traffic analytics', blurb: 'See where your visitors come from', icon: 'Activity' },
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
