import { Linking, PixelRatio } from 'react-native'
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

// Mirrors controller-service/src/lib/shared/image-optimizer.json: the hosts the web host's /_next/image
// fetches and the widths it serves.
const RESIZE_HOSTS = [
  /^dm9rri2wgl1e\.cloudfront\.net$/i,
  /^jeffi-stores-bucket\.s3(?:\.us-east-1)?\.amazonaws\.com$/i,
  /^jeffi-tenant-[a-z0-9-]+\.s3(?:\.us-east-1)?\.amazonaws\.com$/i,
]
const RESIZE_WIDTHS = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920]
const MAX_WIDTH = RESIZE_WIDTHS[RESIZE_WIDTHS.length - 1]
const NO_RESIZE = /\.(?:gif|svg)$/i
const SITE_PREFIX = `${SITE_URL}/`
const RESIZED = `${SITE_URL}/_next/image?url=`
// /_next/image answers in WebP only when Accept names it; the native loaders send image/* or nothing.
const WEBP_ACCEPT = { Accept: 'image/webp,image/*;q=0.8' }

/**
 * A storefront image resized by the web host (/_next/image, WebP) to the smallest served width that
 * covers `width` dp at this screen density. GIFs, SVGs and other hosts keep their absUrl. `resize` is
 * the backend's image_resize flag (useImageSource). One URL per width, so expo-image caches it.
 */
export function imageUri(url: string | null | undefined, width: number, resize: boolean): string | null {
  const abs = absUrl(url)
  if (!abs || !resize || !(width > 0)) return abs
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(abs)
  if (!m || NO_RESIZE.test(m[2] ?? '')) return abs
  const site = abs.startsWith(SITE_PREFIX)
  if (site ? abs.startsWith(`${SITE_URL}/_next/`) : !RESIZE_HOSTS.some(re => re.test(m[1]))) return abs
  const px = Math.min(Math.ceil(width * PixelRatio.get()), MAX_WIDTH)
  const w = RESIZE_WIDTHS.find(x => x >= px) ?? MAX_WIDTH
  const src = site ? abs.slice(SITE_URL.length) : abs
  return `${RESIZED}${encodeURIComponent(src)}&w=${w}&q=70`
}

export interface RemoteImage {
  uri: string
  headers?: Record<string, string>
}

/** imageUri as an image source (expo-image, react-native-svg). */
export function imageSource(url: string | null | undefined, width: number, resize: boolean): RemoteImage | undefined {
  const uri = imageUri(url, width, resize)
  if (!uri) return undefined
  return uri.startsWith(RESIZED) ? { uri, headers: WEBP_ACCEPT } : { uri }
}

const PRODUCT_PARAMS = ['category', 'brand', 'search', 'q', 'grade', 'material', 'minPrice', 'maxPrice', 'inStock', 'onSale', 'offer', 'sort', 'dir', 'order']
const SORT_PARAMS = ['sort', 'dir', 'order']

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
  const sortParams: Record<string, string> = {}
  for (const k of SORT_PARAMS) {
    const v = url.searchParams.get(k)
    if (v) sortParams[k] = v
  }
  if ((slug = m(/^\/(?:category|categories)\/([^/]+)$/))) return router.push({ pathname: '/category/[slug]', params: { slug, ...sortParams } })
  if ((slug = m(/^\/brands\/([^/]+)$/))) return router.push({ pathname: '/brands/[slug]', params: { slug, ...sortParams } })
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
    // The web's /support is the chat (support reply pushes link there).
    '/support': '/info/support-chat',
    '/business/support': '/info/support-chat',
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
