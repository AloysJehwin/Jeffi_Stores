import { queryMany } from '@/lib/shared/db'
import { cleanStockCredit, STOCK_CREDITS_SETTING, type StockCredit } from '@/lib/ai/stock-credits'

// The live store's credits line (PhotoCredits under the footer): the stock photos it still shows. Two sources: the
// store's gallery rows from stock (lib/ai/stock.ts) and the seeded sample catalogue's credits (site_settings, by URL,
// provisioning/seed.ts). A photo counts while a published page, a product or a category uses its URL.

const SQL = `WITH stock(url, credit) AS (
    SELECT image_url, credit FROM gallery_images WHERE source = 'stock' AND credit IS NOT NULL
    UNION ALL
    SELECT e.key, e.value FROM site_settings s
      CROSS JOIN LATERAL jsonb_each(CASE WHEN s.value ~ '^\\s*\\{' THEN s.value::jsonb ELSE '{}'::jsonb END) e
     WHERE s.key = $1
  )
  SELECT DISTINCT ON (credit->>'source', lower(credit->>'name')) credit FROM stock st
   WHERE EXISTS (SELECT 1 FROM site_pages p WHERE strpos(p.published_doc::text, st.url) > 0)
      OR EXISTS (SELECT 1 FROM product_images pi WHERE pi.image_url = st.url)
      OR EXISTS (SELECT 1 FROM categories c WHERE c.image_url = st.url)
   LIMIT 24`

const TTL_MS = 5 * 60_000
const memo = new Map<string, { at: number; credits: StockCredit[] }>()

/** Credits for the stock photos a store shows, cached 5 minutes per store; [] when none or on any failure. */
export async function storePhotoCredits(store: string): Promise<StockCredit[]> {
  const hit = memo.get(store)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.credits
  // A failure is remembered too, so a store whose database lacks the column is not asked on every page.
  const rows = await queryMany<{ credit: unknown }>(SQL, [STOCK_CREDITS_SETTING]).catch(() => [])
  const credits = rows.map(r => cleanStockCredit(r.credit)).filter((c): c is StockCredit => !!c)
  memo.set(store, { at: Date.now(), credits })
  return credits
}

/** Test hook. */
export function __resetPhotoCredits(): void {
  memo.clear()
}
