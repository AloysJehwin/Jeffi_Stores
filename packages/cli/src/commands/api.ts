import { Command, Option } from 'commander'
import { call } from '../http'
import { contextOf, emit, type Io } from '../io'
import { argSpec, buildRequest, fileFields, filePairs, flagsFor, manifest, multipartSchema, readData, toMultipart } from '../manifest'
import type { ManifestRoute } from '../manifest-types'
import { format, parseCsv } from '../output'
import { CliError, collect, parseValue, setPath, splitPair } from '../util'

interface RawOpts {
  data?: string
  field?: string[]
  query?: string[]
  header?: string[]
  file?: string[]
}

/** Renders an answer; CSV answers become rows. */
export function show(io: Io, cmd: Command, data: unknown, contentType: string) {
  const parsed = typeof data === 'string' && /csv/.test(contentType) ? parseCsv(data) : data
  emit(io, cmd, parsed, d => format(d))
}

export function registerApi(program: Command, io: Io) {
  program
    .command('api <method> <path>')
    .description('Call any admin endpoint: jeffi api GET /api/admin/products/<id> (or /v1/admin/…, /v1/platform/…)')
    .option('-d, --data <json>', 'JSON body, @file, or - for stdin')
    .option('-f, --field <key=value>', 'body field (repeatable; values parsed as JSON when they are JSON, a.b=1 nests)', collect)
    .option('-q, --query <key=value>', 'query parameter (repeatable)', collect)
    .option('-H, --header <name:value>', 'extra request header (repeatable)', collect)
    .option('-F, --file <field=path>', 'send multipart/form-data with this file (repeatable); body fields become form fields', collect)
    .action(async (method: string, path: string, o: RawOpts, cmd: Command) => {
      const m = method.toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(m)) throw new CliError(`Unknown method ${method}`)
      let body: unknown
      if (o.data !== undefined) body = readData(o.data, io.readStdin)
      if (o.field?.length) {
        const obj = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>
        for (const f of o.field) {
          const [k, v] = splitPair(f, '--field')
          setPath(obj, k, parseValue(v))
        }
        body = obj
      }
      const headers: Record<string, string> = {}
      for (const h of o.header ?? []) {
        const i = h.indexOf(':')
        if (i <= 0) throw new CliError(`--header must look like name:value: ${h}`)
        headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim()
      }
      const ctx = contextOf(io, cmd)
      const query = (o.query ?? []).map(q => splitPair(q, '--query'))
      let multipart
      if (o.file?.length) {
        if (Array.isArray(body)) throw new CliError('A multipart body cannot be a JSON array')
        multipart = toMultipart(body as Record<string, unknown> | undefined, filePairs(null, o.file))
      }
      const res = await call(ctx, multipart ? { method: m, path, query, multipart, headers } : { method: m, path, query, body, headers }, { dispatcher: io.dispatcher })
      show(io, cmd, res.data, res.contentType)
    })
}

function ensureGroup(parent: Command, name: string, description: string): Command {
  const found = parent.commands.find(c => c.name() === name)
  if (found) return found
  return parent.command(name).description(description).helpGroup('API commands (generated from the route manifest):')
}

const firstSentence = (s: string) => {
  const m = /^(.{12,110}?[.!?])(\s|$)/.exec(s)
  return m ? m[1] : s.length > 110 ? s.slice(0, 109).replace(/\s+\S*$/, '') + '…' : s
}

function describe(route: ManifestRoute): string {
  return route.summary ? firstSentence(route.summary) : `${route.method} ${route.gatewayPath ?? route.path}`
}

function helpAfter(route: ManifestRoute): string {
  const lines = [
    '',
    ...(route.summary && firstSentence(route.summary) !== route.summary ? [route.summary, ''] : []),
    `Request:  ${route.method} ${route.gatewayPath ?? `${route.path} (admin host only: --direct)`}`,
    `Scope:    ${route.scope ?? 'checked by the handler'}${route.platform ? ` · platform ${route.platform}` : ''}`,
  ]
  const req = (s: typeof route.body) => ((s?.required as string[] | undefined) ?? []).join(', ')
  const files = fileFields(route)
  if (route.body?.raw) lines.push('Body:     not described statically; pass --data or --field')
  else if (route.bodyContentType === 'multipart/form-data') lines.push(`Body:     multipart/form-data; files via --file ${files.length === 1 ? '<path>' : '<field=path>'}${files.length ? ` (${files.join(', ')})` : ''}, other fields as flags or --field`)
  else if (route.body) lines.push('Body:     JSON; named flags above, or --data / --field for anything else')
  else if (route.noBody) lines.push('Body:     none')
  if (route.body && !route.body.raw && req(route.body)) lines.push(`Required: ${req(route.body)}`)
  const alt = route.bodyAlternatives?.find(a => a.contentType === 'multipart/form-data')
  if (alt) lines.push(`          or multipart/form-data with --file ${files.length === 1 ? '<path>' : '<field=path>'}${files.length ? ` (${files.join(', ')})` : ''}`)
  return lines.join('\n')
}

/** `jeffi <resource> <action>` for every manifest route (curated commands of the same name win). */
export function registerGenerated(program: Command, io: Io, routes: ManifestRoute[] = manifest.routes) {
  for (const route of routes) {
    if (route.hidden) continue
    const words = route.command.split(' ')
    let parent = program
    for (const w of words.slice(0, -1)) parent = ensureGroup(parent, w, w === 'platform' ? 'Platform (control plane) commands; flagship profiles only' : w === 'storefront' ? "Storefront admin routes (admin host only: --direct)" : `${w} endpoints`)
    const action = words[words.length - 1]
    if (parent.commands.some(c => c.name() === action)) continue
    const sub = parent.command([action, ...argSpec(route)].join(' ')).description(describe(route))
    const flags = flagsFor(route)
    for (const f of flags) {
      if (f.type !== 'boolean') {
        sub.addOption(new Option(`--${f.flag} <value>`, f.description))
        continue
      }
      sub.addOption(new Option(`--${f.flag}`, f.description))
      if (f.kind === 'body') sub.addOption(new Option(`--no-${f.flag}`, `send ${f.key}: false`))
    }
    if (route.method !== 'GET') {
      sub.option('-d, --data <json>', 'JSON body, @file, or - for stdin')
      sub.option('-f, --field <key=value>', 'body field (repeatable)', collect)
      if (multipartSchema(route)) {
        const files = fileFields(route)
        sub.option(files.length === 1 ? '-F, --file <path>' : '-F, --file <field=path>', `upload a file as multipart/form-data${files.length ? ` (${files.join(', ')})` : ''}; repeatable`, collect)
      }
    }
    sub.option('-q, --query <key=value>', 'extra query parameter (repeatable)', collect)
    sub.addHelpText('after', helpAfter(route))
    sub.action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command
      const positionals = args.slice(0, route.pathParams.length) as (string | string[] | undefined)[]
      const opts = cmd.opts() as Record<string, unknown> & RawOpts
      const named: Record<string, unknown> = {}
      for (const f of flags) {
        const attr = f.flag.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
        if (opts[attr] !== undefined) named[f.flag] = opts[attr]
      }
      const req = buildRequest(route, positionals, { data: opts.data, field: opts.field, query: opts.query, file: opts.file, named, readStdin: io.readStdin })
      const ctx = contextOf(io, cmd)
      const res = await call(ctx, req, { dispatcher: io.dispatcher })
      show(io, cmd, res.data, res.contentType)
    })
  }
}
