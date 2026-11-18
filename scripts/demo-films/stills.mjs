// Viewport screenshots of a test store's studio pages for the storefront film's page grid, into stills/<store>-<page>.jpg.
// Usage: node stills.mjs home categories category brand product search cart checkout wishlist
// The store is Halo Audio unless FILMS_STORE says paws or lumen.
import fs from 'node:fs'
import * as pw from '@playwright/test'
import { ECOM, ownerLogin } from './lib.mjs'
import { HIDE_DEV } from './mask.mjs'
import { HALO, HALO_OWNER, LUMEN, LUMEN_OWNER, PAWS, PAWS_OWNER } from './shots/common.mjs'

const STORES = { halo: [HALO, HALO_OWNER], paws: [PAWS, PAWS_OWNER], lumen: [LUMEN, LUMEN_OWNER] }
const store = process.env.FILMS_STORE || 'halo'
if (!STORES[store]) throw new Error(`FILMS_STORE must be one of: ${Object.keys(STORES).join(', ')}`)
const [session, owner] = STORES[store]
const pages = process.argv.slice(2)
fs.mkdirSync('stills', { recursive: true })
const b = await pw.chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(HIDE_DEV)
const page = await ctx.newPage()
await ownerLogin(page, owner)
for (const p of pages) {
  await page.goto(`${ECOM}/onboard/studio/preview/${session}/${p}?surface=web&preview=1`, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `stills/${store}-${p}.jpg`, type: 'jpeg', quality: 88 })
  console.log('shot', p)
}
await b.close()
