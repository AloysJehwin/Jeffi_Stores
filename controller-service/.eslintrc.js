// An app imports packages/store-core (@/) and its own code (@controller/), never another app.
module.exports = {
  extends: 'next/core-web-vitals',
  settings: { next: { rootDir: __dirname } },
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['@controller/*', '@storefront/*', '@admin/*', '@business/*'].filter(g => g !== '@controller/*'), message: 'An app must not import another app; shared code lives in packages/store-core.' }] }],
    'import/no-restricted-paths': ['error', { basePath: __dirname, zones: [{ target: './src/lib', from: './src/components', message: 'src/lib must not import src/components.' }] }],
  },
}
