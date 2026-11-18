// Campaigns c3: one campaign on email, WhatsApp and app push, with its previews.
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/campaigns/abandoned_cart`, 4000)
    await page.waitForTimeout(2000)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo([331, 152], 700)
    await h.sleep(300)
    for (const p of [[523, 152], [592, 152], [681, 152]]) {
      await h.cursorTo(p, 450)
      await h.sleep(300)
    }
    await h.cursorTo([1071, 379], 800)
    await h.sleep(500)
    await h.cursorTo([1060, 501], 500)
    await h.sleep(800)
    await h.wheel(600, 1600, [1200, 620])
    await h.sleep(700)
    await h.wheel(700, 1600)
    await h.sleep(1200)
  },
}
