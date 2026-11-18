const { baseConfig } = require('../packages/store-core/next.base')

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const config = baseConfig({ app: 'showcase', headers: [{ source: '/(.*)', headers: SECURITY_HEADERS }] })
// Every path on a Showcase host is this app's (site-{slug}.<root>), so it serves /_next/ itself: no asset prefix.
delete config.assetPrefix

module.exports = config
