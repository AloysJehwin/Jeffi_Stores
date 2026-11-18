// Overview o5 / storefront s5: drag a section, then ask the AI for a change (not sent).
import { api, openWizard, warm, HALO, HALO_OWNER } from './common.mjs'

// Halo's home sections: Opening picture, Shop by category, Brands we carry, New this week, Offers on now, Featured
// collection, Shoppers say, Stay in touch. New this week goes up to second place, then back between Brands and Offers.
const handle = label => `[aria-label="Drag to move ${label}"]`
export default {
  viewport: { width: 1536, height: 960 },
  async before(page) {
    await openWizard(page, HALO_OWNER, 2, 'site')
    await warm(page, HALO, ['home'])
    await page.evaluate(() => window.scrollTo(0, 260))
    await page.waitForTimeout(2500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.drag(handle('New this week'), handle('Shop by category'), { ms: 1300 })
    await h.sleep(2200)
    await h.click('button:has-text("Change a section")', 800)
    await h.sleep(700)
    await h.click('text="New this week"', 700)
    await h.sleep(800)
    await h.type('#studio-tweak', 'Put the new arrivals on a frosted mint glass band', 16)
    await h.sleep(1500)
  },
  async after(page, h) {
    await page.locator('[aria-label="Cancel"]').first().click().catch(() => {})
    await page.waitForTimeout(800)
    await h.drag(handle('New this week'), handle('Brands we carry'), { ms: 900 }).catch(() => {})
    await page.waitForTimeout(2000)
    // A drop that missed is put right through the studio's own move. Only the moved section's neighbours are checked.
    const sections = async () => (await api(page, '/api/ecom/onboard/studio')).json?.session?.pages?.['store:home']?.sections ?? []
    const back = list => {
      const i = list.findIndex(x => x.label === 'New this week')
      return i > 0 && list[i - 1].label === 'Brands we carry' && list[i + 1]?.label === 'Offers on now'
    }
    let now = await sections()
    if (!back(now)) {
      const id = label => now.find(x => x.label === label)?.id
      await api(page, '/api/ecom/onboard/studio/edit', { page: 'store:home', op: 'move', blockId: id('New this week'), before: id('Offers on now') })
      now = await sections()
    }
    if (!back(now)) throw new Error(`Halo home order not restored: ${now.map(x => x.label).join(' / ')}`)
  },
}
