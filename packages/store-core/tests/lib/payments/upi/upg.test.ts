import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/payments/upi/upg-logic', () => ({
  LATE_ALERT_MS: 900_000,
  upgPaySeconds: () => 300,
  upgVerifySeconds: () => 120,
}))

import {
  advanceVpa, promoteNext, queueState, markProcessing, markCancelled, insertObservation,
  claimObservation, releaseObservation, trustedObservationByUtr, alertCandidates,
  awaitingIntentByUtr, observationSuggestions, alertStats, openVpas, expireStaleQueued, unappliedUpgIntents,
} from '@/lib/payments/upi/upg'

const q = vi.fn<(...args: any[]) => Promise<{ rows: any[]; rowCount: number | null }>>(async () => ({ rows: [] as any[], rowCount: 0 }))
const db = { query: q }
const intentRow = (over: Record<string, unknown> = {}) => ({ id: 'i1', amount_paise: '5000', refs: null, result: null, provider: 'upg', status: 'active', ...over })
const obsRow = (over: Record<string, unknown> = {}) => ({ id: 'o1', kind: 'credit', amount_paise: '5000', trusted: true, receiving_vpa: 's@ok', ...over })

beforeEach(() => q.mockResolvedValue({ rows: [], rowCount: 0 }))

describe('advanceVpa', () => {
  it('null for a falsy vpa (no query)', async () => {
    expect(await advanceVpa(null, db)).toBeNull()
    expect(await advanceVpa('', db)).toBeNull()
    expect(q).not.toHaveBeenCalled()
  })
  it('runs the due-timer update then promotes the next', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }) // the timer UPDATE
    q.mockResolvedValueOnce({ rows: [intentRow()], rowCount: 1 }) // promoteNext
    const r = await advanceVpa('s@ok', db)
    expect(r?.id).toBe('i1')
    expect(q.mock.calls[0][0]).toContain("status = 'active' THEN 'expired'")
    expect(q.mock.calls[0][1]).toEqual(['s@ok'])
  })
})

describe('promoteNext', () => {
  it('returns the activated intent and passes the pay seconds', async () => {
    q.mockResolvedValueOnce({ rows: [intentRow({ status: 'active' })], rowCount: 1 })
    const r = await promoteNext('s@ok', db)
    expect(r?.status).toBe('active')
    expect(q.mock.calls[0][1]).toEqual(['s@ok', 300])
  })
  it('null on a unique-violation (race lost)', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    expect(await promoteNext('s@ok', db)).toBeNull()
  })
  it('rethrows other errors', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '42P01' }))
    await expect(promoteNext('s@ok', db)).rejects.toThrow('boom')
  })
})

describe('queueState', () => {
  it('reports server clock and the position for a queued intent', async () => {
    const now = new Date('2026-11-10T00:00:00Z')
    q.mockResolvedValueOnce({ rows: [{ now, ahead: 2 }], rowCount: 1 })
    const r = await queueState({ id: 'i1', receiving_vpa: 's@ok', created_at: now.toISOString(), status: 'queued' } as any, db)
    expect(r.serverNow).toBe(now.toISOString())
    expect(r.queuePosition).toBe(3) // 1 + ahead
  })
  it('null position when not queued; defaults now when row missing', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const r = await queueState({ id: 'i1', receiving_vpa: 's@ok', created_at: 'x', status: 'active' } as any, db)
    expect(r.queuePosition).toBeNull()
    expect(typeof r.serverNow).toBe('string')
  })
})

describe('markProcessing / markCancelled', () => {
  it('markProcessing returns the moved intent with verify seconds', async () => {
    q.mockResolvedValueOnce({ rows: [intentRow({ status: 'processing' })], rowCount: 1 })
    const r = await markProcessing('i1', db)
    expect(r?.status).toBe('processing')
    expect(q.mock.calls[0][1]).toEqual(['i1', 120])
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await markProcessing('i1', db)).toBeNull()
  })
  it('markCancelled returns the cancelled intent or null', async () => {
    q.mockResolvedValueOnce({ rows: [intentRow({ status: 'cancelled' })], rowCount: 1 })
    expect((await markCancelled('i1', db))?.status).toBe('cancelled')
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await markCancelled('i1', db)).toBeNull()
  })
})

describe('insertObservation', () => {
  it('inserts and normalises the amount; defaults kind to credit', async () => {
    q.mockResolvedValueOnce({ rows: [obsRow()], rowCount: 1 })
    const r = await insertObservation({ receivingVpa: 's@ok', amountPaise: 5000, utr: 'U', fingerprint: 'f', trusted: true, subject: 'x' }, db)
    expect(r?.amount_paise).toBe(5000)
    expect(q.mock.calls[0][1]![0]).toBe('credit')
  })
  it('null amount stays null; long subject truncated to 300', async () => {
    q.mockResolvedValueOnce({ rows: [obsRow({ amount_paise: null })], rowCount: 1 })
    const r = await insertObservation({ kind: 'gmail_forwarding', receivingVpa: null, amountPaise: null, utr: null, fingerprint: 'g', trusted: false, subject: 's'.repeat(500) }, db)
    expect(r?.amount_paise).toBeNull()
    expect((q.mock.calls[0][1]![10] as string).length).toBe(300)
  })
  it('null on a duplicate fingerprint (23505); rethrows other errors', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    expect(await insertObservation({ receivingVpa: 's@ok', amountPaise: 1, utr: null, fingerprint: 'f', trusted: true }, db)).toBeNull()
    q.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '500' }))
    await expect(insertObservation({ receivingVpa: 's@ok', amountPaise: 1, utr: null, fingerprint: 'f', trusted: true }, db)).rejects.toThrow('x')
  })
})

describe('claimObservation / releaseObservation', () => {
  it('claim true when a row changed, false otherwise', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    expect(await claimObservation('o1', 'i1', db)).toBe(true)
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await claimObservation('o1', 'i1', db)).toBe(false)
  })
  it('release runs the nulling update', async () => {
    await releaseObservation('o1', 'i1', db)
    expect(q.mock.calls[0][0]).toContain('matched_intent_id = NULL')
    expect(q.mock.calls[0][1]).toEqual(['o1', 'i1'])
  })
})

describe('trustedObservationByUtr / awaitingIntentByUtr', () => {
  it('trustedObservationByUtr returns a normalised obs or null', async () => {
    q.mockResolvedValueOnce({ rows: [obsRow()], rowCount: 1 })
    expect((await trustedObservationByUtr('s@ok', 'U', db))?.id).toBe('o1')
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await trustedObservationByUtr('s@ok', 'U', db)).toBeNull()
  })
  it('awaitingIntentByUtr passes vpa/utr/amount', async () => {
    q.mockResolvedValueOnce({ rows: [intentRow({ status: 'awaiting_confirmation' })], rowCount: 1 })
    const r = await awaitingIntentByUtr('s@ok', 'U', 5000, db)
    expect(r?.status).toBe('awaiting_confirmation')
    expect(q.mock.calls[0][1]).toEqual(['s@ok', 'U', 5000])
  })
})

describe('alertCandidates', () => {
  it('maps rows and passes the late-alert window', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'active', amount_paise: '5000' }], rowCount: 1 })
    const r = await alertCandidates('s@ok', db)
    expect(r[0].amount_paise).toBe(5000)
    expect(q.mock.calls[0][1]![1]).toBe(Math.round(900_000 / 1000) + 600)
  })
})

describe('observationSuggestions', () => {
  it('returns an empty map when no intent has a vpa', async () => {
    const out = await observationSuggestions([{ id: 'i1', receiving_vpa: null, amount_paise: 5000, utr: null }], db)
    expect(out.size).toBe(0)
    expect(q).not.toHaveBeenCalled()
  })
  it('groups observations matching amount or UTR under each intent id', async () => {
    q.mockResolvedValueOnce({
      rows: [
        obsRow({ id: 'o1', receiving_vpa: 's@ok', amount_paise: '5000', utr: 'AAA' }),
        obsRow({ id: 'o2', receiving_vpa: 's@ok', amount_paise: '9999', utr: 'BBB' }),
      ],
      rowCount: 2,
    })
    const out = await observationSuggestions([{ id: 'i1', receiving_vpa: 's@ok', amount_paise: 5000, utr: 'bbb' }], db)
    // matches o1 by amount and o2 by UTR (case-insensitive)
    expect(out.get('i1')!.map(o => o.id).sort()).toEqual(['o1', 'o2'])
  })
})

describe('alertStats', () => {
  it('maps last alert, 30d count and the gmail confirmation', async () => {
    const d = new Date('2026-11-10T00:00:00Z')
    q.mockImplementation(async (sql: string) => {
      if (/gmail_forwarding/.test(sql)) return { rows: [{ details: { code: 'C', link: 'L' }, observed_at: d }], rowCount: 1 }
      return { rows: [{ last: d, n: 4 }], rowCount: 1 }
    })
    const r = await alertStats('s@ok', db)
    expect(r.lastAlertAt).toBe(d.toISOString())
    expect(r.trustedCount30d).toBe(4)
    expect(r.gmailConfirmation).toEqual({ code: 'C', link: 'L', at: d.toISOString() })
  })
  it('skips the stats query when vpa is null and reports no gmail', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 })
    const r = await alertStats(null, db)
    expect(r).toEqual({ lastAlertAt: null, trustedCount30d: 0, gmailConfirmation: null })
  })
})

describe('openVpas / expireStaleQueued / unappliedUpgIntents', () => {
  it('openVpas maps distinct vpas', async () => {
    q.mockResolvedValueOnce({ rows: [{ receiving_vpa: 'a@ok' }, { receiving_vpa: 'b@ok' }], rowCount: 2 })
    expect(await openVpas(db)).toEqual(['a@ok', 'b@ok'])
  })
  it('expireStaleQueued returns the count', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 5 })
    expect(await expireStaleQueued(60, db)).toBe(5)
    q.mockResolvedValueOnce({ rows: [], rowCount: null as any })
    expect(await expireStaleQueued(60, db)).toBe(0)
  })
  it('unappliedUpgIntents maps the rows', async () => {
    q.mockResolvedValueOnce({ rows: [intentRow({ status: 'completed' })], rowCount: 1 })
    expect((await unappliedUpgIntents(db))[0].status).toBe('completed')
  })
})
