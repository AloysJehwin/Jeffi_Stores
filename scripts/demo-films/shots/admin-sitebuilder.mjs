// Admin a5: the site builder: redesign styles (nothing is generated).
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/settings/site-builder`, 3000)
  },
  async run(page, h) {
    await h.sleep(500)
    for (const name of ['Minimalist', 'Brutalist', 'Editorial', 'Luxury', 'Playful', 'Glass']) {
      await h.cursorTo(`text="${name}"`, 500)
      await h.sleep(250)
    }
    await h.click('text="Brutalist"', 600)
    await h.sleep(900)
    await h.cursorTo('button:has-text("New colours")', 700)
    await h.sleep(500)
    await h.cursorTo('button:has-text("Redesign my site")', 700)
    await h.sleep(1500)
  },
}
