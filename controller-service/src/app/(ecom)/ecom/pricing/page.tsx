import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { MessageSquare, PanelsTopLeft } from 'lucide-react'
import {
  listPlans,
  planFeatureMatrix,
  COMPARISON_ROWS,
  domainAllowance,
  domainFaqAnswer,
  SIGNUP_CREDIT_INR,
} from '@/lib/tenant-registry'
import { addonPrices } from '@/lib/billing/requested-addons'
import type { AddonPrice } from '@/lib/billing/addons'
import { SHOWCASE_FREE_DAYS, SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import PricingCards from './PricingCards'
import { floorPrices } from '@controller/lib/compute/floor-prices'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pricing' }

function Check() {
  return (
    <svg
      className="w-5 h-5 mx-auto org-sage-text"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}
function Dash() {
  return <span className="text-foreground-muted/40">—</span>
}

export default async function PricingPage() {
  const [plans, matrix, prices, addons] = await Promise.all([
    listPlans(),
    planFeatureMatrix(),
    floorPrices(),
    addonPrices().catch((): AddonPrice[] => []),
  ])
  const floors = prices?.floors ?? null
  const ordered = [...plans].sort((a, b) => a.tier - b.tier)

  const has = (planSlug: string, scopeKey: string | null) => {
    if (scopeKey === null) return true
    return matrix[planSlug]?.has(scopeKey) ?? false
  }

  const groups = Array.from(new Set(COMPARISON_ROWS.map(r => r.group)))
  const cols = { gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` }
  const gstPct = `${Math.round((prices?.gstRate ?? 0.18) * 100)}%`
  // Prices are before GST ("₹X/mo + GST"); no figure when they can't be computed.
  const fromLabel = (p: { slug: string }) => {
    const inr = floors?.[p.slug]
    return inr == null ? '' : `from ₹${inr.toLocaleString('en-IN')}/mo + GST`
  }
  // Every store runs on its own server with Postgres on it, and may move it to a dedicated RDS database; on Basic at a price.
  const rdsExtra = (slug: string) => prices?.rdsExtra[slug]
  const dedicatedDb = (slug: string, cls: string) => {
    const extra = rdsExtra(slug)
    return extra == null ? <Check /> : <span className={`text-xs text-foreground-muted ${cls}`}>+₹{extra.toLocaleString('en-IN')}/mo + GST</span>
  }
  const addonPrice = (id: string) => addons.find(a => a.id === id)?.priceInr
  const perMonth = (inr: number | undefined) => (inr == null ? null : `₹${inr.toLocaleString('en-IN')}/mo`)

  // Rows outside the plan features: `cell` differs by plan, `all` is the same on every plan.
  type Extra = { label: string; cell?: (p: (typeof ordered)[number], cls: string) => ReactNode; all?: string | null }
  const extraGroups: { group: string; rows: Extra[] }[] = [
    {
      group: 'Domain & hosting',
      rows: [
        { label: 'Custom domain', cell: p => domainAllowance(p.max_custom_domains) },
        { label: 'Your own server, with its database', cell: () => <Check /> },
        { label: 'Separate managed database (optional)', cell: (p, cls) => dedicatedDb(p.slug, cls) },
      ],
    },
    {
      group: 'Add-ons',
      rows: [
        { label: 'Daily payouts', all: '+5% of each sale' },
        { label: 'Remove ads from your store', all: perMonth(addonPrice('ad_free')) },
        { label: 'Your own SMS & WhatsApp numbers', all: perMonth(addonPrice('messaging')) },
      ].filter(r => r.all),
    },
  ]

  return (
    <div className="text-foreground">
      {/* Header */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="org-sage absolute -top-28 -right-32 -z-10 w-[300px] h-[300px] sm:-top-40 sm:-right-24 sm:w-[520px] sm:h-[520px] rounded-full opacity-70"
        />
        <div className="w-full px-4 sm:px-6 lg:px-12 pt-12 pb-8 sm:pt-20 sm:pb-10">
          <h1 className="font-display font-black text-5xl lg:text-7xl tracking-tight">Pricing</h1>
          <p className="mt-4 sm:mt-5 text-lg text-foreground-secondary max-w-2xl">
            Every plan includes the complete storefront. As you grow, unlock more of the admin platform. Monthly or
            yearly — cancel anytime.
          </p>
        </div>
      </section>

      {/* Interactive plan cards with monthly/yearly toggle */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-12 sm:pb-16">
        <PricingCards plans={plans} fromInr={floors} gstRate={prices?.gstRate} />
      </section>

      {/* Detailed comparison table */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-16 sm:pb-24">
        <h2 className="font-display font-black text-3xl lg:text-4xl mb-6 sm:mb-10">Compare every feature</h2>
        <div className="md:hidden">
          <div style={cols} className="sticky top-14 z-10 grid rounded-2xl bg-surface-secondary px-2 py-2.5 shadow-sm">
            {ordered.map(p => (
              <div
                key={p.slug}
                className={`min-w-0 px-0.5 text-center text-[11px] leading-tight font-semibold break-words ${p.slug === 'growth' ? 'ecom-accent-text' : 'text-foreground'}`}
              >
                {p.name}
                <div className="mt-0.5 text-[10px] font-normal text-foreground-muted">{fromLabel(p)}</div>
              </div>
            ))}
          </div>
          {groups.map(group => (
            <div key={group} className="mt-6">
              <div className="px-1 text-xs font-semibold uppercase tracking-widest text-foreground-muted">{group}</div>
              <ul className="mt-2 rounded-2xl bg-surface-elevated divide-y divide-border-default/60">
                {COMPARISON_ROWS.filter(r => r.group === group).map(row => (
                  <li key={row.label} className="px-2 py-3">
                    <div className="px-1 text-sm text-foreground-secondary">{row.label}</div>
                    <div style={cols} className="mt-2 grid">
                      {ordered.map(p => (
                        <div key={p.slug} className="flex justify-center">
                          {has(p.slug, row.scopeKey) ? <Check /> : <Dash />}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {extraGroups.map(({ group, rows }) => (
            <div key={group} className="mt-6">
              <div className="px-1 text-xs font-semibold uppercase tracking-widest text-foreground-muted">{group}</div>
              <ul className="mt-2 rounded-2xl bg-surface-elevated divide-y divide-border-default/60">
                {rows.map(({ label, cell, all }) => (
                  <li key={label} className="px-2 py-3">
                    <div className="px-1 text-sm text-foreground-secondary">{label}</div>
                    <div style={cols} className="mt-2 grid">
                      {cell ? (
                        ordered.map(p => (
                          <div key={p.slug} className="flex min-w-0 justify-center text-center text-xs text-foreground-muted break-words">
                            {cell(p, 'break-words')}
                          </div>
                        ))
                      ) : (
                        <div className="col-span-full text-center text-xs text-foreground-muted">{all} on every plan</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="hidden md:block w-full overflow-x-auto rounded-[2rem] bg-surface-elevated">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="sticky top-0">
              <tr className="bg-surface-secondary">
                <th className="text-left px-5 py-4 font-semibold text-foreground w-2/5">Feature</th>
                {ordered.map(p => (
                  <th
                    key={p.slug}
                    className={`px-4 py-4 text-center font-semibold ${p.slug === 'growth' ? 'ecom-accent-text' : 'text-foreground'}`}
                  >
                    {p.name}
                    <div className="text-xs font-normal text-foreground-muted">{fromLabel(p)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <Fragment key={group}>
                  <tr className="bg-surface-secondary/50">
                    <td
                      colSpan={ordered.length + 1}
                      className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-foreground-muted"
                    >
                      {group}
                    </td>
                  </tr>
                  {COMPARISON_ROWS.filter(r => r.group === group).map(row => (
                    <tr key={row.label} className="border-t border-border-default/60 hover:bg-surface-secondary/30">
                      <td className="px-5 py-3 text-foreground-secondary">{row.label}</td>
                      {ordered.map(p => (
                        <td key={p.slug} className="px-4 py-3 text-center">
                          {has(p.slug, row.scopeKey) ? <Check /> : <Dash />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {extraGroups.map(({ group, rows }) => (
                <Fragment key={group}>
                  <tr className="bg-surface-secondary/50">
                    <td
                      colSpan={ordered.length + 1}
                      className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-foreground-muted"
                    >
                      {group}
                    </td>
                  </tr>
                  {rows.map(({ label, cell, all }) => (
                    <tr key={label} className="border-t border-border-default/60 hover:bg-surface-secondary/30">
                      <td className="px-5 py-3 text-foreground-secondary">{label}</td>
                      {cell ? (
                        ordered.map(p => (
                          <td key={p.slug} className="px-4 py-3 text-center text-xs text-foreground-muted">
                            {cell(p, '')}
                          </td>
                        ))
                      ) : (
                        <td colSpan={ordered.length} className="px-4 py-3 text-center text-xs text-foreground-muted">
                          {all} on every plan
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-center mt-8 sm:mt-10">
          <Link
            href="/signup"
            className="ecom-accent-bg block w-full sm:inline-block sm:w-auto px-8 py-4 rounded-full text-white font-display font-bold text-lg transition-colors"
          >
            Start your store
          </Link>
        </div>
      </section>

      {/* The products that don't need a store */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-16 sm:pb-24">
        <h2 className="font-display font-black text-3xl lg:text-4xl">No store needed</h2>
        <p className="mt-3 text-foreground-secondary max-w-2xl">Both run on their own, without a store plan.</p>
        <div className="mt-6 sm:mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-5">
          {[
            {
              title: 'Showcase',
              icon: PanelsTopLeft,
              copy: 'A one-page website for your business, with your work, reviews and contact details. Enquiries come straight to you.',
              price: `${SHOWCASE_FREE_DAYS}-day free trial, then ₹${SHOWCASE_PRICE_INR.toLocaleString('en-IN')}/month from your wallet`,
              cta: 'Make a Showcase site',
            },
            {
              title: 'Messaging & Documents API',
              icon: MessageSquare,
              copy: 'Send email, SMS and WhatsApp, and make GST invoices, quotations and labels as PDFs, from your own app.',
              price: `Pay as you go from your wallet, with a ₹${SIGNUP_CREDIT_INR.toLocaleString('en-IN')} welcome credit to start`,
              cta: 'Get an API key',
            },
          ].map(({ title, icon: Icon, copy, price, cta }) => (
            <div key={title} className="min-w-0 rounded-3xl sm:rounded-[2rem] bg-surface-elevated p-6 sm:p-8 flex flex-col">
              <span className="grid place-items-center w-10 h-10 rounded-full org-sage org-sage-text">
                <Icon className="w-5 h-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display font-black text-2xl">{title}</h3>
              <p className="mt-2 text-sm text-foreground-secondary flex-1">{copy}</p>
              <p className="mt-4 text-sm font-semibold text-foreground">{price}</p>
              <Link
                href="/signup"
                className="mt-6 self-stretch sm:self-start text-center px-6 py-3 sm:py-2.5 rounded-full text-sm font-display font-bold org-sand org-sand-hover text-foreground transition-colors"
              >
                {cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-16 sm:pb-24 pt-4 sm:pt-8">
        <h2 className="font-display font-black text-3xl lg:text-4xl mb-6 sm:mb-10">Frequently asked</h2>
        <div className="max-w-3xl mx-auto space-y-4">
          {[
            [
              'Is the storefront limited on cheaper plans?',
              'No. Every plan — including Basic — ships with the complete storefront: full catalogue, cart, checkout, wishlist, compare and cash on delivery. Plans differ only in how much of the admin platform you unlock.',
            ],
            [
              'What does the price include?',
              `One subscription for the plan and your store's own server. Prices are shown before GST; ${gstPct} GST is added at checkout. The server is priced at its AWS cost — at cost on Basic, plus 20% on Grow, Pro and Enterprise. Prices shown are each plan's smallest size; you choose the size when you sign up. Your database runs on your server, or on any plan you can move it to a separate managed database; on Basic that prices your servers at AWS cost plus 20%.`,
            ],
            [
              "Monthly vs yearly — what's the difference?",
              'Yearly is charged once a year at 10× the monthly price, so you get 12 months for the price of 10. You can switch between monthly and yearly anytime from your billing dashboard — a downgrade takes effect at the next renewal, an upgrade is applied immediately with a prorated credit.',
            ],
            [
              'How do payouts work?',
              'Payments from your customers are split at checkout and settled to your verified bank account, minus platform + gateway fees. Weekly by default, or daily for an extra 5% of each sale.',
            ],
            ['Can I use my own domain?', domainFaqAnswer(plans)],
            [
              'Can I upgrade or downgrade later?',
              "Anytime. Upgrading is immediate — you're charged the difference with a prorated credit. Downgrading takes effect at your next renewal so you keep your current features until then.",
            ],
            [
              'What about GST?',
              'Compliant GST invoices are generated automatically on every order, quotation and cash sale.',
            ],
          ].map(([q, a]) => (
            <details key={q} className="group rounded-3xl sm:rounded-[2rem] org-sand px-5 py-4 sm:px-8 sm:py-5">
              <summary className="flex items-center justify-between gap-4 cursor-pointer font-display font-black text-lg text-foreground list-none">
                {q}
                <span className="shrink-0 text-foreground-muted group-open:rotate-45 transition-transform text-xl leading-none">
                  +
                </span>
              </summary>
              <p className="text-sm text-foreground-secondary mt-3">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
