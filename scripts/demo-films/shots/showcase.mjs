// Overview o9: Showcase: switch the one-page site's theme, then the 30-days-free publish card.
import { ECOM, ownerLogin, LUMEN_OWNER } from './common.mjs'

const swatch = name => `[aria-label='${name}'], button[title='${name}']`
export default {
  viewport: { width: 1536, height: 960 },
  acceptDialogs: true,
  async before(page, h) {
    await ownerLogin(page, LUMEN_OWNER)
    await h.goto(`${ECOM}/onboard/showcase`, 4000)
    await page.evaluate(() => window.scrollTo(0, 120))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.click('button:has-text("Change theme")', 800)
    await h.sleep(1200)
    await h.click(swatch('Tomato'), 800)
    await h.sleep(700)
    await h.click('button:has-text("Use this theme") >> nth=1', 800)
    await h.sleep(3200)
    await h.scroll(700, 1400)
    await h.cursorTo('button:has-text("Publish my site")', 900)
    await h.sleep(1600)
  },
  async after(page) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.locator('button:has-text("Change theme")').first().click()
    await page.waitForTimeout(1500)
    await page.locator(swatch('Sand')).first().click()
    await page.waitForTimeout(600)
    await page.locator('button:has-text("Use this theme") >> nth=0').click()
    await page.waitForTimeout(3000)
  },
}
