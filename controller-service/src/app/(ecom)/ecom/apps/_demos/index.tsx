'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

const lazy = (load: () => Promise<{ default: ComponentType }>) => dynamic(load, { ssr: false })

// slug → demo. Add a file in this folder + one line here to give an app its walkthrough.
const DEMOS: Record<string, ComponentType> = {
  products: lazy(() => import('./ProductsDemo')),
  categories: lazy(() => import('./CategoriesDemo')),
  inventory: lazy(() => import('./InventoryDemo')),
  suppliers: lazy(() => import('./SuppliersDemo')),
  enrichment: lazy(() => import('./EnrichmentDemo')),
  orders: lazy(() => import('./OrdersDemo')),
  'cash-sale': lazy(() => import('./CashSaleDemo')),
  quotations: lazy(() => import('./QuotationsDemo')),
  coupons: lazy(() => import('./CouponsDemo')),
  reviews: lazy(() => import('./ReviewsDemo')),
  delivery: lazy(() => import('./DeliveryDemo')),
  'packing-slips': lazy(() => import('./PackingSlipsDemo')),
  labels: lazy(() => import('./LabelsDemo')),
  returns: lazy(() => import('./ReturnsDemo')),
  gst: lazy(() => import('./GstDemo')),
  payments: lazy(() => import('./PaymentsDemo')),
  financial: lazy(() => import('./FinancialDemo')),
  payouts: lazy(() => import('./PayoutsDemo')),
  campaigns: lazy(() => import('./CampaignsDemo')),
  mailer: lazy(() => import('./MailerDemo')),
  social: lazy(() => import('./SocialDemo')),
  offers: lazy(() => import('./OffersDemo')),
  business: lazy(() => import('./BusinessDemo')),
  rfqs: lazy(() => import('./RfqsDemo')),
  'b2b-pricing': lazy(() => import('./B2bPricingDemo')),
  crm: lazy(() => import('./CrmDemo')),
  dashboard: lazy(() => import('./DashboardDemo')),
  agent: lazy(() => import('./AgentDemo')),
  team: lazy(() => import('./TeamDemo')),
  traffic: lazy(() => import('./TrafficDemo')),
}

export function hasDemo(slug: string) {
  return slug in DEMOS
}

export default function AppDemo({ slug }: { slug: string }) {
  const Demo = DEMOS[slug]
  if (!Demo) return <p className="text-sm text-foreground-secondary py-12 sm:py-20 text-center">Walkthrough coming soon.</p>
  return <Demo />
}
