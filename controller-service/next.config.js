const { baseConfig } = require('../packages/store-core/next.base')

const base = baseConfig({ app: 'controller' })

module.exports = {
  ...base,
  // The platform admin pages share admin.<domain> with admin-service; their chunks load under this
  // prefix, which the ingress (and the dev router) strip before passing to this app (service-routing.ts).
  assetPrefix: '/_controller',
  images: { ...base.images, path: '/_controller/_next/image' },
}
