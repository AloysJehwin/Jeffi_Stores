import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Globe, Truck, Receipt, BookOpen, Landmark, CreditCard, Building2, Wallet, KeyRound, MessageSquare, FileText, Store, LayoutGrid } from 'lucide-react'
import type { ServiceType } from '@/lib/tenant-registry'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  requires?: ServiceType      // shown only when the tenant has this service
  hideWhen?: ServiceType      // shown only when the tenant does NOT have this service
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
      { href: '/dashboard/domains', label: 'Domains', icon: Globe, requires: 'store' },
      { href: '/dashboard/delivery', label: 'Delivery', icon: Truck, requires: 'store' },
      { href: '/dashboard/add-store', label: 'Add a store', icon: Store, hideWhen: 'store' },
    ],
  },
  {
    title: 'Developers',
    items: [
      { href: '/dashboard/services', label: 'Services', icon: LayoutGrid },
      { href: '/dashboard/api-keys', label: 'API keys', icon: KeyRound },
      { href: '/dashboard/messaging', label: 'Messaging', icon: MessageSquare, requires: 'messaging' },
      { href: '/dashboard/documents', label: 'Documents', icon: FileText, requires: 'documents' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/dashboard/wallet', label: 'Wallet', icon: Wallet },
      { href: '/dashboard/transactions', label: 'Transactions', icon: Receipt, requires: 'store' },
      { href: '/dashboard/ledger', label: 'Settlement ledger', icon: BookOpen, requires: 'store' },
      { href: '/dashboard/payouts', label: 'Payouts', icon: Landmark },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard/billing', label: 'Billing', icon: CreditCard, requires: 'store' },
      { href: '/dashboard/business', label: 'Business details', icon: Building2 },
    ],
  },
]

export function navFor(serviceTypes: string[]): NavGroup[] {
  const has = (s?: ServiceType) => !s || serviceTypes.includes(s)
  return NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(i => has(i.requires) && !(i.hideWhen && serviceTypes.includes(i.hideWhen))) })).filter(g => g.items.length)
}
