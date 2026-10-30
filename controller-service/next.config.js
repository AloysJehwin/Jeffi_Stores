const { baseConfig, ALLOWED_ORIGINS, VAULT_HOST_RE, VAULT_CSP } = require('../packages/store-core/next.base')

const base = baseConfig({
  app: 'controller',
  headers: [
    {
      source: '/(.*)',
      has: [{ type: 'host', value: VAULT_HOST_RE }],
      headers: [{ key: 'Content-Security-Policy', value: VAULT_CSP }],
    },
    {
      source: '/api/gallery/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: ALLOWED_ORIGINS },
        { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        { key: 'Vary', value: 'Origin' },
      ],
    },
    {
      source: '/api/categories',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: ALLOWED_ORIGINS },
        { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        { key: 'Vary', value: 'Origin' },
      ],
    },
  ],
})

module.exports = {
  ...base,
  outputFileTracingIncludes: {
    '/api/admin/orders/[id]/shipping-label': ['../node_modules/pdfkit/js/data/**/*'],
    '/api/vault/pdf-worker': ['../node_modules/pdfjs-dist/build/pdf.worker.min.mjs'],
    // The assistant's file reader: pdfjs loads its worker, fonts and cmaps by path at run time.
    '/api/admin/agent/**': [
      '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      '../node_modules/pdfjs-dist/standard_fonts/**/*',
      '../node_modules/pdfjs-dist/cmaps/**/*',
    ],
  },
  // Approved WhatsApp templates (Meta-locked text) link to jeffistores.in/orders; the page is
  // /account/orders. Storefront hosts only — on admin/business/app hosts /orders is a real page.
  async redirects() {
    return [
      {
        source: '/orders',
        destination: '/account/orders',
        permanent: false,
        missing: [
          { type: 'host', value: '(admin|ecom|business|invoice|quotation|purchaseorder|forms|vault|certportal)([.-].*)?' },
          { type: 'host', value: '.*\\.business\\..*' },
        ],
      },
    ]
  },
}
