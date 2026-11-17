// Overview o5 / storefront s5: drag a section, then ask the AI for a change (not sent).
import { openWizard, warm, PAWS, PAWS_OWNER } from './common.mjs'

const handle = label => `[aria-label="Drag to move ${label}"]`
export default {
  viewport: { width: 1536, height: 960 },
  async before(page) {
    await openWizard(page, PAWS_OWNER, 2, 'site')
    await warm(page, PAWS, ['home'])
    await page.evaluate(() => window.scrollTo(0, 260))
    await page.waitForTimeout(2500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.drag(handle('Bestsellers this week'), handle('Shop by need'), { ms: 1300 })
    await h.sleep(2200)
    await h.click('button:has-text("Change a section")', 800)
    await h.sleep(700)
    await h.click('text="Bestsellers this week"', 700)
    await h.sleep(800)
    await h.type('textarea', 'Make the bestsellers pop on a hot pink band', 16)
    await h.sleep(1500)
  },
  async after(page, h) {
    await page.locator('[aria-label="Cancel"]').first().click().catch(() => {})
    await page.waitForTimeout(800)
    await h.drag(handle('Bestsellers this week'), handle('Coupons and bandana'), { ms: 900 })
    await page.waitForTimeout(2000)
  },
}
