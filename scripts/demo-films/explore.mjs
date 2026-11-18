// Walks a page and runs actions, for finding selectors when a shot breaks. Admin pages are masked.
// Usage: node explore.mjs admin /admin/orders click:"All orders" shot:orders buttons
//        node explore.mjs owner:theme-demo@crm.test /onboard/showcase scroll:600 shot:showcase
// Actions: click:<text | css=selector>  shot:<name> (qa/<name>.jpg)  wait:<ms>  scroll:<px>  goto:<path>  buttons
import fs from 'node:fs'
import * as pw from '@playwright/test'
import { ADMIN, ECOM, adminLogin, ownerLogin } from './lib.mjs'
import { maskScript, HIDE_DEV } from './mask.mjs'

const [, , who, start, ...actions] = process.argv
const asAdmin = who === 'admin'
const base = asAdmin ? ADMIN : ECOM
fs.mkdirSync('qa', { recursive: true })
const browser = await pw.chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } })
if (asAdmin) await ctx.addInitScript(maskScript())
await ctx.addInitScript(HIDE_DEV)
const page = await ctx.newPage()
page.on('dialog', d => { console.log('DIALOG', d.message().slice(0, 100)); d.dismiss() })
if (asAdmin) await adminLogin(page)
else await ownerLogin(page, who.replace(/^owner:/, ''))
await page.goto(base + start, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {})
await page.waitForTimeout(2000)
for (const a of actions) {
  const [kind, ...rest] = a.split(':')
  const arg = rest.join(':')
  try {
    if (kind === 'click') {
      const loc = arg.startsWith('css=') ? page.locator(arg.slice(4)).first() : page.getByText(arg, { exact: true }).first()
      await loc.click({ timeout: 15000 })
      await page.waitForTimeout(2000)
    } else if (kind === 'shot') await page.screenshot({ path: `qa/${arg}.jpg`, type: 'jpeg', quality: 70 })
    else if (kind === 'wait') await page.waitForTimeout(Number(arg))
    else if (kind === 'scroll') { await page.mouse.move(900, 600); await page.mouse.wheel(0, Number(arg)); await page.waitForTimeout(800) }
    else if (kind === 'goto') { await page.goto(base + arg, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {}); await page.waitForTimeout(2000) }
    else if (kind === 'buttons') console.log(JSON.stringify([...new Set(await page.$$eval('button, a, [role=button], [role=tab]', els => els.filter(e => e.offsetParent).map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean)))].slice(0, 150)))
    console.log('ok', a)
  } catch (e) { console.log('FAIL', a, String(e).split('\n')[0].slice(0, 140)) }
}
await browser.close()
