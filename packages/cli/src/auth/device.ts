// RFC 8628 device authorization, through the store's public API (no client certificate needed):
//   POST {base}/v1/admin/cli-auth/start → { device_code, user_code, verification_uri, interval, expires_in }
//   POST {base}/v1/admin/cli-auth/poll  → { access_token: 'jfc_…' } or { error: authorization_pending | slow_down | access_denied | expired_token }
// verification_uri is on the store's admin host. With --direct the same calls go to {adminHost}/api/admin/cli-auth/*.
import { spawn } from 'node:child_process'
import { fetch, type Dispatcher } from 'undici'
import { CLI_VERSION, CliError } from '../util'

export const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
export const CLIENT_ID = 'jeffi-cli'

export interface DeviceStart {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  interval?: number
  expires_in?: number
}

export interface DeviceToken {
  token: string
  expiresAt: string | null
  scopes?: string[]
}

export interface DeviceDeps {
  dispatcher?: Dispatcher
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface StartOptions {
  scopes?: string
  ttl?: string
  name?: string
}

async function post(url: string, body: Record<string, unknown>, deps: DeviceDeps): Promise<{ status: number; data: Record<string, unknown> }> {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-jeffi-cli': CLI_VERSION },
      body: JSON.stringify(body),
      dispatcher: deps.dispatcher,
    })
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause
    throw new CliError(`Can't reach ${new URL(url).origin}: ${cause?.code || (e as Error).message}`)
  }
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { error: 'invalid_response', error_description: text.slice(0, 200) }
  }
  return { status: res.status, data }
}

/** The cli-auth endpoints: the public API's /v1/admin/cli-auth, or the admin host's /api/admin/cli-auth with --direct. */
export function deviceEndpoint(ctx: { base: string; adminBase: string; direct: boolean }): string {
  return ctx.direct ? `${ctx.adminBase}/api/admin/cli-auth` : `${ctx.base}/v1/admin/cli-auth`
}

export async function startDevice(endpoint: string, opts: StartOptions, deps: DeviceDeps = {}): Promise<DeviceStart> {
  const { status, data } = await post(`${endpoint}/start`, {
    client_id: CLIENT_ID,
    client_name: opts.name || `jeffi CLI ${CLI_VERSION}`,
    ...(opts.scopes ? { scope: opts.scopes } : {}),
    ...(opts.ttl ? { ttl: opts.ttl } : {}),
  }, deps)
  if (status >= 400 || typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
    const why = String(data.error_description ?? data.error ?? `HTTP ${status}`)
    throw new CliError(status === 404 ? `No CLI login at ${new URL(endpoint).origin}: ${why}` : `Couldn't start the login: ${why}`)
  }
  return data as unknown as DeviceStart
}

export async function pollDevice(endpoint: string, start: DeviceStart, deps: DeviceDeps = {}): Promise<DeviceToken> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  let interval = Math.max(1, Number(start.interval) || 5)
  const deadline = now() + (Number(start.expires_in) || 600) * 1000
  for (;;) {
    await sleep(interval * 1000)
    if (now() > deadline) throw new CliError('The login code expired. Run jeffi login again.')
    const { status, data } = await post(`${endpoint}/poll`, { grant_type: GRANT_TYPE, device_code: start.device_code, client_id: CLIENT_ID }, deps)
    const token = data.access_token ?? data.token
    if (typeof token === 'string' && token) {
      const expiresAt = typeof data.expires_at === 'string' ? data.expires_at : typeof data.expires_in === 'number' ? new Date(now() + data.expires_in * 1000).toISOString() : null
      const scopes = Array.isArray(data.scopes) ? (data.scopes as string[]) : typeof data.scope === 'string' ? data.scope.split(/[\s,]+/).filter(Boolean) : undefined
      return { token, expiresAt, scopes }
    }
    switch (data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5
        continue
      case 'access_denied':
        throw new CliError('The login was denied in the browser.')
      case 'expired_token':
        throw new CliError('The login code expired. Run jeffi login again.')
      default:
        throw new CliError(`Login failed: ${String(data.error_description ?? data.error ?? `HTTP ${status}`)}`)
    }
  }
}

export function openBrowser(url: string): boolean {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
