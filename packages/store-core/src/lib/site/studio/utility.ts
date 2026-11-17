import type { PageKey } from '@jeffi/site-blocks'

// The store's working pages as the studio plans them: sign in, sign up, the account pages (one design frames the
// overview and the orders, addresses, rewards, referrals, transactions and subscriptions pages), an order, the
// wishlist, compare, the policies, returns, help and page not found. Each is built around its core part
// (code/parts/utility.tsx), which draws the page's own working component, so the design only frames it. Lean on
// purpose (two sections each, planned from the pool, not by the planner's call) and built after every main page,
// so a budget that runs out loses only these, and they keep the theme.

/** The plan's PageSpec (plan.ts), for these pages. */
export interface UtilitySpec {
  page: PageKey
  label: string
  optional?: boolean
  alsoFor?: PageKey[]
  sections: [number, number]
  must: string[]
  pool: string[][]
  parts?: string[][]
  layouts?: string[]
}

// Drawn per page, not per section, so these are moods that suit both sections; each idea says its own composition.
const BANDS = ['calm, with generous side space', 'quiet, with thin rules between the parts', 'on a softly tinted surface', 'type-led, with one accent colour']
const AUTH = ['on a softly tinted surface with generous space', 'calm, with generous side space', 'type-led, with one accent colour', 'on a band in the brand colour with light text']

export const UTILITY_SPECS: UtilitySpec[] = [
  {
    page: 'login',
    label: 'Sign in',
    optional: true,
    sections: [2, 2],
    must: ['SignInForm'],
    pool: [
      [
        'Sign-in split: a brand panel in the store colours with a warm welcome back and two or three short reasons to sign in (orders and returns in one place, saved addresses for a quicker checkout) beside <SignInForm />',
        'Centred sign-in: a short welcome line in the store voice over <SignInForm /> on a softly tinted band, the store name small under it',
      ],
      ['Reassurance strip: a secure sign-in with a one-time code, orders and returns in one place, saved addresses, as three short notes with icons'],
    ],
    parts: [['SignInForm'], []],
    layouts: AUTH,
  },
  {
    page: 'signup',
    label: 'Sign up',
    optional: true,
    sections: [2, 2],
    must: ['SignUpForm'],
    pool: [
      [
        'Join split: a brand panel with the reasons to create an account (every order in one place, saved addresses, a quicker checkout, a wishlist) beside <SignUpForm />',
        'Centred join: a short invitation in the store voice over <SignUpForm /> on a softly tinted band',
      ],
      ['What an account gives: orders in one place, saved addresses, a wishlist, as three short notes with icons'],
    ],
    parts: [['SignUpForm'], []],
    layouts: AUTH,
  },
  {
    page: 'account',
    label: 'Account pages',
    optional: true,
    sections: [2, 2],
    must: ['AccountPage'],
    pool: [
      [
        'Account frame: a slim welcome band in the store voice (never a name), then <AccountPage /> full width under it',
        'Account frame: a quiet heading strip with a short line about the shopper’s corner of the store, then <AccountPage /> full width',
      ],
      ['Help band: where to get help with an order, returns and the policies, as a few quiet links (/support, /return-policy, /legal)'],
    ],
    parts: [['AccountPage'], []],
    layouts: BANDS,
  },
  {
    page: 'track',
    label: 'Order details',
    optional: true,
    sections: [2, 2],
    must: ['OrderDetail'],
    pool: [
      ['Order page: a slim band with a link back to all orders (/account/orders), then <OrderDetail /> full width', 'Order page: a quiet strip with a short line in the store voice, then <OrderDetail /> full width'],
      ['Help with this order: contact options from <Store> and links to returns (/return-policy) and support (/support)'],
    ],
    parts: [['OrderDetail'], []],
    layouts: BANDS,
  },
  {
    page: 'wishlist',
    label: 'Wishlist',
    optional: true,
    sections: [2, 2],
    must: ['WishlistGrid'],
    pool: [
      ['Wishlist: a heading band in the store voice for saved favourites (the page’s h1), then <WishlistGrid /> full width', 'Wishlist: a quiet title strip with the h1 and a short line, then <WishlistGrid /> full width'],
      ['More to love: best sellers from <Products> as the site’s product cards, under a short heading'],
    ],
    parts: [['WishlistGrid'], ['Products']],
    layouts: BANDS,
  },
  {
    page: 'compare',
    label: 'Compare',
    optional: true,
    sections: [2, 2],
    must: ['CompareTable'],
    pool: [
      ['Compare: a short heading band (the page’s h1) with a line on choosing well, then <CompareTable /> full width', 'Compare: a quiet title strip with the h1, then <CompareTable /> full width'],
      ['Help choosing: a quiet band pointing to support (/support) and contact options from <Store>'],
    ],
    parts: [['CompareTable'], []],
    layouts: BANDS,
  },
  {
    page: 'legal',
    label: 'Policies',
    optional: true,
    sections: [2, 2],
    must: ['LegalContent'],
    pool: [
      ['Policies: a thin brand strip (no page title: the content brings it), then <LegalContent /> full width', 'Policies: <LegalContent /> full width on a calm surface under a thin rule'],
      ['Questions: a quiet band pointing to support (/support) and contact options from <Store>'],
    ],
    parts: [['LegalContent'], []],
    layouts: BANDS,
  },
  {
    page: 'returns',
    label: 'Returns',
    optional: true,
    sections: [2, 2],
    must: ['ReturnsContent'],
    pool: [
      ['Returns: a clear heading band (the page’s h1) with a short reassuring line that makes no promise, then <ReturnsContent /> full width', 'Returns: a quiet title strip with the h1, then <ReturnsContent /> full width'],
      ['Still need help: contact options from <Store> and a link to support (/support)'],
    ],
    parts: [['ReturnsContent'], []],
    layouts: BANDS,
  },
  {
    page: 'support',
    label: 'Help and support',
    optional: true,
    sections: [2, 2],
    must: ['SupportContent'],
    pool: [
      ['Help centre: a warm heading band in the store voice (the page’s h1), then <SupportContent /> full width', 'Help centre: a tinted band with the h1 and a short line, then <SupportContent /> full width'],
      ['Call or message: a closing band inviting a call or a WhatsApp message through <Store>'],
    ],
    parts: [['SupportContent'], []],
    layouts: BANDS,
  },
  {
    page: 'not_found',
    label: 'Page not found',
    optional: true,
    sections: [2, 2],
    must: ['NotFoundContent'],
    pool: [
      ['Lost page: an oversized 404 in the store’s type and a friendly line in the store voice (the h1), with <NotFoundContent /> under it', 'Lost page: a big 404 beside a playful line on a tinted band, then <NotFoundContent />'],
      ['New in: the newest products from <Products> as the site’s product cards, under a short heading'],
    ],
    parts: [['NotFoundContent'], ['Products']],
    layouts: ['centred, with generous space', 'on a softly tinted surface', 'type-led, with one oversized accent', 'calm, with thin rules between the parts'],
  },
]

/** Build order (controller build.ts): after every main page of both audiences. */
export const UTILITY_RANK: Record<string, number> = Object.fromEntries(UTILITY_SPECS.map((s, i) => [`store:${s.page}`, 30 + i]))

const COMMON =
  "This is one of the store's working pages: its working part (below) is the page itself. Place it exactly once, as it is: it brings its own layout, buttons and its signed-out, empty and loading states. Design the bands around it, never inside it: calm and slim, a short band rather than a hero, nothing heavy above it. Never type a customer's name, an order number, a price, a date or a policy term."

const RULES: Partial<Record<PageKey, string>> = {
  login: '<SignInForm /> is the sign-in card with its own heading: put it in a column, beside a brand panel on wide screens and under a slim line on phones.',
  signup: '<SignUpForm /> is the create-account card with its own heading: put it in a column, beside a brand panel on wide screens and under a slim line on phones.',
  account:
    '<AccountPage /> takes the full width: it is whichever account page the shopper is on (the overview, orders, addresses, rewards, referrals, transactions or subscriptions), with its own headings. This one design frames all of them, so keep the bands general and slim (nothing about one of those pages in particular).',
  track: '<OrderDetail /> takes the full width: it is one order with its number, status, items and actions. Every order wears this design, so the bands never describe one order.',
  wishlist: "<WishlistGrid /> takes the full width: the shopper's saved products, with no heading of its own. Write the page's h1 in your band above it.",
  compare: "<CompareTable /> takes the full width: the comparison table, with no heading of its own. Write the page's h1 in your band above it.",
  legal: '<LegalContent /> takes the full width: the list of policies, or one policy, with its own title. Every policy wears this design, so add no page title and never name a policy.',
  returns: "<ReturnsContent /> takes the full width: the store's own return and refund policy and how to start a return, with no heading of its own. Write the page's h1 above it, and never type return windows, fees or conditions.",
  support: "<SupportContent /> takes the full width: the store's contact details, quick links, policies and the support chat, with no heading of its own. Write the page's h1 above it.",
  not_found: '<NotFoundContent /> is a search box and popular links, with no heading of its own: write the 404 heading (the h1) and a friendly line in the store voice above it, never an apology wall.',
}

/** The section writer's rules for a working page (prompts.ts sectionSystem), or '' for any other page. */
export function utilityRules(page: PageKey): string {
  const own = RULES[page]
  return own ? `${COMMON} ${own}\n\n` : ''
}
