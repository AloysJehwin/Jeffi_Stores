// Viewport screenshots of the AI-built Paws & Co pages for the storefront film's page grid, into stills/.
// Usage: node stills.mjs home categories category brand product search cart checkout wishlist
import fs from 'node:fs'
import * as pw from '@playwright/test'
import { ECOM, ownerLogin } from './lib.mjs'
import { HIDE_DEV } from './mask.mjs'
import { PAWS, PAWS_OWNER } from './shots/common.mjs'

const pages = process.argv.slice(2)
fs.mkdirSync('stills', { recursive: true })
const b = await pw.chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(HIDE_DEV)
const page = await ctx.newPage()
await ownerLogin(page, PAWS_OWNER)
for (const p of pages) {
  await page.goto(`${ECOM}/onboard/studio/preview/${PAWS}/${p}?surface=web&preview=1`, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `stills/paws-${p}.jpg`, type: 'jpeg', quality: 88 })
  console.log('shot', p)
}
await b.close()
