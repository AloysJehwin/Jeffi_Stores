// Phone view of the Halo Audio store; stops are found by their section's heading, as in halo-home.
import { ECOM, ownerLogin, toHeading, HALO, HALO_OWNER } from './common.mjs'

const STOPS = [['Shop by category', 110, 2000], ['New this week', 100, 2600], ['Good things', 110, 2600], ['Chosen with care', 575, 2200]]
export default {
  viewport: { width: 390, height: 844 },
  mobile: true,
  cursor: false,
  scale: 3,
  async before(page, h) {
    await ownerLogin(page, HALO_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${HALO}/home?surface=mobile&preview=1`, 3000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(900)
    for (const [text, offset, ms] of STOPS) {
      await toHeading(page, h, text, offset, ms)
      await h.sleep(500)
    }
    await h.sleep(200)
  },
}
