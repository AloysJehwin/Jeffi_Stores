// Google AdSense on storefronts. The platform's publisher account serves every store by default; a store
// that pays for the remove-ads add-on (lib/billing/ad-free.ts) shows none. Pure and isomorphic.

import { CONSENT_COOKIE } from './google-tag'

export const PLATFORM_ADSENSE_CLIENT = 'ca-pub-3028325011384102'

/** The publisher id to load, or null when ADSENSE_DISABLED switches ads off platform-wide. Server only. */
export function adsenseClient(): string | null {
  const off = (process.env.ADSENSE_DISABLED || '').toLowerCase()
  return off === '1' || off === 'true' ? null : PLATFORM_ADSENSE_CLIENT
}

/** IAB TAG-ID of Google's ad exchange, fixed for every AdSense ads.txt line. */
const GOOGLE_TAG_ID = 'f08c47fec0942fa0'

/** ads.txt body authorising the platform account (ca-pub-… → pub-…). */
export function adsTxt(client: string = PLATFORM_ADSENSE_CLIENT): string {
  return `google.com, ${client.replace(/^ca-/, '')}, DIRECT, ${GOOGLE_TAG_ID}\n`
}

/**
 * Pages that carry no publisher content or sit in the purchase flow: AdSense policy keeps ads off sign-in,
 * thank-you and similar screens, and an ad click there costs a sale.
 */
const NO_AD_PREFIXES = [
  '/login',
  '/signup',
  '/auth',
  '/cart',
  '/checkout',
  '/account',
  '/review',
  '/subscribe',
  '/birthday',
  '/dev',
  '/r',
  '/staff',
  '/admin',
  '/forms',
  '/certportal',
]

export function adsAllowedOn(pathname: string): boolean {
  const p = pathname.toLowerCase()
  return !NO_AD_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`))
}

export function adsenseScriptSrc(client: string): string {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`
}

/**
 * Inline <head> script that runs before adsbygoogle.js: non-personalised ads until the visitor accepts
 * marketing cookies (consent cookie `v1.<analytics>.<ads>`), and requests paused on no-ad pages.
 * components/visitor/AdSense.tsx keeps the pause in step on client-side navigation.
 */
export function adsenseInitScript(): string {
  return (
    `(function(){var a=window.adsbygoogle=window.adsbygoogle||[];` +
    `try{var m=document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]*)/),p=m?decodeURIComponent(m[1]).split('.'):[];` +
    `a.requestNonPersonalizedAds=p[0]==='v1'&&p[2]==='1'?0:1}catch(e){a.requestNonPersonalizedAds=1}` +
    `var l=location.pathname.toLowerCase(),b=${JSON.stringify(NO_AD_PREFIXES)}.some(function(q){return l===q||l.indexOf(q+'/')===0});` +
    `a.pauseAdRequests=b?1:0;if(b)document.documentElement.setAttribute('data-no-ads','')})()`
  )
}
