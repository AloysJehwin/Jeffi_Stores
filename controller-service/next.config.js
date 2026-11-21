const { baseConfig } = require('../packages/store-core/next.base')

// KYB's document check (lib/kyb/read.ts) reads PDFs with pdfjs, which loads its worker, fonts and cmaps by path at run time.
const pdfjs = [
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  '../node_modules/pdfjs-dist/standard_fonts/**/*',
  '../node_modules/pdfjs-dist/cmaps/**/*',
]

module.exports = {
  ...baseConfig({ app: 'controller' }),
  outputFileTracingIncludes: {
    '/api/ecom/kyb/**': pdfjs,
    '/api/ecom/onboard/**': pdfjs,
    '/api/admin/ecom/**': pdfjs,
  },
}
