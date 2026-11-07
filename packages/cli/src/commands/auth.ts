import type { Command } from 'commander'
import { FLAGSHIP, adminUrl, baseUrl, loadConfig, loadCredentials, saveConfig, saveCredentials, validateStore, type Profile } from '../config'
import { deviceEndpoint, pollDevice, startDevice } from '../auth/device'
import { call, makeDispatcher, send } from '../http'
import { contextOf, emit, globals, type Io } from '../io'
import { manifest } from '../manifest'
import { renderRecord } from '../output'
import { CLI_VERSION, CliError } from '../util'

const TTLS = new Set(['1h', '12h', '7d', '24h'])

/** -1 / 0 / 1 for dotted versions (prerelease tags ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1
  return 0
}

interface LoginOpts {
  store?: string
  local?: boolean
  adminHost?: string
  scopes?: string
  ttl?: string
  browser?: boolean
  cert?: string
  certPassword?: string
}

export function registerAuth(program: Command, io: Io) {
  program
    .command('login')
    .description("Sign in through the browser (a device code via the store's public API) and save a CLI token")
    .option('--store <slug>', `store slug or "${FLAGSHIP}" (creates the profile if it doesn't exist)`)
    .option('--local', 'local dev hosts (*.localhost:3000)')
    .option('--admin-host <url>', "override the store's admin host (the approval page, --direct)")
    .option('--scopes <preset>', 'requested scopes: read, all, or a comma-separated list (you confirm in the browser)')
    .option('--ttl <ttl>', 'requested lifetime: 1h, 12h or 7d (administrators at most 24h)')
    .option('--no-browser', "print the link instead of opening it")
    .option('--cert <p12>', 'client certificate (.p12) for --direct')
    .option('--cert-password <password>', 'password of the .p12')
    .action(async (o: LoginOpts, cmd: Command) => {
      if (o.ttl && !TTLS.has(o.ttl)) throw new CliError('--ttl is 1h, 12h, 24h or 7d')
      const g = globals(cmd)
      const cfg = loadConfig(io.dir)
      const name = g.profile || io.env.JEFFI_PROFILE || cfg.current || 'default'
      const prev = cfg.profiles[name]
      const profile: Profile = { ...prev, store: validateStore(o.store ?? prev?.store ?? FLAGSHIP), kind: 'person' }
      if (o.local !== undefined) profile.local = o.local
      if (o.cert) profile.cert = o.cert
      if (o.adminHost) profile.adminHost = o.adminHost
      if (g.host) profile.host = g.host
      const creds = loadCredentials(io.dir)
      const certPassword = o.certPassword ?? io.env.JEFFI_CERT_PASSWORD ?? creds[name]?.certPassword
      const adminBase = (io.env.JEFFI_ADMIN_HOST || adminUrl(profile)).replace(/\/+$/, '')
      const base = io.env.JEFFI_HOST ? io.env.JEFFI_HOST.replace(/\/+$/, '') : baseUrl(profile)
      // The public API needs no certificate; only --direct logs in on the admin host with the .p12.
      const direct = !!(g.direct || profile.direct)
      const endpoint = deviceEndpoint({ base, adminBase, direct })
      const dispatcher = io.dispatcher ?? makeDispatcher({ cert: io.env.JEFFI_CERT || profile.cert, certPassword }, direct)
      const start = await startDevice(endpoint, { scopes: o.scopes, ttl: o.ttl }, { dispatcher })
      const abs = (u: string) => (u.startsWith('/') ? adminBase + u : u)
      const uri = abs(start.verification_uri)
      const link = start.verification_uri_complete ? abs(start.verification_uri_complete) : `${uri}${uri.includes('?') ? '&' : '?'}code=${encodeURIComponent(start.user_code)}`
      io.err(`Confirm this code in the browser: ${start.user_code}\n  ${link}`)
      if (o.browser !== false && !io.openUrl(link)) io.err('(open the link yourself)')
      io.err('Waiting for approval…')
      const tok = await pollDevice(endpoint, start, { dispatcher, sleep: io.sleep })
      const fresh = loadConfig(io.dir)
      fresh.profiles[name] = profile
      fresh.current = fresh.current ?? name
      saveConfig(io.dir, fresh)
      const c = loadCredentials(io.dir)
      c[name] = { ...c[name], token: tok.token, expiresAt: tok.expiresAt, ...(o.certPassword ? { certPassword: o.certPassword } : {}) }
      saveCredentials(io.dir, c)
      io.out(`Signed in to ${profile.store} as profile ${name}${tok.expiresAt ? ` (until ${tok.expiresAt})` : ''}`)
    })

  program
    .command('logout')
    .description('Revoke this profile’s CLI token and forget it locally (service-account keys are only forgotten)')
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = contextOf(io, cmd)
      const name = ctx.profileName
      if (ctx.token?.startsWith('jfc_')) {
        const res = await send(ctx, { method: 'POST', path: '/api/admin/cli/logout' }, { dispatcher: io.dispatcher }).catch(() => null)
        if (!res?.ok) io.err(`Couldn't revoke the token on the server${res ? ` (HTTP ${res.status})` : ''}; it expires on its own.`)
      }
      if (name) {
        const creds = loadCredentials(io.dir)
        if (creds[name]?.token) {
          delete creds[name].token
          delete creds[name].expiresAt
          saveCredentials(io.dir, creds)
        }
      }
      io.out(name ? `Logged out of ${name}` : 'Nothing stored to forget (the token came from JEFFI_TOKEN)')
    })

  program
    .command('whoami')
    .description('Who the current credential is, its scopes, and whether this CLI matches the server')
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = contextOf(io, cmd)
      const res = await call(ctx, { method: 'GET', path: '/api/admin/cli/whoami' }, { dispatcher: io.dispatcher })
      const d = (res.data ?? {}) as Record<string, unknown> & { server?: { manifestHash?: string; minCli?: string; version?: string }; scopes?: string[] }
      const notes: string[] = []
      if (d.server?.manifestHash && d.server.manifestHash !== manifest.manifestHash) notes.push("The server's admin API differs from this CLI's manifest; update with npm i -g @jeffi_erp/cli.")
      if (d.server?.minCli && !CLI_VERSION.startsWith('0.0.0') && compareVersions(CLI_VERSION, d.server.minCli) < 0) notes.push(`This CLI (${CLI_VERSION}) is older than the server supports (${d.server.minCli}); update it.`)
      emit(io, cmd, { ...d, profile: ctx.profileName, cli: { version: CLI_VERSION, manifestHash: manifest.manifestHash } }, () => {
        const { scopes, server: _server, ...rest } = d
        const lines = [renderRecord({ profile: ctx.profileName ?? '(env)', ...rest, scopes: Array.isArray(scopes) ? `${scopes.length} (${scopes.slice(0, 6).join(', ')}${scopes.length > 6 ? ', …' : ''})` : scopes })]
        return [...lines, ...notes].join('\n')
      })
    })
}
