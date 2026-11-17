import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import { productCardNodes } from '@/components/visitor/site/code/parts/utility/cards'
import WishlistClient from './WishlistClient'

// The wishlist. An AI-designed wishlist places it itself (<WishlistGrid />), its products drawn as the site's product
// cards; a Site Builder wishlist page holds it in its `wishlist_main` block with the store's own blocks around it;
// otherwise it is the page.
export default async function WishlistPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  async function cards(ids: string[]) {
    'use server'
    return productCardNodes(ids)
  }
  const site = await renderUtilityPage({ audience: 'store', page: 'wishlist' }, await searchParams, {
    part: 'WishlistGrid',
    core: <WishlistClient cards={cards} />,
    block: { wishlist_main: <WishlistClient /> },
  })
  return site ?? <WishlistClient />
}
