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
  const product = path.match(/^\/products?\/([^/]+)$/)
  if (product) return router.push(`/product/${product[1]}`)
  const category = path.match(/^\/(?:category|categories)\/([^/]+)$/)
  if (category) return router.push(`/category/${category[1]}`)
  if (path === '/categories') return router.push('/categories')
  const brand = path.match(/^\/brands\/([^/]+)$/)
  if (brand) return router.push({ pathname: '/(tabs)/products', params: { brand: brand[1] } })
  if (path === '/brands') return router.push('/(tabs)/products')
  if (path === '/cart') return router.push('/(tabs)/cart')
  if (path === '/wishlist') return router.push('/(tabs)/wishlist')
  if (path === '/' ) return router.push('/(tabs)')
  if (path === '/products' || path.startsWith('/offers/')) {
    const params: Record<string, string> = {}
    for (const k of PRODUCT_PARAMS) {
      const v = url.searchParams.get(k)
      if (v) params[k] = v
    }
    const offer = path.match(/^\/offers\/([^/]+)$/)
    if (offer) params.offer = offer[1]
    return router.push({ pathname: '/(tabs)/products', params })
  }
  Linking.openURL(url.toString())
}
