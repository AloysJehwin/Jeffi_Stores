import { describe, it, expect, vi } from 'vitest'
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))
import { groupRows } from '@controller/app/(ecom)/ecom/dashboard/documents/BulkDocuments'

const row = (o: Record<string, string>) => ({ reference: 'R1', item_description: 'Item', quantity: '1', unit_price: '100', ...o })

describe('bulk documents CSV', () => {
  it('reads line and document-level discounts, charges, round off and paid', () => {
    const { docs, errors } = groupRows([
      row({ buyer_name: 'B', discount_pct: '10', doc_discount_pct: '5', discount_label: 'Promo', shipping: '50', charge_label: 'Install', charge_amount: '200', round_off: 'yes', amount_paid: '30' }),
      row({ discount: '20' }),
    ], 'invoice')
    expect(errors).toEqual([])
    expect(docs[0].items[0]).toMatchObject({ discount_pct: 10, discount: 0 })
    expect(docs[0].items[1]).toMatchObject({ discount: 20 })
    expect(docs[0]).toMatchObject({ discount: { percent: 5, label: 'Promo' }, charges: [{ label: 'Shipping', amount: 50 }, { label: 'Install', amount: 200 }], round_off: true, amount_paid: 30 })
  })
  it('rejects both forms of a discount', () => {
    expect(groupRows([row({ buyer_name: 'B', discount: '5', discount_pct: '5' })], 'invoice').errors[0]).toMatch(/not both/)
    expect(groupRows([row({ buyer_name: 'B', doc_discount: '5', doc_discount_pct: '5' })], 'invoice').errors[0]).toMatch(/not both/)
  })
})
