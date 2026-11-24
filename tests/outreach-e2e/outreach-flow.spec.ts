// Outreach, end to end on a local stack (docs/OUTREACH_E2E.md, part B): CSV import -> test mode -> the worker dials ->
// the simulated owner goes through the happy path -> the tools build and publish the site -> the captured WhatsApp
// links -> the preview page -> claim on ecom with an email OTP -> the site in the owner's workspace on a trial.
// A step skips with its reason when something it needs isn't running locally; anything that runs and misbehaves fails.
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  ADMIN, CONTROLLER, ECOM, PROGRAM, Skip, TEST_PHONE, adminApi, capturedWhatsApp, closeDb, contactByPhone, csv, db,
  linksFrom, needs, ownerLogin, poll, reachable, resetTestContact, runWorker, setVoiceProvider, startVoiceSim,
  voiceProvider, type VoiceSim,
} from './helpers'

const RUN = Date.now().toString(36)
const BUSINESS = 'Sri Lakshmi Sweets'
const OWNER_EMAIL = `outreach-e2e-${RUN}@jeffi.test`

test.describe.configure({ mode: 'serial' })

let admin: APIRequestContext
let settings: APIRequestContext | null = null
let sim: VoiceSim | null = null
const restore: { program?: { enabled: boolean; test_numbers: string[] }; provider?: string | null } = {}
const state: { contactId?: string; callId?: string; preview?: string; claim?: string; siteId?: string } = {}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await test.step(name, async () => {
    try {
      await fn()
    } catch (e) {
      if (e instanceof Skip) test.skip(true, `${name}: ${e.message}`)
      throw e
    }
  })
}

test.beforeAll(async () => {
  test.skip(!!process.env.OUTREACH_E2E_SETUP_SKIPPED, process.env.OUTREACH_E2E_SETUP_SKIPPED || '')
  test.skip(!(await reachable(`${CONTROLLER}/`)), `controller not running at ${CONTROLLER}`)
  admin = await adminApi(CONTROLLER)
  if (await reachable(`${ADMIN}/`)) settings = await adminApi(ADMIN)
})

test.afterAll(async () => {
  await sim?.stop()
  if (restore.program) await admin.patch('/api/admin/ecom/outreach/program', { data: { program: PROGRAM, ...restore.program } })
  if (settings && restore.provider !== undefined) await setVoiceProvider(settings, restore.provider)
  await settings?.dispose()
  await admin?.dispose()
  await closeDb()
})

test('a lead goes from CSV to a claimed Showcase site with a trial', async ({ page }) => {
  await step('the program is in test mode: twilio_test provider, the test number listed, enabled', async () => {
    const r = await admin.get(`/api/admin/ecom/outreach/program?program=${PROGRAM}`)
    expect(r.status(), await r.text()).toBe(200)
    const before = (await r.json()).state
    restore.program = { enabled: !!before.enabled, test_numbers: before.test_numbers ?? [] }
    const p = await admin.patch('/api/admin/ecom/outreach/program', { data: { program: PROGRAM, enabled: true, test_numbers: [TEST_PHONE] } })
    expect(p.status(), await p.text()).toBe(200)
    const provider = await voiceProvider()
    if (provider !== 'twilio_test') {
      needs(settings, `admin-service not running at ${ADMIN}: can't switch the voice provider to twilio_test`)
      restore.provider = provider
      expect(await setVoiceProvider(settings, 'twilio_test')).toBe(200)
    }
    expect(await voiceProvider()).toBe('twilio_test')
  })

  await step('a CSV of leads imports into a list as a queued contact', async () => {
    await resetTestContact(TEST_PHONE)
    // No dnd_status column: unknown DND, which the dialler skips for real leads; test numbers are exempt in test mode.
    const file = csv([{ business_name: BUSINESS, phone: TEST_PHONE, source: 'e2e-test', owner_name: 'Ramesh', category: 'sweet shop', city: 'Madurai', language: 'en' }])
    const r = await admin.post('/api/admin/ecom/outreach/lists', {
      multipart: { name: `e2e ${RUN}`, program: PROGRAM, file: { name: 'leads.csv', mimeType: 'text/csv', buffer: file } },
    })
    expect(r.status(), await r.text()).toBe(201)
    const c = await contactByPhone(TEST_PHONE)
    expect(c, 'the contact row').toBeTruthy()
    expect(c!.status).toBe('queued')
    state.contactId = String(c!.id)
  })

  await step('voice-service and the simulated phone network are up', async () => {
    sim = await startVoiceSim()
    expect(await reachable(`${sim.voiceUrl}/healthz`)).toBe(true)
  })

  await step('the worker dials the lead (the test-call API outside the calling window)', async () => {
    const w = await runWorker()
    needs(w.status !== 401, 'CRON_SECRET in .env.local does not match the controller')
    expect(w.status, JSON.stringify(w.body)).toBe(200)
    needs(w.body.skipped !== 'not_configured', 'the controller has no VOICE_SERVICE_URL (set it to the simulator, http://127.0.0.1:8095)')
    expect(w.body.testMode, 'worker in test mode').toBe(true)
    const run = (w.body.programs ?? []).find((p: { program: string }) => p.program === PROGRAM)
    if (run?.skipped === 'outside_window') {
      test.info().annotations.push({ type: 'note', description: 'outside 09:30-20:30 IST: placed through the test-call API instead' })
      const r = await admin.post('/api/admin/ecom/outreach/test-call', { data: { phone: TEST_PHONE, language: 'en' } })
      expect(r.status(), await r.text()).toBe(200)
      state.callId = String((await r.json()).callId)
    } else {
      expect(run, JSON.stringify(w.body)).toMatchObject({ placed: 1 })
      state.callId = String((await contactByPhone(TEST_PHONE))!.last_call_id)
    }
    await poll('the simulator to receive the call', async () => (await sim!.calls()).find(c => c.callId === state.callId), 30_000)
  })

  await step('the owner answers and goes through the happy path', async () => {
    const done = await poll('the call to finish', async () => (await sim!.calls()).find(c => c.callId === state.callId && c.done), 8 * 60_000, 3000)
    expect(done.said).toEqual(expect.arrayContaining(['owner', 'consent', 'details', 'publish']))
    const detail = await poll('the call row to be final', async () => {
      const r = await admin.get(`/api/admin/ecom/outreach/calls/${state.callId}`)
      expect(r.status()).toBe(200)
      const j = await r.json()
      return j.call?.ended_at ? j : null
    }, 90_000)
    expect(detail.call.status).toBe('completed')
    expect(JSON.stringify(detail.call.transcript)).toMatch(/recorded/i)
    expect(detail.call.consent, 'consent evidence on the call').toBeTruthy()
    expect(detail.events.length).toBeGreaterThan(0)
  })

  await step('the tools built and published the site', async () => {
    const c = await poll('the contact to be published', async () => {
      const row = await contactByPhone(TEST_PHONE)
      return row && ['published', 'claimed'].includes(String(row.status)) ? row : null
    }, 5 * 60_000, 3000)
    expect(c.showcase_site_id, 'a Showcase site attached to the contact').toBeTruthy()
    state.siteId = String(c.showcase_site_id)
  })

  await step('WhatsApp capture mode holds the preview and claim links', async () => {
    const msgs = await poll('captured WhatsApp messages', async () => {
      const m = capturedWhatsApp(state.contactId!)
      const l = linksFrom(m)
      return l.preview && l.claim ? m : null
    }, 60_000)
    const slugs = msgs.map(m => m.template)
    expect(slugs).toEqual(expect.arrayContaining(['preview_ready']))
    const links = linksFrom(msgs)
    state.preview = links.preview
    state.claim = links.claim
  })

  await step('the preview page renders, noindex, with the post-publish banner', async () => {
    const res = await page.goto(state.preview!)
    expect(res?.status()).toBe(200)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByText(BUSINESS).first()).toBeVisible()
    await expect(page.getByText(/go to your live site/i).first()).toBeVisible({ timeout: 30_000 })
  })

  await step('the owner claims the site on ecom with an email OTP', async () => {
    await ownerLogin(page, OWNER_EMAIL)
    await page.goto(state.claim!.replace(/^https?:\/\/[^/]+/, ECOM))
    await page.waitForURL(/\/dashboard\/showcase\//, { timeout: 60_000 })
    expect(page.url()).toContain(`/dashboard/showcase/${state.siteId}`)
  })

  await step('the site is in the owner\'s workspace on a trial', async () => {
    await expect(page.getByText(/trial/i).first()).toBeVisible({ timeout: 30_000 })
    const c = await contactByPhone(TEST_PHONE)
    expect(c!.status).toBe('claimed')
    expect(c!.claimed_owner_id).toBeTruthy()
    const site = await db().query(`SELECT owner_id FROM showcase_sites WHERE id = $1`, [state.siteId])
    expect(String(site.rows[0]?.owner_id)).toBe(String(c!.claimed_owner_id))
  })
})
