import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { formatKpi, kpi, periodSql, snapshot } from '@/lib/overviews/ops-kpi'
import { rfqAttention, rfqTotals } from '@/lib/overviews/business-rfqs'
import { b2bAttention, b2bTotals } from '@/lib/overviews/business-customers'
import { supplierAttention, supplierTotals } from '@/lib/overviews/suppliers'
import { taskAttention } from '@/lib/overviews/tasks'
import { shelfAttention } from '@/lib/overviews/shelving'
import { teamAttention } from '@/lib/overviews/team'
import { auditAttention } from '@/lib/overviews/audit'
import { agentAttention } from '@/lib/overviews/agent'
import { viewFor } from '@/app/(admin)/admin/tasks/TasksTabs'

const now = new Date('2026-10-16T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

describe('ops-kpi', () => {
  it('computes deltas and leaves snapshots without one', () => {
    expect(kpi('a', 'A', 15, 10, 'count').delta).toBe(0.5)
    expect(kpi('a', 'A', 5, 0, 'count').delta).toBeNull()
    expect(snapshot('b', 'B', 3, 'count')).toMatchObject({ previous: null, delta: null })
  })

  it('formats each kind', () => {
    expect(formatKpi(null, 'count')).toBe('-')
    expect(formatKpi(1234.4, 'count')).toBe('1,234')
    expect(formatKpi(0.2959, 'money')).toBe('Rs 0.30')
    expect(formatKpi(150000, 'money')).toBe('Rs 1,50,000')
    expect(formatKpi(0.125, 'pct')).toBe('12.5%')
    expect(formatKpi(0.5, 'hours')).toBe('30 min')
    expect(formatKpi(5, 'hours')).toBe('5.0 h')
    expect(formatKpi(72, 'hours')).toBe('3.0 d')
  })

  it('binds the current period at $1/$2 and the previous at $3/$4', () => {
    const ps = periodSql({ from: '2026-10-01', to: '2026-10-10' })
    expect(ps.params).toEqual(['2026-10-01', '2026-10-10', '2026-09-21', '2026-09-30'])
    expect(ps.cur('x')).toContain('$1')
    expect(ps.prev('x')).toContain('$3')
    expect(ps.span('x')).toMatch(/\$1.*\$2.*\$3.*\$4/s)
  })
})

describe('B2B RFQs', () => {
  it('totals and conversion', () => {
    expect(rfqTotals({ received: '4', converted: '1', won_value: '500' })).toMatchObject({
      received: 4,
      conversion_rate: 0.25,
      won_value: 500,
    })
    expect(rfqTotals(undefined).conversion_rate).toBeNull()
  })

  it('escalates RFQs waiting over three days', () => {
    const a = rfqAttention(
      [
        { id: 'r1', rfq_number: 'RFQ/1', status: 'pending', company_name: 'Acme', waiting_since: hoursAgo(100) },
        { id: 'r2', rfq_number: 'RFQ/2', status: 'pending', company_name: null, waiting_since: hoursAgo(2) },
      ],
      1,
      0,
      now
    )
    expect(a[0]).toMatchObject({ key: 'awaiting', severity: 'critical', href: '/admin/business/rfqs/r1/view' })
    expect(a[0].title).toContain('1 RFQ')
    expect(a.map(x => x.key)).toEqual(['awaiting', 'offer_accepted'])
  })

  it('says nothing when every RFQ has a reply', () => {
    expect(rfqAttention([], 0, 0, now)).toEqual([])
  })
})

describe('B2B customers', () => {
  it('totals with AOV', () => {
    expect(b2bTotals({ sales: '1000', orders: '4' }, { applications: '2' })).toMatchObject({
      aov: 250,
      applications: 2,
    })
  })

  it('flags pending applications, overdue credit and dormant accounts', () => {
    const a = b2bAttention(
      [{ user_id: 'u', company_name: 'Acme', created_at: hoursAgo(72) }],
      { amount: 5000, count: 2 },
      1,
      now
    )
    expect(a.map(x => [x.key, x.severity])).toEqual([
      ['pending', 'critical'],
      ['overdue', 'warning'],
      ['dormant', 'info'],
    ])
  })
})

describe('suppliers', () => {
  it('on-time rate uses POs with a due date', () => {
    expect(supplierTotals({ delivered: '27', with_expected: '12', on_time: '11' }).on_time_rate).toBeCloseTo(11 / 12)
  })

  it('orders attention by urgency', () => {
    const a = supplierAttention(
      [
        {
          id: 'p1',
          po_number: 'PO-1',
          supplier_name: 'S',
          expected_date: '2026-10-01',
          days_late: 15,
          total_amount: 10,
        },
      ],
      { overdue_amount: 100, overdue_count: 1, due_soon_amount: 50, due_soon_count: 1 },
      2
    )
    expect(a.map(x => x.key)).toEqual(['payables_overdue', 'po_overdue', 'payables_due', 'drafts'])
    expect(a[1]).toMatchObject({ severity: 'critical', href: '/admin/purchase-orders?tab=orders&po=p1' })
  })
})

describe('strips', () => {
  it('tasks: overdue urgent work is critical', () => {
    const a = taskAttention({ open: 10, overdue: 3, overdue_urgent: 1, due_today: 0, unassigned: 2 })
    expect(a.map(x => [x.key, x.severity])).toEqual([
      ['overdue', 'critical'],
      ['unassigned', 'info'],
    ])
  })

  it('shelving: setup hint with no locations, else unshelved stock', () => {
    const base = {
      warehouses: 1,
      locations: 0,
      used: 0,
      products_shelved: 0,
      unshelved_products: 0,
      unshelved_units: 0,
      over_shelved: 0,
    }
    expect(shelfAttention(base).map(x => x.key)).toEqual(['setup'])
    expect(
      shelfAttention({ ...base, locations: 4, used: 3, unshelved_products: 2, unshelved_units: 9 }).map(x => x.key)
    ).toEqual(['unshelved'])
  })

  it('team: missing MFA is critical', () => {
    const a = teamAttention({ admins: 3, active: 3, mfa: 2, no_mfa: 1, idle: 1, certs_expiring: 0, low_recovery: 0 })
    expect(a.map(x => [x.key, x.severity])).toEqual([
      ['mfa', 'critical'],
      ['idle', 'info'],
    ])
  })

  it('audit: failed sign-ins on a member email are critical', () => {
    expect(auditAttention({ risky: 0, deletes: 0, failed: 0, failed_admin: 0 })).toEqual([])
    const a = auditAttention({ risky: 4, deletes: 2, failed: 25, failed_admin: 1 })
    expect(a.map(x => x.key)).toEqual(['failed_admin', 'failed', 'deletes'])
  })

  it('agent: approvals, failures and a high tool error rate', () => {
    const a = agentAttention({ pending: 2, failed: 0, proposed_tools: 1, tool_calls: 20, tool_errors: 8 })
    expect(a.map(x => x.key)).toEqual(['pending', 'tools', 'errors'])
    expect(agentAttention({ pending: 0, failed: 0, proposed_tools: 0, tool_calls: 4, tool_errors: 2 })).toEqual([])
  })
})

describe('overview tab selection', () => {
  const v = (q: string) => viewFor(new URLSearchParams(q))
  it('defaults to overview, keeps old list URLs on the list', () => {
    expect(v('')).toBe('overview')
    expect(v('from=2026-10-01&to=2026-10-10')).toBe('overview')
    expect(v('status=overdue&scope=all')).toBe('list')
    expect(v('tab=cron')).toBe('list')
    expect(v('view=overview&status=open')).toBe('overview')
    expect(v('view=list')).toBe('list')
  })
})
