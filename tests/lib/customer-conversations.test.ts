import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/s3', () => ({
  getS3Url: vi.fn(async (key: string) => `https://cdn.test/${key}`),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

import {
  parseChannels,
  clampConversationLimit,
  derivePage,
  mapConversationRow,
  summarizeRow,
  buildConversationsSql,
  CONVERSATION_CHANNELS,
  type ConversationRow,
  type SummaryRow,
} from '@/lib/customer-conversations'

describe('buildConversationsSql', () => {
  // Each channel sub-select must alias its own columns; when a single channel is selected there is
  // no UNION ALL to supply positional names, so the outer `x.at` / `x.subject` / `x.body` would break.
  it('aliases the outer columns for every single channel', () => {
    for (const c of CONVERSATION_CHANNELS) {
      const sql = buildConversationsSql([c])
      for (const col of [
        'id',
        'channel',
        'direction',
        'at',
        'thread_id',
        'thread_label',
        'actor',
        'subject',
        'body',
        'status',
        'entity_type',
        'entity_id',
        'attachments',
      ]) {
        expect(sql, `${c} must alias ${col}`).toMatch(new RegExp(`AS ${col}\\b`))
      }
      expect(sql).not.toContain('UNION ALL')
    }
  })

  it('joins multiple channels with UNION ALL', () => {
    expect(buildConversationsSql(['email', 'note'])).toContain('UNION ALL')
  })
})

describe('parseChannels', () => {
  it('returns every channel for null or empty input', () => {
    expect(parseChannels(null)).toEqual({ channels: ['chat', 'email', 'whatsapp', 'sms', 'note', 'rfq'] })
    expect(parseChannels('  ')).toEqual({ channels: ['chat', 'email', 'whatsapp', 'sms', 'note', 'rfq'] })
  })

  it('parses a valid comma list and dedupes', () => {
    expect(parseChannels('email, chat, email')).toEqual({ channels: ['email', 'chat'] })
  })

  it('returns an error naming the bad token', () => {
    const res = parseChannels('email,telepathy')
    expect(res).toEqual({ error: 'Unknown channel: telepathy' })
  })
})

describe('clampConversationLimit', () => {
  it('defaults when not a number', () => {
    expect(clampConversationLimit('abc')).toBe(40)
    expect(clampConversationLimit(null)).toBe(40)
  })

  it('clamps to bounds', () => {
    expect(clampConversationLimit(0)).toBe(1)
    expect(clampConversationLimit(999)).toBe(100)
    expect(clampConversationLimit('25')).toBe(25)
  })
})

describe('derivePage', () => {
  it('returns null nextBefore when within limit', () => {
    const items = [{ at: 'a' }, { at: 'b' }]
    expect(derivePage(items, 5)).toEqual({ items, nextBefore: null })
  })

  it('trims to limit and sets nextBefore to the last kept item', () => {
    const items = [{ at: 'a' }, { at: 'b' }, { at: 'c' }]
    const res = derivePage(items, 2)
    expect(res.items).toHaveLength(2)
    expect(res.nextBefore).toBe('b')
  })
})

function baseRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'e1',
    channel: 'email',
    direction: 'outbound',
    at: '2024-01-15T10:00:00Z',
    thread_id: null,
    thread_label: null,
    actor: 'Store',
    subject: 'Hello',
    body: '<b>Hi</b>',
    status: 'sent',
    entity_type: 'order',
    entity_id: 'ord-1',
    attachments: null,
    ...overrides,
  }
}

describe('mapConversationRow', () => {
  it('maps direction and href for an order email', async () => {
    const item = await mapConversationRow(baseRow(), 'user-1')
    expect(item.direction).toBe('outbound')
    expect(item.href).toBe('/admin/orders/ord-1')
    expect(item.channel).toBe('email')
  })

  it('maps an internal note and its thread href stays null', async () => {
    const item = await mapConversationRow(
      baseRow({
        channel: 'note',
        direction: 'internal',
        entity_type: null,
        entity_id: null,
      }),
      'user-1'
    )
    expect(item.direction).toBe('internal')
    expect(item.href).toBeNull()
  })

  it('links a chat row to the support session view', async () => {
    const item = await mapConversationRow(
      baseRow({
        channel: 'chat',
        direction: 'inbound',
        thread_id: 'sess-9',
        entity_type: 'support_session',
        entity_id: 'sess-9',
      }),
      'user-7'
    )
    expect(item.direction).toBe('inbound')
    expect(item.href).toBe('/admin/customers/user-7?chat=true')
  })
})

function summaryRow(overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    counts_30d: { email: 2, chat: 1 },
    counts_90d: { email: 5 },
    last_inbound_at: null,
    last_outbound_at: null,
    open_chats: 0,
    median_first_response_minutes: null,
    ...overrides,
  }
}

describe('summarizeRow', () => {
  it('flags awaitingReply when inbound is newer than outbound', () => {
    const s = summarizeRow(
      summaryRow({ last_inbound_at: '2024-02-01T00:00:00Z', last_outbound_at: '2024-01-01T00:00:00Z' })
    )
    expect(s.awaitingReply).toBe(true)
    expect(s.awaitingReplySince).toBe('2024-02-01T00:00:00.000Z')
  })

  it('is not awaiting when outbound is newer', () => {
    const s = summarizeRow(
      summaryRow({ last_inbound_at: '2024-01-01T00:00:00Z', last_outbound_at: '2024-02-01T00:00:00Z' })
    )
    expect(s.awaitingReply).toBe(false)
    expect(s.awaitingReplySince).toBeNull()
  })

  it('projects channel counts and defaults missing channels to zero', () => {
    const s = summarizeRow(summaryRow())
    expect(s.counts30d.email).toBe(2)
    expect(s.counts30d.chat).toBe(1)
    expect(s.counts30d.sms).toBe(0)
  })
})
