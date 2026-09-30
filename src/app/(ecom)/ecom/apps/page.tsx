import Link from 'next/link'
import { APP_GROUPS } from '@/app/(ecom)/ecom/apps'
import AppIcon from './AppIcon'

export const dynamic = 'force-dynamic'

export default function AppsIndexPage() {
  return (
    <div className="ecom-clean bg-[#eef1f5] text-foreground">
      <section className="border-b border-border-default">
        <div className="w-full px-6 lg:px-12 pt-14 pb-10 sm:pt-20 text-center">
          <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">One platform</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mt-3 text-foreground">
            All apps
          </h1>
          <p className="mt-5 text-lg text-foreground-secondary max-w-2xl mx-auto">
            Everything your store needs, grouped and ready — catalogue, sales, fulfilment, finance, marketing and more.
            Turn on what you need as you grow.
          </p>
        </div>
      </section>

      <section className="w-full px-6 lg:px-12 py-12 space-y-12">
        {APP_GROUPS.map(g => (
          <div key={g.group}>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-5">{g.group}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {g.apps.map(a => (
                <Link
                  key={a.slug}
                  href={`/apps/${a.slug}`}
                  className="group rounded-2xl bg-surface-elevated border border-border-default shadow-sm shadow-black/[0.04] p-5 flex items-start gap-4 transition-colors hover:border-border-default/80"
                >
                  <span className="ecom-accent-bg shrink-0 grid place-items-center w-11 h-11 rounded-xl text-white">
                    <AppIcon name={a.icon} className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">{a.name}</span>
                    <span className="block text-sm text-foreground-secondary mt-0.5">{a.blurb}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="border-t border-border-default">
        <div className="w-full px-6 lg:px-12 py-16 text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-foreground">Start with all of it</h2>
          <p className="text-foreground-secondary mt-3 text-lg">
            Set up your store in minutes and switch on the apps you need.
          </p>
          <Link
            href="/signup"
            className="ecom-accent-bg inline-block mt-7 px-8 py-3.5 rounded-lg text-white font-semibold text-lg transition-colors"
          >
            Start your store
          </Link>
        </div>
      </section>
    </div>
  )
}
