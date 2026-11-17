// Next marks a not-found page noindex; the page's generateMetadata titles it.
const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">There is no site here</h1>
      <p className="max-w-md text-foreground-secondary">Check the address, or the business may not have published its site yet.</p>
      <a href={`https://ecom.${ROOT}`} className="mt-6 text-sm text-foreground-muted underline underline-offset-2 hover:text-foreground">
        Make a site for your business with Jeffi
      </a>
    </main>
  )
}
