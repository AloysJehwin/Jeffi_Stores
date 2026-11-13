import { getHost } from '@/lib/tenancy/get-host'

/** The request's public origin, so robots and sitemap URLs match the host being crawled (custom domains included). */
export async function siteOrigin(): Promise<string> {
  const host = (await getHost()).split(',')[0].trim()
  if (!host) return process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || host.endsWith('.localhost')
  return `${local ? 'http' : 'https'}://${host}`
}
