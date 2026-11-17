// Campaigns c2: who to reach: the built-in scenarios.
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
    await h.cursorTo('[role=tab]:has-text("Scenarios")', 800)
    await h.click(null)
    await page.getByRole('tab', { name: 'Scenarios' }).first().click().catch(() => {})
    await h.sleep(1800)
    await h.cursorTo([300, 262], 700)
    await h.sleep(600)
    await h.wheel(520, 1500, [900, 600])
    await h.sleep(600)
    await h.wheel(620, 1600)
    await h.sleep(600)
    await h.wheel(700, 1600)
    await h.sleep(900)
  },
}
