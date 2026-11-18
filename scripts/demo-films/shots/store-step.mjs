// Overview o2: the Store step: details, what you sell (licences appear), contacts, socials.
import { openWizard, LUMEN_OWNER } from './common.mjs'

const chip = 'button:has-text("Food & Groceries")'
export default {
  viewport: { width: 1536, height: 960 },
  async before(page) {
    await openWizard(page, LUMEN_OWNER, 1, 'store')
    // Start with Food & Groceries off (a selected chip carries a check icon).
    if (await page.locator(`${chip} svg`).count()) {
      await page.locator(chip).first().click()
      await page.waitForTimeout(1500)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1200)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo('input[value="Lumen Home"]', 700)
    await h.sleep(500)
    await h.cursorTo('text=Tagline', 600)
    await h.sleep(300)
    await h.scroll(300, 1100)
    await h.click(chip, 700)
    await h.sleep(900)
    await h.scroll(330, 1200)
    await h.cursorTo('text=Licences & certificates', 600)
    await h.sleep(1300)
    await h.scroll(520, 1300)
    await h.cursorTo('text=How customers reach you', 600)
    await h.sleep(700)
    await h.scroll(560, 1300)
    await h.cursorTo('text=Social links', 600)
    await h.sleep(1200)
  },
  async after(page) {
    if (await page.locator(`${chip} svg`).count()) await page.locator(chip).first().click().catch(() => {})
    await page.waitForTimeout(1500)
  },
}
