import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// S3 SDK: record PutObjectCommand inputs, capture send calls.
const s3Send = vi.fn().mockResolvedValue({})
const putCommandInputs: any[] = []
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(public cfg: any) {}
    send = s3Send
  },
  PutObjectCommand: class {
    constructor(public input: any) {
      putCommandInputs.push(input)
    }
  },
}))

vi.mock('node:crypto', () => ({ randomUUID: () => 'fixed-uuid' }))

// controlPlanePool().query drives the storage-cap checks.
const cpQuery = vi.fn()
vi.mock('../src/pools', () => ({
  controlPlanePool: () => ({ query: cpQuery }),
  PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000',
}))

// currentTenant is toggled per test.
const currentTenant = vi.fn()
vi.mock('../src/context', () => ({ currentTenant: () => currentTenant() }))

const ENV = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  putCommandInputs.length = 0
  s3Send.mockResolvedValue({})
  currentTenant.mockReturnValue(null)
})
afterEach(() => {
  process.env = { ...ENV }
})

// Re-import with chosen env (module reads env at load time).
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return import('../src/s3')
}

describe('currentBucket', () => {
  it('returns the default bucket when no tenant override', async () => {
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', AWS_REGION: 'us-east-1' })
    expect(m.currentBucket()).toBe('default-bkt')
  })

  it("returns the tenant's bucket when set", async () => {
    currentTenant.mockReturnValue({ infra: { s3Bucket: 'tenant-bkt' } })
    const m = await load({ S3_BUCKET_NAME: 'default-bkt' })
    expect(m.currentBucket()).toBe('tenant-bkt')
  })
})

describe('publicUrl / getS3Url', () => {
  it('uses CloudFront for the default bucket when configured', async () => {
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', CLOUDFRONT_URL: 'https://cdn.test/' })
    expect(m.publicUrl('default-bkt', 'a/b.png')).toBe('https://cdn.test/a/b.png')
  })

  it('uses the S3 URL for a non-default bucket', async () => {
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', CLOUDFRONT_URL: 'https://cdn.test', AWS_REGION: 'eu-west-1' })
    expect(m.publicUrl('other', 'a/b.png')).toBe('https://other.s3.eu-west-1.amazonaws.com/a/b.png')
  })

  it('uses the S3 URL for the default bucket when no CloudFront', async () => {
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', CLOUDFRONT_URL: undefined, AWS_REGION: 'us-east-1' })
    expect(m.publicUrl('default-bkt', 'k')).toBe('https://default-bkt.s3.us-east-1.amazonaws.com/k')
  })

  it('getS3Url prefixes the key with S3_KEY_PREFIX', async () => {
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', S3_KEY_PREFIX: 'prefix', AWS_REGION: 'us-east-1', CLOUDFRONT_URL: undefined })
    expect(m.getS3Url('x.png')).toBe('https://default-bkt.s3.us-east-1.amazonaws.com/prefix/x.png')
  })
})

describe('getTenantS3UsageBytes', () => {
  it('returns the stored usage as a number', async () => {
    cpQuery.mockResolvedValue({ rows: [{ s3_usage_bytes: '2048' }] })
    const m = await load()
    expect(await m.getTenantS3UsageBytes('t-1')).toBe(2048)
    expect(cpQuery).toHaveBeenCalledWith(expect.stringContaining('FROM tenant_infra WHERE tenant_id = $1'), ['t-1'])
  })

  it('returns 0 when unknown', async () => {
    cpQuery.mockResolvedValue({ rows: [] })
    const m = await load()
    expect(await m.getTenantS3UsageBytes('t-1')).toBe(0)
  })
})

describe('isS3CapExceeded', () => {
  it('false when there is no compute spec row', async () => {
    cpQuery.mockResolvedValue({ rows: [] })
    const m = await load()
    expect(await m.isS3CapExceeded('t-1')).toBe(false)
  })

  it('false when the spec has no numeric s3Gb cap', async () => {
    cpQuery.mockResolvedValue({ rows: [{ desired: { storage: {} }, usage: '999999999999' }] })
    const m = await load()
    expect(await m.isS3CapExceeded('t-1')).toBe(false)
  })

  it('true when usage is at or over the cap', async () => {
    cpQuery.mockResolvedValue({ rows: [{ desired: { storage: { s3Gb: 1 } }, usage: String(1024 * 1024 * 1024) }] })
    const m = await load()
    expect(await m.isS3CapExceeded('t-1')).toBe(true)
  })

  it('false when usage is under the cap', async () => {
    cpQuery.mockResolvedValue({ rows: [{ desired: { storage: { s3Gb: 2 } }, usage: '10' }] })
    const m = await load()
    expect(await m.isS3CapExceeded('t-1')).toBe(false)
  })
})

describe('uploadInvoicePDF', () => {
  it('uploads with an inline content-disposition and returns the URL', async () => {
    currentTenant.mockReturnValue(null) // no tenant => guardCap no-op
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', AWS_REGION: 'us-east-1', CLOUDFRONT_URL: undefined, S3_KEY_PREFIX: undefined })
    const url = await m.uploadInvoicePDF(Buffer.from('pdf'), 'INV/2024/1', '2024-25')
    expect(s3Send).toHaveBeenCalledTimes(1)
    const input = putCommandInputs.at(-1)
    expect(input.Bucket).toBe('default-bkt')
    expect(input.Key).toBe('invoices/2024-25/INV-2024-1.pdf') // slashes in number sanitised
    expect(input.ContentType).toBe('application/pdf')
    expect(input.ContentDisposition).toContain('inline')
    expect(url).toBe('https://default-bkt.s3.us-east-1.amazonaws.com/invoices/2024-25/INV-2024-1.pdf')
  })

  it('throws StorageCapExceededError when the tenant is over cap', async () => {
    currentTenant.mockReturnValue({ tenantId: 't-1', infra: { s3Bucket: null } })
    // isS3CapExceeded -> true, then getTenantS3UsageBytes -> usage
    cpQuery
      .mockResolvedValueOnce({ rows: [{ desired: { storage: { s3Gb: 1 } }, usage: String(2 * 1024 * 1024 * 1024) }] })
      .mockResolvedValueOnce({ rows: [{ s3_usage_bytes: '123' }] })
    const m = await load({ S3_BUCKET_NAME: 'default-bkt' })
    await expect(m.uploadInvoicePDF(Buffer.from('x'), 'INV1', '2024-25')).rejects.toBeInstanceOf(m.StorageCapExceededError)
    expect(s3Send).not.toHaveBeenCalled()
  })
})

describe('uploadTemplateAsset', () => {
  it('builds a keyed path with the mime extension and returns key+url', async () => {
    currentTenant.mockReturnValue(null)
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', AWS_REGION: 'us-east-1', CLOUDFRONT_URL: undefined, S3_KEY_PREFIX: undefined })
    const r = await m.uploadTemplateAsset(Buffer.from('img'), 'tpl-9', 'image/png')
    expect(r.key).toBe('template-assets/tpl-9/fixed-uuid.png')
    expect(putCommandInputs.at(-1).CacheControl).toContain('immutable')
    expect(r.url).toContain('template-assets/tpl-9/fixed-uuid.png')
  })

  it('uses the library folder and bin extension for a null id / unknown mime', async () => {
    currentTenant.mockReturnValue(null)
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', CLOUDFRONT_URL: undefined })
    const r = await m.uploadTemplateAsset(Buffer.from('x'), null, 'application/unknown')
    expect(r.key).toBe('template-assets/library/fixed-uuid.bin')
  })
})

describe('uploadCdnAsset', () => {
  it('uploads to the default bucket under the CDN path and returns the CDN URL', async () => {
    currentTenant.mockReturnValue(null)
    const m = await load({ S3_BUCKET_NAME: 'default-bkt', MEDIA_CDN_URL: 'https://media.test', CLOUDFRONT_URL: undefined })
    const r = await m.uploadCdnAsset(Buffer.from('v'), 'video/mp4')
    expect(putCommandInputs.at(-1).Bucket).toBe('default-bkt')
    expect(r.key).toBe('template-assets/media/fixed-uuid.mp4')
    expect(r.url).toBe('https://media.test/template-assets/media/fixed-uuid.mp4')
  })

  it('throws when base is not on the media CDN origin', async () => {
    currentTenant.mockReturnValue(null)
    const m = await load({ MEDIA_CDN_URL: 'https://media.test' })
    await expect(m.uploadCdnAsset(Buffer.from('v'), 'image/png', 'https://evil.test/')).rejects.toThrow('is not our media CDN')
  })

  it('MEDIA_CDN_URL falls back to the hard-coded CloudFront host', async () => {
    const m = await load({ MEDIA_CDN_URL: undefined, CLOUDFRONT_URL: undefined })
    expect(m.MEDIA_CDN_URL).toBe('https://dm9rri2wgl1e.cloudfront.net')
  })
})

describe('s3 client credentials branch', () => {
  it('passes explicit credentials when AWS_ACCESS_KEY_ID is set (exercised via upload)', async () => {
    currentTenant.mockReturnValue(null)
    const m = await load({ AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'secret', S3_BUCKET_NAME: 'default-bkt', CLOUDFRONT_URL: undefined })
    await m.uploadTemplateAsset(Buffer.from('x'), 't', 'image/jpeg')
    expect(s3Send).toHaveBeenCalled()
  })
})
