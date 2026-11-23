import Link from 'next/link'
import clsx from 'clsx'
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
  ChevronRight,
} from 'lucide-react'
import { APP_GROUPS } from '@controller/app/(ecom)/ecom/apps'

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

/** The lowest plan an app needs ("Grow+"), from appPlanTags. */
export function PlanTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-semibold leading-4 text-foreground-secondary">{label}</span>
  )
}

/** An odd last group spans the two-column (sm) row instead of sitting alone; 7 groups fill 4 + 3 at lg. */
export const lastGroupSpan = (i: number, count: number) => i === count - 1 && count % 2 === 1 && 'sm:col-span-2 lg:col-span-1'

export default function AppsGrid({ tags }: { tags: Record<string, string> }) {
  const tagged = Object.keys(tags).length > 0
  return (
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>Every app, one login</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-2xl">One platform, every tool your store needs</Display>
      <p className="text-foreground-secondary mt-4 text-base sm:text-lg max-w-2xl">
        Catalogue, sales, fulfilment, finance, marketing and B2B, all working together.
        {tagged && ' A tag shows the lowest plan an app comes with.'}
      </p>
      <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 w-full">
        {APP_GROUPS.map((group, gi) => (
          <SandCard key={group.group} className={clsx('p-6 max-sm:p-5', lastGroupSpan(gi, APP_GROUPS.length))}>
            <Eyebrow className="text-[11px]">{group.group}</Eyebrow>
            <ul className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
              {group.apps.map(app => (
                <li key={app.slug}>
                  <Link href={`/apps/${app.slug}`} className="group flex items-center gap-4 max-sm:min-h-11 max-sm:gap-3">
                    <Dot tone="sage" className="shrink-0 max-sm:w-8 max-sm:h-8" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-base font-semibold text-foreground group-hover:org-brown">{app.name}</span>
                        {tags[app.slug] && <PlanTag label={tags[app.slug]} />}
                      </span>
                      <span className="mt-0.5 block text-sm text-foreground-secondary line-clamp-2">{app.blurb}</span>
                    </span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
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
