import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Lifted monolith tests keep their `@/...` module ids; map them onto the service's layout.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: [
      { find: 'next/server', replacement: r('./src/next.ts') },
      { find: '@/lib/auth/jwt', replacement: r('./src/auth.ts') },
      { find: '@/lib/auth/scopes', replacement: r('./src/lib/scopes.ts') },
      { find: '@/lib/shared/db', replacement: r('../packages/tenancy/src/db.ts') },
      { find: '@/lib/shared/s3', replacement: r('../packages/tenancy/src/s3.ts') },
      { find: '@/lib/email', replacement: r('./src/lib/mail.ts') },
      { find: '@/lib/shared/email-business', replacement: r('./src/lib/mail-business.ts') },
      { find: '@/lib/shared/validate', replacement: r('./src/lib/validate.ts') },
      { find: '@/lib/payments/razorpay', replacement: r('./src/lib/razorpay.ts') },
      { find: '@/lib/shipping/einvoice', replacement: r('./src/lib/einvoice.ts') },
      { find: /^@\/lib\/(catalog|documents|orders|shared|tenancy)\/([a-z-]+)$/, replacement: r('./src/lib') + '/$2.ts' },
      { find: '@/app/api/(admin)/admin/invoices/route', replacement: r('./src/admin/invoices/list.ts') },
      { find: '@/app/api/(admin)/admin/invoices/drafts/route', replacement: r('./src/admin/invoices/drafts.ts') },
      { find: '@/app/api/(admin)/admin/invoices/drafts/[id]/route', replacement: r('./src/admin/invoices/draft.ts') },
      { find: '@/app/api/(admin)/admin/invoices/drafts/[id]/publish/route', replacement: r('./src/admin/invoices/publish.ts') },
      { find: '@/app/api/(admin)/admin/invoices/drafts/[id]/finalize/route', replacement: r('./src/admin/invoices/finalize.ts') },
      { find: '@/app/api/(admin)/admin/invoices/[id]/route', replacement: r('./src/admin/invoices/edit.ts') },
      { find: '@/app/api/(admin)/admin/invoices/[id]/detail/route', replacement: r('./src/admin/invoices/detail.ts') },
      { find: '@/app/api/(admin)/admin/invoices/[id]/resend-email/route', replacement: r('./src/admin/invoices/resend-email.ts') },
      { find: '@/app/api/(admin)/admin/invoices/cash-sale/route', replacement: r('./src/admin/invoices/cash-sale.ts') },
      { find: '@/app/api/(admin)/admin/orders/[id]/einvoice/route', replacement: r('./src/admin/invoices/einvoice.ts') },
      { find: '@/app/api/(public)/orders/[id]/invoice/route', replacement: r('./src/admin/invoices/order-invoice.ts') },
      { find: '@/app/api/(admin)/admin/quotations/route', replacement: r('./src/admin/quotations/list.ts') },
      { find: '@/app/api/(admin)/admin/quotations/[id]/route', replacement: r('./src/admin/quotations/item.ts') },
      { find: '@/app/api/(admin)/admin/quotations/products/route', replacement: r('./src/admin/quotations/products.ts') },
      { find: '@/app/api/(admin)/admin/quotations/[id]/pdf/route', replacement: r('./src/admin/quotations/pdf.ts') },
      { find: '@/app/api/(admin)/admin/quotations/[id]/resend-email/route', replacement: r('./src/admin/quotations/resend-email.ts') },
      { find: '@/app/api/(admin)/admin/quotations/[id]/convert-to-invoice/route', replacement: r('./src/admin/quotations/convert-to-invoice.ts') },
      { find: '@/app/api/(admin)/admin/business/rfqs/[id]/convert-to-quotation/route', replacement: r('./src/admin/quotations/rfq-convert.ts') },
      { find: '@/app/api/(admin)/admin/inventory/po/route', replacement: r('./src/admin/po/list.ts') },
      { find: '@/app/api/(admin)/admin/inventory/po/[id]/route', replacement: r('./src/admin/po/item.ts') },
      { find: '@/app/api/(admin)/admin/inventory/po/[id]/receive/route', replacement: r('./src/admin/po/receive.ts') },
      { find: '@/app/api/(admin)/admin/inventory/po/[id]/resend-email/route', replacement: r('./src/admin/po/resend-email.ts') },
    ],
  },
})
