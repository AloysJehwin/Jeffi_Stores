import { renderAccountFrame } from '@/components/visitor/site/code/parts/utility/site-page'
import OrdersClient from './OrdersClient'

// The shopper's orders, framed by the store's AI-designed account pages when it has them.
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  return renderAccountFrame(await searchParams, <OrdersClient />)
}
