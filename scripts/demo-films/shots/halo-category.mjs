// Storefront s3: product cards in the store's own style, then search, filters, wishlist and quick add, in the order the
// line names them. The preview is display-only (links and forms do nothing), so only the search box is clicked.
import { ECOM, ownerLogin, HALO, HALO_OWNER } from './common.mjs'

// How far to scroll to put the grid's first row where the cursor stops expect it (its wishlist buttons 333 px down).
const toGrid = page => page.locator('button[aria-label="Add to wishlist"]').first().evaluate(b => Math.round(b.getBoundingClientRect().top) - 333)
export default {
  viewport: { width: 1440, height: 900 },
  async before(page, h) {
    await ownerLogin(page, HALO_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${HALO}/products?surface=web&preview=1`, 3000)
    await page.evaluate(by => window.scrollBy(0, by), await toGrid(page))
    await page.waitForTimeout(1800)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo([577, 230], 900)
    await h.sleep(500)
    await h.cursorTo([878, 230], 650)
    await h.sleep(400)
    await h.cursorTo([1181, 230], 550)
    await h.sleep(500)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await h.sleep(1100)
    await h.type('input[placeholder="Search the store"]', 'earbuds', 12)
    await h.sleep(1200)
    await h.cursorTo('a[href="/categories/audio"]', 700)
    await h.sleep(450)
    await h.cursorTo('a[href="/categories/power-charging"]', 450)
    await h.sleep(450)
    await h.scroll(await toGrid(page), 1500)
    await h.cursorTo('button[aria-label="Add to wishlist"] >> nth=1', 650)
    await h.sleep(500)
    await h.cursorTo('button[aria-label^="Quick add"] >> nth=2', 500)
    await h.sleep(1200)
  },
}
