// Admin API calls that a tab makes on its own (session checks, event streams, bell and support
// polls) must not count as the admin being active, or the idle window never elapses while a
// tab is open. Both middleware and the routes themselves resolve the session without touching
// last_seen_at for these.
const PASSIVE_EXACT = new Set(['/api/admin/check-session', '/api/admin/events', '/api/admin/notifications'])
const PASSIVE_PREFIXES = ['/api/admin/support/sessions']

export function isPassiveAdminRequest(pathname: string, method: string): boolean {
  if (method.toUpperCase() !== 'GET') return false
  if (PASSIVE_EXACT.has(pathname)) return true
  return PASSIVE_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
}
