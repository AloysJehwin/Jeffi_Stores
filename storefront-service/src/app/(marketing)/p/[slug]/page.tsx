import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { renderSitePage } from '@/components/visitor/site/SitePage'
import { loadSitePage } from '@/lib/site/page'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string; layout?: string }> }

const ok = (slug: string) => /^[a-z0-9-]{1,120}$/.test(slug)

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (!ok(slug)) return {}
  const [page, identity] = await Promise.all([loadSitePage({ audience: 'store', page: 'custom', slug }).catch(() => null), getStoreIdentity()])
  return page?.title ? { title: `${page.title} | ${identity.name}` } : {}
}

/** A page the store built in Site Builder (/p/<slug>). */
export default async function CustomPage({ params, searchParams }: Props) {
  const { slug } = await params
  if (!ok(slug)) notFound()
  const site = await renderSitePage({ audience: 'store', page: 'custom', slug }, await searchParams)
  if (!site) notFound()
  return site
}
