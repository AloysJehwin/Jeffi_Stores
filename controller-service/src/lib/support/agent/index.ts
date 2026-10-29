import 'server-only'
import { after } from 'next/server'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'
import type { SessionRow } from '../sessions'
import type { SupportMessage } from '../types'
import { runSupportTurn } from './run'
import { decideAction, leadingYesNo, pendingActionForReply, yesNo } from './actions'

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

/** What a channel knows about where a reply belongs (see lib/replies/engine.ts). */
export interface ReplyHints {
  repliedToSid?: string | null
  emailRefs?: string[]
  token?: string | null
  phone?: string | null
  email?: string | null
  /** Defaults to true: signed-in chat, or a WhatsApp number the provider vouches for. */
  verified?: boolean
}

/**
 * A customer message was stored: a bare YES/NO answers the pending confirm card; an answer to a
 * question the store asked (order change, quotation...) is acted on; otherwise the assistant
 * replies while the chat is with the AI.
 */
export async function onCustomerMessage(session: SessionRow, m: SupportMessage, hints: ReplyHints = {}): Promise<void> {
  const decision = !m.attachments.length ? (yesNo(m.text) ?? leadingYesNo(m.text)) : null
  if (decision) {
    const pending = await pendingActionForReply(session.id)
    if (pending) {
      await afterResponse(() => decideAction(pending.id, session.id, decision, m.id))
      return
    }
  }
  await afterResponse(async () => {
    const { handleCustomerReply } = await import('@/lib/replies/engine')
    const handled = await handleCustomerReply({
      session,
      message: m,
      userId: session.user_id,
      phone: hints.phone ?? session.contact_phone,
      email: hints.email ?? null,
      repliedToSid: hints.repliedToSid ?? null,
      emailRefs: hints.emailRefs,
      token: hints.token ?? null,
      verified: hints.verified ?? true,
    }).catch(err => {
      console.error('[replies] failed', err instanceof Error ? err.message : err)
      return 'unhandled' as const
    })
    if (handled === 'unhandled' && session.handler === 'ai') await runSupportTurn(session.id)
  })
}

export { runSupportTurn }
