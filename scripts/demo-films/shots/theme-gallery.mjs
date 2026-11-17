// Overview o4: pick a ready-made theme and the store wears it at once.
import { openWizard, warm, LUMEN, LUMEN_OWNER } from './common.mjs'

const swatch = name => `[aria-label='${name}'], button[title='${name}']`
export default {
  viewport: { width: 1536, height: 960 },
  acceptDialogs: true,
  async before(page) {
    await openWizard(page, LUMEN_OWNER, 2, 'site')
    await warm(page, LUMEN, ['home'])
    await page.evaluate(() => window.scrollTo(0, 150))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.click('button:has-text("Change theme")', 800)
    await h.sleep(1300)
    await h.cursorTo(swatch('Ocean'), 700)
    await h.sleep(400)
    await h.click(swatch('Cobalt'), 800)
    await h.sleep(900)
    await h.click(swatch('Safety Orange'), 500)
    await h.sleep(700)
    await h.click('button:has-text("Use this theme") >> nth=1', 800)
    await h.sleep(3800)
  },
  async after(page) {
    await page.locator('button:has-text("Change theme")').first().click()
    await page.waitForTimeout(1500)
    await page.locator(swatch('Sage')).first().click()
    await page.waitForTimeout(600)
    await page.locator('button:has-text("Use this theme") >> nth=0').click()
    await page.waitForTimeout(3000)
  },
}
