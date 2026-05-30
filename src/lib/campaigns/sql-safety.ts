export interface SqlValidationOk {
  ok: true
  normalized: string
  tablesReferenced: string[]
}

export interface SqlValidationFail {
  ok: false
  reason: string
  matched?: string
}

export type SqlValidation = SqlValidationOk | SqlValidationFail

const ALLOWED_TABLES = new Set([
  'users',
  'orders',
  'order_items',
  'cart_items',
  'wishlist_items',
  'products',
  'product_variants',
  'product_images',
  'product_reviews',
  'customer_profiles',
  'customer_health',
  'email_campaigns_sent',
  'campaigns',
  'coupons',
  'addresses',
])

const BANNED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT',
  'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'COMMENT',
  'GRANT', 'REVOKE', 'REASSIGN', 'REINDEX', 'VACUUM', 'CLUSTER',
  'COPY', 'EXECUTE', 'CALL', 'PREPARE', 'DEALLOCATE',
  'LISTEN', 'NOTIFY', 'UNLISTEN',
  'SET', 'RESET', 'SHOW',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'LOCK', 'DO', 'DECLARE', 'FETCH', 'MOVE', 'CLOSE',
  'INTO', 'RETURNING', 'FOR UPDATE', 'FOR SHARE',
]

const BANNED_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'pg_sleep', 'pg_terminate_backend', 'pg_cancel_backend',
  'current_setting', 'set_config',
  'lo_import', 'lo_export', 'lo_create',
  'dblink', 'dblink_exec',
  'pg_advisory_lock', 'pg_advisory_xact_lock',
]

const COMMENT_PATTERNS = [/--/g, /\/\*[\s\S]*?\*\//g]

function stripComments(sql: string): string {
  let s = sql
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')
  s = s
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--')
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
  return s
}

function extractTables(sql: string): string[] {
  const re = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    found.add(m[1].toLowerCase())
  }
  return Array.from(found)
}

function extractCteNames(sql: string): Set<string> {
  const out = new Set<string>()
  if (!/^\s*with\s/i.test(sql)) return out
  const re = /(?:^\s*with\s+|,\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    out.add(m[1].toLowerCase())
  }
  return out
}

export function validateScenarioSql(rawSql: string): SqlValidation {
  if (typeof rawSql !== 'string') return { ok: false, reason: 'SQL must be a string' }
  const trimmed = rawSql.trim()
  if (!trimmed) return { ok: false, reason: 'SQL is empty' }
  if (trimmed.length > 8000) return { ok: false, reason: 'SQL exceeds 8000 character limit' }

  const stripped = stripComments(trimmed).trim()
  if (!stripped) return { ok: false, reason: 'SQL contains only comments' }

  if (stripped.includes(';')) {
    const semiCount = (stripped.match(/;/g) || []).length
    const trailing = stripped.replace(/;\s*$/, '')
    if (trailing.includes(';') || semiCount > 1) {
      return { ok: false, reason: 'Multiple statements not allowed', matched: ';' }
    }
  }

  const upper = stripped.toUpperCase()

  if (!/^\s*(WITH\s+[A-Z_][A-Z0-9_]*\s+AS\s*\(|SELECT\s)/i.test(stripped)) {
    return { ok: false, reason: 'Query must start with SELECT (or WITH … SELECT)' }
  }

  for (const kw of BANNED_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (pattern.test(upper)) {
      return { ok: false, reason: `Disallowed keyword: ${kw}`, matched: kw }
    }
  }

  for (const fn of BANNED_FUNCTIONS) {
    const pattern = new RegExp(`\\b${fn}\\s*\\(`, 'i')
    if (pattern.test(stripped)) {
      return { ok: false, reason: `Disallowed function: ${fn}`, matched: fn }
    }
  }

  if (/\bpg_[a-z_]+\s*\(/i.test(stripped)) {
    return { ok: false, reason: 'Calls to pg_* functions are not allowed' }
  }

  if (/(\$\$|\bdo\s+\$|\blanguage\s+(sql|plpgsql|c|internal))/i.test(stripped)) {
    return { ok: false, reason: 'Function-body literals not allowed' }
  }

  const tables = extractTables(stripped)
  if (tables.length === 0) {
    return { ok: false, reason: 'No tables referenced — query must select from a known table' }
  }
  const cteNames = extractCteNames(stripped)
  for (const t of tables) {
    if (cteNames.has(t)) continue
    if (!ALLOWED_TABLES.has(t)) {
      return { ok: false, reason: `Table not in allowlist: ${t}`, matched: t }
    }
  }

  const selectMatch = stripped.match(/select\s+([\s\S]+?)\s+from\s/i)
  if (!selectMatch) {
    return { ok: false, reason: 'Could not locate SELECT clause' }
  }
  const selectClause = selectMatch[1].trim()
  const cols = selectClause.split(',').map(c => c.trim().toLowerCase())
  const looksLikeUserId = cols.every(c =>
    /^(distinct\s+)?(u\.|users\.|orders\.|o\.|wi\.|ci\.|pr\.)?(user_)?id(\s+as\s+[a-z_]+)?$/i.test(c) ||
    /^(distinct\s+)?u\.id$/i.test(c) ||
    /^id$/i.test(c) ||
    /^user_id$/i.test(c)
  )
  if (!looksLikeUserId) {
    return {
      ok: false,
      reason: 'SELECT clause must return only user id or user_id (no other columns). Got: ' + selectClause,
    }
  }

  return { ok: true, normalized: stripped, tablesReferenced: tables }
}
