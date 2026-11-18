// Records a scripted walk through the real app as a constant-rate JPEG sequence (CDP screencast, high resolution),
// with an animated cursor drawn into the page. Usage: node record.mjs <shot.mjs> <outDir>
// A shot module exports { viewport, scale, url, storage?, run(page, h) } where h has cursor/scroll/type helpers.
import * as pw from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { maskScript, HIDE_DEV } from '../mask.mjs'

const { chromium } = pw
const [, , shotPath, outDir] = process.argv
const shot = (await import(pathToFileURL(path.resolve(shotPath)).href)).default
const FPS = 30
fs.mkdirSync(outDir, { recursive: true })
for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f))

const browser = await chromium.launch({ args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
const ctx = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: shot.scale ?? 1.5, isMobile: !!shot.mobile, hasTouch: !!shot.mobile, ignoreHTTPSErrors: true, storageState: shot.storage })
await ctx.addInitScript(HIDE_DEV)
await ctx.addInitScript(() => { try { localStorage.setItem('jeffi:studio-gift-seen', '1') } catch {} })
if (shot.mask) await ctx.addInitScript(maskScript())
for (const s of shot.init ?? []) await ctx.addInitScript(s)
const page = await ctx.newPage()
page.setDefaultTimeout(20000)
// A theme switch asks before replacing the current pages; shots that switch themes say yes.
if (shot.acceptDialogs) page.on('dialog', d => d.accept().catch(() => {}))
page.on('pageerror', e => console.error('pageerror', String(e.message).slice(0, 140)))

const CURSOR = `
(() => {
  if (window.__cur) return
  const c = document.createElement('div')
  c.id = '__cur'
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 11-6.6 1.2L16 21l-2.8 1.3-3.6-6.8L4 20z" fill="#1f1b16" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', transition: 'none', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.25))' })
  const r = document.createElement('div')
  Object.assign(r.style, { position: 'fixed', zIndex: 2147483646, pointerEvents: 'none', width: '44px', height: '44px', margin: '-22px 0 0 -22px', borderRadius: '50%', border: '3px solid rgba(196,106,70,.85)', opacity: '0', transform: 'scale(.4)', transition: 'transform .45s ease-out, opacity .45s ease-out', left: '-100px', top: '-100px' })
  window.__cur = { c, r, x: -100, y: -100 }
  window.__move = (x, y) => { window.__cur.x = x; window.__cur.y = y; c.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; mount() }
  window.__ripple = (x, y) => { r.style.transition = 'none'; r.style.left = x + 'px'; r.style.top = y + 'px'; r.style.opacity = '1'; r.style.transform = 'scale(.4)'; r.offsetWidth; r.style.transition = 'transform .45s ease-out, opacity .45s ease-out'; r.style.transform = 'scale(1.4)'; r.style.opacity = '0' }
  // Mounted into <body> only after the page has hydrated, so React never sees it.
  function mount() { if (!c.isConnected && document.readyState === 'complete' && document.body) document.body.append(c, r) }
  if (document.readyState === 'complete') setTimeout(mount, 200)
  else window.addEventListener('load', () => setTimeout(mount, 400))
})()`

const frames = []
const client = await ctx.newCDPSession(page)
client.on('Page.screencastFrame', async f => {
  frames.push({ t: f.metadata.timestamp, data: f.data })
  await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
let cx = shot.viewport.width / 2
let cy = shot.viewport.height / 2
const h = {
  sleep,
  async cursorTo(target, ms = 700) {
    let x, y
    if (typeof target === 'string') {
      const box = await page.locator(target.includes('>>') ? target : `${target} >> visible=true`).first().boundingBox()
      if (!box) throw new Error(`no box for ${target}`)
      x = box.x + box.width / 2
      y = box.y + box.height / 2
    } else [x, y] = target
    const sx = cx, sy = cy
    const steps = Math.max(8, Math.round(ms / 16))
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps)
      const px = sx + (x - sx) * k
      const py = sy + (y - sy) * k
      await page.evaluate(([a, b]) => window.__move?.(a, b), [px, py])
      await page.mouse.move(px, py)
      await sleep(ms / steps)
    }
    cx = x
    cy = y
  },
  async click(target, ms) {
    if (target) await h.cursorTo(target, ms)
    await page.evaluate(([a, b]) => window.__ripple?.(a, b), [cx, cy])
    await page.mouse.click(cx, cy)
  },
  async type(target, text, cps = 14) {
    await h.click(target)
    for (const ch of text) {
      await page.keyboard.type(ch)
      await sleep(1000 / cps)
    }
  },
  async scroll(by, ms = 1500, el) {
    const steps = Math.max(10, Math.round(ms / 16))
    let done = 0
    for (let i = 1; i <= steps; i++) {
      const target = Math.round(by * ease(i / steps))
      const d = target - done
      done = target
      if (el) await page.locator(el).first().evaluate((n, dd) => n.scrollBy(0, dd), d)
      else await page.evaluate(dd => window.scrollBy(0, dd), d)
      await sleep(ms / steps)
    }
  },
  async box(target) {
    const b = await page.locator(target.includes('>>') ? target : `${target} >> visible=true`).first().boundingBox()
    if (!b) throw new Error(`no box for ${target}`)
    return b
  },
  async drag(from, to, { ms = 1000, dy = 0 } = {}) {
    await h.cursorTo(from, 650)
    await sleep(200)
    await page.mouse.down()
    const b = await h.box(to)
    const tx = b.x + b.width / 2
    const ty = b.y + b.height / 2 + dy
    const sx = cx, sy = cy
    const steps = Math.max(14, Math.round(ms / 16))
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps)
      const px = sx + (tx - sx) * k
      const py = sy + (ty - sy) * k
      await page.evaluate(([a, b]) => window.__move?.(a, b), [px, py])
      await page.mouse.move(px, py)
      await sleep(ms / steps)
    }
    await sleep(300)
    await page.mouse.up()
    cx = tx
    cy = ty
  },
  async wheel(dy, ms = 1200, at) {
    if (at) await h.cursorTo(at, 500)
    const steps = Math.max(10, Math.round(ms / 16))
    let done = 0
    for (let i = 1; i <= steps; i++) {
      const target = Math.round(dy * ease(i / steps))
      await page.mouse.wheel(0, target - done)
      done = target
      await sleep(ms / steps)
    }
  },
  async goto(url, settle = 1200) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
    if (shot.cursor !== false) await page.evaluate(CURSOR)
    await page.evaluate(([a, b]) => window.__move?.(a, b), [cx, cy])
    await sleep(settle)
  },
  page,
}

if (shot.cursor !== false) await page.addInitScript(CURSOR)
if (shot.before) await shot.before(page, h)
await page.evaluate(([a, b]) => window.__move?.(a, b), [cx, cy]).catch(() => {})
if (shot.url) await h.goto(shot.url, shot.settle ?? 1500)
const vw = Math.round(shot.viewport.width * (shot.scale ?? 1.5))
const vh = Math.round(shot.viewport.height * (shot.scale ?? 1.5))
await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vw, maxHeight: vh, everyNthFrame: 1 })
const t0 = Date.now() / 1000
await sleep(400)
await shot.run(page, h)
await sleep(600)
await client.send('Page.stopScreencast')
const t1 = Date.now() / 1000
if (shot.after) await shot.after(page, h).catch(e => console.error('after failed', String(e).slice(0, 160)))
await browser.close()

// Constant frame rate: each output frame takes the newest screencast frame at or before its time.
frames.sort((a, b) => a.t - b.t)
const count = Math.round((t1 - t0) * FPS)
let j = 0
let lastData = frames[0]?.data
for (let i = 0; i < count; i++) {
  const t = t0 + i / FPS
  while (j < frames.length && frames[j].t <= t) lastData = frames[j++].data
  fs.writeFileSync(path.join(outDir, `${String(i + 1).padStart(5, '0')}.jpg`), Buffer.from(lastData, 'base64'))
}
const meta = { fps: FPS, count, width: shot.viewport.width, height: shot.viewport.height, seconds: count / FPS, captured: frames.length }
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta))
console.log(JSON.stringify(meta))
