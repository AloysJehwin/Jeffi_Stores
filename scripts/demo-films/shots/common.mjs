// Shared setup for the film recordings.
import { ECOM, ADMIN, api, ownerLogin, adminLogin } from '../lib.mjs'

export { ECOM, ADMIN, api, ownerLogin, adminLogin }
export const PAWS = '340c9782-f7da-49ae-ace0-59acec540bab'
export const LUMEN = 'ecf96288-0f30-4769-90ad-ad79134478c3'
export const HALO = 'bb7b7c9c-cd87-4e1f-8c7f-e25cdaa685e7'
export const PAWS_OWNER = 'studio-ui-check@crm.test'
export const LUMEN_OWNER = 'theme-demo@crm.test'
export const HALO_OWNER = 'film-audio@crm.test'

/** Signs the owner in, puts the onboarding draft on a step and opens the wizard there. */
export async function openWizard(page, email, step, stepId) {
  await ownerLogin(page, email)
  const draft = (await api(page, '/api/ecom/onboard/draft')).json?.draft
  const saved = await api(page, '/api/ecom/onboard/draft', { step, data: { ...(draft?.data ?? {}), stepId } })
  if (saved.status !== 200) throw new Error(`draft ${saved.status}`)
  await page.goto(`${ECOM}/onboard`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByRole('button', { name: /Online store/ }).click({ timeout: 60000 })
  await page.getByRole('button', { name: /^Continue$/ }).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(3000)
}

/** Scrolls until the h1/h2 starting with `text` sits `offset` px below the top of the window, wherever the theme put it. */
export async function toHeading(page, h, text, offset, ms) {
  const by = await page.evaluate(([t, o]) => {
    const el = [...document.querySelectorAll('h1, h2')].find(e => e.textContent.trim().startsWith(t))
    return el ? Math.round(el.getBoundingClientRect().top - o) : null
  }, [text, offset])
  if (by === null) throw new Error(`no heading "${text}"`)
  await h.scroll(by, ms)
}

/** Compiles studio preview routes ahead of filming (dev server). */
export async function warm(page, session, keys, surface = 'web') {
  for (const k of keys) await page.request.get(`${ECOM}/onboard/studio/preview/${session}/${k}?surface=${surface}&preview=1`, { timeout: 180000 }).catch(() => {})
}

export const PAGES = ['home', 'products', 'category', 'brand', 'search', 'product', 'cart', 'checkout', 'about', 'contact', 'categories', 'brands', 'wishlist', 'account', 'login']
