module.exports = {
  extends: 'next/core-web-vitals',
  settings: { next: { rootDir: __dirname } },
  rules: {
    'import/no-restricted-paths': [
      'error',
      {
        basePath: __dirname,
        zones: [
          { target: './src/lib', from: './src/app', message: 'src/lib must not import src/app.' },
          { target: './src/lib', from: './src/components', message: 'src/lib must not import src/components.' },
          { target: './src/components', from: './src/app', message: 'src/components must not import src/app.' },
        ],
      },
    ],
  },
}
