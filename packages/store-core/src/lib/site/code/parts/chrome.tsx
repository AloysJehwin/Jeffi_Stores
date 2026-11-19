import Link from 'next/link'
import { z } from 'zod'
import { defineCodeComponent, type RenderCtx } from '../registry'
import { safeHref } from '../allow'
import { DEFAULT_FOOTER_COLUMNS, DEFAULT_NAV } from '@/lib/site/chrome-types'
import { StoreLogoMark } from '@/components/visitor/site/code/parts/chrome/marks'
import { AccountLinkPart, AnnouncementTextPart, CartIconPart, NewsletterFormPart, SearchBoxPart } from '@/components/visitor/site/code/parts/chrome/client'
import { FooterColumns, NavList, SOCIAL_LABEL, SOCIAL_NETWORKS, SocialIcons, type SocialNetwork } from '@/components/visitor/site/code/parts/chrome/static'
import type { StoreView } from '../../data/types'
import { studioPreview } from '../../portal'
import { cls, settings } from './cart'

// The header, footer and announcement parts (Part C): the store's logo, links, search, cart and account, built on the
// built-in header's own pieces (search, cart count, phone drawer).

const href = z
  .string()
  .trim()
  .max(500)
  .refine(v => safeHref(v) !== null, 'a /path or an https:// link')
const link = z.object({ label: z.string().trim().min(1).max(40), href })

const LogoProps = z.object({
  showName: z.boolean().default(true).describe('the store name beside the logo'),
  tagline: z.boolean().default(false).describe("the store's tagline under the name"),
  color: z.enum(['brand', 'inherit']).default('brand').describe('name in the brand colour, or the surrounding text colour'),
})

defineCodeComponent({
  name: 'Logo',
  pages: ['header', 'footer', 'announcement'],
  props: LogoProps,
  describe: "The store's logo (or its initial) and name, linking home.",
  render: async (props, ctx) => {
    const s = settings(LogoProps, props)
    const store = await ctx.data.store()
    return (
      <Link href="/" className={cls(props.className) ?? 'flex items-center min-w-0'}>
        <StoreLogoMark
          name={store.name}
          logoUrl={store.logo}
          tagline={s.tagline ? store.tagline : null}
          showName={s.showName}
          nameClassName={s.color === 'inherit' ? 'text-base sm:text-lg lg:text-xl font-bold truncate' : undefined}
        />
      </Link>
    )
  },
})

const NavLinksProps = z.object({
  links: z.array(link).min(1).max(10).optional().describe("used until the owner sets the store's menu; default: Home, Products, Categories, About Us, Support"),
  mobile: z.enum(['menu', 'scroll', 'hide', 'show']).default('menu').describe("phones and tablets: a menu button opening the store's drawer (at an edge of the logo row), a scrolling row, hidden, or as-is"),
  from: z.enum(['md', 'lg', 'xl']).default('lg').describe('with mobile menu or hide: the width the links show from (md 768px, lg 1024px, xl 1280px)'),
})

defineCodeComponent({
  name: 'NavLinks',
  pages: ['header', 'footer'],
  props: NavLinksProps,
  binding: { label: 'link text', href: 'link target' },
  describe: "The menu links: the store's own menu once the owner sets one in Site Builder, else `links`; className styles the list, the optional render function each link.",
  render: async (props, ctx) => {
    const s = settings(NavLinksProps, props)
    const links = (await storeMenu(ctx)) ?? s.links ?? DEFAULT_NAV
    const items = ctx.renderItem ? links.map((l, i) => ctx.renderItem!({ label: l.label, href: l.href }, i)) : undefined
    return <NavList links={links} items={items} mobile={s.mobile} from={s.from} className={cls(props.className)} />
  },
})

const SearchBoxProps = z.object({
  variant: z.enum(['icon', 'bar']).default('icon').describe("icon: the store's expanding search; bar: an open search field"),
  placeholder: z.string().trim().max(60).default('Search products'),
})

defineCodeComponent({
  name: 'SearchBox',
  pages: ['header', 'search'],
  props: SearchBoxProps,
  describe: "The store's product search with suggestions.",
  render: props => {
    const s = settings(SearchBoxProps, props)
    return <SearchBoxPart variant={s.variant} placeholder={s.placeholder} className={cls(props.className)} />
  },
})

const CartIconProps = z.object({ showCount: z.boolean().default(true) })

defineCodeComponent({
  name: 'CartIcon',
  pages: ['header'],
  props: CartIconProps,
  describe: 'The cart icon with the live item count, linking to the cart.',
  render: props => <CartIconPart showCount={settings(CartIconProps, props).showCount} className={cls(props.className)} demoCount={2} />,
})

const AccountLinkProps = z.object({ label: z.string().trim().max(30).default('Account').describe('"" for the icon only') })

defineCodeComponent({
  name: 'AccountLink',
  pages: ['header'],
  props: AccountLinkProps,
  describe: "A link to the shopper's account (sign-in when signed out): a person icon and the label, or once signed in their initial and first name.",
  render: (props, ctx) => <AccountLinkPart label={settings(AccountLinkProps, props).label} className={cls(props.className)} preview={studioPreview(ctx.data)} />,
})

const AnnouncementTextProps = z.object({
  messages: z.array(z.string().trim().min(1).max(140)).min(1).max(6),
  href: href.optional(),
  interval: z.number().int().min(2).max(15).default(5).describe('seconds per message'),
})

defineCodeComponent({
  name: 'AnnouncementText',
  pages: ['announcement', 'header'],
  props: AnnouncementTextProps,
  describe: 'Announcement messages taking turns (text only; style the bar around it).',
  render: props => {
    const r = AnnouncementTextProps.safeParse(props)
    if (!r.success) return null
    return <AnnouncementTextPart messages={r.data.messages} href={r.data.href ?? null} interval={r.data.interval} className={cls(props.className)} />
  },
})

const FooterLinksProps = z.object({
  columns: z
    .array(z.object({ title: z.string().trim().max(40), links: z.array(link).max(12) }))
    .min(1)
    .max(5)
    .optional()
    .describe('default: Shop, Help and Policies columns'),
})

defineCodeComponent({
  name: 'FooterLinks',
  pages: ['footer'],
  props: FooterLinksProps,
  binding: { title: 'column heading', links: 'array of { label, href }' },
  describe: 'Footer link columns; className styles the grid, the optional render function each column.',
  render: (props, ctx) => {
    const columns = settings(FooterLinksProps, props).columns ?? DEFAULT_FOOTER_COLUMNS
    const items = ctx.renderItem ? columns.map((c, i) => ctx.renderItem!({ title: c.title, links: c.links }, i)) : undefined
    return <FooterColumns columns={columns} items={items} className={cls(props.className)} />
  },
})

const SocialLinksProps = z.object({
  links: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORKS), href: z.string().trim().max(500).refine(v => /^https:\/\//.test(v) && safeHref(v) !== null, 'an https:// link') }))
    .max(8)
    .optional()
    .describe("leave out to show the store's own profiles and WhatsApp, as the owner set them"),
})

defineCodeComponent({
  name: 'SocialLinks',
  // On a Showcase the "store" is the business (lib/showcase/site-data.ts), so its own profiles show.
  pages: ['header', 'footer', 'showcase'],
  props: SocialLinksProps,
  binding: { network: SOCIAL_NETWORKS.join(' | '), href: 'profile link', label: 'network name' },
  describe: "Icons linking to the store's social profiles and WhatsApp, as the owner set them (nothing while there are none); `links` replaces them. The optional render function draws each one.",
  render: async (props, ctx) => {
    let links = settings(SocialLinksProps, props).links
    let inert = false
    if (!links) {
      links = storeSocials(await ctx.data.store())
      // The studio's sample store has none yet: stand-ins show where they go.
      if (!links.length && studioPreview(ctx.data)) {
        links = STAND_INS
        inert = true
      }
    }
    const shown = links
    const items = ctx.renderItem ? shown.map((l, i) => ctx.renderItem!({ network: l.network, href: l.href, label: SOCIAL_LABEL[l.network] }, i)) : undefined
    return <SocialIcons links={shown} items={items} className={cls(props.className)} inert={inert} />
  },
})

// The store's own subscription is its offer emails (a shopper's notification preferences): there is no list of guest
// addresses, so a guest signs up by creating an account, which gets them.
const NewsletterFormProps = z.object({
  placeholder: z.string().trim().max(60).default('Your email address'),
  button: z.string().trim().min(1).max(30).default('Subscribe'),
  inputClassName: z.string().max(400).optional().describe('classes for the email field'),
  buttonClassName: z.string().max(400).optional().describe('classes for the button'),
})

defineCodeComponent({
  name: 'NewsletterForm',
  pages: ['footer', 'home'],
  props: NewsletterFormProps,
  describe:
    "Sign-up for the store's offer emails: an email field and a button. A signed-in shopper is signed up in one tap; a guest goes on to create an account with that email (new accounts get the offers). className styles the form, inputClassName the field, buttonClassName the button.",
  render: (props, ctx) => {
    const s = settings(NewsletterFormProps, props)
    return (
      <NewsletterFormPart
        placeholder={s.placeholder}
        button={s.button}
        inputClassName={cls(s.inputClassName)}
        buttonClassName={cls(s.buttonClassName)}
        className={cls(props.className)}
        preview={studioPreview(ctx.data)}
      />
    )
  },
})

/** The store's menu (Site Builder's header links) on the live store; null where it has none, and in the studio. */
async function storeMenu(ctx: RenderCtx): Promise<{ label: string; href: string }[] | null> {
  if (studioPreview(ctx.data)) return null
  try {
    // Loaded here: the site's chrome reads the page store, which loads this library.
    const [{ getSiteChrome }, { getWebSurface }] = await Promise.all([import('@/lib/site/chrome'), import('@/lib/catalog/web-surface')])
    const nav = (await getSiteChrome('store', (await getWebSurface()) === 'web_mobile' ? 'web_mobile' : 'web'))?.nav
    return nav?.length ? nav.filter(l => safeHref(l.href)).slice(0, 10) : null
  } catch {
    return null
  }
}

/** The store's own profiles (https only) and its WhatsApp number. */
function storeSocials(s: StoreView): { network: SocialNetwork; href: string }[] {
  const socials: Record<string, unknown> = s.socials ?? {}
  const out: { network: SocialNetwork; href: string }[] = []
  for (const network of SOCIAL_NETWORKS) {
    const href = socials[network]
    if (network !== 'whatsapp' && typeof href === 'string' && /^https:\/\//.test(href) && safeHref(href)) out.push({ network, href })
  }
  const wa = typeof s.whatsapp === 'string' ? s.whatsapp.replace(/\D/g, '') : ''
  if (wa.length >= 8 && wa.length <= 15) out.push({ network: 'whatsapp', href: `https://wa.me/${wa}` })
  return out
}

const STAND_INS: { network: SocialNetwork; href: string }[] = [
  { network: 'instagram', href: '#' },
  { network: 'facebook', href: '#' },
  { network: 'youtube', href: '#' },
]
