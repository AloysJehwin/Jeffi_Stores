const { baseConfig } = require('../packages/store-core/next.base')

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

// The preview link carries its token in the address: no referrer, never indexed or cached. Listed last, so these win.
const PREVIEW_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-store' },
]

const config = baseConfig({
  app: 'showcase',
  headers: [
    { source: '/(.*)', headers: SECURITY_HEADERS },
    { source: '/preview', headers: PREVIEW_HEADERS },
    { source: '/preview/:path*', headers: PREVIEW_HEADERS },
  ],
})
// Every path on a Showcase host is this app's (site-{slug}.<root>), so it serves /_next/ itself: no asset prefix.
delete config.assetPrefix

module.exports = config
