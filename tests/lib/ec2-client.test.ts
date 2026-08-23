/**
 * Tests for src/lib/ec2-client.ts — the minimal SigV4-signed EC2 Query-API client
 * used by the pool/tenant provisioning controllers.
 *
 * The AWS network boundary is mocked at two seams:
 *   - @smithy/signature-v4 / @aws-sdk/credential-provider-node → signing is a no-op
 *     (we assert on the params we pass, not on real signatures)
 *   - global.fetch → returns canned EC2 XML responses / errors
 *
 * These pin the XML parsing (xmlTag), the RunInstances env-driven param assembly,
 * the poll loop in waitForState, and the "gone" classification in isInstanceGone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Sign the request without touching real AWS credentials ────────────────────
vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: vi.fn().mockImplementation(function (this: any) {
    this.sign = vi.fn(async (req: any) => ({ ...req, headers: { ...req.headers, authorization: 'AWS4-signed' } }))
  }),
}))
vi.mock('@smithy/protocol-http', () => ({
  HttpRequest: vi.fn().mockImplementation(function (this: any, opts: any) { Object.assign(this, opts) }),
}))
vi.mock('@aws-sdk/credential-provider-node', () => ({ defaultProvider: vi.fn(() => vi.fn()) }))
vi.mock('@aws-crypto/sha256-js', () => ({ Sha256: vi.fn() }))

/** Build a fake fetch Response. */
function res(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

// Minimal EC2 DescribeInstances XML with the tags the client scrapes.
function describeXml(opts: { state?: string; type?: string; ip?: string } = {}) {
  const { state = 'running', type = 't4g.small', ip } = opts
  return `<?xml version="1.0"?><DescribeInstancesResponse>
    <instanceType>${type}</instanceType>
    <instanceState><name>${state}</name></instanceState>
    ${ip ? `<ipAddress>${ip}</ipAddress>` : ''}
  </DescribeInstancesResponse>`
}

describe('ec2-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    // Speed up the poll loop's setTimeout so tests don't wait 8s.
    vi.stubGlobal('setTimeout', ((fn: any) => { fn(); return 0 as any }) as any)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.TENANT_APP_AMI_ID
    delete process.env.TENANT_APP_SECURITY_GROUP
    delete process.env.TENANT_RDS_SECURITY_GROUP
    delete process.env.TENANT_APP_SUBNET_ID
    delete process.env.TENANT_APP_IAM_PROFILE
    delete process.env.TENANT_APP_KEY_NAME
  })

  // ── ec2() error handling (via a public wrapper) ────────────────────────────
  describe('ec2() request/error handling', () => {
    it('throws with status + body slice when the API returns non-2xx', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(403, 'UnauthorizedOperation: nope')))
      const { describeInstance } = await import('@/lib/ec2-client')
      await expect(describeInstance('i-1')).rejects.toThrow(/DescribeInstances failed \(403\).*UnauthorizedOperation/)
    })

    it('sends a signed POST to the EC2 endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(200, describeXml()))
      vi.stubGlobal('fetch', fetchMock)
      const { describeInstance } = await import('@/lib/ec2-client')
      await describeInstance('i-abc')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec2.us-east-1.amazonaws.com/',
        expect.objectContaining({ method: 'POST' }),
      )
      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers.authorization).toBe('AWS4-signed')
      expect(String(init.body)).toContain('Action=DescribeInstances')
    })
  })

  // ── describeInstance / xmlTag ──────────────────────────────────────────────
  describe('describeInstance', () => {
    it('parses instanceType and state from the XML', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({ state: 'running', type: 'm5.large' }))))
      const { describeInstance } = await import('@/lib/ec2-client')
      const s = await describeInstance('i-1')
      expect(s).toEqual({ instanceType: 'm5.large', state: 'running' })
    })

    it('falls back to empty strings when tags are absent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, '<Response></Response>')))
      const { describeInstance } = await import('@/lib/ec2-client')
      const s = await describeInstance('i-1')
      expect(s).toEqual({ instanceType: '', state: '' })
    })
  })

  // ── simple action wrappers ─────────────────────────────────────────────────
  describe('stop / start / modifyInstanceType', () => {
    it('stopInstance issues StopInstances', async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<ok/>'))
      vi.stubGlobal('fetch', fetchMock)
      const { stopInstance } = await import('@/lib/ec2-client')
      await stopInstance('i-1')
      expect(String(fetchMock.mock.calls[0][1].body)).toContain('Action=StopInstances')
    })

    it('startInstance issues StartInstances', async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<ok/>'))
      vi.stubGlobal('fetch', fetchMock)
      const { startInstance } = await import('@/lib/ec2-client')
      await startInstance('i-1')
      expect(String(fetchMock.mock.calls[0][1].body)).toContain('Action=StartInstances')
    })

    it('modifyInstanceType issues ModifyInstanceAttribute with the new type', async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<ok/>'))
      vi.stubGlobal('fetch', fetchMock)
      const { modifyInstanceType } = await import('@/lib/ec2-client')
      await modifyInstanceType('i-1', 't4g.medium')
      const body = String(fetchMock.mock.calls[0][1].body)
      expect(body).toContain('Action=ModifyInstanceAttribute')
      expect(body).toContain('InstanceType.Value=t4g.medium')
    })
  })

  // ── waitForState — the poll loop ───────────────────────────────────────────
  describe('waitForState', () => {
    it('returns once the instance reaches the wanted state', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(res(200, describeXml({ state: 'pending' })))
        .mockResolvedValueOnce(res(200, describeXml({ state: 'pending' })))
        .mockResolvedValueOnce(res(200, describeXml({ state: 'running' })))
      vi.stubGlobal('fetch', fetchMock)
      const { waitForState } = await import('@/lib/ec2-client')
      await expect(waitForState('i-1', 'running')).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('throws once the timeout budget is exceeded without reaching the state', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({ state: 'pending' }))))
      const { waitForState } = await import('@/lib/ec2-client')
      // timeoutMs of 0 means the loop condition is immediately false → straight to throw.
      await expect(waitForState('i-1', 'running', 0)).rejects.toThrow(/did not reach 'running'/)
    })
  })

  // ── runInstance — env-driven param assembly ────────────────────────────────
  describe('runInstance', () => {
    it('throws when TENANT_APP_AMI_ID is not set (no billable launch)', async () => {
      const { runInstance } = await import('@/lib/ec2-client')
      await expect(runInstance({ instanceType: 't4g.small', name: 'x' })).rejects.toThrow(/TENANT_APP_AMI_ID is not set/)
    })

    it('returns the parsed instanceId and includes only the configured optional params', async () => {
      process.env.TENANT_APP_AMI_ID = 'ami-123'
      process.env.TENANT_APP_SECURITY_GROUP = 'sg-1'
      process.env.TENANT_APP_SUBNET_ID = 'subnet-1'
      process.env.TENANT_APP_IAM_PROFILE = 'role-1'
      process.env.TENANT_APP_KEY_NAME = 'key-1'
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<RunInstancesResponse><instanceId>i-new</instanceId></RunInstancesResponse>'))
      vi.stubGlobal('fetch', fetchMock)
      const { runInstance } = await import('@/lib/ec2-client')
      const out = await runInstance({ instanceType: 't4g.small', name: 'jeffi-tenant-acme', userData: 'echo hi' })
      expect(out).toEqual({ instanceId: 'i-new' })
      const body = String(fetchMock.mock.calls[0][1].body)
      expect(body).toContain('Action=RunInstances')
      expect(body).toContain('ImageId=ami-123')
      expect(body).toContain('SecurityGroupId.1=sg-1')
      expect(body).toContain('SubnetId=subnet-1')
      expect(body).toContain('KeyName=key-1')
      expect(body).toContain('IamInstanceProfile.Name=role-1')
      // userData is base64-encoded.
      expect(body).toContain(`UserData=${encodeURIComponent(Buffer.from('echo hi', 'utf8').toString('base64'))}`)
    })

    it('falls back to TENANT_RDS_SECURITY_GROUP when the app SG is unset, and omits blanks', async () => {
      process.env.TENANT_APP_AMI_ID = 'ami-123'
      process.env.TENANT_RDS_SECURITY_GROUP = 'sg-rds'
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<r><instanceId>i-2</instanceId></r>'))
      vi.stubGlobal('fetch', fetchMock)
      const { runInstance } = await import('@/lib/ec2-client')
      await runInstance({ instanceType: 't4g.small', name: 'x' })
      const body = String(fetchMock.mock.calls[0][1].body)
      expect(body).toContain('SecurityGroupId.1=sg-rds')
      expect(body).not.toContain('SubnetId=')
      expect(body).not.toContain('KeyName=')
      expect(body).not.toContain('UserData=')
    })

    it('throws when RunInstances returns no instanceId', async () => {
      process.env.TENANT_APP_AMI_ID = 'ami-123'
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, '<RunInstancesResponse></RunInstancesResponse>')))
      const { runInstance } = await import('@/lib/ec2-client')
      await expect(runInstance({ instanceType: 't4g.small', name: 'x' })).rejects.toThrow(/returned no instanceId/)
    })
  })

  // ── getInstanceIp ──────────────────────────────────────────────────────────
  describe('getInstanceIp', () => {
    it('returns the public ipAddress when assigned', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({ ip: '52.1.2.3' }))))
      const { getInstanceIp } = await import('@/lib/ec2-client')
      await expect(getInstanceIp('i-1')).resolves.toBe('52.1.2.3')
    })

    it('returns null when no IP has been assigned yet', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({}))))
      const { getInstanceIp } = await import('@/lib/ec2-client')
      await expect(getInstanceIp('i-1')).resolves.toBeNull()
    })
  })

  // ── terminateInstance / isInstanceGone ─────────────────────────────────────
  describe('terminate / isInstanceGone', () => {
    it('terminateInstance issues TerminateInstances', async () => {
      const fetchMock = vi.fn().mockResolvedValue(res(200, '<ok/>'))
      vi.stubGlobal('fetch', fetchMock)
      const { terminateInstance } = await import('@/lib/ec2-client')
      await terminateInstance('i-1')
      expect(String(fetchMock.mock.calls[0][1].body)).toContain('Action=TerminateInstances')
    })

    it('reports gone when the instance is terminated', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({ state: 'terminated' }))))
      const { isInstanceGone } = await import('@/lib/ec2-client')
      await expect(isInstanceGone('i-1')).resolves.toBe(true)
    })

    it('reports gone when the state is empty (no such instance row)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, '<Response></Response>')))
      const { isInstanceGone } = await import('@/lib/ec2-client')
      await expect(isInstanceGone('i-1')).resolves.toBe(true)
    })

    it('reports NOT gone when the instance is still running', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, describeXml({ state: 'running' }))))
      const { isInstanceGone } = await import('@/lib/ec2-client')
      await expect(isInstanceGone('i-1')).resolves.toBe(false)
    })

    it('classifies a NotFound API error as gone', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400, 'InvalidInstanceID.NotFound: does not exist')))
      const { isInstanceGone } = await import('@/lib/ec2-client')
      await expect(isInstanceGone('i-1')).resolves.toBe(true)
    })

    it('re-classifies an unrelated API error as NOT gone (do not delete siblings)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, 'InternalError: try later')))
      const { isInstanceGone } = await import('@/lib/ec2-client')
      await expect(isInstanceGone('i-1')).resolves.toBe(false)
    })
  })
})
