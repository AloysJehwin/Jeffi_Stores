// Admin a2 / overview o7: every order as it comes in. Customer details are masked; the page starts scrolled to the
// list so the store's revenue totals stay out of shot.
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/orders`, 2500)
    await page.getByRole('tab', { name: 'All orders' }).first().click()
    await page.waitForSelector('tbody tr', { timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.mouse.move(900, 700)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 85); await page.waitForTimeout(60) }
    await page.waitForTimeout(1200)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo('tbody tr >> nth=0', 800)
    await h.sleep(450)
    await h.cursorTo('tbody tr >> nth=2', 500)
    await h.sleep(400)
    await h.cursorTo('tbody tr >> nth=4', 500)
    await h.sleep(500)
    await h.wheel(520, 1500, [900, 650])
    await h.sleep(500)
    await h.cursorTo('tbody tr >> nth=9', 600)
    await h.sleep(1000)
  },
}
