const LEGACY_SCOPE_PARENTS: Record<string, string> = {
  'delhivery:read': 'orders:read', 'delhivery:write': 'orders:write',
  'shelving:read': 'inventory:read', 'shelving:write': 'inventory:write',
  'campaigns:read': 'mailer:read', 'campaigns:write': 'mailer:write',
  'controls:read': 'inflation:read', 'controls:write': 'inflation:write',
}

export function hasScope(role: string | undefined, scopes: string[] | undefined, required: string): boolean {
  if (role === 'administrator') return true
  const s = scopes ?? []
  if (s.includes(required)) return true
  if (required.endsWith(':read') && s.includes(required.replace(':read', ':write'))) return true
  const parent = LEGACY_SCOPE_PARENTS[required]
  if (parent && (s.includes(parent) || (parent.endsWith(':read') && s.includes(parent.replace(':read', ':write'))))) return true
  return false
}
