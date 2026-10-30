// An app imports packages/store-core (@/) and its own code (@storefront/), never another app.
module.exports = {
  extends: 'next/core-web-vitals',
  settings: { next: { rootDir: __dirname } },
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['@controller/*', '@storefront/*', '@admin/*', '@business/*'].filter(g => g !== '@storefront/*'), message: 'An app must not import another app; shared code lives in packages/store-core.' }] }],
  },
}
