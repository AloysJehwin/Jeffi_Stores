const { baseConfig, ALLOWED_ORIGINS, VAULT_HOST_RE, VAULT_CSP } = require('../packages/store-core/next.base')

const cors = methods => [
  { key: 'Access-Control-Allow-Origin', value: ALLOWED_ORIGINS },
  { key: 'Access-Control-Allow-Methods', value: methods },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
  { key: 'Vary', value: 'Origin' },
]

module.exports = {
  ...baseConfig({
    app: 'storefront',
    headers: [
      { source: '/(.*)', has: [{ type: 'host', value: VAULT_HOST_RE }], headers: [{ key: 'Content-Security-Policy', value: VAULT_CSP }] },
      { source: '/api/gallery/:path*', headers: cors('GET,POST,DELETE,OPTIONS') },
      { source: '/api/categories', headers: cors('GET,OPTIONS') },
    ],
  }),
  outputFileTracingIncludes: {
    '/api/vault/pdf-worker': ['../node_modules/pdfjs-dist/build/pdf.worker.min.mjs'],
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
