import type { ReactNode } from 'react'
import { z } from 'zod'
import type { PageKey } from '@jeffi/site-blocks'
import { defineCodeComponent, type RenderCtx } from '../registry'
import { studioPreview } from '../../portal'
import { takePageCore } from '@/components/visitor/site/code/parts/utility/slot'
import NotFoundView from '@/components/visitor/site/code/parts/utility/NotFoundView'
import {
  AccountPreview,
  ComparePreview,
  LegalPreview,
  OrderPreview,
  ReturnsPreview,
  SignInPreview,
  SignUpPreview,
  SupportPreview,
  WishlistPreview,
} from '@/components/visitor/site/code/parts/utility/previews'

// The working pages' core parts: sign in, sign up, the account pages, an order, the wishlist, compare, the policies,
// returns, help and page not found. Each is required on its page (help aside, below) and draws that page's own working
// component, which the storefront route hands over (utility/slot.ts), so every flow, guard, redirect and empty state
// stays the store's; the AI design frames it. In the studio preview each draws an inert look-alike over the sample
// catalogue.

const cls = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const storeName = async (ctx: RenderCtx) => (await ctx.data.store().catch(() => null))?.name || 'Your store'

function core(name: string, page: PageKey, describe: string, preview: (ctx: RenderCtx) => ReactNode | Promise<ReactNode>, required = true) {
  defineCodeComponent({
    name,
    pages: [page],
    ...(required ? { required: [page] } : {}),
    props: z.object({}),
    describe: `LOCKED, exactly once: ${describe} No props but className, for its wrapper.`,
    render: async (props, ctx) => {
      const node = studioPreview(ctx.data) ? await preview(ctx) : takePageCore(name)
      if (node == null) return null
      const c = cls(props.className)
      return c ? <div className={c}>{node}</div> : node
    },
  })
}

core(
  'SignInForm',
  'login',
  "the store's sign-in card with every sign-in option the store has on (a one-time code by email, SMS or WhatsApp, a password, Google), its errors and the way back to where the shopper was. A card about 28rem wide with no heading of its own: your section writes the page heading (e.g. \"Welcome back\" or \"Create your account\") above or beside it, once. Place it in a column, e.g. beside your brand panel.",
  async ctx => <SignInPreview store={await storeName(ctx)} />
)

core(
  'SignUpForm',
  'signup',
  "the store's create-account card (name, email and mobile with a one-time code, Google), its checks and the way back to where the shopper was. A card about 28rem wide with no heading of its own: your section writes the page heading (e.g. \"Create your account\") above or beside it, once. Place it in a column, e.g. beside your brand panel.",
  async ctx => <SignUpPreview store={await storeName(ctx)} />
)

core(
  'AccountPage',
  'account',
  "the signed-in shopper's account page they are on: the overview (profile, orders, addresses, wishlist) on /account, and their orders, addresses, rewards, referrals, transactions or subscriptions on those pages, with their own headings and phone menu. Full width in its own row.",
  ctx => <AccountPreview data={ctx.data} />
)

core(
  'OrderDetail',
  'track',
  'one order: its number, status and tracking, items, address, payment, invoice and actions (cancel, return or replace, review). Full width in its own row.',
  ctx => <OrderPreview data={ctx.data} />
)

core(
  'WishlistGrid',
  'wishlist',
  "the shopper's saved products as the site's product cards, with an in-stock filter, remove, the account menu and its own empty state. Full width in its own row; it has no page heading.",
  ctx => <WishlistPreview data={ctx.data} />
)

core(
  'CompareTable',
  'compare',
  'the products being compared side by side: their product cards with change and add buttons over the rows that tell them apart (it scrolls sideways on phones). Full width in its own row; it has no page heading.',
  ctx => <ComparePreview data={ctx.data} />
)

core(
  'LegalContent',
  'legal',
  "on /legal the list of the store's policies, and on each policy's page its title, sections and PDF download. Full width in its own row; it brings its own title.",
  () => <LegalPreview />
)

core(
  'ReturnsContent',
  'returns',
  "how to start a return from an order, then the store's own return and refund policy with its PDF. Full width in its own row; it has no page heading.",
  () => <ReturnsPreview />
)

core(
  'SupportContent',
  'support',
  "the store's contact details and hours, quick links, the policies and the support chat (shoppers sign in to chat). Full width in its own row; it has no page heading.",
  async ctx => <SupportPreview store={await ctx.data.store().catch(() => null)} />,
  // The business portal's support page shares the key and draws no store help: not required there. The studio still
  // plans it, and the store's route adds the built-in help to a design without it.
  false
)

core(
  'NotFoundContent',
  'not_found',
  "a search box and links to the store's popular categories and main pages, for a shopper on a page that does not exist. It has no heading: write the 404 heading and a friendly line above it.",
  ctx => <NotFoundView data={ctx.data} bare />
)
