import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import { getReferralStats, getReferralSummary, listReferralSignups, maskName } from '@/lib/referrals/queries'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const settings = { enabled: true, rewardPoints: 100, yearlyCap: 10, qualifyDays: 90 }

describe('referral read models', () => {
  beforeEach(() => vi.clearAllMocks())

  it('masks a friend to first name and last initial', () => {
    expect(maskName('Rahul', 'sharma')).toBe('Rahul S.')
    expect(maskName('Rahul', null)).toBe('Rahul')
    expect(maskName('  ', 'Sharma')).toBe('A friend')
  })

  it('summarises counts, points and rewards left, and pages friends', async () => {
    mockQueryMany.mockImplementation(async (sql: string) =>
      String(sql).includes('GROUP BY status')
        ? [
            { status: 'joined', n: 3 },
            { status: 'rewarded', n: 2 },
            { status: 'rejected', n: 1 },
          ]
        : [
            {
              id: 's1',
              first_name: 'Rahul',
              last_name: 'Sharma',
              status: 'joined',
              has_ordered: true,
              points: null,
              signed_up_at: '2026-10-01',
              rewarded_at: null,
            },
          ]
    )
    mockQueryOne.mockResolvedValue({ earned: 200, standing: 2 })
    const summary = await getReferralSummary('u1', settings, 2)
    expect(summary.counts).toEqual({ joined: 3, rewarded: 2, reversed: 0, capped: 0, rejected: 1 })
    expect(summary.pointsEarned).toBe(200)
    expect(summary.rewardsLeftThisYear).toBe(8)
    expect(summary.friends).toMatchObject({ total: 6, page: 2, pageSize: 10 })
    expect(summary.friends.items[0]).toMatchObject({ name: 'Rahul S.', hasOrdered: true })
    const listCall = mockQueryMany.mock.calls.find(c => String(c[0]).includes('LIMIT'))!
    expect(listCall[1]).toEqual(['u1', 10, 10])
  })

  it('never reports negative rewards left', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ earned: 0, standing: 12 })
    expect((await getReferralSummary('u1', settings)).rewardsLeftThisYear).toBe(0)
  })

  it('filters the admin list by a known status and search, and ignores unknown statuses', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ total: 0 })
    await listReferralSignups({ page: 2, pageSize: 25, status: 'rewarded', search: ' asha ' })
    expect(mockQueryMany.mock.calls[0][1]).toEqual(['rewarded', '%asha%', 25, 25])
    await listReferralSignups({ page: 1, pageSize: 25, status: 'bogus', search: '' })
    expect(mockQueryMany.mock.calls[1][1]).toEqual([null, null, 25, 0])
  })

  it('totals program stats', async () => {
    mockQueryMany.mockResolvedValue([
      { status: 'rewarded', n: 4 },
      { status: 'rejected', n: 2 },
    ])
    mockQueryOne.mockResolvedValue({ paid: 400, referrers: 3 })
    expect(await getReferralStats()).toEqual({
      signups: 6,
      byStatus: { joined: 0, rewarded: 4, reversed: 0, capped: 0, rejected: 2 },
      pointsPaid: 400,
      referrers: 3,
    })
  })
})
