import AccountReferrals from '@/components/visitor/AccountReferrals'
import { renderAccountFrame } from '@/components/visitor/site/code/parts/utility/site-page'

// Refer and earn, framed by the store's AI-designed account pages when it has them.
export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  return renderAccountFrame(await searchParams, <AccountReferrals />)
}
