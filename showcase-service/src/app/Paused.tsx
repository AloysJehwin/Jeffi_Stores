import { businessView } from '@/lib/showcase/views'
import type { ShowcaseSiteRow } from '@/lib/showcase/store'

const CONSOLE = `https://ecom.${process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'}/dashboard/showcase`

/** A paused site (by its owner, or unpaid hosting): the business's name and a note; nothing else of the page. */
export default function Paused({ site }: { site: ShowcaseSiteRow }) {
  const b = businessView(site.business)
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      {b.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.logo} alt="" className="h-16 w-16 rounded-full object-cover" />
      ) : (
        <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-surface-secondary text-2xl font-bold text-foreground">
          {b.initial}
        </span>
      )}
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{b.name}</h1>
      <p className="max-w-md text-foreground-secondary">This site is taking a short break. Please check back soon.</p>
      <p className="mt-10 text-xs text-foreground-muted">
        Is this your site?{' '}
        <a href={CONSOLE} className="underline underline-offset-2 hover:text-foreground">
          Bring it back from your Jeffi dashboard
        </a>
        .
      </p>
    </main>
  )
}
