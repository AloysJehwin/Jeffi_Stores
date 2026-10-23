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
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>Every app, one login</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-2xl">One platform, every tool your store needs</Display>
      <p className="text-foreground-secondary mt-4 text-base sm:text-lg max-w-2xl">
        Catalogue, sales, fulfilment, finance, marketing and B2B — all built in, all working together.
      </p>
      <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 w-full">
        {APP_GROUPS.map(group => (
          <SandCard key={group.group} className="p-6 max-sm:p-5">
            <Eyebrow className="text-[11px]">{group.group}</Eyebrow>
            <ul className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
              {group.apps.map(app => (
                <li key={app.slug}>
                  <Link href={`/apps/${app.slug}`} className="group flex items-center gap-4 max-sm:min-h-11 max-sm:gap-3">
                    <Dot tone="sage" className="shrink-0 max-sm:w-8 max-sm:h-8" />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-foreground group-hover:org-brown">{app.name}</span>
                      <span className="block text-sm text-foreground-secondary truncate max-sm:whitespace-normal">{app.blurb}</span>
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
