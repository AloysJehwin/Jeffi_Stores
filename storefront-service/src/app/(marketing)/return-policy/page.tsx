import { redirect } from 'next/navigation'
import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import ReturnsView from './ReturnsView'

// A Site Builder Returns page when the store has one (an AI design places the returns policy itself, with
// <ReturnsContent />); otherwise the returns and refund policy (the middleware sends the 307; this redirect() is the
// fallback).
export default async function ReturnPolicyRedirect({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderUtilityPage({ audience: 'store', page: 'returns' }, await searchParams, { part: 'ReturnsContent', core: <ReturnsView /> })
  if (site) return site
  redirect('/legal/return-refund-policy')
}
