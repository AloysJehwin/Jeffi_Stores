import type { FastifyInstance } from 'fastify'
import { mount } from '../shim'
import * as list from './invoices/list'
import * as drafts from './invoices/drafts'
import * as draft from './invoices/draft'
import * as publish from './invoices/publish'
import * as finalize from './invoices/finalize'
import * as edit from './invoices/edit'
import * as detail from './invoices/detail'
import * as amendment from './invoices/amendment-draft'
import * as resend from './invoices/resend-email'
import * as cashSale from './invoices/cash-sale'
import * as einvoice from './invoices/einvoice'
import * as orderInvoice from './invoices/order-invoice'
import * as system from './invoices/system'

// Same paths as the monolith's /api/admin/* so the Next proxy forwards 1:1.
export async function adminRoutes(app: FastifyInstance) {
  mount(app, 'GET', '/admin/invoices', list.GET)
  mount(app, 'GET', '/admin/invoices/drafts', drafts.GET)
  mount(app, 'POST', '/admin/invoices/drafts', drafts.POST)
  mount(app, 'GET', '/admin/invoices/drafts/:id', draft.GET)
  mount(app, 'PATCH', '/admin/invoices/drafts/:id', draft.PATCH)
  mount(app, 'DELETE', '/admin/invoices/drafts/:id', draft.DELETE)
  mount(app, 'POST', '/admin/invoices/drafts/:id/publish', publish.POST)
  mount(app, 'POST', '/admin/invoices/drafts/:id/finalize', finalize.POST)
  mount(app, 'POST', '/admin/invoices/cash-sale', cashSale.POST)
  mount(app, 'PATCH', '/admin/invoices/:id', edit.PATCH)
  mount(app, 'GET', '/admin/invoices/:id/detail', detail.GET)
  mount(app, 'POST', '/admin/invoices/:id/amendment-draft', amendment.POST)
  mount(app, 'POST', '/admin/invoices/:id/resend-email', resend.POST)
  mount(app, 'POST', '/admin/orders/:id/einvoice', einvoice.POST)
  mount(app, 'DELETE', '/admin/orders/:id/einvoice', einvoice.DELETE)
  mount(app, 'GET', '/orders/:id/invoice', orderInvoice.GET)
  mount(app, 'POST', '/orders/:id/invoice', orderInvoice.POST)
  mount(app, 'POST', '/orders/:id/invoice/draft', system.draft)
  mount(app, 'POST', '/orders/:id/invoice/number', system.number)
  mount(app, 'POST', '/orders/:id/invoice/generate', system.generate)
}
