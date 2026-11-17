export const dynamic = 'force-dynamic'

import { renderSitePage } from '@/components/visitor/site/SitePage'
import BusinessOrdersClient from './BusinessOrdersClient'

// The business orders list. With a Site Builder orders page, it is that page's `orders_main` block with the store's own
// blocks around it; otherwise it is the page.
export default async function BusinessOrdersPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderSitePage({ audience: 'business', page: 'orders' }, await searchParams, { orders_main: <BusinessOrdersClient /> })
  return site ?? <BusinessOrdersClient />
}
