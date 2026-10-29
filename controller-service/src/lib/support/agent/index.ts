import 'server-only'
import { after } from 'next/server'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'
import type { SessionRow } from '../sessions'
import type { SupportMessage } from '../types'
import { runSupportTurn } from './run'
import { decideAction, pendingActionForReply, yesNo } from './actions'

/** Run work after the response is sent, in the request's store; inline when there is no request. */
export async function afterResponse(job: () => Promise<unknown>): Promise<void> {
  const tenant = await resolveTenant().catch(() => null)
  const run = () => (tenant ? runWithTenantContext(tenant, job) : job()).catch(err => console.error('[support] background job failed', err))
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * A customer message was stored: a bare YES/NO answers the pending confirm card, otherwise the
 * assistant replies while the chat is with the AI.
 */
export async function onCustomerMessage(session: SessionRow, m: SupportMessage): Promise<void> {
  const decision = !m.attachments.length ? yesNo(m.text) : null
  if (decision) {
    const pending = await pendingActionForReply(session.id)
    if (pending) {
      await afterResponse(() => decideAction(pending.id, session.id, decision))
      return
    }
  }
  if (session.handler === 'ai') await afterResponse(() => runSupportTurn(session.id))
}

export { runSupportTurn }
