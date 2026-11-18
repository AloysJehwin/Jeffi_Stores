// Landing check on the local dev server: the four films load, play muted, and only one plays with sound.
// --local serves the films from out/ in place of the CDN, to check new renders before uploading.
// Usage: node check-landing.mjs [--local]   (screenshots in qa/)
import fs from 'node:fs'
import path from 'node:path'
import * as pw from '@playwright/test'
import { ECOM } from './lib.mjs'

const local = process.argv.includes('--local')
const types = { mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg' }
fs.mkdirSync('qa', { recursive: true })
const b = await pw.chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const films = []
await ctx.route(/\/marketing\/demo\/v\d+\//, async route => {
  const name = route.request().url().split('/').pop()
  films.push(name)
  if (!local) return route.continue()
  const file = path.resolve('out', name)
  if (!fs.existsSync(file)) return route.fulfill({ status: 404 })
  await route.fulfill({ status: 200, path: file, headers: { 'content-type': types[name.split('.').pop()] ?? 'application/octet-stream' } })
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
await page.goto(`${ECOM}/`, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {})
await page.waitForTimeout(8000)
const state = () => page.evaluate(() => [...document.querySelectorAll('video')].map(v => ({
  film: v.getAttribute('aria-label'), src: v.currentSrc.split('/').pop(), playing: !v.paused, muted: v.muted, t: +v.currentTime.toFixed(1), error: v.error?.code ?? null,
})))
console.log('initial', JSON.stringify(await state()))
await page.screenshot({ path: 'qa/landing-hero.jpg', type: 'jpeg', quality: 75 })
await page.getByRole('button', { name: /with sound/i }).first().click()
await page.waitForTimeout(2000)
console.log('hero with sound', JSON.stringify((await state()).map(v => [v.film, v.muted ? 'muted' : 'SOUND'])))
await page.evaluate(() => document.querySelectorAll('video')[1]?.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(4000)
await page.getByRole('button', { name: /^Play .* with sound$/ }).nth(1).click()
await page.waitForTimeout(2500)
console.log('row film with sound', JSON.stringify((await state()).map(v => [v.film, v.muted ? 'muted' : 'SOUND'])))
await page.screenshot({ path: 'qa/landing-row.jpg', type: 'jpeg', quality: 75 })
console.log('films requested', [...new Set(films)].join(' ') || 'none (is the hero showing the films?)')
console.log('errors', JSON.stringify(errors.slice(0, 6)))
await b.close()
