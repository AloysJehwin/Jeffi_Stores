const ALLOWED_ORIGINS = [
  'https://jeffistores.in',
  'https://www.jeffistores.in',
  'https://admin.jeffistores.in',
  'https://invoice.jeffistores.in',
  'https://business.jeffistores.in',
].join(' ')

const CSP = [
  "default-src 'self' https://*.jeffistores.in",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://maps.googleapis.com https://www.googletagmanager.com https://dm9rri2wgl1e.cloudfront.net",
  "style-src 'self' 'unsafe-inline' https://*.jeffistores.in https://fonts.googleapis.com https://maps.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://oauth2.googleapis.com https://maps.googleapis.com https://dm9rri2wgl1e.cloudfront.net https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.merchant-center-analytics.goog",
  "img-src 'self' data: blob: https://*.jeffistores.in https://*.razorpay.com https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com https://lh3.googleusercontent.com https://maps.gstatic.com https://maps.googleapis.com https://www.google-analytics.com https://www.googletagmanager.com",
  'frame-src data: https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com',
  'child-src https://*.razorpay.com blob:',
  "worker-src 'self' blob: https://dm9rri2wgl1e.cloudfront.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.jeffistores.in",
].join('; ')

const nextConfig = {
  output: 'standalone',
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    instrumentationHook: true,
    outputFileTracingIncludes: {
      '/api/admin/orders/[id]/shipping-label': ['./node_modules/pdfkit/js/data/**/*'],
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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'Content-Security-Policy', value: CSP }],
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
