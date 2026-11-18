// Campaigns c4 / overview o8: results: sends, opens, clicks, per campaign.
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/campaigns`, 2500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo([820, 222], 800)
    await h.click(null)
    await h.sleep(1600)
    await h.cursorTo([560, 297], 600)
    await h.sleep(400)
    await h.cursorTo([773, 297], 500)
    await h.sleep(500)
    await h.cursorTo([670, 740], 700)
    await h.sleep(900)
    await h.cursorTo([388, 166], 700)
    await page.getByRole('tab', { name: 'Campaigns' }).first().click().catch(() => {})
    await page.evaluate(([a, b]) => window.__ripple?.(a, b), [388, 166])
    await h.sleep(1600)
    await h.cursorTo([480, 360], 700)
    await h.sleep(400)
    await h.cursorTo([703, 360], 500)
    await h.sleep(1200)
  },
}
