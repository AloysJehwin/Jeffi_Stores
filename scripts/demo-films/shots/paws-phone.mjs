// Phone view of the Paws & Co store.
import { ECOM, ownerLogin, PAWS, PAWS_OWNER } from './common.mjs'

export default {
  viewport: { width: 390, height: 844 },
  mobile: true,
  cursor: false,
  scale: 3,
  async before(page, h) {
    await ownerLogin(page, PAWS_OWNER)
    await h.goto(`${ECOM}/onboard/studio/preview/${PAWS}/home?surface=mobile&preview=1`, 3000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(900)
    await h.scroll(600, 2000)
    await h.sleep(500)
    await h.scroll(700, 2200)
    await h.sleep(500)
    await h.scroll(800, 2200)
    await h.sleep(500)
    await h.scroll(800, 2200)
    await h.sleep(700)
  },
}
