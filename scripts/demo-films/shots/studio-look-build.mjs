// Overview o3: the AI's looks for Paws & Co, then the built site page by page.
import { openWizard, warm, PAWS, PAWS_OWNER, PAGES } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  scale: 1.5,
  async before(page) {
    await openWizard(page, PAWS_OWNER, 2, 'site')
    await warm(page, PAWS, PAGES)
    await page.evaluate(() => window.scrollTo(0, 150))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.click('button:has-text("Look")', 800)
    await h.sleep(1400)
    for (const i of [0, 1, 2]) {
      await h.cursorTo(`[aria-pressed] >> nth=${i}`, 650)
      await h.sleep(650)
    }
    await h.click('button:has-text("See your site")', 800)
    await h.sleep(1500)
    for (const label of ['Category pages', 'Product page', 'Cart', 'Checkout']) {
      await h.click(`text="${label}"`, 600)
      await h.sleep(1700)
    }
  },
}
