// The AI-built Paws & Co home page, scrolled like a shopper would.
import { ECOM, ownerLogin, PAWS, PAWS_OWNER } from './common.mjs'

export default {
  viewport: { width: 1440, height: 900 },
  async before(page, h) {
    await ownerLogin(page, PAWS_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${PAWS}/home?surface=web&preview=1`, 3000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(800)
    await h.cursorTo([980, 520], 900)
    await h.scroll(700, 2200)
    await h.sleep(500)
    await h.scroll(800, 2400)
    await h.sleep(500)
    await h.scroll(900, 2400)
    await h.sleep(600)
    await h.scroll(900, 2400)
    await h.sleep(800)
  },
}
