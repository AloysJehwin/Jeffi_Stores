import { normalizeCustomerId } from '../client'
import { resolveGoogleAdsCreds } from '../credentials'
import { actionIdOf, readConversionConfig } from './actions'
import { DataManagerApiError, adsDestination, dataManagerClientFor, violationsByEvent, type DataManagerClient } from './data-manager'
import type { Db } from './queue'
import type { SetupCheck } from './types'

// "Check setup": a validateOnly events:ingest with one made-up purchase. Google runs the same
// fast-fail checks as a real upload (scope, API enabled, access to the account, the conversion
// action) and ingests nothing.

const OK = 'Google accepted the setup: this connection can send conversions to the chosen action.'

export async function checkDataManagerSetup(opts: { dm?: DataManagerClient; db?: Db; now?: Date } = {}): Promise<SetupCheck> {
  const cfg = await readConversionConfig(opts.db)
  if (!cfg.action || !cfg.matchesAccount) {
    return { ok: false, code: 'NO_ACTION', message: 'Choose a conversion action for this account first.', warnings: [] }
  }
  const creds = await resolveGoogleAdsCreds()
  const dm = opts.dm ?? dataManagerClientFor(creds, { retryDelays: [] })
  const now = opts.now ?? new Date()
  const destination = adsDestination({
    operating: normalizeCustomerId(cfg.owner) || creds.customerId,
    login: creds.loginCustomerId,
    actionId: actionIdOf(cfg.action),
  })
  const event = {
    transactionId: `setup-check-${now.getTime()}`,
    eventTimestamp: new Date(now.getTime() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    eventSource: 'WEB' as const,
    conversionValue: 1,
    currency: 'INR',
    adIdentifiers: { gclid: 'setup-check' },
  }
  try {
    const res = await dm.ingestEvents({ destinations: [destination], events: [event], encoding: 'HEX', validateOnly: true })
    return { ok: true, code: null, message: OK, warnings: res?.fieldWarnings ?? [] }
  } catch (e) {
    if (!(e instanceof DataManagerApiError)) throw e
    // Only the made-up click refused: access, account and action all passed.
    if (violationsByEvent(e.violations, 1)) return { ok: true, code: null, message: OK, warnings: [] }
    return { ok: false, code: e.code, message: e.message, warnings: [] }
  }
}
