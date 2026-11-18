// The site-wide parts (header links, footer columns, announcement bar) a store's Site Builder pages set, as the
// storefront's header and footer read them. Client-safe.

export interface ChromeLink {
  label: string
  href: string
}
export interface SiteChrome {
  nav: ChromeLink[] | null
  footer: { columns: { title: string; links: ChromeLink[] }[]; note: string | null } | null
  announcements: { text: string; href: string | null; tone: 'brand' | 'dark' | 'accent' }[]
}

export const DEFAULT_NAV: ChromeLink[] = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/about', label: 'About Us' },
  { href: '/support', label: 'Support' },
]

export const DEFAULT_FOOTER_COLUMNS: { title: string; links: ChromeLink[] }[] = [
  { title: 'Shop', links: [{ href: '/', label: 'Home' }, { href: '/products', label: 'Products' }, { href: '/categories', label: 'Categories' }] },
  { title: 'Help', links: [{ href: '/about', label: 'About Us' }, { href: '/contact', label: 'Contact' }, { href: '/support', label: 'Support' }] },
  { title: 'Policies', links: [{ href: '/legal', label: 'Policies' }, { href: '/legal/privacy-policy', label: 'Privacy' }] },
]
