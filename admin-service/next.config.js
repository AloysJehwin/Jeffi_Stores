const { baseConfig } = require('../packages/store-core/next.base')

module.exports = {
  ...baseConfig({ app: 'admin' }),
  outputFileTracingIncludes: {
    '/api/admin/orders/[id]/shipping-label': ['../node_modules/pdfkit/js/data/**/*'],
    // The standard Export renders PDFs with PDFKit and Noto Sans (₹).
    '/api/admin/export/[key]': ['../node_modules/pdfkit/js/data/**/*', '../packages/store-core/assets/fonts/NotoSans-Regular.ttf', '../packages/store-core/assets/fonts/NotoSans-Bold.ttf'],
    // whoami reports the CLI manifest's hash.
    '/api/admin/cli/whoami': ['../packages/cli/manifest/admin-api.json'],
    // The assistant's file reader: pdfjs loads its worker, fonts and cmaps by path at run time.
    '/api/admin/agent/**': [
      '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      '../node_modules/pdfjs-dist/standard_fonts/**/*',
      '../node_modules/pdfjs-dist/cmaps/**/*',
    ],
  },
}
