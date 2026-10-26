// Admin API calls that a tab makes on its own (session checks, event streams, bell and support
// polls, draft-lock status and presence heartbeats) must not count as the admin being active, or
// the idle window never elapses while a tab is open. Both middleware and the routes themselves
// resolve the session without touching last_seen_at for these.
const PASSIVE_EXACT = new Set(['/api/admin/check-session', '/api/admin/events', '/api/admin/notifications'])
const PASSIVE_PREFIXES = ['/api/admin/support/sessions', '/api/admin/draft-locks']
const PASSIVE_POST = new Set(['/api/admin/draft-locks/presence'])

export function isPassiveAdminRequest(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  if (m === 'POST' && PASSIVE_POST.has(pathname)) return true
  if (m !== 'GET') return false
  if (PASSIVE_EXACT.has(pathname)) return true
  return PASSIVE_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
}
