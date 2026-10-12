import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Globe, Truck, Receipt, BookOpen, Landmark, CreditCard, Building2 } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}
export interface NavGroup {
  title?: string
  items: NavItem[]
}

// One entry per owner-facing surface. New services: add a row here + a page under dashboard/.
export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true }] },
  {
    title: 'Store',
    items: [
      { href: '/dashboard/domains', label: 'Domains', icon: Globe },
      { href: '/dashboard/delivery', label: 'Delivery', icon: Truck },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/dashboard/transactions', label: 'Transactions', icon: Receipt },
      { href: '/dashboard/ledger', label: 'Settlement ledger', icon: BookOpen },
      { href: '/dashboard/payouts', label: 'Payouts', icon: Landmark },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
      { href: '/dashboard/business', label: 'Business details', icon: Building2 },
    ],
  },
]
