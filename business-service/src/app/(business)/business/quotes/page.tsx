export const dynamic = 'force-dynamic'

import { renderSitePage } from '@/components/visitor/site/SitePage'
import BusinessQuotesClient from './BusinessQuotesClient'

// The quotes list. With a Site Builder quotes page, it is that page's `quotes_main` block with the store's own
// blocks around it; otherwise it is the page.
export default async function MyQuotesPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderSitePage({ audience: 'business', page: 'quotes' }, await searchParams, { quotes_main: <BusinessQuotesClient /> })
  return site ?? <BusinessQuotesClient />
}
