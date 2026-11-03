import { publish, subscribe } from '@/lib/shared/pubsub'

export type SessionLogoutReason = 'logout' | 'idle' | 'expired' | 'revoked' | 'binding'

export type SessionEvent =
  { type: 'deadline'; deadlineAt: string; expiresAt: string } | { type: 'logout'; reason: SessionLogoutReason }

const CHANNEL_PREFIX = 'sess:'

/** Fan a session event out to every connected tab of that session, on every instance. */
export async function publishSessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
  await publish(CHANNEL_PREFIX + sessionId, event)
}

export function subscribeSessionEvents(sessionId: string, handler: (event: SessionEvent) => void): () => void {
  return subscribe<SessionEvent>(CHANNEL_PREFIX + sessionId, handler)
}
