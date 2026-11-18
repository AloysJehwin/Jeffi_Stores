import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import OrderDetailClient from './OrderDetailClient'

// An order's details and tracking. An AI-designed order page places it itself (<OrderDetail />); a Site Builder
// tracking page holds it in its `track_main` block with the store's own blocks (help, offers) around it; otherwise it
// is the page.
export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderUtilityPage({ audience: 'store', page: 'track' }, await searchParams, {
    part: 'OrderDetail',
    core: <OrderDetailClient params={params} />,
    block: { track_main: <OrderDetailClient params={params} /> },
  })
  return site ?? <OrderDetailClient params={params} />
}
