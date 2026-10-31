import { describe, it, expect } from 'vitest'
import { listSelectableAccounts } from '@/lib/google-ads/accounts'

const client = (id: string) => ({ customerClient: { id, descriptiveName: `acct ${id}`, manager: false, currencyCode: 'INR', ...clients[id] } })
const clients: Record<string, any> = {
  '1111111111': { testAccount: true, status: 'CLOSED' },
  '2222222222': { testAccount: false, status: 'CLOSED' },
  '3333333333': { testAccount: false, status: 'ENABLED' },
}

function fakeBase(): any {
  const make = (customerId: string): any => ({
    forCustomer: (id: string) => make(id),
    searchStream: async (q: string) =>
      q.includes('FROM customer_client')
        ? [{ customerClient: { id: '9999999999', manager: true } }, ...Object.keys(clients).map(client)]
        : [{ customer: { id: customerId, descriptiveName: 'Test MCC', manager: true, testAccount: true, status: 'CLOSED' } }],
  })
  return { ...make('0'), listAccessibleCustomers: async () => ['9999999999'] }
}

describe('listSelectableAccounts', () => {
  it('offers enabled clients and test clients (which Google always reports as CLOSED), not real closed ones', async () => {
    const { accounts } = await listSelectableAccounts(fakeBase())
    expect(accounts.map(a => a.customerId).sort()).toEqual(['1111111111', '3333333333'])
    expect(accounts.find(a => a.customerId === '1111111111')).toMatchObject({ testAccount: true, loginCustomerId: '9999999999', managerName: 'Test MCC' })
  })
})
