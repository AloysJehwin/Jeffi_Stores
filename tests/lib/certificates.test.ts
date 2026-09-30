import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted so mock factory variables are available before vi.mock hoisting
const { mockMkdtempSync, mockWriteFileSync, mockReadFileSync, mockRmSync, mockExecSync, mockExecFileSync } = vi.hoisted(
  () => ({
    mockMkdtempSync: vi.fn().mockReturnValue('/tmp/cert-abc123'),
    mockWriteFileSync: vi.fn(),
    mockReadFileSync: vi.fn().mockReturnValue(Buffer.from('mock-p12-data')),
    mockRmSync: vi.fn(),
    mockExecSync: vi.fn().mockReturnValue(Buffer.from('')),
    mockExecFileSync: vi.fn().mockReturnValue(Buffer.from('')),
  })
)

vi.mock('fs', () => ({
  default: {
    mkdtempSync: mockMkdtempSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: mockReadFileSync,
    rmSync: mockRmSync,
  },
  mkdtempSync: mockMkdtempSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
}))

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync, execFileSync: mockExecFileSync },
  execSync: mockExecSync,
  execFileSync: mockExecFileSync,
}))

vi.mock('os', () => ({
  default: { tmpdir: vi.fn().mockReturnValue('/tmp') },
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}))

// Mock crypto to get deterministic outputs
// certificates.ts uses `import crypto from 'crypto'` (default import), so we must
// patch both the named exports AND the default export object.
vi.mock('crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('crypto')>()
  const mockRandomBytes = vi.fn().mockImplementation((size: number) => {
    return { toString: (_enc: string) => 'deadbeef'.repeat(size / 4 + 1).slice(0, size * 2) }
  })
  const mockRandomUUID = vi.fn().mockReturnValue('test-uuid-1234-5678-abcd')
  return {
    ...actual,
    default: {
      ...actual,
      randomBytes: mockRandomBytes,
      randomUUID: mockRandomUUID,
    },
    randomBytes: mockRandomBytes,
    randomUUID: mockRandomUUID,
  }
})

import { generateClientCertificate } from '@/lib/certificates'

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdtempSync.mockReturnValue('/tmp/cert-abc123')
  mockReadFileSync.mockReturnValue(Buffer.from('mock-p12-data'))
  mockExecSync.mockReturnValue(Buffer.from(''))
  mockExecFileSync.mockReturnValue(Buffer.from(''))
})

describe('generateClientCertificate', () => {
  it('returns all required fields', async () => {
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    expect(result).toHaveProperty('p12Buffer')
    expect(result).toHaveProperty('p12Password')
    expect(result).toHaveProperty('serialNumber')
    expect(result).toHaveProperty('expiresAt')
    expect(result).toHaveProperty('downloadToken')
  })

  it('p12Buffer is the content read from the p12 file', async () => {
    const mockP12 = Buffer.from('fake-p12-binary-content')
    mockReadFileSync.mockReturnValue(mockP12)
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    expect(result.p12Buffer).toEqual(mockP12)
  })

  it('p12Password is a non-empty hex string', async () => {
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    expect(typeof result.p12Password).toBe('string')
    expect(result.p12Password.length).toBeGreaterThan(0)
  })

  it('serialNumber is a non-empty hex string', async () => {
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    expect(typeof result.serialNumber).toBe('string')
    expect(result.serialNumber.length).toBeGreaterThan(0)
  })

  it('downloadToken is a UUID string', async () => {
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    expect(result.downloadToken).toBe('test-uuid-1234-5678-abcd')
  })

  it('expiresAt is approximately 365 days from now', async () => {
    const before = Date.now()
    const result = await generateClientCertificate('admin_user', 'admin-id-1')
    const after = Date.now()
    const expectedMs = 365 * 24 * 60 * 60 * 1000
    const diff = result.expiresAt.getTime() - before
    expect(diff).toBeGreaterThanOrEqual(expectedMs - 1000)
    expect(diff).toBeLessThanOrEqual(expectedMs + (after - before) + 1000)
  })

  it('runs openssl genrsa command', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    const calls = mockExecFileSync.mock.calls
    expect(calls.some((c: any) => c[0] === 'openssl' && c[1][0] === 'genrsa')).toBe(true)
  })

  it('runs openssl req command to create CSR with subject', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    const calls = mockExecFileSync.mock.calls
    expect(
      calls.some(
        (c: any) => c[0] === 'openssl' && c[1][0] === 'req' && c[1].some((a: string) => a.includes('testadmin'))
      )
    ).toBe(true)
  })

  it('runs openssl x509 to sign the cert', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    const calls = mockExecFileSync.mock.calls
    expect(calls.some((c: any) => c[0] === 'openssl' && c[1][0] === 'x509')).toBe(true)
  })

  it('runs openssl pkcs12 to export the p12', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    const calls = mockExecFileSync.mock.calls
    expect(calls.some((c: any) => c[0] === 'openssl' && c[1][0] === 'pkcs12')).toBe(true)
  })

  it('writes ext.cnf file with required extensions', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    const writeCall = mockWriteFileSync.mock.calls.find((c: any) => String(c[0]).includes('ext.cnf'))
    expect(writeCall).toBeDefined()
    const content = String(writeCall![1])
    expect(content).toContain('clientAuth')
    expect(content).toContain('CA:FALSE')
  })

  it('cleans up temp directory in finally block even if not throwing', async () => {
    await generateClientCertificate('testadmin', 'aid1')
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cert-abc123', { recursive: true, force: true })
  })

  it('cleans up temp directory even if execSync throws', async () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('openssl not found')
    })
    await expect(generateClientCertificate('testadmin', 'aid1')).rejects.toThrow('openssl not found')
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cert-abc123', { recursive: true, force: true })
  })

  it('creates temp dir under os.tmpdir()', async () => {
    await generateClientCertificate('admin_user', 'aid1')
    expect(mockMkdtempSync).toHaveBeenCalledOnce()
    const [dirArg] = mockMkdtempSync.mock.calls[0]
    expect(dirArg).toContain('/tmp')
    expect(dirArg).toContain('cert-')
  })

  it('executes exactly 4 openssl commands', async () => {
    await generateClientCertificate('admin_user', 'aid1')
    expect(mockExecFileSync).toHaveBeenCalledTimes(4)
  })

  // --- Validation branch: invalid username ---

  it('throws on empty string username', async () => {
    await expect(generateClientCertificate('', 'aid1')).rejects.toThrow(
      'Invalid username format for certificate generation'
    )
  })

  it('throws on username longer than 64 characters', async () => {
    const longName = 'a'.repeat(65)
    await expect(generateClientCertificate(longName, 'aid1')).rejects.toThrow(
      'Invalid username format for certificate generation'
    )
  })

  it('throws on username with spaces', async () => {
    await expect(generateClientCertificate('admin user', 'aid1')).rejects.toThrow(
      'Invalid username format for certificate generation'
    )
  })

  it('throws on username with forward slash', async () => {
    await expect(generateClientCertificate('admin/user', 'aid1')).rejects.toThrow(
      'Invalid username format for certificate generation'
    )
  })

  it('throws on username with semicolon', async () => {
    await expect(generateClientCertificate('admin;drop', 'aid1')).rejects.toThrow(
      'Invalid username format for certificate generation'
    )
  })

  it('does not throw for a 64-character username (boundary valid)', async () => {
    const maxName = 'a'.repeat(64)
    await expect(generateClientCertificate(maxName, 'aid1')).resolves.toBeDefined()
  })

  it('does not throw for username with all allowed special chars (. _ @ -)', async () => {
    await expect(generateClientCertificate('user.name_admin@org-1', 'aid1')).resolves.toBeDefined()
  })

  it('does not throw for a single-character username (boundary valid)', async () => {
    await expect(generateClientCertificate('a', 'aid1')).resolves.toBeDefined()
  })

  it('does not call execFileSync when username is invalid', async () => {
    await expect(generateClientCertificate('bad user!', 'aid1')).rejects.toThrow()
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('does not call mkdtempSync when username is invalid', async () => {
    await expect(generateClientCertificate('', 'aid1')).rejects.toThrow()
    expect(mockMkdtempSync).not.toHaveBeenCalled()
  })
})
