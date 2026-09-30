import { describe, it, expect, vi } from 'vitest'

// Must be set before s3.ts is evaluated — it reads CLOUDFRONT_URL at module scope.
vi.hoisted(() => {
  process.env.CLOUDFRONT_URL = 'https://cdn.jeffistores.in'
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send() {
      return {}
    }
  },
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
  CopyObjectCommand: class {},
  HeadObjectCommand: class {},
}))
vi.mock('sharp', () => ({ default: () => ({}) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { getS3Url } from '@/lib/s3'
import { runWithTenantContext } from '@/lib/tenant-context'

const TENANT = {
  tenantId: 't-1',
  slug: 'acme',
  displayName: 'Acme',
  plan: 'basic',
  infra: {
    rdsEndpoint: 'ep',
    rdsDb: 'jeffi_stores',
    rdsPort: 5432,
    dbSecretRef: null,
    iamAuth: true,
    s3Bucket: 'jeffi-tenant-acme',
    region: 'us-east-1',
  },
}

describe('a tenant object is addressed in the tenant bucket', () => {
  it('serves the platform store off the platform CDN', async () => {
    const url = await getS3Url('products/p1/img.jpg')
    expect(url).toBe('https://cdn.jeffistores.in/products/p1/img.jpg')
  })

  it('uses the tenant bucket inside tenant context', async () => {
    const url = await runWithTenantContext(TENANT, () => getS3Url('products/p1/img.jpg'))
    expect(url).toContain('jeffi-tenant-acme')
    expect(url).not.toContain('jeffi-stores-bucket')
  })

  it('never serves a tenant object off the platform CDN', async () => {
    const url = await runWithTenantContext(TENANT, () => getS3Url('products/p1/img.jpg'))
    expect(url).not.toContain('cdn.jeffistores.in')
  })
})
