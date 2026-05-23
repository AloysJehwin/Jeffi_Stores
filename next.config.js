const ALLOWED_ORIGINS = [
  'https://jeffistores.in',
  'https://www.jeffistores.in',
  'https://admin.jeffistores.in',
].join(' ')

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com https://lh3.googleusercontent.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://api.razorpay.com https://oauth2.googleapis.com https://dm9rri2wgl1e.cloudfront.net",
  "frame-src https://checkout.razorpay.com https://accounts.google.com",
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
