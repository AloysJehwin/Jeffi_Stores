import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ withTransaction: vi.fn() }))

import { generateProductSku, generateVariantSku } from '@/lib/catalog/sku'
import { withTransaction } from '@/lib/shared/db'

const mockTx = vi.mocked(withTransaction)

// A client whose query() answers each call in order.
function fakeClient(...rows: any[][]) {
  let i = 0
  const calls: { sql: string; params: any[] }[] = []
  const client = {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return { rows: rows[i++] ?? [] }
    }),
  }
  return client
}

beforeEach(() => {
  mockTx.mockReset()
  // Default: run the callback against whatever client the test wires via `current`.
  mockTx.mockImplementation((cb: any) => cb(current))
})

let current: any = null
function run(client: any) {
  current = client
}

describe('generateProductSku', () => {
  it('defaults to PRD when no category', async () => {
    const client = fakeClient([{ max_seq: 4 }])
    run(client)
    expect(await generateProductSku(null)).toBe('PRD-005')
    // only the max-seq query ran
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].params[0]).toBe('PRD')
  })

  it('uses the category sku_prefix when present', async () => {
    const client = fakeClient([{ name: 'Bolts', sku_prefix: 'BLT' }], [{ max_seq: 10 }])
    run(client)
    expect(await generateProductSku('cat1')).toBe('BLT-011')
    expect(client.calls[0].sql).toContain('FOR UPDATE')
    expect(client.calls[0].params).toEqual(['cat1'])
  })

  it('derives a prefix from the name when no sku_prefix', async () => {
    const client = fakeClient([{ name: 'fasteners', sku_prefix: null }], [{ max_seq: 0 }])
    run(client)
    expect(await generateProductSku('cat1')).toBe('FAS-001')
  })

  it('falls back to PRD when the name yields no letters', async () => {
    const client = fakeClient([{ name: '123', sku_prefix: null }], [{ max_seq: null }])
    run(client)
    expect(await generateProductSku('cat1')).toBe('PRD-001')
  })

  it('PRD when the category row is missing', async () => {
    const client = fakeClient([], [{ max_seq: 2 }])
    run(client)
    expect(await generateProductSku('cat1')).toBe('PRD-003')
  })
})

describe('generateVariantSku', () => {
  it('appends an uppercased, alphanumeric-only suffix', () => {
    expect(generateVariantSku('PRD-001', 'Red / Large')).toBe('PRD-001-REDLARGE')
    expect(generateVariantSku('X', 'a1-b2')).toBe('X-A1B2')
  })
})
