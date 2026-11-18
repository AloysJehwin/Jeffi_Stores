import AccountRewards from '@/components/visitor/AccountRewards'
import { renderAccountFrame } from '@/components/visitor/site/code/parts/utility/site-page'

// The shopper's rewards, framed by the store's AI-designed account pages when it has them.
export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  return renderAccountFrame(await searchParams, <AccountRewards />)
}
