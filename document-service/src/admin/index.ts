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
import * as qList from './quotations/list'
import * as qItem from './quotations/item'
import * as qProducts from './quotations/products'
import * as qPdf from './quotations/pdf'
import * as qResend from './quotations/resend-email'
import * as qConvert from './quotations/convert-to-invoice'
import * as poList from './po/list'
import * as poItem from './po/item'
import * as poResend from './po/resend-email'
import * as poDrafts from './po/drafts'
import * as poDraft from './po/draft'
import * as poUnit from './po/purchase-unit'
import * as poReceive from './po/receive'
import * as poReceiveDraft from './po/receive-draft'
import * as rfqConvert from './quotations/rfq-convert'

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

  mount(app, 'GET', '/admin/quotations', qList.GET)
  mount(app, 'POST', '/admin/quotations', qList.POST)
  mount(app, 'GET', '/admin/quotations/products', qProducts.GET)
  mount(app, 'GET', '/admin/quotations/:id', qItem.GET)
  mount(app, 'PATCH', '/admin/quotations/:id', qItem.PATCH)
  mount(app, 'DELETE', '/admin/quotations/:id', qItem.DELETE)
  mount(app, 'GET', '/admin/quotations/:id/pdf', qPdf.GET)
  mount(app, 'POST', '/admin/quotations/:id/resend-email', qResend.POST)
  mount(app, 'POST', '/admin/quotations/:id/convert-to-invoice', qConvert.POST)

  mount(app, 'GET', '/admin/inventory/po', poList.GET)
  mount(app, 'POST', '/admin/inventory/po', poList.POST)
  mount(app, 'GET', '/admin/inventory/po/purchase-unit', poUnit.GET)
  mount(app, 'GET', '/admin/inventory/po/draft', poDrafts.GET)
  mount(app, 'POST', '/admin/inventory/po/draft', poDrafts.POST)
  mount(app, 'GET', '/admin/inventory/po/draft/:id', poDraft.GET)
  mount(app, 'PATCH', '/admin/inventory/po/draft/:id', poDraft.PATCH)
  mount(app, 'DELETE', '/admin/inventory/po/draft/:id', poDraft.DELETE)
  mount(app, 'GET', '/admin/inventory/po/:id', poItem.GET)
  mount(app, 'PATCH', '/admin/inventory/po/:id', poItem.PATCH)
  mount(app, 'POST', '/admin/inventory/po/:id/resend-email', poResend.POST)
  mount(app, 'POST', '/admin/inventory/po/:id/receive', poReceive.POST)
  mount(app, 'GET', '/admin/inventory/po/:id/receive/draft', poReceiveDraft.GET)
  mount(app, 'PATCH', '/admin/inventory/po/:id/receive/draft', poReceiveDraft.PATCH)
  mount(app, 'DELETE', '/admin/inventory/po/:id/receive/draft', poReceiveDraft.DELETE)
  mount(app, 'POST', '/admin/business/rfqs/:id/convert-to-quotation', rfqConvert.POST)
}
