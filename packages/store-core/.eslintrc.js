// Shared code for every Next app: it must never import an app's own routes or code.
module.exports = {
  extends: 'next/core-web-vitals',
  settings: { next: { rootDir: ['../../controller-service'] } },
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['@controller/*', '@storefront/*', '@admin/*', '@business/*'], message: 'packages/store-core must not import an app.' }] }],
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
}
