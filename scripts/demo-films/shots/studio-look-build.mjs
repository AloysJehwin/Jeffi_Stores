// Overview o3: the cursor passes over the five ready-made styles (none is applied), then the built Halo Audio site
// page by page. No AI runs: Halo wears the Glass · Mint theme.
import { openWizard, warm, HALO, HALO_OWNER, PAGES } from './common.mjs'

const STYLES = ['Minimalist', 'Brutalist', 'Glass', 'Luxury', 'Playful']
// Waits out the preview's "Loading preview…" cover, so every page stays on screen as long, however slowly it loads.
async function loaded(page) {
  const loading = page.getByText('Loading preview').first()
  await loading.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  await loading.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
export default {
  viewport: { width: 1536, height: 960 },
  scale: 1.5,
  async before(page) {
    await openWizard(page, HALO_OWNER, 2, 'site')
    await warm(page, HALO, PAGES)
    await page.evaluate(() => window.scrollTo(0, 150))
    await page.waitForTimeout(1500)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.click('button:has-text("Change theme")', 800)
    await h.sleep(1300)
    for (const name of STYLES) {
      const b = await h.box(`ul[aria-label="Themes"] > li:has(h4:text-is("${name}"))`)
      await h.cursorTo([b.x + b.width / 2, b.y + 90], 650)
      await h.sleep(500)
    }
    await h.click('button:has-text("Back to your site")', 800)
    await loaded(page)
    await h.sleep(900)
    for (const label of ['Category pages', 'Product page', 'Cart', 'Checkout']) {
      await h.click(`nav[aria-label="Pages"] >> text="${label}"`, 600)
      await loaded(page)
      await h.sleep(1300)
    }
  },
}
