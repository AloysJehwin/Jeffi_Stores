import { Fragment } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'
import { COMPARISON_ROWS } from '@/lib/tenant-registry'

const PLANS = 4

export default function Loading() {
  const groups = Array.from(new Set(COMPARISON_ROWS.map(r => r.group)))
  return (
    <div className="text-foreground" aria-busy="true" aria-label="Loading Pricing">
      <section className="relative overflow-hidden">
        <div aria-hidden className="org-sage absolute -top-28 -right-32 -z-10 w-[300px] h-[300px] sm:-top-40 sm:-right-24 sm:w-[520px] sm:h-[520px] rounded-full opacity-70" />
        <div className="w-full px-4 sm:px-6 lg:px-12 pt-12 pb-8 sm:pt-20 sm:pb-10">
          <h1 className="font-display font-black text-5xl lg:text-7xl tracking-tight">Pricing</h1>
          <p className="mt-4 sm:mt-5 text-lg text-foreground-secondary max-w-2xl">
            Every plan includes the complete storefront. As you grow, unlock more of the admin platform. Monthly or
            yearly — cancel anytime.
          </p>
        </div>
      </section>
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-12 sm:pb-16">
        <div className="flex justify-center mb-8 sm:mb-10">
          <div className="inline-flex gap-0.5 rounded-full org-sand p-1">
            <span className="rounded-full px-4 py-1.5 text-sm font-semibold ecom-sel shadow-sm">Monthly</span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold text-foreground-secondary">
              Yearly <span className="px-2 py-0.5 rounded-full text-[10px] font-bold org-sage org-sage-text">2 months free</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-5 w-full">
          {Array.from({ length: PLANS }).map((_, i) => (
            <div key={i} className={`min-w-0 rounded-3xl sm:rounded-[2rem] p-6 sm:p-7 flex flex-col ${i === 2 ? 'org-peach' : 'org-sand'}`}>
              <Sk className="h-7 w-24" />
              <Sk className="mt-3 h-10 w-36" />
              <div className="text-xs text-foreground-secondary mt-2">Incl. GST · plan &amp; servers in one subscription</div>
              <Sk className="mt-4 h-3.5 w-full" />
              <Sk className="mt-2 h-3.5 w-2/3" />
              <Sk className="mt-6 h-11 w-full rounded-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="w-full px-4 sm:px-6 lg:px-12 pb-16 sm:pb-24">
        <h2 className="font-display font-black text-3xl lg:text-4xl mb-6 sm:mb-10">Compare every feature</h2>
        <div className="w-full overflow-x-auto rounded-[2rem] bg-surface-elevated">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-surface-secondary">
                <th className="text-left px-5 py-4 font-semibold text-foreground w-2/5">Feature</th>
                {Array.from({ length: PLANS }).map((_, i) => (
                  <th key={i} className="px-4 py-4">
                    <Sk className="mx-auto h-4 w-16" />
                    <Sk className="mx-auto mt-1.5 h-3 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <Fragment key={group}>
                  <tr className="bg-surface-secondary/50">
                    <td colSpan={PLANS + 1} className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-foreground-muted">{group}</td>
                  </tr>
                  {COMPARISON_ROWS.filter(r => r.group === group).map(row => (
                    <tr key={row.label} className="border-t border-border-default/60">
                      <td className="px-5 py-3 text-foreground-secondary">{row.label}</td>
                      {Array.from({ length: PLANS }).map((_, i) => (
                        <td key={i} className="px-4 py-3"><Sk className="mx-auto h-4 w-4 rounded-full" /></td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
