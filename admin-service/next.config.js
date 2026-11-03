const { baseConfig } = require('../packages/store-core/next.base')

module.exports = {
  ...baseConfig({ app: 'admin' }),
  outputFileTracingIncludes: {
    '/api/admin/orders/[id]/shipping-label': ['../node_modules/pdfkit/js/data/**/*'],
    // The assistant's file reader: pdfjs loads its worker, fonts and cmaps by path at run time.
    '/api/admin/agent/**': [
      '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      '../node_modules/pdfjs-dist/standard_fonts/**/*',
      '../node_modules/pdfjs-dist/cmaps/**/*',
    ],
  },
}
