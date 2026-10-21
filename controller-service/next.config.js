const path = require('path')

const ALLOWED_ORIGINS = [
  'https://jeffistores.in',
  'https://www.jeffistores.in',
  'https://admin.jeffistores.in',
  'https://invoice.jeffistores.in',
  'https://business.jeffistores.in',
].join(' ')

// Private vault bucket (presigned uploads, media streams, PDF fetches). Baked in at build time.
const VAULT_BUCKET = process.env.VAULT_S3_BUCKET || 'jeffi-stores-vault'
const VAULT_ORIGINS = `https://${VAULT_BUCKET}.s3.us-east-1.amazonaws.com https://${VAULT_BUCKET}.s3.amazonaws.com`

// Google AdSense (ad script, ad frames, reporting pings) on storefronts that show ads.
const ADSENSE_SCRIPT =
  'https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://*.googlesyndication.com https://*.adtrafficquality.google https://www.googletagservices.com https://adservice.google.com https://adservice.google.co.in https://fundingchoicesmessages.google.com'
const ADSENSE_FRAME =
  'https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://www.google.com https://fundingchoicesmessages.google.com'
const ADSENSE_CONNECT =
  'https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://adservice.google.com https://adservice.google.co.in https://fundingchoicesmessages.google.com'
const ADSENSE_IMG = 'https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://*.gstatic.com'

const CSP = [
  "default-src 'self' https://*.jeffistores.in",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://maps.googleapis.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://dm9rri2wgl1e.cloudfront.net ${ADSENSE_SCRIPT}`,
  "style-src 'self' 'unsafe-inline' https://*.jeffistores.in https://fonts.googleapis.com https://maps.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `connect-src 'self' https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://oauth2.googleapis.com https://maps.googleapis.com https://dm9rri2wgl1e.cloudfront.net https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.merchant-center-analytics.goog https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://pagead2.googlesyndication.com https://td.doubleclick.net https://*.google-analytics.com https://*.analytics.google.com ${VAULT_ORIGINS} ${ADSENSE_CONNECT}`,
  `media-src 'self' blob: ${VAULT_ORIGINS}`,
  `img-src 'self' data: blob: https://*.jeffistores.in https://*.razorpay.com https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com https://lh3.googleusercontent.com https://maps.gstatic.com https://maps.googleapis.com https://www.google-analytics.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://www.google.co.in https://td.doubleclick.net ${ADSENSE_IMG}`,
  `frame-src data: https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://www.googletagmanager.com https://td.doubleclick.net ${ADSENSE_FRAME}`,
  // Protected Audience (remarketing) ads render in fenced frames, which Chrome loads only when https: is allowed.
  'fenced-frame-src https:',
  'child-src https://*.razorpay.com blob:',
  "worker-src 'self' blob: https://dm9rri2wgl1e.cloudfront.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.jeffistores.in",
].join('; ')

// Vault hosts (vault. / vault-{slug}.) get a locked-down policy: no eval, no third-party scripts,
// no framing, network limited to self + the vault bucket.
const VAULT_HOST_RE = 'vault(-[a-z0-9-]+)?\\.jeffistores\\.in'
const VAULT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `connect-src 'self' ${VAULT_ORIGINS}`,
  `media-src 'self' blob: ${VAULT_ORIGINS}`,
  `img-src 'self' data: blob: https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com ${VAULT_ORIGINS}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig = {
  output: 'standalone',
  // The app lives in controller-service/; workspace packages and node_modules sit at the repo root.
  outputFileTracingRoot: path.join(__dirname, '..'),
  turbopack: { root: path.join(__dirname, '..') },
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    instrumentationHook: true,
    outputFileTracingIncludes: {
      '/api/admin/orders/[id]/shipping-label': ['../node_modules/pdfkit/js/data/**/*'],
      '/api/vault/pdf-worker': ['../node_modules/pdfjs-dist/build/pdf.worker.min.mjs'],
    },
  },
  serverExternalPackages: ['pdfkit', 'ioredis', 'pg'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'jeffi-stores-bucket.s3.us-east-1.amazonaws.com' },
      { protocol: 'https', hostname: '*.s3.*.amazonaws.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
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
  async headers() {
    return [
      {
        source: '/(.*)',
        // public.<domain> is public-api-service (proxied through Next only in dev); it sets its own headers.
        missing: [{ type: 'host', value: 'public\\..*' }],
        headers: [{ key: 'Content-Security-Policy', value: CSP }],
      },
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
    ]
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      const ioredisStub = require.resolve('./src/lib/shared/ioredis-stub.js')
      if (!config.resolve) config.resolve = {}
      if (!config.resolve.alias) config.resolve.alias = {}
      config.resolve.alias['ioredis'] = ioredisStub
    } else {
      const existingExternals = config.externals || []
      config.externals = [
        ...(Array.isArray(existingExternals) ? existingExternals : [existingExternals]),
        function (context, request, callback) {
          if (request === 'ioredis' || request.startsWith('ioredis/')) {
            return callback(null, 'commonjs ' + request)
          }
          callback()
        },
      ]
    }
    return config
  },
}

module.exports = nextConfig
