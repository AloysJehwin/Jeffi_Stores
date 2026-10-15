import { GoogleAdsClient, GoogleAdsApiError } from './client'
import { Q, mapCustomer, mapCustomerClient } from './queries'

// Account discovery for the connect flow: the accounts a signed-in user can reach directly, plus
// the clients under any manager among them (reached with login-customer-id = that manager).

export interface AdsAccountOption {
  customerId: string
  name: string | null
  currency: string | null
  testAccount: boolean
  /** Manager to send as login-customer-id; null when the user reaches the account directly. */
  loginCustomerId: string | null
  managerName: string | null
}

export interface AdsAccountListing {
  accounts: AdsAccountOption[]
  /** Accessible accounts that could not be read (e.g. disabled), with the reason. */
  skipped: { customerId: string; reason: string }[]
}

const MAX_ACCESSIBLE = 25

export async function listSelectableAccounts(base: GoogleAdsClient): Promise<AdsAccountListing> {
  const ids = (await base.listAccessibleCustomers()).slice(0, MAX_ACCESSIBLE)
  const accounts = new Map<string, AdsAccountOption>()
  const skipped: AdsAccountListing['skipped'] = []

  for (const id of ids) {
    try {
      const direct = base.forCustomer(id, null)
      const info = mapCustomer((await direct.searchStream(Q.customer()))[0] ?? {})
      if (!info.manager) {
        if (!accounts.has(id)) {
          accounts.set(id, {
            customerId: id,
            name: info.descriptive_name,
            currency: info.currency_code,
            testAccount: info.test_account,
            loginCustomerId: null,
            managerName: null,
          })
        }
        continue
      }
      // A manager has no ads of its own; offer its (non-manager) clients instead.
      const viaManager = base.forCustomer(id, id)
      for (const row of await viaManager.searchStream(Q.customerClients())) {
        const c = mapCustomerClient(row)
        if (!c.id || c.manager || c.id === id) continue
        const existing = accounts.get(c.id)
        if (existing && existing.loginCustomerId === null) continue
        accounts.set(c.id, {
          customerId: c.id,
          name: c.name,
          currency: c.currency,
          testAccount: c.testAccount,
          loginCustomerId: id,
          managerName: info.descriptive_name,
        })
      }
    } catch (e) {
      skipped.push({ customerId: id, reason: e instanceof GoogleAdsApiError ? e.message : String((e as any)?.message ?? e) })
    }
  }
  return { accounts: [...accounts.values()], skipped }
}

/** One cheap read that proves the credentials reach the account; returns its basic info. */
export async function verifyAccount(client: GoogleAdsClient) {
  const rows = await client.searchStream(Q.customer())
  const info = mapCustomer(rows[0] ?? {})
  if (!info.customer_id) throw new Error('Google Ads returned no account for this customer id.')
  if (info.manager) {
    throw new Error('This is a manager account, which has no ads of its own. Pick one of its client accounts.')
  }
  return info
}
