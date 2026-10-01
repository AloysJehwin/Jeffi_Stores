import Link from 'next/link'
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
    <section className="w-full px-6 lg:px-12 py-20 bg-surface-elevated border-y border-border-default">
      <div className="text-center mb-12">
        <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">Every app, one login</p>
        <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">
          One platform, every tool your store needs
        </h2>
        <p className="text-foreground-secondary mt-3 text-lg max-w-2xl mx-auto">
          Catalogue, sales, fulfilment, finance, marketing and B2B — all built in, all working together.
        </p>
      </div>

      <div className="w-full space-y-12">
        {APP_GROUPS.map(group => (
          <div key={group.group}>
            <h3 className="text-lg font-bold text-foreground mb-4">{group.group}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.apps.map(app => {
                const Icon = ICONS[app.icon] ?? LayoutGrid
                return (
                  <Link
                    key={app.slug}
                    href={`/apps/${app.slug}`}
                    className="ecom-clean group flex items-start gap-4 rounded-2xl border border-border-default bg-surface p-5 shadow-sm shadow-black/[0.03] transition hover:-translate-y-0.5 hover:border-[color:var(--ecom-accent,#2563eb)] hover:shadow-md"
                  >
                    <span className="ecom-accent-bg inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-xl text-white">
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-foreground">{app.name}</span>
                      <span className="mt-1 block text-sm text-foreground-secondary">{app.blurb}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
