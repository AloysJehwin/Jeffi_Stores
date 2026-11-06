import type { Command } from 'commander'
import { assertPlatformAllowed, call } from '../http'
import { contextOf, emit, globals, type Io } from '../io'
import { parseCsv, renderRecord, renderTable } from '../output'
import { isTerminal, pipelineOf, renderPipeline, type ProvisioningResponse } from '../pipeline'
import { CliError, collect, splitPair } from '../util'

const enc = encodeURIComponent

interface ListOpts {
  search?: string
  status?: string
  limit?: string
  query?: string[]
}

/** Lists come from the list filters' CSV export (the same rows and filters as the admin list pages). */
async function listEntity(io: Io, cmd: Command, entity: string, o: ListOpts, columns: string[]) {
  const limit = Math.max(1, Number(o.limit ?? 25) || 25)
  const query: [string, string][] = []
  if (o.search) query.push(['search', o.search])
  if (o.status) query.push(['status', o.status])
  for (const q of o.query ?? []) query.push(splitPair(q, '--query'))
  const ctx = contextOf(io, cmd)
  const res = await call(ctx, { method: 'GET', path: `/api/admin/filters/${entity}/export`, query }, { dispatcher: io.dispatcher })
  const rows = typeof res.data === 'string' ? parseCsv(res.data) : Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []
  const shown = rows.slice(0, limit)
  const total = Number(res.headers.get('x-row-count') ?? rows.length)
  emit(io, cmd, shown, () => {
    const cols = columns.filter(c => shown.some(r => c in r))
    const table = renderTable(shown, cols.length ? cols : undefined)
    return total > shown.length ? `${table}\n\n${shown.length} of ${total}; --limit or --query to see more` : table
  })
}

function listOptions(cmd: Command): Command {
  return cmd
    .option('-s, --search <text>', 'search text')
    .option('--limit <n>', 'rows to show', '25')
    .option('-q, --query <key=value>', 'any list filter, as on the admin list page URL (repeatable)', collect)
}

const ensure = (parent: Command, name: string, description: string) => parent.commands.find(c => c.name() === name) ?? parent.command(name).description(description)

export function registerCurated(program: Command, io: Io) {
  const orders = ensure(program, 'orders', 'Orders')
  listOptions(orders.command('list').description('Orders, newest first (the admin Orders list and its filters)'))
    .option('--status <status>', 'order status filter')
    .action((o: ListOpts, cmd: Command) => listEntity(io, cmd, 'orders', o, ['Order', 'Order #', 'Order number', 'Date', 'Customer', 'Status', 'Payment', 'Total']))

  const products = ensure(program, 'products', 'Products')
  listOptions(products.command('list').description('Products (the admin Products list and its filters)'))
    .action((o: ListOpts, cmd: Command) => listEntity(io, cmd, 'products', o, ['Name', 'SKU', 'Category', 'Brand', 'Price', 'Stock', 'Active']))

  products
    .command('create')
    .description('Create a draft product; finish it with jeffi products update <id> --field … and jeffi products publish <id>')
    .requiredOption('--name <name>', 'product name')
    .action(async (o: { name: string }, cmd: Command) => {
      const ctx = contextOf(io, cmd)
      const res = await call(ctx, { method: 'POST', path: '/api/admin/products/draft', body: { name: o.name } }, { dispatcher: io.dispatcher })
      emit(io, cmd, res.data, d => `${renderRecord(d as Record<string, unknown>)}\n\nDraft created. Next: jeffi products update <id> --field basePrice=… then jeffi products publish <id>`)
    })

  const platform = ensure(program, 'platform', 'Platform (control plane) commands; flagship profiles only')
  platform.hook('preAction', (_this, action) => assertPlatformAllowed(contextOf(io, action)))
  const customers = ensure(platform, 'customers', 'Platform customers (tenants)')

  customers
    .command('list')
    .description('Store counts and the top stores by GMV (customers overview)')
    .option('--from <date>', 'YYYY-MM-DD')
    .option('--to <date>', 'YYYY-MM-DD')
    .action(async (o: { from?: string; to?: string }, cmd: Command) => {
      const query: [string, string][] = []
      if (o.from) query.push(['from', o.from])
      if (o.to) query.push(['to', o.to])
      const res = await call(contextOf(io, cmd), { method: 'GET', path: '/api/admin/ecom/customers/overview', query }, { dispatcher: io.dispatcher })
      emit(io, cmd, res.data, d => {
        const v = d as { snapshot?: Record<string, unknown>; top_stores?: Record<string, unknown>[]; by_status?: unknown }
        const parts = [v.snapshot ? renderRecord(v.snapshot) : '']
        if (v.top_stores?.length) parts.push(renderTable(v.top_stores, ['id', 'name', 'slug', 'plan', 'gmv', 'orders']))
        return parts.filter(Boolean).join('\n\n')
      })
    })

  customers
    .command('show <tenantId>')
    .description('A tenant and its provisioning job')
    .action(async (tenantId: string, _o: unknown, cmd: Command) => {
      const res = await call(contextOf(io, cmd), { method: 'GET', path: `/api/admin/ecom/customers/${enc(tenantId)}/provisioning` }, { dispatcher: io.dispatcher })
      emit(io, cmd, res.data, d => {
        const v = d as ProvisioningResponse & { tenant?: Record<string, unknown> }
        const job = v.job ? { status: v.job.status, step: v.job.step, attempts: v.job.attempts, last_error: v.job.last_error ?? '' } : { job: 'none' }
        const p = pipelineOf(v)
        return [renderRecord(v.tenant ?? {}), renderRecord(job), p ? renderPipeline(v)[0] : ''].filter(Boolean).join('\n\n')
      })
    })

  const provisioning = ensure(platform, 'provisioning', 'Provisioning pipelines')
  provisioning
    .command('watch <tenantId>')
    .description('Follow a tenant’s provisioning pipeline: jobs and steps, live until it succeeds or fails')
    .option('--interval <seconds>', 'poll interval', '4')
    .option('--once', 'print the current state and exit')
    .action(async (tenantId: string, o: { interval: string; once?: boolean }, cmd: Command) => {
      const ctx = contextOf(io, cmd)
      const json = !!globals(cmd).json
      const every = Math.max(1, Number(o.interval) || 4) * 1000
      let prevLines = 0
      let prevText = ''
      for (;;) {
        const res = await call(ctx, { method: 'GET', path: `/api/admin/ecom/customers/${enc(tenantId)}/provisioning` }, { dispatcher: io.dispatcher })
        const data = res.data as ProvisioningResponse
        const p = pipelineOf(data)
        const done = !p || isTerminal(p.status) || !!o.once
        if (json) {
          if (done) io.out(JSON.stringify(data, null, 2))
        } else {
          const lines = renderPipeline(data, { color: io.isTTY && !io.env.NO_COLOR, width: process.stdout.columns || 100 })
          const text = lines.join('\n')
          if (io.isTTY && prevLines) io.out(`\x1b[${prevLines}F\x1b[J${text}`)
          else if (text !== prevText) io.out(text)
          prevLines = lines.length
          prevText = text
        }
        if (done) {
          if (p?.status === 'failed') throw new CliError('Provisioning failed', 1, data)
          return
        }
        await io.sleep(every)
      }
    })

  const certs = ensure(platform, 'certs', 'Tenant admin certificates')
  certs
    .command('issue <tenantId>')
    .description("Issue (or re-issue) the store owner's admin certificate and email it")
    .option('--email <email>', 'issue to this email instead of the owner (creates another full-access admin)')
    .option('--name <name>', 'name on the certificate')
    .option('--revoke-existing', 'revoke the current certificates first')
    .action(async (tenantId: string, o: { email?: string; name?: string; revokeExisting?: boolean }, cmd: Command) => {
      const body: Record<string, unknown> = {}
      if (o.email) body.email = o.email
      if (o.name) body.name = o.name
      if (o.revokeExisting) body.revokeExisting = true
      const res = await call(contextOf(io, cmd), { method: 'POST', path: `/api/admin/ecom/${enc(tenantId)}/certs/issue`, body }, { dispatcher: io.dispatcher })
      emit(io, cmd, res.data)
    })
}
