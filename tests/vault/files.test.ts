import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockWithTransaction = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}))

// Mirrors route handlers: the ALS tenant is EMPTY there, only the request-resolved tenant is set.
// A regression back to getCurrentTenantId() would fall into the untracked/default-quota branch.
let currentTenantId: string | null = 'tenant-1'
vi.mock('@/lib/tenancy/tenant-context', () => ({
  getCurrentTenantId: () => null,
  resolveTenantId: async () => currentTenantId,
}))

const mockCpQuery = vi.fn()
vi.mock('@/lib/tenant-registry/shared', () => ({
  controlPlanePool: () => ({ query: (...a: any[]) => mockCpQuery(...a) }),
}))

const driver = {
  name: 'local' as const,
  readHead: vi.fn(async (_k: string, n: number) => PDF.subarray(0, n)),
  signUpload: vi.fn(async (_key: string, _mime: string) => '/api/vault/local/vault-staging/tenant-1/p1/file-1.pdf?t=x'),
  signDownload: vi.fn(async () => '/api/vault/local/vault/tenant-1/p1/file-1.pdf?t=y'),
  size: vi.fn(async () => 1000),
  delete: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
}
vi.mock('@/lib/vault/storage', () => ({
  getStorageDriver: () => driver,
  vaultKey: (t: string | null, p: string, f: string, e: string) => `vault/${t || 'platform'}/${p}/${f}.${e}`,
  vaultStagingKey: (t: string | null, p: string, f: string, e: string) =>
    `vault-staging/${t || 'platform'}/${p}/${f}.${e}`,
}))

import {
  classifyUpload,
  extensionOf,
  sniffKind,
  reserveUpload,
  completeUpload,
  deleteFile,
  VaultFileError,
} from '@/lib/vault/files'

const HTML = Buffer.from('<!DOCTYPE html><html>', 'ascii')
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function planLimits(over: Partial<Record<string, number>> = {}) {
  return {
    rows: [
      {
        storage_quota_bytes: String(over.quota ?? 10 * 1024 ** 3),
        max_file_bytes: String(over.max ?? 5 * 1024 ** 3),
        used_storage_bytes: String(over.used ?? 0),
        file_count: over.files ?? 0,
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTenantId = 'tenant-1'
  driver.readHead.mockImplementation(async (_k: string, n: number) => PDF.subarray(0, n))
})

describe('classify + sniff', () => {
  it('extensionOf', () => {
    expect(extensionOf('Movie.MP4')).toBe('mp4')
    expect(extensionOf('noext')).toBe('')
  })

  it('allows a declared pdf, rejects html and type/ext mismatch', () => {
    expect(classifyUpload('a.pdf', 'application/pdf')).toEqual({ ext: 'pdf', kind: 'pdf', mime: 'application/pdf' })
    expect(classifyUpload('a.epub', '')).toEqual({ ext: 'epub', kind: 'other', mime: 'application/epub+zip' })
    expect(classifyUpload('a.svg', 'image/svg+xml')).toBeNull()
    expect(classifyUpload('a.html', 'text/html')).toBeNull()
    expect(classifyUpload('a.pdf', 'image/png')).toBeNull()
  })

  it('sniffs magic numbers', () => {
    expect(sniffKind(PDF)).toBe('pdf')
    expect(sniffKind(PNG)).toBe('image')
    expect(sniffKind(HTML)).toBeNull()
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypisom', 'ascii')])
    expect(sniffKind(mp4)).toBe('video')
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypM4A ', 'ascii')])
    expect(sniffKind(m4a)).toBe('audio')
  })
})

describe('reserveUpload', () => {
  it('rejects an unsupported type before any upload URL is issued', async () => {
    await expect(
      reserveUpload({ productId: 'p1', displayName: 'x.exe', mimeType: 'application/x-msdownload', declaredBytes: 10 })
    ).rejects.toMatchObject({ status: 415 })
    expect(driver.signUpload).not.toHaveBeenCalled()
  })

  it('rejects when the file exceeds the per-file cap', async () => {
    mockCpQuery.mockResolvedValueOnce(planLimits({ max: 1000 }))
    await expect(
      reserveUpload({ productId: 'p1', displayName: 'x.pdf', mimeType: 'application/pdf', declaredBytes: 2000 })
    ).rejects.toMatchObject({ status: 413 })
  })

  it('counts open reservations against the quota', async () => {
    mockCpQuery.mockResolvedValueOnce(planLimits({ quota: 1000, used: 500 }))
    mockQueryOne.mockResolvedValueOnce({ bytes: '400' })
    await expect(
      reserveUpload({ productId: 'p1', displayName: 'x.pdf', mimeType: 'application/pdf', declaredBytes: 200 })
    ).rejects.toMatchObject({ status: 413 })
    expect(driver.signUpload).not.toHaveBeenCalled()
  })

  it('rejects when used + declared exceeds the quota', async () => {
    mockCpQuery.mockResolvedValueOnce(planLimits({ quota: 1000, used: 900 }))
    mockQueryOne.mockResolvedValueOnce({ bytes: '0' })
    await expect(
      reserveUpload({ productId: 'p1', displayName: 'x.pdf', mimeType: 'application/pdf', declaredBytes: 200 })
    ).rejects.toMatchObject({ status: 413 })
  })

  it('issues an upload URL and opens a session when within quota', async () => {
    mockCpQuery.mockResolvedValueOnce(planLimits())
    mockQueryOne.mockResolvedValueOnce({ bytes: '0' }).mockResolvedValueOnce({ id: 'sess-1' })
    const r = await reserveUpload({
      productId: 'p1',
      displayName: 'x.pdf',
      mimeType: 'application/pdf',
      declaredBytes: 500,
    })
    expect(r.sessionId).toBe('sess-1')
    expect(r.kind).toBe('pdf')
    expect(r.mimeType).toBe('application/pdf')
    expect(driver.signUpload).toHaveBeenCalledOnce()
    // Uploads go to the tenant-scoped STAGING prefix, never straight to a served key.
    expect(driver.signUpload.mock.calls[0][0]).toMatch(/^vault-staging\/tenant-1\/p1\/[0-9a-f-]+\.pdf$/)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO upload_sessions'), expect.any(Array))
  })

  it('reads the plan quota for the request tenant (not the empty ALS tenant)', async () => {
    mockCpQuery.mockResolvedValueOnce(planLimits())
    mockQueryOne.mockResolvedValueOnce({ bytes: '0' }).mockResolvedValueOnce({ id: 'sess-1' })
    await reserveUpload({ productId: 'p1', displayName: 'x.pdf', mimeType: 'application/pdf', declaredBytes: 500 })
    expect(mockCpQuery.mock.calls[0][1]).toEqual(['tenant-1'])
  })
})

describe('completeUpload', () => {
  const STAGING = 'vault-staging/tenant-1/p1/file-1.pdf'
  const FINAL = 'vault/tenant-1/p1/file-1.pdf'
  const openSession = {
    id: 'sess-1',
    product_id: 'p1',
    storage_driver: 'local',
    storage_key: STAGING,
    display_name: 'x.pdf',
    mime_type: 'application/pdf',
    declared_bytes: '500',
    status: 'open',
  }
  // load session, then the atomic open→completed claim
  const loadAndClaim = () => mockQueryOne.mockResolvedValueOnce(openSession).mockResolvedValueOnce({ id: 'sess-1' })
  const isClaimUsage = (c: any[]) => String(c[0]).includes('<= COALESCE(p.storage_quota_bytes')
  const isRefund = (c: any[]) => String(c[0]).includes('used_storage_bytes = GREATEST')

  it('rejects when the sniffed bytes disagree with the declared kind, and deletes the staged object', async () => {
    loadAndClaim()
    driver.size.mockResolvedValueOnce(1000)
    driver.readHead.mockResolvedValueOnce(HTML)
    await expect(completeUpload({ productId: 'p1', sessionId: 'sess-1' })).rejects.toMatchObject({ status: 415 })
    expect(driver.delete).toHaveBeenCalledWith(STAGING)
    expect(driver.move).not.toHaveBeenCalled()
  })

  it('claims usage atomically, promotes staging → final, and inserts the FINAL key', async () => {
    loadAndClaim()
    driver.size.mockResolvedValueOnce(1234)
    mockCpQuery.mockResolvedValueOnce(planLimits()) // per-file cap read
    mockCpQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'tenant-1' }] }) // claimUsage
    const insertedRow = { id: 'pf-1', kind: 'pdf', size_bytes: '1234' }
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [insertedRow] }) }
    mockWithTransaction.mockImplementationOnce(async (fn: any) => fn(client))

    const file = await completeUpload({ productId: 'p1', sessionId: 'sess-1', downloadable: true })
    expect(file.id).toBe('pf-1')
    expect(mockQueryOne.mock.calls[1][0]).toContain("status='open'")
    const claim = mockCpQuery.mock.calls.find(isClaimUsage)
    expect(claim?.[1]).toEqual(['tenant-1', 1234])
    expect(driver.move).toHaveBeenCalledWith(STAGING, FINAL)
    const insertCall = client.query.mock.calls[0]
    expect(insertCall[0]).toContain('INSERT INTO product_files')
    expect(insertCall[1]).toContain('pdf')
    expect(insertCall[1]).toContain(1234)
    expect(insertCall[1]).toContain(FINAL)
    expect(insertCall[1]).not.toContain(STAGING)
    expect(mockCpQuery.mock.calls.some(isRefund)).toBe(false)
  })

  it('rejects with 413 when the atomic quota claim fails, without promoting', async () => {
    loadAndClaim()
    driver.size.mockResolvedValueOnce(1234)
    mockCpQuery.mockResolvedValueOnce(planLimits())
    mockCpQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }) // claimUsage refused
    await expect(completeUpload({ productId: 'p1', sessionId: 'sess-1' })).rejects.toMatchObject({ status: 413 })
    expect(driver.move).not.toHaveBeenCalled()
    expect(driver.delete).toHaveBeenCalledWith(STAGING)
  })

  it('refunds usage and deletes the promoted object when the insert fails', async () => {
    loadAndClaim()
    driver.size.mockResolvedValueOnce(1234)
    mockCpQuery.mockResolvedValueOnce(planLimits())
    mockCpQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'tenant-1' }] })
    mockWithTransaction.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    mockCpQuery.mockResolvedValueOnce({ rows: [] }) // refund
    await expect(completeUpload({ productId: 'p1', sessionId: 'sess-1' })).rejects.toThrow('db down')
    expect(mockCpQuery.mock.calls.find(isRefund)?.[1]).toEqual(['tenant-1', -1234, -1])
    expect(driver.delete).toHaveBeenCalledWith(FINAL)
  })

  it('rejects a second complete of the same session before claiming usage or moving bytes', async () => {
    mockQueryOne.mockResolvedValueOnce(openSession).mockResolvedValueOnce(null) // claim lost
    await expect(completeUpload({ productId: 'p1', sessionId: 'sess-1' })).rejects.toMatchObject({ status: 409 })
    expect(mockCpQuery).not.toHaveBeenCalled()
    expect(driver.move).not.toHaveBeenCalled()
  })

  it('aborts when the uploaded object is empty', async () => {
    loadAndClaim()
    driver.size.mockResolvedValueOnce(0)
    await expect(completeUpload({ productId: 'p1', sessionId: 'sess-1' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('deleteFile', () => {
  it('deletes the object, drops the row, and decrements usage', async () => {
    mockQueryOne.mockResolvedValueOnce({ storage_key: 'k', size_bytes: '500' })
    mockCpQuery.mockResolvedValueOnce({ rows: [] })
    const ok = await deleteFile('p1', 'pf-1')
    expect(ok).toBe(true)
    expect(driver.delete).toHaveBeenCalledWith('k')
    const bump = mockCpQuery.mock.calls.find(c => String(c[0]).includes('used_storage_bytes = GREATEST'))
    expect(bump?.[1]).toEqual(['tenant-1', -500, -1])
  })

  it('returns false when the file is unknown', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    expect(await deleteFile('p1', 'nope')).toBe(false)
  })
})
