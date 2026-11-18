// Storefront s3: product cards in the store's own style, then search. (Preview cards are display-only.)
import { ECOM, ownerLogin, PAWS, PAWS_OWNER } from './common.mjs'

export default {
  viewport: { width: 1440, height: 900 },
  async before(page, h) {
    await ownerLogin(page, PAWS_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${PAWS}/products?surface=web&preview=1`, 3000)
    await page.evaluate(() => window.scrollTo(0, 700))
    await page.waitForTimeout(1800)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo([640, 260], 900)
    await h.sleep(500)
    await h.cursorTo([1065, 399], 700)
    await h.sleep(450)
    await h.cursorTo([1267, 399], 450)
    await h.sleep(500)
    await h.scroll(520, 1500)
    await h.cursorTo([570, 420], 600)
    await h.sleep(350)
    await h.cursorTo([880, 420], 500)
    await h.sleep(350)
    await h.cursorTo([1180, 420], 500)
    await h.sleep(400)
    await h.scroll(560, 1500)
    await h.sleep(500)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await h.sleep(1100)
    await h.type('input[placeholder^="Try"]', 'salmon treats', 12)
    await h.sleep(1600)
  },
}
