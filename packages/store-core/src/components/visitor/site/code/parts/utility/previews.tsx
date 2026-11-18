import type { ReactNode } from 'react'
import { siteCard } from '@/lib/site/card'
import { money } from '@/lib/site/data/format'
import type { ProductView, SiteData, StoreView } from '@/lib/site/data/types'
import { ProductItem } from '../../common/SiteCard'
import { ImagePlaceholder } from '../../common/tiles'

// The working pages' core parts as the studio previews them: inert look-alikes of the real components over the sample
// catalogue (a signed-in sample customer, orders and a wishlist made of its products), drawn with the same ui-* hooks
// so they wear the theme the way the store's pages do. Nothing here acts.

const card = 'ui-card bg-surface-elevated rounded-xl border border-border-default'
const btn = 'ui-btn inline-flex items-center justify-center rounded-lg bg-accent-500 px-6 py-3 font-semibold text-white'
const ghost = 'ui-btn inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-secondary bg-surface px-4 py-2.5 text-sm font-medium text-foreground'
const field = 'ui-input block w-full rounded-lg border border-border-secondary bg-surface px-4 py-3 text-foreground-muted'
const label = 'mb-2 block text-sm font-medium text-foreground-secondary'
const h2 = 'ui-heading text-sm font-semibold text-foreground'

const CUSTOMER = { name: 'Priya Sharma', initials: 'PS', email: 'priya.sharma@example.com', address: ['Flat 4B, Lotus Residency', '12 Gandhi Road, T. Nagar', 'Chennai, Tamil Nadu 600017'] }
const STATUS: { label: string; tone: string }[] = [
  { label: 'Shipped', tone: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' },
  { label: 'Delivered', tone: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
  { label: 'Delivered', tone: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
]

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const products = (data: SiteData, n: number) => data.products({ sort: 'featured', limit: n }).catch(() => [] as ProductView[])
const orderNo = (i: number) => `ORD${(48213 + i * 37).toString()}`

function Thumb({ p, className = 'h-14 w-14' }: { p: ProductView; className?: string }) {
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-secondary`}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImagePlaceholder className="h-full w-full" />
      )}
    </div>
  )
}

function Field({ name, hint }: { name: string; hint: string }) {
  return (
    <div>
      <span className={label}>{name}</span>
      <div className={field}>{hint}</div>
    </div>
  )
}

function Divider({ text }: { text: string }) {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border-default" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-surface-elevated px-3 text-foreground-muted">{text}</span>
      </div>
    </div>
  )
}

function Google({ verb }: { verb: string }) {
  return (
    <div className="ui-btn flex w-full items-center justify-center gap-3 rounded-lg border border-border-secondary bg-surface px-4 py-3 text-sm font-semibold text-foreground">
      <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full border border-border-secondary text-[11px] font-bold text-primary-600">G</span>
      {verb} Google
    </div>
  )
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center bg-surface px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="ui-card rounded-lg bg-surface-elevated p-4 shadow-lg sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
  )
}

export function SignInPreview({ store }: { store: string }) {
  return (
    <AuthCard>
      {/* No heading: inside an AI design the page's own section carries it (as the live card does, `bare`). */}
      <p className="sr-only">Sign in to your {store} account</p>
      <Google verb="Continue with" />
      <Divider text="or continue with email or mobile" />
      <div className="space-y-5">
        <Field name="Email or Mobile Number" hint="your@email.com or 10-digit number" />
        <div>
          <span className={label}>Send OTP via</span>
          <div className="flex gap-2">
            {['Email', 'SMS', 'WhatsApp'].map((c, i) => (
              <span
                key={c}
                className={`flex flex-1 items-center justify-center rounded-lg border-2 px-3 py-2.5 text-sm font-medium ${i === 0 ? 'border-accent-500 bg-accent-50 text-accent-600 dark:bg-accent-950/20 dark:text-accent-400' : 'border-border-secondary bg-surface text-foreground-secondary'}`}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
        <span className={`${btn} w-full`}>Send OTP</span>
      </div>
      <p className="mt-6 text-center text-sm text-foreground-secondary">
        Don&apos;t have an account? <span className="font-medium text-accent-600 dark:text-accent-400">Create one</span>
      </p>
    </AuthCard>
  )
}

export function SignUpPreview({ store }: { store: string }) {
  return (
    <AuthCard>
      <p className="sr-only">Create your {store} account</p>
      <Google verb="Sign up with" />
      <Divider text="or sign up with email" />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field name="First Name" hint="John" />
          <Field name="Last Name" hint="Doe" />
        </div>
        <Field name="Email Address" hint="your@email.com" />
        <div>
          <span className={label}>Mobile Number</span>
          <div className="flex">
            <span className="ui-addon inline-flex items-center rounded-l-lg border border-r-0 border-border-secondary bg-surface-secondary px-4 py-3 text-sm font-medium text-foreground-secondary">+91</span>
            <div className={`${field} rounded-l-none`}>10-digit number</div>
          </div>
        </div>
        <span className={`${btn} w-full`}>Continue</span>
      </div>
      <p className="mt-6 text-center text-sm text-foreground-secondary">
        Already have an account? <span className="font-medium text-accent-600 dark:text-accent-400">Login</span>
      </p>
    </AuthCard>
  )
}

function Avatar({ className }: { className: string }) {
  return <div className={`flex shrink-0 items-center justify-center rounded-full text-xl font-bold ${className}`}>{CUSTOMER.initials}</div>
}

function Address() {
  return (
    <div className="text-sm leading-relaxed text-foreground-secondary">
      <p className="font-medium text-foreground">{CUSTOMER.name}</p>
      {CUSTOMER.address.map(l => (
        <p key={l}>{l}</p>
      ))}
    </div>
  )
}

/** The account overview: the shopper's profile, order numbers, recent orders, default address and wishlist. */
export async function AccountPreview({ data }: { data: SiteData }) {
  const list = await products(data, 3)
  const orders = list.map((p, i) => ({ p, no: orderNo(i), date: day(3 + i * 9), status: STATUS[i], total: money(p.price.value * (i === 0 ? 2 : 1)).formatted }))
  const spent = money(list.reduce((s, p, i) => s + p.price.value * (i === 0 ? 2 : 1), 0)).formatted
  const stats = [
    { label: 'Total Orders', value: String(orders.length) },
    { label: 'Total Spent', value: spent },
    { label: 'Active Orders', value: orders.length ? '1' : '0' },
  ]
  return (
    <div className="bg-surface">
      <div className="bg-gradient-to-br from-accent-600 to-accent-500 px-4 pb-8 pt-8 dark:from-accent-700 dark:to-accent-600 lg:hidden">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 bg-white/20 text-white" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight text-white">{CUSTOMER.name}</p>
            <p className="truncate text-sm text-white/70">{CUSTOMER.email}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl bg-white/15 p-3 text-center">
              <p className="text-sm font-bold text-white">{s.value}</p>
              <p className="mt-0.5 text-[10px] text-white/70">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="container mx-auto px-4 py-4 lg:py-6">
        <div className="space-y-4">
          <div className={`${card} hidden items-center gap-4 p-5 lg:flex`}>
            <Avatar className="h-14 w-14 bg-accent-500/10 text-accent-600" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-foreground">{CUSTOMER.name}</p>
              <p className="text-sm text-foreground-muted">{CUSTOMER.email}</p>
            </div>
            <span className={ghost}>Edit profile</span>
          </div>
          <div className="hidden gap-3 lg:grid lg:grid-cols-3">
            {stats.map(s => (
              <div key={s.label} className={`${card} p-4`}>
                <p className="text-xl font-bold leading-none text-foreground">{s.value}</p>
                <p className="mt-1 text-xs text-foreground-muted">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className={`${card} p-4 sm:p-5 lg:col-span-2`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className={h2}>Recent Orders</h2>
                <span className="text-xs font-semibold text-accent-600 dark:text-accent-400">View all</span>
              </div>
              {orders.length ? (
                <div className="divide-y divide-border-default">
                  {orders.map(o => (
                    <div key={o.no} className="flex items-center gap-3 py-3">
                      <Thumb p={o.p} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{o.p.name}</p>
                        <p className="text-xs text-foreground-muted">
                          #{o.no} · {o.date}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">{o.total}</p>
                        <span className={`ui-badge mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${o.status.tone}`}>{o.status.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-foreground-muted">No orders yet</p>
              )}
            </div>
            <div className="space-y-4">
              <div className={`${card} p-4 sm:p-5`}>
                <h2 className={`${h2} mb-3`}>Default Address</h2>
                <Address />
              </div>
              <div className={`${card} flex items-center justify-between gap-3 p-4 sm:p-5`}>
                <div>
                  <h2 className={h2}>Wishlist</h2>
                  <p className="mt-0.5 text-xs text-foreground-muted">4 saved items</p>
                </div>
                <span className="text-xs font-semibold text-accent-600 dark:text-accent-400">Open</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const STEPS = ['Ordered', 'Confirmed', 'Shipped', 'Out for delivery', 'Delivered']

/** One order: its status and tracking, items, address, payment and actions. */
export async function OrderPreview({ data }: { data: SiteData }) {
  const lines = (await products(data, 2)).map((p, i) => ({ p, qty: i === 0 ? 2 : 1 }))
  const total = money(lines.reduce((s, l) => s + l.p.price.value * l.qty, 0)).formatted
  const done = 3
  return (
    <div className="bg-surface">
      <div className="container mx-auto space-y-4 px-4 py-6">
        <div className={`${card} p-4 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="ui-heading text-xl font-bold text-foreground sm:text-2xl">Order #{orderNo(0)}</h1>
              <p className="mt-1 text-sm text-foreground-secondary">Placed on {day(4)}</p>
            </div>
            <span className={`ui-badge inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS[0].tone}`}>Shipped</span>
          </div>
          <ol className="mt-6 grid grid-cols-5 gap-1">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col items-center text-center">
                <span className={`h-1.5 w-full rounded-full ${i < done ? 'bg-accent-500' : 'bg-surface-secondary'}`} />
                <span className={`mt-2 text-[11px] font-medium sm:text-xs ${i < done ? 'text-foreground' : 'text-foreground-muted'}`}>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-foreground-secondary">
            Arriving by <span className="font-semibold text-foreground">{day(-2)}</span>
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className={`${card} p-4 sm:p-6 lg:col-span-2`}>
            <h2 className={`${h2} mb-3`}>Items</h2>
            <div className="divide-y divide-border-default">
              {lines.map(l => (
                <div key={l.p.id} className="flex items-center gap-4 py-3">
                  <Thumb p={l.p} className="h-16 w-16" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{l.p.name}</p>
                    <p className="mt-0.5 text-xs text-foreground-muted">Qty {l.qty}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{money(l.p.price.value * l.qty).formatted}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={ghost}>Track shipment</span>
              <span className={ghost}>Download invoice</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className={`${card} p-4 sm:p-5`}>
              <h2 className={`${h2} mb-3`}>Delivery Address</h2>
              <Address />
            </div>
            <div className={`${card} space-y-2 p-4 text-sm sm:p-5`}>
              <h2 className={`${h2} mb-1`}>Payment</h2>
              <div className="flex justify-between text-foreground-secondary">
                <span>Subtotal</span>
                <span>{total}</span>
              </div>
              <div className="flex justify-between text-foreground-secondary">
                <span>Delivery</span>
                <span>Free</span>
              </div>
              <div className="flex justify-between border-t border-border-default pt-2 font-bold text-foreground">
                <span>Total</span>
                <span>{total}</span>
              </div>
              <p className="text-xs text-foreground-muted">Paid by UPI</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="mb-4 flex items-center gap-1.5">
      {items.map((c, i) => (
        <span key={c} className={`ui-btn rounded-full px-3 py-1 text-xs font-medium ${i === 0 ? 'bg-accent-500 text-white' : 'border border-border-default bg-surface-elevated text-foreground-secondary'}`}>
          {c}
        </span>
      ))}
    </div>
  )
}

/** The wishlist as the live AI page draws it: the site's product cards, each with its wishlist line under it. */
export async function WishlistPreview({ data }: { data: SiteData }) {
  const [list, c] = await Promise.all([products(data, 4), siteCard(data)])
  const badges = ['Price dropped 8%', null, 'Back in stock', null]
  return (
    <div className="container mx-auto px-4 py-4 sm:py-6">
      <Chips items={['All', 'In Stock', 'Out of Stock']} />
      {list.length ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p, i) => (
            <div key={p.id} className="flex flex-col gap-2">
              <ProductItem product={p} card={c} data={data} priority={i === 0} />
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                {badges[i] ? <span className={`ui-badge rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${i === 0 ? 'bg-rose-600' : 'bg-emerald-600'}`}>{badges[i]}</span> : <span />}
                <span className="inline-flex min-h-[36px] items-center gap-1 px-1 text-xs font-medium text-foreground-secondary">× Remove</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${card} p-12 text-center`}>
          <h3 className="ui-heading mb-2 text-xl font-semibold text-foreground">Your wishlist is empty</h3>
          <p className="mb-6 text-foreground-secondary">Save your favorite items to buy them later</p>
          <span className={btn}>Browse Products</span>
        </div>
      )}
    </div>
  )
}

/** The compare table as the live AI page draws it: the site's product cards over the rows that tell them apart. */
export async function ComparePreview({ data }: { data: SiteData }) {
  const [list, c] = await Promise.all([products(data, 3), siteCard(data)])
  const rows: [string, (p: ProductView) => string | null][] = [
    ['Brand', p => p.brand],
    ['Category', p => p.category],
    ['Price', p => p.price.formatted],
    ['Availability', p => (p.inStock ? 'In stock' : 'Out of stock')],
    ['Rating', p => (p.rating ? `${p.rating} / 5` : null)],
  ]
  return (
    <div className="container mx-auto px-4 py-6 sm:py-8">
      <div className="mb-4 flex justify-end">
        <span className={ghost}>+ Add product</span>
      </div>
      <div className="ui-card overflow-x-auto rounded-xl border border-border-default bg-surface-elevated shadow-sm">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-border-default">
              <th className="w-36 bg-surface-secondary p-4 sm:w-44" />
              {list.map((p, i) => (
                <th key={p.id} className="min-w-[160px] p-4 text-left align-top sm:min-w-[190px]">
                  <div className="space-y-2">
                    <ProductItem product={p} card={c} data={data} priority={i === 0} />
                    <span className="block text-xs font-medium text-accent-600 dark:text-accent-400">Change</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, value], r) => (
              <tr key={name} className={`border-b border-border-default last:border-0 ${r % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}>
                <td className="whitespace-nowrap bg-surface-secondary p-4 align-top text-xs font-semibold uppercase tracking-wide text-foreground-muted">{name}</td>
                {list.map(p => (
                  <td key={p.id} className="p-4 align-top text-sm text-foreground">
                    {value(p) ?? <span className="text-foreground-muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const POLICIES = [
  ['Privacy Policy', 'How we collect, use and protect your personal information.'],
  ['Terms & Conditions', 'The terms that apply when you shop with us.'],
  ['Return & Refund Policy', 'How returns, replacements and refunds work.'],
  ['Shipping Policy', 'Where we deliver, how long it takes and what it costs.'],
  ['Cancellation Policy', 'When and how an order can be cancelled.'],
  ['FAQ', 'Answers to the questions shoppers ask most.'],
]

/** The policies index (each policy's own page wears the same design). */
export function LegalPreview() {
  return (
    <div className="bg-surface">
      <div className="border-b border-border-default bg-surface-elevated">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="ui-heading mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground md:text-4xl">Policies &amp; Legal</h1>
          <p className="text-sm text-foreground-secondary">Everything you need to know about how we operate, your rights, and our commitments to you.</p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {POLICIES.map(([title, text]) => (
              <div key={title} className="ui-card flex items-start gap-4 rounded-xl border border-border-default bg-surface-elevated p-5">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
                  {title[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="ui-heading text-sm font-bold text-foreground">{title}</h2>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-foreground-secondary">{text}</p>
                  <p className="mt-2 text-xs text-foreground-muted">Updated {day(20)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={`${card} p-6 text-center`}>
            <p className="mb-3 text-sm text-foreground-secondary">Can&apos;t find what you&apos;re looking for? Our support team can help.</p>
            <span className={`${btn} px-6 py-2.5 text-sm`}>Contact Support</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const RETURN_STEPS = ['Open the order in My Orders', 'Choose the items to return or replace, and tell us why', 'Follow the request on the order page']

/** The returns page's working part: how to start a return, then the store's own policy text. */
export function ReturnsPreview() {
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={`${card} p-6`}>
          <h2 className="ui-heading text-base font-bold text-foreground md:text-lg">How to start a return</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {RETURN_STEPS.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-sm font-bold text-white">{i + 1}</span>
                <span className="text-sm text-foreground-secondary">{s}</span>
              </li>
            ))}
          </ol>
          <span className={`${btn} mt-5 py-2.5 text-sm`}>Go to my orders</span>
        </div>
        {['Overview', 'Eligibility', 'Refunds'].map(t => (
          <div key={t} className={`${card} p-6`}>
            <h2 className="ui-heading mb-3 text-base font-bold text-foreground md:text-lg">{t}</h2>
            <p className="text-sm leading-relaxed text-foreground-secondary">Your own return and refund policy shows here, written from your store settings when your store is set up. You can change any of it later.</p>
          </div>
        ))}
        <p className="text-xs text-foreground-muted">
          Last updated {day(20)} · <span className="font-semibold text-accent-600 dark:text-accent-400">Download PDF</span>
        </p>
      </div>
    </div>
  )
}

const QUICK = ['My Orders', 'My Account', 'Wishlist', 'Browse Products', 'All Categories', 'About Us']
const LEGAL = ['Privacy Policy', 'Terms & Conditions', 'Return & Refund Policy', 'Shipping Policy', 'Cancellation Policy', 'FAQ']

/** Help and support: contact details, quick links, the policies and the support chat. */
export function SupportPreview({ store }: { store: StoreView | null }) {
  const own = [
    ['Phone', store?.phone],
    ['Email', store?.email],
    ['Address', store?.address],
  ].filter((x): x is [string, string] => !!x[1])
  const contact: [string, string][] = own.length ? own : [['Phone', 'Your phone number'], ['Email', 'Your email address']]
  const list = (title: string, items: string[]) => (
    <div className={`${card} p-5`}>
      <h2 className="mb-3 text-sm font-bold text-foreground">{title}</h2>
      <div className="divide-y divide-border-default">
        {items.map(l => (
          <div key={l} className="flex items-center justify-between py-2 text-sm text-foreground-secondary">
            {l}
            <span aria-hidden className="text-foreground-muted">›</span>
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3 md:mb-10">
        <div className={`${card} space-y-4 p-5`}>
          <h2 className="text-sm font-bold text-foreground">Contact Us</h2>
          {contact.map(([k, v]) => (
            <div key={k}>
              <p className="mb-1 text-xs text-foreground-muted">{k}</p>
              <p className="break-words text-sm font-medium text-foreground">{v}</p>
            </div>
          ))}
        </div>
        {list('Quick Links', QUICK)}
        {list('Legal & Policies', LEGAL)}
      </div>
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-accent-500">Support Chat</p>
      <h2 className="mb-4 text-xl font-extrabold text-foreground md:text-2xl">Chat with us</h2>
      <div className="flex h-80 flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-elevated shadow-sm">
        <div className="flex-1 space-y-3 p-4">
          <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-surface-secondary px-4 py-2.5 text-sm text-foreground">Hi! How can we help you today?</div>
          <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-accent-500 px-4 py-2.5 text-sm text-white">Where is my order?</div>
        </div>
        <div className="flex gap-2 border-t border-border-default p-3">
          <div className={`${field} py-2.5 text-sm`}>Type your message…</div>
          <span className={`${btn} px-4 py-2.5 text-sm`}>Send</span>
        </div>
      </div>
    </div>
  )
}
