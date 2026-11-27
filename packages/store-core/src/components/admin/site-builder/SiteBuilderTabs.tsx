import Link from 'next/link'
import SiteBuilderSwitch from './SiteBuilderSwitch'

/** Settings → Site builder: two builders, one live. The "Live" badge marks the one customers see; the control on the right makes the other live. */
export default function SiteBuilderTabs({
  active,
  live,
  siteHref,
  homepageHref,
  siteStarted,
}: {
  active: 'site' | 'homepage'
  live: 'site' | 'homepage'
  siteHref: string
  homepageHref: string
  siteStarted: boolean
}) {
  const tab = (id: 'site' | 'homepage', href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === id ? 'page' : undefined}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${
        active === id ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
      }`}
    >
      {label}
      {live === id && <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:text-green-300">Live</span>}
    </Link>
  )
  // The control names the builder it would make live: the one that is not live now.
  const other = live === 'site' ? 'homepage' : 'site'
  const showSwitch = other === 'homepage' || siteStarted
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-border-default">
      <nav className="flex gap-1 overflow-x-auto" aria-label="Builders">
        {tab('site', siteHref, 'Site builder')}
        {tab('homepage', homepageHref, 'Block builder')}
      </nav>
      {showSwitch && (
        <div className="pb-1">
          <SiteBuilderSwitch target={other} live={false} />
        </div>
      )}
    </div>
  )
}
