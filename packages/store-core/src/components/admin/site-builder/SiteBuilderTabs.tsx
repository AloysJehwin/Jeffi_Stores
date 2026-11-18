import Link from 'next/link'

/** Settings → Site Builder: two builders, one live. The "Live" badge marks the one customers see. */
export default function SiteBuilderTabs({ active, live, siteHref, homepageHref }: { active: 'site' | 'homepage'; live: 'site' | 'homepage'; siteHref: string; homepageHref: string }) {
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
  return (
    <nav className="flex gap-1 border-b border-border-default overflow-x-auto" aria-label="Builders">
      {tab('site', siteHref, 'Site Builder')}
      {tab('homepage', homepageHref, 'Homepage builder')}
    </nav>
  )
}
