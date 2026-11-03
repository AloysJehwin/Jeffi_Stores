import { AsyncLocalStorage } from 'node:async_hooks'

// Sends made inside withReplyContext() belong to that question: mail gets its Reply-To and every
// send is remembered, so the customer's reply finds its way back. No send wrapper has to change.

export interface ReplyScope {
  contextId: string
  replyTo: string
  entityType: string
  entityId: string
}

const als = new AsyncLocalStorage<ReplyScope>()

export function withReplyContext<T>(scope: ReplyScope | null | undefined, fn: () => Promise<T>): Promise<T> {
  return scope ? als.run(scope, fn) : fn()
}

export function currentReplyScope(): ReplyScope | null {
  return als.getStore() ?? null
}

/** SES SMTP answers "250 Ok <id>" and rewrites Message-ID to <id>@email.amazonses.com; replies quote that. */
export function sesMessageId(smtpResponse: string | undefined | null): string | null {
  const m = /^250\s+Ok\s+(\S+)/i.exec(smtpResponse ?? '')
  return m ? `${m[1]}@email.amazonses.com` : null
}

export async function recordScopedSend(s: { channel: 'whatsapp' | 'sms' | 'email'; providerSid?: string | null; emailMessageIds?: Array<string | null | undefined> }): Promise<void> {
  const scope = currentReplyScope()
  if (!scope) return
  const { recordContextSend } = await import('./context')
  if (s.providerSid) await recordContextSend(scope.contextId, { channel: s.channel, providerSid: s.providerSid })
  for (const id of new Set((s.emailMessageIds ?? []).filter(Boolean) as string[])) await recordContextSend(scope.contextId, { channel: 'email', emailMessageId: id })
}
