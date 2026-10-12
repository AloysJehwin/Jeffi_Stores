import Link from 'next/link'
import { Eyebrow, Display, SandCard, Dot } from '../_ui'
import type { ComponentType } from 'react'
import {
  Package,
  FolderTree,
  Boxes,
  Warehouse,
  Sparkles,
  ShoppingCart,
  Store,
  FileSignature,
  TicketPercent,
  Star,
  Truck,
  ScrollText,
  Barcode,
  Undo2,
  FileText,
  CreditCard,
  LineChart,
  Banknote,
  Megaphone,
  Mail,
  Share2,
  BadgePercent,
  Building2,
  Handshake,
  Tags,
  Users,
  LayoutDashboard,
  Bot,
  UserCog,
  Activity,
  LayoutGrid,
} from 'lucide-react'
import { APP_GROUPS } from '@/app/(ecom)/ecom/apps'

type IconType = ComponentType<{ className?: string }>

const ICONS: Record<string, IconType> = {
  Package,
  FolderTree,
  Boxes,
  Warehouse,
  Sparkles,
  ShoppingCart,
  Store,
  FileSignature,
  TicketPercent,
  Star,
  Truck,
  ScrollText,
  Barcode,
  Undo2,
  FileText,
  CreditCard,
  LineChart,
  Banknote,
  Megaphone,
  Mail,
  Share2,
  BadgePercent,
  Building2,
  Handshake,
  Tags,
  Users,
  LayoutDashboard,
  Bot,
  UserCog,
  Activity,
}

export default function AppsGrid() {
  return (
    <section className="w-full px-6 lg:px-12 py-20">
      <Eyebrow>Every app, one login</Eyebrow>
      <Display className="mt-3 text-4xl lg:text-5xl max-w-2xl">One platform, every tool your store needs</Display>
      <p className="text-foreground-secondary mt-4 text-lg max-w-2xl">
        Catalogue, sales, fulfilment, finance, marketing and B2B — all built in, all working together.
      </p>
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
        {APP_GROUPS.map(group => (
          <SandCard key={group.group} className="p-6">
            <Eyebrow className="text-[11px]">{group.group}</Eyebrow>
            <ul className="mt-5 space-y-5">
              {group.apps.map(app => (
                <li key={app.slug}>
                  <Link href={`/apps/${app.slug}`} className="group flex items-center gap-4">
                    <Dot tone="sage" className="shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-foreground group-hover:org-brown">{app.name}</span>
                      <span className="block text-sm text-foreground-secondary truncate">{app.blurb}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </SandCard>
        ))}
      </div>
    </section>
  )
}
