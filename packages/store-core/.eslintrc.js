// Shared code for every Next app: it must never import an app's own routes or code.
module.exports = {
  extends: 'next/core-web-vitals',
  settings: { next: { rootDir: ['../../controller-service', '../../storefront-service', '../../admin-service', '../../business-service'] } },
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['@controller/*', '@storefront/*', '@admin/*', '@business/*', '@showcase/*'], message: 'packages/store-core must not import an app.' }] }],
    'import/no-restricted-paths': [
      'error',
      {
        basePath: __dirname,
        zones: [
          { target: './src/lib', from: './src/components', message: 'src/lib must not import src/components.' },
        ],
      },
    ],
  },
  // AI Site Studio part registrations map code-section names to the components they render.
  overrides: [{ files: ['src/lib/site/code/parts/**'], rules: { 'import/no-restricted-paths': 'off' } }],
}
