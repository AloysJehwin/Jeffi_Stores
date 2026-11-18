import Link from 'next/link'
import { siteData, type SiteData } from '@/lib/site/data'

// A way back in for a shopper who lands on a page that does not exist: a search box (the listing's search), the
// store's top categories and its main pages. The built-in not-found page shows it under a 404 heading; an AI design
// (NotFoundContent) writes its own heading and draws it `bare`.

const LINKS = [
  { label: 'Home', href: '/' },
  { label: 'All products', href: '/products' },
  { label: 'All categories', href: '/categories' },
  { label: 'Help and support', href: '/support' },
]

export default async function NotFoundView({ data, bare = false }: { data?: SiteData; bare?: boolean }) {
  const cats = await (data ?? siteData()).categories({ parent: null, limit: 8 }).catch(() => [])
  return (
    <div className={`mx-auto flex w-full max-w-2xl flex-col items-center px-4 text-center ${bare ? 'py-6' : 'min-h-[60vh] justify-center py-16'}`}>
      {!bare && (
        <>
          <p className="font-display text-7xl font-bold text-primary-600 dark:text-primary-400">404</p>
          <h1 className="ui-heading mt-3 text-2xl font-bold text-foreground sm:text-3xl">We couldn&apos;t find that page</h1>
          <p className="mt-2 text-sm text-foreground-secondary">The link may be old or mistyped. Search for what you wanted, or carry on from one of these.</p>
        </>
      )}
      <form action="/products" method="get" role="search" className={`${bare ? '' : 'mt-6 '}flex w-full gap-2`}>
        <label htmlFor="not-found-search" className="sr-only">
          Search the store
        </label>
        <input
          id="not-found-search"
          name="search"
          type="search"
          required
          minLength={2}
          maxLength={60}
          placeholder="Search products"
          className="ui-input min-h-[44px] w-full flex-1 rounded-lg border border-border-secondary bg-surface px-4 text-base text-foreground placeholder:text-foreground-muted focus:border-accent-500 focus:ring-2 focus:ring-accent-500"
        />
        <button type="submit" className="ui-btn min-h-[44px] shrink-0 rounded-lg bg-accent-500 px-5 font-semibold text-white transition-colors hover:bg-accent-600">
          Search
        </button>
      </form>
      {cats.length > 0 && (
        <div className="mt-8 w-full">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Popular categories</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {cats.map(c => (
              <Link key={c.id} href={c.url} className="ui-btn rounded-full border border-border-default bg-surface-elevated px-4 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-accent-400 hover:text-foreground">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      <nav aria-label="Main pages" className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-semibold">
        {LINKS.map(l => (
          <Link key={l.href} href={l.href} className="text-accent-600 hover:text-accent-700 dark:text-accent-400">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
