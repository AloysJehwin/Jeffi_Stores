// The Halo Audio home page (Glass · Mint), scrolled like a shopper would. Each stop is found by its section's heading,
// so the stops hold when a section above changes height.
import { ECOM, ownerLogin, toHeading, HALO, HALO_OWNER } from './common.mjs'

const STOPS = [['Shop by category', 110, 2200], ['New this week', 96, 3000], ['Good things', 153, 2800], ['Chosen with care', 122, 2600]]
export default {
  viewport: { width: 1440, height: 900 },
  async before(page, h) {
    await ownerLogin(page, HALO_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${HALO}/home?surface=web&preview=1`, 3000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(800)
    await h.cursorTo([980, 520], 900)
    for (const [text, offset, ms] of STOPS) {
      await toHeading(page, h, text, offset, ms)
      await h.sleep(600)
    }
    await h.sleep(200)
  },
}
