import { MySubscriptionsVisitor } from '@/components/subscriptions/MySubscriptions'
import { renderAccountFrame } from '@/components/visitor/site/code/parts/utility/site-page'

// The shopper's subscriptions, framed by the store's AI-designed account pages when it has them.
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  return renderAccountFrame(await searchParams, <MySubscriptionsVisitor />)
}
