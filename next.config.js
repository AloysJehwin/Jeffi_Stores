const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
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
        source: '/api/gallery/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        ],
      },
      {
        source: '/api/categories',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        ],
      },
    ]
  },
}

module.exports = nextConfig

