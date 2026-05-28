const ALLOWED_ORIGINS = [
  'https://jeffistores.in',
  'https://www.jeffistores.in',
  'https://admin.jeffistores.in',
].join(' ')

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.razorpay.com https://*.google.com https://*.googleapis.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://*.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://*.razorpay.com https://*.google.com https://*.googleapis.com https://dm9rri2wgl1e.cloudfront.net https://*.google-analytics.com https://www.googletagmanager.com",
  "img-src 'self' data: blob: https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com https://*.googleusercontent.com https://*.gstatic.com https://*.googleapis.com https://*.google-analytics.com https://www.googletagmanager.com",
  "frame-src https://*.razorpay.com https://*.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    outputFileTracingIncludes: {
      '/api/admin/orders/[id]/shipping-label': ['./node_modules/pdfkit/js/data/**/*'],
    },
  },
  serverExternalPackages: ['pdfkit'],
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
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
        ],
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
}

module.exports = nextConfig
