import type { Command } from 'commander'
import { FLAGSHIP, adminUrl, baseUrl, loadConfig, loadCredentials, saveConfig, saveCredentials, validateStore, type Profile } from '../config'
import { emit, globals, type Io } from '../io'
import { renderTable } from '../output'
import { CliError } from '../util'

export const maskToken = (t?: string) => (t ? `${t.slice(0, 8)}…` : '')

interface AddOpts {
  store?: string
  local?: boolean
  domain?: string
  host?: string
  adminHost?: string
  direct?: boolean
  cert?: string
  certPassword?: string
  serviceAccount?: string
  token?: string
  use?: boolean
}

export function registerProfiles(program: Command, io: Io) {
  const profiles = program.command('profiles').description('Saved stores and credentials (~/.config/jeffi)')

  profiles
    .command('add <name>')
    .description('Add or update a profile')
    .option('--store <slug>', `store slug, or "${FLAGSHIP}" for the platform's own store and platform commands`, FLAGSHIP)
    .option('--local', 'local dev hosts (public-{slug}.localhost:3000, admin-{slug}.localhost:3000)')
    .option('--domain <domain>', 'root domain (default jeffistores.in)')
    .option('--admin-host <url>', "override the store's admin host (login approval page, --direct)")
    .option('--direct', "call the store's admin host with the .p12 instead of the public API")
    .option('--cert <p12>', 'client certificate (.p12) for --direct')
    .option('--cert-password <password>', 'password of the .p12 (kept in credentials.json, mode 0600)')
    .option('--service-account <key>', 'a service-account key (jsa_…) shown when the account was created')
    .option('--token <token>', 'a CLI token (jfc_…), e.g. from Settings → CLI & tokens')
    .option('--use', 'make it the current profile')
    .action((name: string, o: AddOpts, cmd: Command) => {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new CliError(`Profile names are letters, digits, - _ . only: ${name}`)
      if (o.serviceAccount && !o.serviceAccount.startsWith('jsa_')) throw new CliError('--service-account takes a jsa_… key')
      if (o.token && !o.token.startsWith('jfc_')) throw new CliError('--token takes a jfc_… token')
      if (o.serviceAccount && o.token) throw new CliError('Pass --service-account or --token, not both')
      const host = globals(cmd).host ?? o.host
      const cfg = loadConfig(io.dir)
      const prev = cfg.profiles[name]
      const p: Profile = { ...prev, store: validateStore(o.store ?? prev?.store ?? FLAGSHIP) }
      if (o.local !== undefined) p.local = o.local
      if (o.domain) p.domain = o.domain
      if (host) p.host = host
      if (o.adminHost) p.adminHost = o.adminHost
      if (o.direct !== undefined) p.direct = o.direct
      if (o.cert) p.cert = o.cert
      if (o.serviceAccount) p.kind = 'service_account'
      else if (o.token) p.kind = 'person'
      cfg.profiles[name] = p
      if (o.use || !cfg.current) cfg.current = name
      saveConfig(io.dir, cfg)
      if (o.serviceAccount || o.token || o.certPassword) {
        const creds = loadCredentials(io.dir)
        creds[name] = { ...creds[name], ...(o.serviceAccount || o.token ? { token: o.serviceAccount ?? o.token, expiresAt: null } : {}), ...(o.certPassword ? { certPassword: o.certPassword } : {}) }
        saveCredentials(io.dir, creds)
      }
      io.out(`Saved profile ${name} (${p.store}, ${p.direct ? adminUrl(p) : baseUrl(p)})${cfg.current === name ? ', current' : ''}`)
    })

  profiles
    .command('use <name>')
    .description('Switch the current profile')
    .action((name: string) => {
      const cfg = loadConfig(io.dir)
      if (!cfg.profiles[name]) throw new CliError(`No profile named ${name}`)
      cfg.current = name
      saveConfig(io.dir, cfg)
      io.out(`Now using ${name}`)
    })

  profiles
    .command('list')
    .description('List profiles')
    .action((_o: unknown, cmd: Command) => {
      const cfg = loadConfig(io.dir)
      const creds = loadCredentials(io.dir)
      const rows = Object.entries(cfg.profiles).map(([name, p]) => ({
        current: cfg.current === name ? '*' : '',
        name,
        store: p.store,
        url: p.direct ? adminUrl(p) : baseUrl(p),
        kind: p.kind ?? '',
        token: maskToken(creds[name]?.token),
        expires: creds[name]?.expiresAt ?? '',
      }))
      emit(io, cmd, rows, () => (rows.length ? renderTable(rows) : 'No profiles yet. Run jeffi login, or jeffi profiles add <name>.'))
    })

  profiles
    .command('remove <name>')
    .description('Delete a profile and its stored credential')
    .action((name: string) => {
      const cfg = loadConfig(io.dir)
      if (!cfg.profiles[name]) throw new CliError(`No profile named ${name}`)
      delete cfg.profiles[name]
      if (cfg.current === name) cfg.current = Object.keys(cfg.profiles)[0]
      saveConfig(io.dir, cfg)
      const creds = loadCredentials(io.dir)
      if (creds[name]) {
        delete creds[name]
        saveCredentials(io.dir, creds)
      }
      io.out(`Removed ${name}`)
    })
}
