import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), query: vi.fn() }))
import { courierConsignee, courierPhone } from '@/lib/shipping/delhivery'

describe('courierConsignee', () => {
  it('cleans symbols/emoji/newlines that make Delhivery flag ER0005', () => {
    const c = courierConsignee({ name: 'Ravi 😀 Kumar', phones: ['+91 94892 54099'], addressParts: ['No.12 #4th St; "Near" Temple & Bus Stop\n', 'Anna Nagar'], city: 'Chennai', state: 'Tamil Nadu' })
    expect(c).toMatchObject({ ok: true, name: 'Ravi Kumar', phone: '9489254099' })
    if (c.ok) expect(c.address).toBe('No.12 4th St Near Temple and Bus Stop, Anna Nagar')
  })
  it('refuses placeholders instead of sending them', () => {
    expect(courierPhone('9999999999')).toBeNull()
    expect(courierConsignee({ name: 'Customer', phones: [null], addressParts: ['x'] })).toMatchObject({ ok: false })
  })
  it('falls back to the second phone', () => {
    expect(courierConsignee({ name: 'Asha', phones: ['123', '08903031299'], addressParts: ['14 Gandhi Road, T Nagar'] })).toMatchObject({ ok: true, phone: '8903031299' })
  })
})
