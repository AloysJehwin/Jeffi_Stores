import { cache } from 'react'
import { headers } from 'next/headers'
import { getShowcaseByHost, type ShowcaseSiteRow } from '@/lib/showcase/store'
import type { ShowcaseView } from '@/lib/showcase/types'

// The site a request's host addresses, cached per host for a minute: a publish, pause or edit shows within it.

const TTL_MS = 60_000
const MAX_HOSTS = 5_000
const hosts = new Map<string, { at: number; site: ShowcaseSiteRow | null }>()

const bare = (host: string) => host.toLowerCase().split(':')[0].trim()

export async function siteForHost(host: string): Promise<ShowcaseSiteRow | null> {
  const key = bare(host)
  if (!key) return null
  const hit = hosts.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site
  // A bought domain serves its www. too; the site holds the apex as its custom domain.
  const site = (await getShowcaseByHost(key)) ?? (key.startsWith('www.') ? await getShowcaseByHost(key.slice(4)) : null)
  hosts.delete(key)
  hosts.set(key, { at: Date.now(), site })
  if (hosts.size > MAX_HOSTS) hosts.delete(hosts.keys().next().value!)
  return site
}

/** Traefik and the dev router pass the visitor's Host through. */
export async function requestHost(): Promise<string> {
  const h = await headers()
  return h.get('host') ?? h.get('x-forwarded-host') ?? ''
}

/** This request's site; one lookup per render (metadata, page, robots share it). */
export const currentSite = cache(async (): Promise<ShowcaseSiteRow | null> => siteForHost(await requestHost()))

/** The site's origin as this request reached it: https in production, the dev router's host and port in dev. */
export async function siteOrigin(): Promise<string> {
  const host = await requestHost()
  return process.env.NODE_ENV === 'production' ? `https://${bare(host)}` : `http://${host}`
}

/** What the page's parts read, live. */
export const liveView = (site: ShowcaseSiteRow): ShowcaseView => ({ business: site.business, content: site.content, leadEndpoint: '/api/leads' })
