import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliError } from './util'

export const FLAGSHIP = 'flagship'
export const DEFAULT_DOMAIN = 'jeffistores.in'
const LOCAL_PORT = 3000

export interface Profile {
  /** A store slug, or 'flagship' (the platform's own store and the platform API). */
  store: string
  /** Local dev: *.localhost:3000 hosts. */
  local?: boolean
  domain?: string
  /** Base URL override for the public API (gateway). */
  host?: string
  /** Base URL override for the store's admin host (login, --direct). */
  adminHost?: string
  /** Call the admin host directly (with the .p12) instead of the public API. */
  direct?: boolean
  cert?: string
  kind?: 'person' | 'service_account'
}

export interface ConfigFile {
  current?: string
  profiles: Record<string, Profile>
}

export interface Credential {
  token?: string
  certPassword?: string
  expiresAt?: string | null
}

export type Credentials = Record<string, Credential>

export function configDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): string {
  if (env.JEFFI_CONFIG_DIR) return env.JEFFI_CONFIG_DIR
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'jeffi')
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'jeffi')
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new CliError(`Can't read ${file}: ${(e as Error).message}`)
  }
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

export function loadConfig(dir: string): ConfigFile {
  const cfg = readJson<ConfigFile>(path.join(dir, 'config.json'), { profiles: {} })
  return { current: cfg.current, profiles: cfg.profiles ?? {} }
}

export function saveConfig(dir: string, cfg: ConfigFile) {
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n')
}

export function credentialsPath(dir: string) {
  return path.join(dir, 'credentials.json')
}

export function loadCredentials(dir: string): Credentials {
  return readJson<Credentials>(credentialsPath(dir), {})
}

/** Tokens and passwords: owner read/write only (0600), in a 0700 directory. */
export function saveCredentials(dir: string, creds: Credentials) {
  ensureDir(dir)
  const file = credentialsPath(dir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

const hostLabel = (store: string, kind: 'public' | 'admin') => (store === FLAGSHIP ? kind : `${kind}-${store}`)

/** Public API base: https://public-{slug}.jeffistores.in, https://public.jeffistores.in for the flagship. */
export function baseUrl(p: Profile): string {
  if (p.host) return p.host.replace(/\/+$/, '')
  if (p.local) return `http://${hostLabel(p.store, 'public')}.localhost:${LOCAL_PORT}`
  return `https://${hostLabel(p.store, 'public')}.${p.domain || DEFAULT_DOMAIN}`
}

/** The store's admin host: login runs there, and --direct calls it. */
export function adminUrl(p: Profile): string {
  if (p.adminHost) return p.adminHost.replace(/\/+$/, '')
  if (p.local) return `http://${hostLabel(p.store, 'admin')}.localhost:${LOCAL_PORT}`
  return `https://${hostLabel(p.store, 'admin')}.${p.domain || DEFAULT_DOMAIN}`
}

export function validateStore(store: string): string {
  const s = store.trim().toLowerCase()
  if (s !== FLAGSHIP && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) throw new CliError(`Not a store slug: ${store}`)
  return s
}

export interface Context {
  dir: string
  profileName: string | null
  profile: Profile
  token?: string
  cert?: string
  certPassword?: string
  base: string
  adminBase: string
  direct: boolean
}

export interface GlobalOpts {
  profile?: string
  host?: string
  direct?: boolean
}

/** The profile in effect, with env overrides (JEFFI_PROFILE, JEFFI_STORE, JEFFI_HOST, JEFFI_TOKEN, JEFFI_CERT, …). */
export function resolveContext(opts: GlobalOpts, env: NodeJS.ProcessEnv, dir: string): Context {
  const cfg = loadConfig(dir)
  const creds = loadCredentials(dir)
  const name = opts.profile || env.JEFFI_PROFILE || cfg.current || (cfg.profiles.default ? 'default' : null)
  if (opts.profile && !cfg.profiles[opts.profile]) throw new CliError(`No profile named ${opts.profile}. Add it with: jeffi profiles add ${opts.profile}`)
  const stored = name ? cfg.profiles[name] : undefined
  const profile: Profile = { ...(stored ?? { store: FLAGSHIP }) }
  if (env.JEFFI_STORE) profile.store = validateStore(env.JEFFI_STORE)
  const host = opts.host || env.JEFFI_HOST
  if (host) profile.host = host
  if (env.JEFFI_ADMIN_HOST) profile.adminHost = env.JEFFI_ADMIN_HOST
  if (env.JEFFI_CERT) profile.cert = env.JEFFI_CERT
  if (!stored && !env.JEFFI_STORE && host) {
    // No profile: guess the store from the host name, so platform commands know what they talk to.
    const label = safeHostname(host).split('.')[0]
    const m = /^(?:public|admin)(?:-(.+))?$/.exec(label)
    profile.store = m ? m[1] ?? FLAGSHIP : ''
  }
  const cred = (name && creds[name]) || {}
  return {
    dir,
    profileName: stored ? name : null,
    profile,
    token: env.JEFFI_TOKEN || cred.token,
    cert: profile.cert,
    certPassword: env.JEFFI_CERT_PASSWORD || cred.certPassword,
    base: baseUrl(profile),
    adminBase: adminUrl(profile),
    direct: !!(opts.direct || profile.direct),
  }
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return u
  }
}
