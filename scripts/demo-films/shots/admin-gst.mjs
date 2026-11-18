// Admin a4: GST invoices and returns, kept up to date (this quarter).
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/gst`, 2500)
    await page.getByText('This Quarter', { exact: true }).first().click()
    await page.waitForTimeout(1200)
    await page.getByText('Fetch Report', { exact: true }).first().click()
    await page.waitForSelector('tbody tr', { timeout: 30000 })
    await page.waitForTimeout(2000)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo([350, 265], 800)
    await h.sleep(400)
    await h.cursorTo([560, 265], 500)
    await h.sleep(400)
    await h.cursorTo([1200, 265], 600)
    await h.sleep(500)
    await h.cursorTo('tbody tr >> nth=0', 700)
    await h.sleep(350)
    await h.cursorTo('tbody tr >> nth=2', 450)
    await h.sleep(350)
    await h.cursorTo('tbody tr >> nth=4', 450)
    await h.sleep(500)
    await h.wheel(480, 1500, [900, 650])
    await h.sleep(1300)
  },
}
