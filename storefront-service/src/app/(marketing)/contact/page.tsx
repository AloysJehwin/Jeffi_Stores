import { redirect } from 'next/navigation'
import { renderSitePage } from '@/components/visitor/site/SitePage'

// A Site Builder Contact page when the store has one; otherwise contact lives on Support (the middleware sends the
// 307; this redirect() is the fallback).
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderSitePage({ audience: 'store', page: 'contact' }, await searchParams)
  if (site) return site
  redirect('/support')
}
