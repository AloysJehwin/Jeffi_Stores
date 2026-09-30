import type { KeyboardShortcuts } from './site-controls'

// The path + required scope for each built-in admin keyboard shortcut. Kept in a plain
// (non-'use client') module so both the server settings page and the client shortcut handler
// import the SAME object — importing a const across the 'use client' boundary yields a client
// reference proxy on the server, not the real object, which is why this must not live in the
// handler component. Scope strings mirror the matching navLinks entry (admin/layout.tsx):
// create-actions gate on :write (they land on an add/new form), landing pages on :read.
export const BUILTIN_SHORTCUT_SCOPES: Record<
  keyof Omit<KeyboardShortcuts, 'customShortcuts'>,
  { path: string; scope: string }
> = {
  newProduct: { path: '/admin/products/add', scope: 'products:write' },
  cashSale: { path: '/admin/cash-sale', scope: 'invoices:read' },
  quotation: { path: '/admin/quotations', scope: 'quotations:read' },
  newPo: { path: '/admin/inventory/po/new', scope: 'inventory:write' },
  orders: { path: '/admin/orders', scope: 'orders:read' },
  packingSlips: { path: '/admin/packing-slips', scope: 'packing_slips:read' },
  returns: { path: '/admin/returns', scope: 'returns:read' },
  gst: { path: '/admin/gst', scope: 'gst:read' },
  labels: { path: '/admin/labels', scope: 'labels:read' },
  inventory: { path: '/admin/inventory', scope: 'inventory:read' },
  coupons: { path: '/admin/coupons/add', scope: 'coupons:write' },
  campaign: { path: '/admin/campaigns/new', scope: 'campaigns:write' },
  financial: { path: '/admin/financial', scope: 'financial:read' },
  customers: { path: '/admin/customers', scope: 'customers:read' },
  crm: { path: '/admin/crm', scope: 'crm:read' },
  reviews: { path: '/admin/reviews', scope: 'reviews:read' },
  aiAgent: { path: '/admin/agent', scope: 'agent:read' },
}
