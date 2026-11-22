import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mocks (factory-hoisted; capture nothing external) -----------------------
// pg: default export with a Pool class. We record configs via a module-level array
// read back through vi.mocked after import.
const pgCtorCalls: any[] = []
class FakePool {
  config: any
  on = vi.fn()
  query = vi.fn().mockResolvedValue({ rows: [] })
  connect = vi.fn()
  end = vi.fn().mockResolvedValue(undefined)
  constructor(config: any) {
    this.config = config
    pgCtorCalls.push(config)
  }
}
vi.mock('pg', () => ({ default: { Pool: FakePool } }))

const signerGetAuthToken = vi.fn().mockResolvedValue('iam-token')
const SignerCtor = vi.fn()
vi.mock('@aws-sdk/rds-signer', () => ({
  Signer: class {
    constructor(opts: any) {
      SignerCtor(opts)
    }
    getAuthToken = signerGetAuthToken
  },
}))

const smSend = vi.fn()
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = smSend
  },
  GetSecretValueCommand: class {
    constructor(public input: any) {}
  },
}))

// fs: existsSync false by default so rdsSslOption takes the no-CA branch unless overridden.
const existsSync = vi.fn().mockReturnValue(false)
const readFileSync = vi.fn().mockReturnValue(Buffer.from('CA-PEM'))
vi.mock('node:fs', () => ({ default: { existsSync, readFileSync }, existsSync, readFileSync }))

const ENV = { ...process.env }
beforeEach(() => {
  pgCtorCalls.length = 0
  vi.clearAllMocks()
  existsSync.mockReturnValue(false)
  readFileSync.mockReturnValue(Buffer.from('CA-PEM'))
  signerGetAuthToken.mockResolvedValue('iam-token')
})
afterEach(() => {
  process.env = { ...ENV }
})

// Fresh module graph each time so cp/platform/tenantPools singletons reset.
async function load() {
  vi.resetModules()
  return import('../src/pools')
}

describe('createPgPool', () => {
  it('constructs a pg.Pool and attaches an error handler', async () => {
    const m = await load()
    const p: any = m.createPgPool({ max: 1 })
    expect(p).toBeInstanceOf(FakePool)
    expect(p.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

describe('rdsSslOption', () => {
  it('returns rejectUnauthorized:false when no CA bundle exists', async () => {
    existsSync.mockReturnValue(false)
    const m = await load()
    expect(m.rdsSslOption()).toEqual({ rejectUnauthorized: false })
  })

  it('reads the primary CA bundle when present', async () => {
    existsSync.mockImplementation((p: string) => p.includes('certs') && !p.includes('..'))
    const m = await load()
    const ssl: any = m.rdsSslOption()
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(ssl.ca).toBe('CA-PEM')
  })

  it('falls back to the parent-dir CA bundle', async () => {
    // primary path missing, alt present (path.join collapses '..', so match by call order)
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true)
    const m = await load()
    const ssl: any = m.rdsSslOption()
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(readFileSync).toHaveBeenCalled()
  })
})

describe('rdsIamPassword', () => {
  it('builds a Signer and returns a token-producing fn', async () => {
    const m = await load()
    const fn = m.rdsIamPassword('h.rds.amazonaws.com', 5432, 'app_user', 'us-east-1')
    expect(SignerCtor).toHaveBeenCalledWith({ hostname: 'h.rds.amazonaws.com', port: 5432, region: 'us-east-1', username: 'app_user' })
    await expect(fn()).resolves.toBe('iam-token')
  })
})

describe('mainPool', () => {
  it('builds config from a plain postgres URL (no TLS, no IAM)', async () => {
    delete process.env.DB_IAM_AUTH
    const m = await load()
    m.mainPool('postgres://user:pw@localhost:5432/jeffi_production_ready', 7)
    const cfg = pgCtorCalls.at(-1)
    expect(cfg).toMatchObject({ host: 'localhost', port: 5432, database: 'jeffi_production_ready', user: 'user', password: 'pw', max: 7 })
    expect(cfg.ssl).toBeUndefined()
  })

  it('adds RDS TLS for an rds.amazonaws.com host', async () => {
    existsSync.mockReturnValue(false)
    const m = await load()
    m.mainPool('postgres://u:p@db.abc.us-east-1.rds.amazonaws.com:5432/jeffi_stores')
    expect(pgCtorCalls.at(-1).ssl).toEqual({ rejectUnauthorized: false })
  })

  it('uses an IAM token as the password when DB_IAM_AUTH=true', async () => {
    process.env.DB_IAM_AUTH = 'true'
    process.env.AWS_REGION = 'ap-south-1'
    const m = await load()
    m.mainPool('postgres://app_user@db.x.rds.amazonaws.com:5432/jeffi_stores')
    expect(typeof pgCtorCalls.at(-1).password).toBe('function')
    expect(SignerCtor).toHaveBeenCalledWith(expect.objectContaining({ region: 'ap-south-1', username: 'app_user' }))
  })

  it('defaults the port to 5432 when the URL omits it', async () => {
    delete process.env.DB_IAM_AUTH
    const m = await load()
    m.mainPool('postgres://u:p@localhost/db')
    expect(pgCtorCalls.at(-1).port).toBe(5432)
  })
})

describe('platformPool', () => {
  it('throws when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL
    const m = await load()
    expect(() => m.platformPool()).toThrow('DATABASE_URL is not set')
  })

  it('builds once and caches the pool', async () => {
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db'
    delete process.env.DB_IAM_AUTH
    const m = await load()
    const a = m.platformPool()
    const b = m.platformPool()
    expect(a).toBe(b)
    expect(pgCtorCalls.length).toBe(1)
  })
})

describe('controlPlanePool', () => {
  it('reuses DATABASE_URL (unified DB) when CONTROL_PLANE_DATABASE_URL + IAM are unset', async () => {
    delete process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete process.env.DB_IAM_AUTH
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db'
    const m = await load()
    const p = m.controlPlanePool()
    expect(p).toBeInstanceOf(FakePool)
    expect(m.controlPlanePool()).toBe(p) // cached
  })

  it('throws when nothing is configured', async () => {
    delete process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete process.env.DATABASE_URL
    const m = await load()
    expect(() => m.controlPlanePool()).toThrow('Control-plane DB not configured')
  })

  it('prefers an explicit CONTROL_PLANE_DATABASE_URL', async () => {
    process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://cp:pw@localhost:5432/cp'
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete process.env.DB_IAM_AUTH
    const m = await load()
    m.controlPlanePool()
    expect(pgCtorCalls.at(-1)).toMatchObject({ database: 'cp', user: 'cp', max: 3 })
  })

  it('builds an IAM-auth pool from CONTROL_PLANE_RDS_* when IAM=true', async () => {
    process.env.CONTROL_PLANE_IAM_AUTH = 'true'
    process.env.CONTROL_PLANE_RDS_HOST = 'cp.rds.amazonaws.com'
    process.env.CONTROL_PLANE_RDS_PORT = '5433'
    process.env.CONTROL_PLANE_RDS_USER = 'cp_user'
    process.env.CONTROL_PLANE_RDS_DB = 'jeffi_stores'
    process.env.AWS_REGION = 'us-east-1'
    const m = await load()
    m.controlPlanePool()
    const cfg = pgCtorCalls.at(-1)
    expect(cfg).toMatchObject({ host: 'cp.rds.amazonaws.com', port: 5433, user: 'cp_user', database: 'jeffi_stores' })
    expect(typeof cfg.password).toBe('function')
  })
})

describe('tenantPool / buildTenantPool', () => {
  const infra = (over: Partial<any> = {}) => ({
    rdsEndpoint: 'tenant.rds.amazonaws.com',
    rdsDb: 'jeffi_stores',
    rdsPort: 5432,
    rdsUser: null,
    dbSecretRef: 'secret/ref',
    iamAuth: true,
    s3Bucket: null,
    region: 'us-east-1',
    ...over,
  })
  const tenant = (over: Partial<any> = {}) => ({ tenantId: 't-1', slug: 'acme', displayName: null, plan: null, infra: infra(), ...over })

  it('throws when the tenant has no RDS endpoint', async () => {
    const m = await load()
    expect(() => m.tenantPool(tenant({ infra: null }) as any)).toThrow('has no RDS endpoint')
    expect(() => m.tenantPool(tenant({ infra: infra({ rdsEndpoint: null }) }) as any)).toThrow('has no RDS endpoint')
  })

  it('builds an IAM pool for a remote RDS tenant', async () => {
    const m = await load()
    m.tenantPool(tenant() as any)
    const cfg = pgCtorCalls.at(-1)
    expect(cfg).toMatchObject({ host: 'tenant.rds.amazonaws.com', database: 'jeffi_stores', user: 'app_user' })
    expect(typeof cfg.password).toBe('function')
    expect(SignerCtor).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'tenant.rds.amazonaws.com', region: 'us-east-1' }))
  })

  it('honours infra.rdsUser and RDS_USER fallback for IAM', async () => {
    process.env.RDS_USER = 'env_user'
    const m = await load()
    m.tenantPool(tenant({ infra: infra({ rdsUser: 'own_role' }) }) as any)
    expect(pgCtorCalls.at(-1).user).toBe('own_role')
    m.tenantPool(tenant({ tenantId: 't-2', infra: infra({ rdsUser: null }) }) as any)
    expect(pgCtorCalls.at(-1).user).toBe('env_user')
  })

  it('caches by endpoint/db/user key and reuses the pool', async () => {
    const m = await load()
    const a = m.tenantPool(tenant() as any)
    const b = m.tenantPool(tenant() as any)
    expect(a).toBe(b)
    expect(pgCtorCalls.length).toBe(1)
  })

  it('rebuilds and ends the old pool when the key changes', async () => {
    const m = await load()
    const a: any = m.tenantPool(tenant() as any)
    const b: any = m.tenantPool(tenant({ infra: infra({ rdsDb: 'moved_db' }) }) as any)
    expect(a).not.toBe(b)
    expect(a.end).toHaveBeenCalled()
  })

  it('builds a local no-TLS pool borrowing DATABASE_URL creds', async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgres://localuser:localpw@localhost:5432/db'
    const m = await load()
    m.tenantPool(tenant({ infra: infra({ rdsEndpoint: 'localhost', iamAuth: false, dbSecretRef: null }) }) as any)
    const cfg = pgCtorCalls.at(-1)
    expect(cfg.ssl).toBe(false)
    expect(cfg.user).toBe('localuser')
    expect(cfg.password).toBe('localpw')
  })

  it('password auth: uses the pod env password for the named slug', async () => {
    process.env.NODE_ENV = 'production'
    process.env.TENANT_DB_PASSWORD = 'pod-pw'
    process.env.TENANT_DB_SLUG = 'acme'
    const m = await load()
    m.tenantPool(tenant({ infra: infra({ iamAuth: false }) }) as any)
    const cfg = pgCtorCalls.at(-1)
    expect(cfg.password).toBe('pod-pw')
    expect(cfg.user).toBe('jeffi')
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('password auth: resolves the Secrets Manager password lazily', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TENANT_DB_PASSWORD
    smSend.mockResolvedValue({ SecretString: JSON.stringify({ password: 'sm-pw' }) })
    const m = await load()
    m.tenantPool(tenant({ infra: infra({ iamAuth: false, dbSecretRef: 'secret/db' }) }) as any)
    const cfg = pgCtorCalls.at(-1)
    expect(typeof cfg.password).toBe('function')
    await expect(cfg.password()).resolves.toBe('sm-pw')
  })

  it('password auth: throws when neither IAM, env pw, nor secret ref is set', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TENANT_DB_PASSWORD
    const m = await load()
    expect(() => m.tenantPool(tenant({ infra: infra({ iamAuth: false, dbSecretRef: null }) }) as any)).toThrow(
      'neither IAM auth nor db_secret_ref',
    )
  })

  it('fetchDbSecret throws when the secret has no password', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TENANT_DB_PASSWORD
    smSend.mockResolvedValue({ SecretString: JSON.stringify({ username: 'x' }) })
    const m = await load()
    m.tenantPool(tenant({ infra: infra({ iamAuth: false, dbSecretRef: 'secret/nopw' }) }) as any)
    const cfg = pgCtorCalls.at(-1)
    await expect(cfg.password()).rejects.toThrow('has no password field')
  })
})

describe('PLATFORM_TENANT_ID', () => {
  it('is the all-zero UUID', async () => {
    const m = await load()
    expect(m.PLATFORM_TENANT_ID).toBe('00000000-0000-0000-0000-000000000000')
  })
})
