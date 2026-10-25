import { Linking } from 'react-native'
import type { Router } from 'expo-router'

// Storefront assets (/images/…) are served by the web host, not the API host.
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://jeffistores.in').replace(/\/$/, '')

/** An absolute URL for an image or link the storefront stores as a site-relative path. */
export function absUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim()
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  return u.startsWith('/') ? `${SITE_URL}${u}` : null
}

const PRODUCT_PARAMS = ['category', 'brand', 'search', 'q', 'grade', 'material', 'minPrice', 'maxPrice', 'inStock', 'onSale', 'offer', 'sort']

/**
 * Open a storefront href in the app: product, category and listing paths map to app screens;
 * anything else opens in the browser on the storefront.
 */
export function openHref(router: Router, href: string | null | undefined) {
  const raw = (href ?? '').trim()
  if (!raw) return
  let url: URL
  try {
    url = new URL(raw, SITE_URL)
  } catch {
    return
  }
  const sameSite = url.origin === new URL(SITE_URL).origin || /(^|\.)jeffistores\.in$/.test(url.hostname)
  if (!sameSite) {
    Linking.openURL(url.toString())
    return
  }
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const m = (re: RegExp) => path.match(re)?.[1]
  let slug: string | undefined
  if ((slug = m(/^\/products?\/([^/]+)$/))) return router.push(`/product/${slug}`)
  if ((slug = m(/^\/(?:category|categories)\/([^/]+)$/))) return router.push(`/category/${slug}`)
  if ((slug = m(/^\/brands\/([^/]+)$/))) return router.push(`/brands/${slug}`)
  if ((slug = m(/^\/(?:account\/)?orders\/([^/]+)$/)) && slug !== 'confirmation') return router.push(`/orders/${slug}`)
  if ((slug = m(/^\/legal\/([^/]+)$/))) return router.push(`/legal/${slug}`)
  // A coupon link (a win, an old "use at checkout" link) opens the cart, which applies it.
  const coupon = url.searchParams.get('coupon') ?? url.searchParams.get('couponCode')
  const couponId = url.searchParams.get('couponId')
  if ((path === '/cart' || path === '/checkout') && (coupon || couponId)) {
    return router.navigate({ pathname: '/(tabs)/cart', params: coupon ? { coupon } : { couponId: couponId! } })
  }
  const screens: Record<string, string> = {
    '/': '/(tabs)',
    '/categories': '/categories',
    '/brands': '/brands',
    '/cart': '/(tabs)/cart',
    '/wishlist': '/(tabs)/wishlist',
    '/compare': '/compare',
    '/checkout': '/checkout/review',
    '/checkout/review': '/checkout/review',
    '/account': '/(tabs)/account',
    '/account/orders': '/orders',
    '/orders': '/orders',
    '/account/addresses': '/account/addresses',
    '/account/transactions': '/account/transactions',
    '/account/referrals': '/account/referrals',
    '/account/rewards': '/account/rewards',
    '/account/subscriptions': '/account/subscriptions',
    '/account/quotes': '/account/quotes',
    '/about': '/info/about',
    '/contact': '/info/contact',
    '/support': '/info/support',
    '/return-policy': '/info/return-policy',
    '/legal': '/legal',
    '/login': '/(auth)/login',
    '/signup': '/(auth)/signup',
  }
  if (screens[path]) return router.push(screens[path] as never)
  if (path === '/products' || path.startsWith('/offers/')) {
    const params: Record<string, string> = {}
    for (const k of PRODUCT_PARAMS) {
      const v = url.searchParams.get(k)
      if (v) params[k] = v
    }
    const offer = m(/^\/offers\/([^/]+)$/)
    if (offer) params.offer = offer
    return router.push({ pathname: '/(tabs)/products', params })
  }
  Linking.openURL(url.toString())
}
