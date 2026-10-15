import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const ec2 = vi.hoisted(() => ({ describeActiveInstanceTypes: vi.fn() }))
vi.mock('@/lib/shared/ec2-client', () => ec2)

import { dedicatedCapacityError, vcpusFor, CAPACITY_MESSAGE } from '@/lib/k8s/capacity'

describe('dedicatedCapacityError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVISIONING_COMPUTE = 'k8s'
    process.env.EC2_VCPU_QUOTA = '8'
  })

  it('never blocks Basic (shared pool)', async () => {
    process.env.EC2_VCPU_QUOTA = '1'
    expect(await dedicatedCapacityError('basic')).toBeNull()
    expect(ec2.describeActiveInstanceTypes).not.toHaveBeenCalled()
  })

  it('blocks a dedicated plan when the quota has no room for its node', async () => {
    ec2.describeActiveInstanceTypes.mockResolvedValue(['t4g.large', 't4g.medium', 't4g.small', 't4g.small'])
    expect(await dedicatedCapacityError('growth')).toBe(CAPACITY_MESSAGE)
  })

  it('allows it when there is headroom', async () => {
    ec2.describeActiveInstanceTypes.mockResolvedValue(['t4g.large'])
    expect(await dedicatedCapacityError('enterprise')).toBeNull()
  })

  it('does not guard when the quota is unset or the check fails', async () => {
    delete process.env.EC2_VCPU_QUOTA
    expect(await dedicatedCapacityError('pro')).toBeNull()
    process.env.EC2_VCPU_QUOTA = '2'
    ec2.describeActiveInstanceTypes.mockRejectedValue(new Error('denied'))
    expect(await dedicatedCapacityError('pro')).toBeNull()
  })

  it('counts vCPUs per instance size', () => {
    expect(vcpusFor('t4g.large')).toBe(2)
    expect(vcpusFor('t4g.xlarge')).toBe(4)
  })
})
