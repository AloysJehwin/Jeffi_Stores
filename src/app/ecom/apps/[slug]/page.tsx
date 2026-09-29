import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findApp } from '../../apps'
import { CheckMark } from '../../Shapes'
import AppIcon from '../AppIcon'

export const dynamic = 'force-dynamic'

function benefits(blurb: string): string[] {
  return [
    blurb,
    'Built into the same platform — no extra tools to wire up.',
    'Works on your own subdomain, on desktop and mobile.',
  ]
}

export default async function AppDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const app = findApp(slug)
  if (!app) notFound()

  return (
    <div className="ecom-clean bg-[#eef1f5] text-foreground">
      <section className="w-full px-6 lg:px-12 pt-10 pb-16 sm:pt-14">
        <nav className="text-sm text-foreground-muted mb-8">
          <Link href="/apps" className="hover:text-foreground">Apps</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground-secondary">{app.group}</span>
        </nav>

        <div className="rounded-2xl bg-surface-elevated border border-border-default shadow-sm shadow-black/[0.05] p-6 sm:p-10">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6">
            <span className="ecom-accent-bg shrink-0 grid place-items-center w-16 h-16 rounded-2xl text-white">
              <AppIcon name={app.icon} className="w-8 h-8" />
            </span>
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground">
                {app.name}
              </h1>
              <p className="mt-3 text-lg text-foreground-secondary max-w-2xl">{app.blurb}</p>
            </div>
          </div>

          <ul className="mt-8 space-y-3 max-w-2xl">
            {benefits(app.blurb).map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="ecom-accent-text shrink-0 mt-0.5">
                  <CheckMark className="w-5 h-5" />
                </span>
                <span className="text-foreground-secondary">{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link
              href="/signup"
              className="ecom-accent-bg w-full sm:w-auto text-center px-7 py-3.5 rounded-lg text-white font-semibold transition-colors"
            >
              Start your store
            </Link>
            <Link
              href="/apps"
              className="w-full sm:w-auto text-center px-7 py-3.5 rounded-lg font-semibold text-foreground bg-surface border border-border-default transition-colors hover:bg-surface-secondary"
            >
              All apps
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
