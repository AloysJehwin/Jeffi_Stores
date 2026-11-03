// Shared Next config for every app (controller, storefront, admin, business). Each app's next.config.js
// calls baseConfig with its name and adds what only its routes need (tracing includes, redirects, headers).
const path = require('path')

const ROOT = path.join(__dirname, '../..')

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

// Public media (CloudFront for the platform bucket, tenant buckets addressed directly): the same hosts
// img-src allows, for <video> playback. Admin video uploads PUT straight to the bucket (presigned).
const MEDIA_ORIGINS = 'https://dm9rri2wgl1e.cloudfront.net https://*.amazonaws.com'
const S3_UPLOAD_ORIGINS = 'https://*.s3.us-east-1.amazonaws.com https://*.s3.amazonaws.com'

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
  `connect-src 'self' https://*.jeffistores.in https://*.razorpay.com https://accounts.google.com https://oauth2.googleapis.com https://maps.googleapis.com https://dm9rri2wgl1e.cloudfront.net https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.merchant-center-analytics.goog https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://pagead2.googlesyndication.com https://td.doubleclick.net https://*.google-analytics.com https://*.analytics.google.com ${VAULT_ORIGINS} ${S3_UPLOAD_ORIGINS} ${ADSENSE_CONNECT}`,
  `media-src 'self' blob: ${MEDIA_ORIGINS} ${VAULT_ORIGINS}`,
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

// Storefront photo resizing (/_next/image). The client helper (lib/shared/image-url.ts) reads the
// same JSON, so it only rewrites URLs this list allows; the env adds this deployment's CDN and bucket.
const IMAGE_OPT = require('./src/lib/shared/image-optimizer.json')
const hostOf = u => {
  try {
    return new URL(u).hostname
  } catch {
    return null
  }
}
const IMAGE_HOSTS = [
  ...new Set(
    [
      ...IMAGE_OPT.hosts,
      hostOf(process.env.CLOUDFRONT_URL),
      process.env.S3_BUCKET_NAME && `${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
    ].filter(Boolean)
  ),
]

/** @param {{ app: 'controller' | 'storefront' | 'admin' | 'business', headers?: object[] }} opts */
function baseConfig({ app, headers = [] }) {
  return {
    output: 'standalone',
    // The apps live in <app>/; packages and node_modules sit at the repo root.
    outputFileTracingRoot: ROOT,
    turbopack: { root: ROOT },
    ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
    reactStrictMode: true,
    devIndicators: false,
    experimental: {
      // Shared code is TS in packages/store-core, outside the app directory.
      externalDir: true,
    },
    env: { JEFFI_APP: app },
    // /_next/ is the storefront's on every host; the other apps load their build output under /_<app>, which
    // the ingress and the dev router strip (ASSET_PREFIX in src/lib/service-routing.ts). Images stay on
    // /_next/image: the storefront's optimizer, which holds public/.
    ...(app === 'storefront' ? {} : { assetPrefix: `/_${app}` }),
    // Bundled, pdfjs can't find its worker ("pdf.worker.mjs" missing); @napi-rs/canvas is native.
    serverExternalPackages: ['pdfkit', 'ioredis', 'pg', 'pdfjs-dist', '@napi-rs/canvas'],
    images: {
      remotePatterns: IMAGE_HOSTS.map(hostname => ({ protocol: 'https', hostname })),
      deviceSizes: IMAGE_OPT.deviceSizes,
      imageSizes: IMAGE_OPT.imageSizes,
      qualities: [IMAGE_OPT.quality, 75],
      // WebP only: AVIF costs several times the CPU to encode and the node has one small vCPU.
      formats: ['image/webp'],
      // Uploads never change in place (keys carry a timestamp/uuid), so a resized copy never goes stale.
      minimumCacheTTL: 60 * 60 * 24 * 365,
      maximumDiskCacheSize: 256 * 1024 * 1024,
    },
    async headers() {
      return [
        {
          source: '/(.*)',
          // public.<domain> is public-api-service (proxied through Next only in dev); it sets its own headers.
          missing: [{ type: 'host', value: 'public\\..*' }],
          headers: [{ key: 'Content-Security-Policy', value: CSP }],
        },
        ...headers,
      ]
    },
    webpack(config, { isServer }) {
      if (!isServer) {
        const ioredisStub = path.join(__dirname, 'src/lib/shared/ioredis-stub.js')
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
}

module.exports = { baseConfig, ALLOWED_ORIGINS, VAULT_HOST_RE, VAULT_CSP }
