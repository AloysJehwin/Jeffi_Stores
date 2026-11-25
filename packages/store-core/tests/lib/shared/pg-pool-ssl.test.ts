// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))
vi.mock('fs', () => ({ default: fsMock, ...fsMock }))
vi.mock('@/lib/shared/paths', () => ({ repoPath: (...p: string[]) => ['/repo', ...p].join('/') }))

import { sslFromConfig, dbSslConfig, stripSslParams, rdsSslOption } from '@/lib/shared/pg-pool'

const ENV = { ...process.env }
beforeEach(() => {
  fsMock.existsSync.mockReset().mockReturnValue(true)
  fsMock.readFileSync.mockReset().mockReturnValue('CA-PEM')
})
afterEach(() => {
  process.env = { ...ENV }
})

describe('sslFromConfig', () => {
  it('is undefined when the mode is unset (callers keep their RDS-host default)', () => {
    expect(sslFromConfig(undefined)).toBeUndefined()
    expect(sslFromConfig('')).toBeUndefined()
  })

  it.each([
    ['disable', false],
    ['off', false],
    ['0', false],
    ['require', { rejectUnauthorized: false }],
    ['1', { rejectUnauthorized: false }],
    ['true', { rejectUnauthorized: false }],
    ['verify', { rejectUnauthorized: true }],
    ['verify-full', { rejectUnauthorized: true }],
    ['Verify-CA', { rejectUnauthorized: true }],
  ])('%s → %j', (mode, want) => {
    expect(sslFromConfig(mode)).toEqual(want)
  })

  it('verify reads an absolute CA path as is, and a relative one from the repo root', () => {
    expect(sslFromConfig('verify', '/etc/ssl/azure-pg/ca.pem')).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM' })
    expect(fsMock.readFileSync).toHaveBeenLastCalledWith('/etc/ssl/azure-pg/ca.pem')
    sslFromConfig('verify', 'certs/azure-pg-bundle.pem')
    expect(fsMock.readFileSync).toHaveBeenLastCalledWith('/repo/certs/azure-pg-bundle.pem')
  })

  it('verify takes inline PEM without touching the disk', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
    expect(sslFromConfig('verify', pem)).toEqual({ rejectUnauthorized: true, ca: pem })
    expect(fsMock.readFileSync).not.toHaveBeenCalled()
  })

  it('a configured CA that is missing is an error, never a silent unverified connection', () => {
    fsMock.existsSync.mockReturnValue(false)
    expect(() => sslFromConfig('verify', '/missing.pem')).toThrow('DB_SSL_CA file not found: /missing.pem')
  })

  it('require and disable ignore the CA', () => {
    expect(sslFromConfig('require', '/etc/ca.pem')).toEqual({ rejectUnauthorized: false })
    expect(sslFromConfig('disable', '/etc/ca.pem')).toBe(false)
  })

  it('an unknown mode is an error', () => {
    expect(() => sslFromConfig('strict')).toThrow('DB_SSL must be disable, require or verify (got "strict")')
  })
})

describe('dbSslConfig', () => {
  it('reads DB_SSL and DB_SSL_CA', () => {
    delete process.env.DB_SSL
    expect(dbSslConfig()).toBeUndefined()
    process.env.DB_SSL = 'verify'
    process.env.DB_SSL_CA = '/etc/ssl/azure-pg/ca.pem'
    expect(dbSslConfig()).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM' })
  })
})

describe('stripSslParams', () => {
  it('drops TLS params and keeps the rest', () => {
    expect(stripSslParams('postgresql://u:p%40ss@h.postgres.database.azure.com:5432/db?sslmode=require&application_name=jeffi')).toBe(
      'postgresql://u:p%40ss@h.postgres.database.azure.com:5432/db?application_name=jeffi'
    )
    expect(stripSslParams('postgres://u:p@h/db?sslmode=verify-full&sslrootcert=/x&uselibpqcompat=true')).toBe('postgres://u:p@h/db')
    expect(stripSslParams('postgres://u:p@h/db')).toBe('postgres://u:p@h/db')
  })

  it('leaves an unparseable string alone', () => {
    expect(stripSslParams('not a url')).toBe('not a url')
  })
})

describe('rdsSslOption (unchanged for AWS)', () => {
  it('verifies against the RDS bundle when present, else connects unverified', () => {
    expect(rdsSslOption()).toEqual({ rejectUnauthorized: true, ca: 'CA-PEM' })
    fsMock.existsSync.mockReturnValue(false)
    expect(rdsSslOption()).toEqual({ rejectUnauthorized: false })
  })
})
