// Admin a2: the product list with stock.
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/products`, 2500)
    await page.getByRole('tab', { name: /^Products/ }).first().click()
    await page.waitForSelector('tbody tr', { timeout: 30000 })
    await page.waitForTimeout(2500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo('tbody tr >> nth=0', 800)
    await h.sleep(400)
    await h.cursorTo('tbody tr >> nth=2', 500)
    await h.sleep(400)
    await h.cursorTo('tbody tr >> nth=4', 500)
    await h.sleep(500)
    await h.wheel(600, 1600, [900, 640])
    await h.sleep(1200)
  },
}
