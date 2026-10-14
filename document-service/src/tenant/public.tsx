import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolveTenantFromHost, runWithTenant, runAsPlatform, appFromHost, slugFromHost, type TenantContext } from '@jeffi/tenancy'
import { loadInvoice, invoicePdf, loadQuotation, quotationPdf, loadPurchaseOrder, purchaseOrderPdf } from './loaders'
import InvoiceView from './views/InvoiceView'
import QuotationView from './views/QuotationView'
import PurchaseOrderView from './views/PurchaseOrderView'

type App = 'invoice' | 'quotation' | 'purchaseorder'
const APPS: App[] = ['invoice', 'quotation', 'purchaseorder']
const TITLES: Record<App, string> = { invoice: 'Invoice', quotation: 'Quotation', purchaseorder: 'Purchase Order' }

// Tailwind compiled from the view components at build time (npm run build:css) and inlined: the pages
// must not depend on a CDN (tenant CSP) or on a static-file route.
const CSS = readFileSync(new URL('./views/styles.css', import.meta.url), 'utf8')
function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}body{margin:0;background:#f3f4f6}</style></head><body>${body}</body></html>`
}

// Host: invoice-{slug}.<root> (Traefik in prod) or x-forwarded-host (Next dev rewrite).
// invoice.<root> (no slug) is the platform store's own document host.
async function tenantFor(req: FastifyRequest): Promise<{ tenant: TenantContext | null; app: App } | null> {
  const fwd = req.headers['x-forwarded-host']
  const host = String((Array.isArray(fwd) ? fwd[0] : fwd) || req.headers.host || '')
  const app = appFromHost(host)
  if (!app || !APPS.includes(app as App)) return null
  const parsed = slugFromHost(host)
  if (!parsed.slug && !parsed.isCustomDomain) return { tenant: null, app: app as App }
  const tenant = await resolveTenantFromHost(host)
  return tenant ? { tenant, app: app as App } : null
}

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', message: 'Not found' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load(app: App, token: string) {
  if (app === 'invoice') return loadInvoice(token)
  if (app === 'quotation') return loadQuotation(token)
  return loadPurchaseOrder(token)
}

export async function publicRoutes(app: FastifyInstance) {
  // /t/:app/:token lets the Next dev proxy (and tests) name the app explicitly; /:token relies on the host.
  const handle = (kind: 'html' | 'json' | 'pdf') => async (req: FastifyRequest<{ Params: { app?: string; token: string } }>, reply: FastifyReply) => {
    if (!UUID.test(req.params.token)) return notFound(reply)
    const t = await tenantFor(req)
    const docApp = (req.params.app as App | undefined) ?? t?.app
    if (!t || !docApp || !APPS.includes(docApp)) return notFound(reply)
    const scoped = <T,>(fn: () => Promise<T>) => (t.tenant ? runWithTenant(t.tenant, fn) : runAsPlatform(fn))
    return scoped(async () => {
      const data: any = await load(docApp, req.params.token)
      if (!data) return notFound(reply)
      if (kind === 'json') return data
      if (kind === 'pdf') {
        const { buffer, filename } = docApp === 'invoice' ? await invoicePdf(data) : docApp === 'quotation' ? await quotationPdf(data) : await purchaseOrderPdf(data)
        return reply.headers({ 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'content-length': String(buffer.length) }).send(buffer)
      }
      const token = req.params.token
      const el =
        docApp === 'invoice' ? <InvoiceView order={data.order} items={data.items} settings={data.settings} token={token} />
        : docApp === 'quotation' ? <QuotationView qt={data.qt} items={data.items} settings={data.settings} token={token} />
        : <PurchaseOrderView po={data.po} items={data.items} settings={data.settings} token={token} grns={data.grns} />
      const number = data.order?.invoice_number ?? data.qt?.quote_number ?? data.po?.po_number ?? ''
      return reply.type('text/html; charset=utf-8').send(page(`${TITLES[docApp]} ${number}`, renderToStaticMarkup(el)))
    })
  }
  for (const prefix of ['/t/:app', '']) {
    app.get(`${prefix}/:token`, handle('html'))
    app.get(`${prefix}/:token/json`, handle('json'))
    app.get(`${prefix}/:token/pdf`, handle('pdf'))
  }
}
