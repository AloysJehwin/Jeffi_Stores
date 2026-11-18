// Shared helpers for the film recordings (local dev only): sign a test owner or the film admin in inside the current
// browser context (sessions are bound to the browser that signed in), and call the app's APIs from the page.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ECOM = process.env.FILMS_ECOM_URL || 'http://ecom.localhost:3000'
export const ADMIN = process.env.FILMS_ADMIN_URL || 'http://localhost:3000'
export const FILM_ADMIN = process.env.FILMS_ADMIN_EMAIL || 'demo-films@crm.test'
/** Local-only files (mask dictionary, the film admin's two-factor secret); ignored by git. */
export const LOCAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '.local')
const sleep = ms => new Promise(r => setTimeout(r, ms))

export const api = (page, path, body, method = body ? 'POST' : 'GET') =>
  page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    const t = await r.text()
    let json = null
    try { json = JSON.parse(t) } catch {}
    return { status: r.status, json, text: t.slice(0, 300) }
  }, [path, body, method])

// Email sign-in codes land in local Redis as otp:<email>.
function codeFor(email) {
  for (let i = 0; i < 25; i++) {
    const raw = execFileSync('redis-cli', ['GET', `otp:${email}`]).toString().trim()
    if (/^\d{6}$/.test(raw)) return raw
    execFileSync('sleep', ['0.4'])
  }
  throw new Error(`no code for ${email}`)
}
const clearOtp = email => execFileSync('redis-cli', ['DEL', `otp:${email}`, `otp:lastSend:${email}`, `otp:sendCount:${email}`, `otp:attempts:${email}`])

/** Owner sign-in through the real API from inside the page. */
export async function ownerLogin(page, email) {
  await page.goto(`${ECOM}/signin`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await sleep(1500)
  clearOtp(email)
  const s = await api(page, '/api/ecom/auth/send-otp', { email })
  if (s.status !== 200) throw new Error(`send-otp ${s.status} ${s.text}`)
  const v = await api(page, '/api/ecom/auth/verify-otp', { email, otp: codeFor(email), code: codeFor(email) })
  if (v.status !== 200) throw new Error(`verify-otp ${v.status} ${v.text}`)
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s|=/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0')
}

// A code typed in the last seconds of its 30 s window can expire on the way; wait for the next one.
async function freshWindow() {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30)
  if (left < 6) await sleep((left + 1) * 1000)
}

const secretFile = path.join(LOCAL, 'admin.json')

/** The film admin (node setup.mjs admin) through the real login form. Its first sign-in enrols two-factor and keeps
 *  the shown secret in .local/admin.json for the next ones. */
export async function adminLogin(page, email = FILM_ADMIN) {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle', timeout: 120000 })
  clearOtp(email)
  await page.fill('input[type=email]', email)
  await page.click('button[type=submit]')
  await page.waitForSelector('input[placeholder="000000"]', { timeout: 30000 })
  await page.fill('input[placeholder="000000"]', codeFor(email))
  await page.click('button[type=submit]')
  const enrol = page.locator('#enroll_code')
  const verify = page.getByRole('button', { name: 'Verify and Continue' })
  await enrol.or(verify).first().waitFor({ timeout: 30000 })
  if (await enrol.isVisible()) {
    const secret = (await page.locator('p:has-text("Enter this secret manually") span.font-mono').first().textContent()).trim()
    fs.mkdirSync(LOCAL, { recursive: true })
    fs.writeFileSync(secretFile, JSON.stringify({ email, secret }))
    await freshWindow()
    await enrol.fill(totp(secret))
    await page.getByRole('button', { name: 'Confirm and Finish Setup' }).click()
    await page.getByRole('button', { name: /continue to dashboard/ }).click({ timeout: 30000 })
  } else {
    const saved = fs.existsSync(secretFile) ? JSON.parse(fs.readFileSync(secretFile, 'utf8')) : null
    if (saved?.email !== email) throw new Error(`no two-factor secret for ${email}: run "node setup.mjs cleanup" then "node setup.mjs admin"`)
    await freshWindow()
    await page.locator('input[placeholder="000000"]:visible').first().fill(totp(saved.secret))
    await verify.click()
  }
  await page.waitForURL(u => !String(u).includes('/admin/login'), { timeout: 30000 })
}
