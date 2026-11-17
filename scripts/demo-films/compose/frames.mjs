// Renders chosen moments of a timeline to JPEGs for a layout check. Usage: node frames.mjs <timeline.json> <outPrefix> t1 t2 ...
import * as pw from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [, , tl, prefix, ...times] = process.argv
const film = JSON.parse(fs.readFileSync(tl, 'utf8'))
const b = await pw.chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] })
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto('file://' + path.join(here, 'stage.html'))
await page.evaluate(f => window.setup(f), film)
for (const t of times) {
  await page.evaluate(x => window.renderAt(x), Number(t))
  await page.screenshot({ path: `${prefix}-${t}.jpg`, type: 'jpeg', quality: 80 })
}
await b.close()
console.log('frames', times.join(' '))
