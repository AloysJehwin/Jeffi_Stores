import { Fragment } from 'react'
import Link from 'next/link'
import { listPlans, planFeatureMatrix, COMPARISON_ROWS } from '@/lib/tenant-registry'
import PricingCards from './PricingCards'

export const dynamic = 'force-dynamic'

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
  const [plans, matrix] = await Promise.all([listPlans(), planFeatureMatrix()])
  const ordered = [...plans].sort((a, b) => a.tier - b.tier)

  const has = (planSlug: string, scopeKey: string | null) => {
    if (scopeKey === null) return true
    return matrix[planSlug]?.has(scopeKey) ?? false
  }

  const groups = Array.from(new Set(COMPARISON_ROWS.map(r => r.group)))
  const cols = { gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` }

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
        <PricingCards plans={plans} />
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
                <div className="mt-0.5 text-[10px] font-normal text-foreground-muted">
                  ₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}/mo
                </div>
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
          <div className="mt-6">
            <div className="px-1 text-xs font-semibold uppercase tracking-widest text-foreground-muted">Add-ons</div>
            <ul className="mt-2 rounded-2xl bg-surface-elevated divide-y divide-border-default/60">
              <li className="px-2 py-3">
                <div className="px-1 text-sm text-foreground-secondary">Custom domain</div>
                <div style={cols} className="mt-2 grid">
                  {ordered.map(p => (
                    <div key={p.slug} className="min-w-0 text-center text-xs text-foreground-muted break-words">
                      {p.slug === 'enterprise' ? 'Included' : 'Add-on'}
                    </div>
                  ))}
                </div>
              </li>
              <li className="px-2 py-3">
                <div className="px-1 text-sm text-foreground-secondary">Daily payouts</div>
                <div style={cols} className="mt-2 grid">
                  {ordered.map(p => (
                    <div key={p.slug} className="text-center text-xs text-foreground-muted">
                      +5%
                    </div>
                  ))}
                </div>
              </li>
              <li className="px-2 py-3">
                <div className="px-1 text-sm text-foreground-secondary">Dedicated database & infra</div>
                <div style={cols} className="mt-2 grid">
                  {ordered.map(p => (
                    <div key={p.slug} className="flex justify-center">
                      {['pro', 'enterprise'].includes(p.slug) ? <Check /> : <Dash />}
                    </div>
                  ))}
                </div>
              </li>
            </ul>
          </div>
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
                    <div className="text-xs font-normal text-foreground-muted">
                      ₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}/mo
                    </div>
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
              <tr className="bg-surface-secondary/50">
                <td
                  colSpan={ordered.length + 1}
                  className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-foreground-muted"
                >
                  Add-ons
                </td>
              </tr>
              <tr className="border-t border-border-default/60">
                <td className="px-5 py-3 text-foreground-secondary">Custom domain</td>
                {ordered.map(p => (
                  <td key={p.slug} className="px-4 py-3 text-center text-xs text-foreground-muted">
                    {p.slug === 'enterprise' ? 'Included' : 'Add-on'}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-border-default/60">
                <td className="px-5 py-3 text-foreground-secondary">Daily payouts</td>
                {ordered.map(p => (
                  <td key={p.slug} className="px-4 py-3 text-center text-xs text-foreground-muted">
                    +5%
                  </td>
                ))}
              </tr>
              <tr className="border-t border-border-default/60">
                <td className="px-5 py-3 text-foreground-secondary">Dedicated database & infra</td>
                {ordered.map(p => (
                  <td key={p.slug} className="px-4 py-3 text-center">
                    {['pro', 'enterprise'].includes(p.slug) ? <Check /> : <Dash />}
                  </td>
                ))}
              </tr>
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

      {/* FAQ */}
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-16 sm:pb-24 pt-4 sm:pt-8">
        <h2 className="font-display font-black text-3xl lg:text-4xl mb-6 sm:mb-10">Frequently asked</h2>
        <div className="max-w-3xl mx-auto space-y-4">
          {[
            [
              'Is the storefront limited on cheaper plans?',
              'No. Every plan — including Basic — ships with the complete storefront: full catalogue, cart, checkout, wishlist, compare and COD. Plans differ only in how much of the admin platform you unlock.',
            ],
            [
              "Monthly vs yearly — what's the difference?",
              'Yearly billing charges 10× the monthly price up front (effectively 2 months free). You can switch between monthly and yearly anytime from your billing dashboard — a downgrade takes effect at the next renewal, an upgrade is applied immediately with a prorated credit.',
            ],
            [
              'How do payouts work?',
              'Payments from your customers are split at checkout and settled to your verified bank account, minus platform + gateway fees. Weekly by default, or daily for +5%.',
            ],
            [
              'Can I use my own domain?',
              'Yes — a custom domain is an add-on on all plans and included on Enterprise. We handle the certificate and DNS.',
            ],
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
