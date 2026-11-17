import type { SampleCatalog } from '@/lib/site/data'

// A non-engaging page as the studio previews it: no AI, just the shapes those pages are made of (cards, forms, lists,
// buttons) wearing the theme through the same ui-* hooks and theme variables the real pages read (store-core
// globals.css, Part F). Sample products fill the lists.

type Product = SampleCatalog['products'][number]

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const heading = 'ui-heading font-display text-3xl font-bold text-foreground sm:text-4xl'
const card = 'ui-card rounded-xl border border-border-default bg-surface-elevated p-5 shadow-sm'
const btn = 'ui-btn inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white'
const ghost = 'ui-btn inline-flex items-center justify-center rounded-lg border border-border-default px-5 py-2.5 text-sm font-semibold text-foreground'
const input = 'ui-input block w-full rounded-lg border border-border-secondary bg-surface px-3.5 py-2.5 text-sm text-foreground'
const badge = 'ui-badge inline-flex rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700'

function Thumb({ p }: { p: Product }) {
  const src = p.images?.[0]
  return (
    <div className="aspect-square w-full overflow-hidden rounded-lg bg-primary-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-xs text-primary-700">{p.name}</div>}
    </div>
  )
}

function Field({ label, value, type = 'text' }: { label: string; value?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground-secondary">{label}</span>
      <input className={input} type={type} defaultValue={value} readOnly />
    </label>
  )
}

const ORDER_STATES = ['Delivered', 'Shipped', 'Processing', 'Delivered']

export default function ThemedSample({ kind, label, audience, catalog }: { kind: string; label: string; audience: 'store' | 'business'; catalog: SampleCatalog | null }) {
  const products = (catalog?.products ?? []).slice(0, 8)
  const store = catalog?.store?.name ?? 'Your store'

  if (kind === 'login' || kind === 'signup' || kind === 'pending') {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className={`${card} w-full max-w-md p-8`}>
          <h1 className={`${heading} text-center text-2xl sm:text-3xl`}>{kind === 'pending' ? 'Almost there' : kind === 'signup' ? `Join ${store}` : 'Welcome back'}</h1>
          {kind === 'pending' ? (
            <p className="mt-3 text-center text-sm text-foreground-secondary">Your trade account is being reviewed. We will email you as soon as it is approved.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {kind === 'signup' && <Field label="Your name" value="Priya S." />}
              <Field label="Email or mobile" value="priya@example.com" />
              <button className={`${btn} w-full`}>{kind === 'signup' ? 'Create account' : 'Send me a code'}</button>
              <button className={`${ghost} w-full`}>Continue with Google</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (kind === 'not_found') {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-20 text-center">
        <div className="font-display text-7xl font-bold text-primary-600">404</div>
        <h1 className={`${heading} mt-2 text-2xl`}>This page wandered off</h1>
        <p className="mt-2 text-sm text-foreground-secondary">The link may be old. Everything else is right where you left it.</p>
        <span className={`${btn} mt-6`}>Back to the shop</span>
      </div>
    )
  }

  if (kind === 'legal' || kind === 'returns' || kind === 'support') {
    const topics = kind === 'support' ? ['Where is my order?', 'Changing an address', 'Payments and refunds', 'Talk to us'] : ['Overview', 'Eligibility', 'How to start', 'Refund timelines']
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <h1 className={heading}>{label}</h1>
        <p className="mt-2 text-sm text-foreground-muted">Updated recently · {store}</p>
        <div className="mt-8 space-y-4">
          {topics.map(t => (
            <section key={t} className={card}>
              <h2 className="ui-heading font-display text-lg font-semibold text-foreground">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                Your own policy text goes here. It is written from your store details when your store is set up, and you can change any of it later.
              </p>
            </section>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'wishlist' || kind === 'compare') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className={heading}>{label}</h1>
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.slice(0, 4).map(p => (
            <div key={p.slug} className={`${card} p-3`}>
              <Thumb p={p} />
              <div className="mt-3 line-clamp-2 text-sm font-medium text-foreground">{p.name}</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{inr(p.price)}</div>
              <button className={`${btn} mt-3 w-full px-3 py-2`}>{kind === 'compare' ? 'View' : 'Add to cart'}</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'account') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <h1 className={heading}>Hello, Priya</h1>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(audience === 'business' ? ['Orders', 'Quotes', 'Invoices', 'Addresses', 'Team', 'Profile'] : ['Orders', 'Addresses', 'Wishlist', 'Rewards', 'Referrals', 'Profile']).map(t => (
            <div key={t} className={card}>
              <h2 className="ui-heading font-display text-lg font-semibold text-foreground">{t}</h2>
              <p className="mt-1 text-sm text-foreground-secondary">Manage your {t.toLowerCase()}.</p>
              <span className="mt-3 inline-block text-sm font-semibold text-primary-700">Open →</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Orders, tracking, transactions, addresses, rewards, referrals, subscriptions, quotes: a list of rows.
  const rows = products.slice(0, 4)
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={heading}>{label}</h1>
        {kind === 'quotes' && <span className={btn}>Request a quote</span>}
        {kind === 'addresses' && <span className={btn}>Add an address</span>}
      </div>
      {kind === 'rewards' || kind === 'referrals' ? (
        <div className={`${card} mt-8 flex flex-wrap items-center justify-between gap-4`}>
          <div>
            <div className="text-sm text-foreground-secondary">{kind === 'rewards' ? 'Your points' : 'Friends who joined'}</div>
            <div className="font-display text-4xl font-bold text-primary-700">{kind === 'rewards' ? '1,240' : '3'}</div>
          </div>
          <span className={ghost}>{kind === 'rewards' ? 'How points work' : 'Copy your link'}</span>
        </div>
      ) : null}
      <div className="mt-6 space-y-3">
        {rows.map((p, i) => (
          <div key={p.slug} className={`${card} flex items-center gap-4 p-4`}>
            <div className="w-16 shrink-0">
              <Thumb p={p} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{kind === 'addresses' ? ['Home', 'Office', 'Parents', 'Studio'][i] : p.name}</div>
              <div className="mt-0.5 text-xs text-foreground-muted">
                {kind === 'addresses' ? '12, Gandhi Road, Chennai 600017' : `#${(48213 + i * 37).toString()} · ${i + 2} Nov`}
              </div>
            </div>
            <div className="text-right">
              {kind !== 'addresses' && <div className="text-sm font-semibold text-foreground">{inr(p.price)}</div>}
              <span className={`${badge} mt-1`}>{kind === 'quotes' ? ['Sent', 'Accepted', 'Draft', 'Sent'][i] : kind === 'addresses' ? (i === 0 ? 'Default' : 'Saved') : ORDER_STATES[i]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
