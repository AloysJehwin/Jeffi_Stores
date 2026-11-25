// Helpers for the outreach flow test, on the controller's real routes and readers (wave 2–3). A piece that isn't
// running or configured locally makes the spec skip with the reason; a piece that is there and misbehaves fails it.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { request, type APIRequestContext, type Page } from '@playwright/test'
import pg from 'pg'
import { storageStatePath } from '../ui-kit/session'

export const CONTROLLER = (process.env.OUTREACH_E2E_CONTROLLER_URL || 'http://localhost:3013').replace(/\/$/, '')
export const ADMIN = (process.env.OUTREACH_E2E_ADMIN_URL || 'http://localhost:3011').replace(/\/$/, '')
export const ECOM = (process.env.OUTREACH_E2E_ECOM_URL || 'http://ecom.localhost:3000').replace(/\/$/, '')
export const VOICE_PORT = Number(process.env.OUTREACH_E2E_VOICE_PORT || 8095)
export const PROGRAM = 'showcase-offer'
// On the program's test list. Nothing is dialled for real: voice-service's calls go to the simulated phone network.
export const TEST_PHONE = process.env.OUTREACH_E2E_TEST_PHONE || '+919000000001'

export class Skip extends Error {}

/** Throws Skip (the spec turns it into test.skip) for a missing piece; never for a broken one. */
export function needs(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Skip(why)
}

export async function adminApi(baseURL: string): Promise<APIRequestContext> {
  const state = storageStatePath('controller')
  needs(fs.existsSync(state), `no admin session (${process.env.OUTREACH_E2E_SETUP_SKIPPED || 'global setup did not run'})`)
  // One platform-admin session serves every localhost app (cookies ignore the port).
  return request.newContext({ baseURL, storageState: state })
}

export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) })
    return true
  } catch {
    return false
  }
}

// ── jeffi_test ──

let pool: pg.Pool | null = null
export function db(): pg.Pool {
  const url = process.env.DATABASE_URL
  needs(url && /test/i.test(new URL(url).pathname), 'DATABASE_URL must point at jeffi_test')
  pool ??= new pg.Pool({ connectionString: url, max: 2 })
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = null
}

export async function contactByPhone(phone: string): Promise<Record<string, unknown> | null> {
  const r = await db().query(`SELECT * FROM outreach_contacts WHERE program = $1 AND phone = $2`, [PROGRAM, phone])
  return r.rows[0] ?? null
}

/** Clears a previous run's contact for the test number (and its suppression), so each run starts from a fresh lead. */
export async function resetTestContact(phone: string): Promise<void> {
  const c = await contactByPhone(phone)
  if (c) {
    for (const t of ['outreach_events', 'outreach_messages', 'outreach_calls']) await db().query(`DELETE FROM ${t} WHERE contact_id = $1`, [c.id])
    await db().query(`DELETE FROM outreach_contacts WHERE id = $1`, [c.id])
  }
  await db().query(`DELETE FROM outreach_suppressions WHERE phone = $1`, [phone])
}

/** The platform's voice provider (Settings > Providers); test mode is `twilio_test`. */
export async function voiceProvider(): Promise<string | null> {
  const r = await db().query(`SELECT value FROM platform_provider_settings WHERE tenant_id IS NULL AND key = 'voice_provider'`)
  const v = r.rows[0]?.value
  return typeof v === 'string' ? v : null
}

export async function setVoiceProvider(admin: APIRequestContext, value: string | null): Promise<number> {
  const r = value === null
    ? await admin.delete(`/api/admin/settings/providers?${new URLSearchParams({ key: 'voice_provider' })}`)
    : await admin.put('/api/admin/settings/providers', { data: { tenantId: null, key: 'voice_provider', value } })
  return r.status()
}

/** The outreach cron's handler (GET /api/cron/outreach-calls, Bearer CRON_SECRET): the cron itself is k8sOnly. */
export async function runWorker(): Promise<{ status: number; body: any }> {
  const secret = process.env.CRON_SECRET
  needs(secret, 'CRON_SECRET is not set (.env.local)')
  const r = await fetch(`${CONTROLLER}/api/cron/outreach-calls`, { headers: { authorization: `Bearer ${secret}` } })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

export interface CapturedWhatsApp {
  contactId: string
  template: string | null
  slug: string | null
  buttonUrl: string | null
  body: string
  at: string
}

function tsxBin(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const bin = path.join(dir, 'node_modules', '.bin', 'tsx')
    if (fs.existsSync(bin)) return bin
    if (path.dirname(dir) === dir) throw new Error('tsx not found: run npm ci')
  }
}

/** What WhatsApp capture mode recorded for the contact, through the controller's readCapturedWhatsApp (outside
 *  production the captured claim message keeps the real link; the event copy is masked). */
export function capturedWhatsApp(contactId: string): CapturedWhatsApp[] {
  const out = execFileSync(tsxBin(), ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', 'tests/outreach-e2e/captured.ts', contactId],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const line = out.trim().split('\n').pop() || '[]'
  return JSON.parse(line)
}

export function linksFrom(msgs: CapturedWhatsApp[]): { preview?: string; claim?: string; live?: string } {
  const urls = msgs.flatMap(m => [m.buttonUrl, ...(m.body.match(/https?:\/\/\S+/g) ?? [])]).filter((u): u is string => !!u)
  return {
    preview: urls.find(u => /\/preview\?t=/.test(u)),
    claim: urls.find(u => /\/claim\/[0-9a-z]+\.[A-Za-z0-9_-]{43}/.test(u)),
    live: urls.find(u => /^https?:\/\/site-/.test(u) && !/\/preview\?/.test(u)),
  }
}

export async function poll<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, everyMs = 1500): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, everyMs))
  }
}

// ── the voice simulator (tests/voice-e2e/run.py serve) ──

export interface VoiceSim {
  proc: ChildProcess
  voiceUrl: string
  phoneUrl: string
  calls(): Promise<Array<{ callId: string; done: boolean; closedBy: string; said: string[]; notes: string[] }>>
  stop(): Promise<void>
}

/** voice-service on VOICE_PORT, pointed at this controller (which must have VOICE_SERVICE_URL=http://127.0.0.1:<port>
 *  and the same SERVICE_AUTH_SECRET), answering every call with the English happy path. */
export async function startVoiceSim(): Promise<VoiceSim> {
  const proc = spawn('python3', [path.join('tests', 'voice-e2e', 'run.py'), 'serve', '--controller-url', CONTROLLER, '--port', String(VOICE_PORT),
    ...(process.env.OUTREACH_E2E_LIVE_KEYS ? ['--live-keys'] : [])], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'] })
  const lines = readline.createInterface({ input: proc.stdout! })
  const ready = await new Promise<{ voiceUrl: string; phoneUrl: string }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('voice simulator did not start in 180 s')), 180_000)
    lines.on('line', l => {
      if (!l.startsWith('{')) return
      try {
        const j = JSON.parse(l)
        if (j.ready) {
          clearTimeout(t)
          resolve(j)
        }
      } catch {}
    })
    proc.on('exit', code => reject(new Error(`voice simulator exited (${code})`)))
  })
  return {
    proc,
    ...ready,
    calls: async () => (await fetch(`${ready.phoneUrl}/__e2e/calls`)).json(),
    stop: async () => {
      if (proc.exitCode !== null) return
      proc.kill('SIGTERM')
      await new Promise(r => proc.once('exit', r))
    },
  }
}

// ── ecom owner ──

/** The repo's local owner sign-in (scripts/demo-films/lib.mjs): writes the email OTP to local Redis, then verifies it. */
export async function ownerLogin(page: Page, email: string): Promise<void> {
  process.env.FILMS_ECOM_URL = ECOM
  const lib = await import('../../scripts/demo-films/lib.mjs')
  await lib.ownerLogin(page, email)
}

export function csv(rows: Array<Record<string, string>>): Buffer {
  const cols = Object.keys(rows[0])
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return Buffer.from([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c] ?? '')).join(','))].join('\n') + '\n')
}
