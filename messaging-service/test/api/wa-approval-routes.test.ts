import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.MESSAGING_DATABASE_URL = 'postgres://x'

vi.mock('../../src/db.js', () => ({ db: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, one: vi.fn(async () => undefined) }))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('@jeffi/push', () => ({ sendPush: vi.fn(async () => []) }))
vi.mock('../../src/send.js', () => ({
  sendMessage: vi.fn(), getMessage: vi.fn(), resolveTemplate: vi.fn(), systemVars: vi.fn(), assertChannelOn: vi.fn(),
  toApi: (m: any) => m,
  SendError: class SendError extends Error { constructor(public status: number, public code: string, msg: string, public details?: unknown) { super(msg) } },
}))
vi.mock('../../src/templates.js', () => ({ listTemplates: vi.fn(), upsertTemplate: vi.fn(), archiveTemplate: vi.fn(), toApi: (t: any) => t }))
vi.mock('../../src/templates-v2.js', async orig => ({ ...(await orig<any>()), findById: vi.fn(), toApi: (t: any) => t }))
vi.mock('../../src/governance.js', () => ({
  getSettings: vi.fn(async () => ({ editing_enabled: true, review_required: false })),
  putSettings: vi.fn(), standardAllowed: () => true, assertCanEdit: vi.fn(), markReview: vi.fn(), reviewDecision: vi.fn(), reviewQueue: vi.fn(),
}))
vi.mock('../../src/wa-approval.js', () => ({ submit: vi.fn(async () => ({ sid: 'HX1', name: 'n', status: 'pending' })), syncTenant: vi.fn(async () => ({ checked: 2, changed: 1 })), startApprovalSync: vi.fn() }))
vi.mock('../../src/delivery.js', () => ({ applyStatus: vi.fn(), startDeliverySync: vi.fn() }))
vi.mock('../../src/pools.js', () => ({ poolsForTenant: vi.fn(async () => ({ pool: { query: vi.fn() }, pools: {} })) }))
vi.mock('../../src/media.js', () => ({ hostUrl: vi.fn(), hostMedia: vi.fn(), MediaError: class extends Error {} }))
vi.mock('@jeffi/tenancy', async orig => ({ ...(await orig<any>()), resolveServiceScope: vi.fn(async () => ({ tenantId: null, skipStoreTenants: false })), inScope: () => true, verifyLink: vi.fn(() => null), scopeSql: () => ({ sql: 'true', params: [] }) }))
vi.mock('@jeffi/bulk', () => ({
  createJob: vi.fn(), getJob: vi.fn(), listJobs: vi.fn(), listItems: vi.fn(), cancelJob: vi.fn(), retryJob: vi.fn(), jobToApi: (j: any) => j, startWorker: vi.fn(), BulkItemError: class extends Error {},
}))

import { signServiceToken } from '@jeffi/service-auth'
import { app } from '../../src/server'
import * as wa from '../../src/wa-approval'
import * as tplv2 from '../../src/templates-v2'
import * as gov from '../../src/governance'

const auth = (claims = {}) => ({ authorization: `Bearer ${signServiceToken({ service: 'gateway', tenantId: 't1', ...claims })}` })

describe('WhatsApp approval routes (v2 aliases)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /v2/templates/wa/submit-approval submits the template and returns the approval', async () => {
    const res = await app.inject({ method: 'POST', url: '/v2/templates/wa/submit-approval', headers: auth(), payload: { templateId: 'tpl1', name: 'n' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ sid: 'HX1', status: 'pending' })
    expect(wa.submit).toHaveBeenCalledWith(expect.anything(), 't1', undefined, 'tpl1', expect.objectContaining({ name: 'n' }))
  })

  it('submit-approval is refused for an API caller whose template awaits Jeffi review (409)', async () => {
    vi.mocked(tplv2.findById).mockResolvedValueOnce({ variant: { review_status: 'pending' } } as any)
    const res = await app.inject({ method: 'POST', url: '/v2/templates/wa/submit-approval', headers: auth({ service: 'public-api' }), payload: { templateId: 'tpl1' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('template_pending_review')
    expect(gov.assertCanEdit).toHaveBeenCalled()
    expect(wa.submit).not.toHaveBeenCalled()
  })

  it('POST /v2/templates/wa/sync-approval syncs the tenant', async () => {
    const res = await app.inject({ method: 'POST', url: '/v2/templates/wa/sync-approval', headers: auth(), payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ checked: 2, changed: 1 })
    expect(wa.syncTenant).toHaveBeenCalledWith(expect.anything(), 't1')
  })

  it('both routes reject a missing or bad service token', async () => {
    for (const url of ['/v2/templates/wa/submit-approval', '/v2/templates/wa/sync-approval']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer nope' }, payload: {} })).statusCode).toBe(401)
    }
  })
})
