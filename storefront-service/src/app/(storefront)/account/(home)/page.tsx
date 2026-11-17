import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import AccountClient from './AccountClient'

// The account home. An AI-designed account page frames it (<AccountPage />, as it frames every account page); a Site
// Builder account page holds it in its `account_main` block with the store's own blocks (offers, rewards, help) around
// it; otherwise it is the page.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderUtilityPage({ audience: 'store', page: 'account' }, await searchParams, {
    part: 'AccountPage',
    core: <AccountClient />,
    block: { account_main: <AccountClient /> },
  })
  return site ?? <AccountClient />
}
