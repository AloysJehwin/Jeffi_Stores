import { describe, it, expect } from 'vitest'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid audience query with all three required placeholders */
const VALID_AUDIENCE_SQL = `
  SELECT DISTINCT u.id
  FROM users u
  WHERE u.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM email_campaigns_sent ecs
      WHERE ecs.campaign_kind = $1
        AND ecs.user_id = u.id
        AND ecs.sent_at > NOW() - ($2 || ' days')::interval
    )
  LIMIT $3
`

/** A minimal valid products query (no placeholders) */
const VALID_PRODUCTS_SQL = `
  SELECT p.id AS product_id, p.name, p.slug, p.base_price AS price
  FROM products p
  WHERE p.is_active = TRUE
`

// ---------------------------------------------------------------------------
// 1. Basic string-type guard
// ---------------------------------------------------------------------------
describe('validateScenarioSql — input type guard', () => {
  it('rejects non-string input', () => {
    // @ts-expect-error intentional wrong type
    const result = validateScenarioSql(42)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/string/)
  })

  it('rejects empty string', () => {
    const result = validateScenarioSql('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/empty/)
  })

  it('rejects whitespace-only string', () => {
    const result = validateScenarioSql('   \n  ')
    expect(result.ok).toBe(false)
  })

  it('rejects SQL exceeding 8000 characters', () => {
    const big = 'SELECT id FROM users -- ' + 'x'.repeat(8000)
    const result = validateScenarioSql(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/8000/)
  })
})

// ---------------------------------------------------------------------------
// 2. Comment stripping
// ---------------------------------------------------------------------------
describe('validateScenarioSql — comment handling', () => {
  it('rejects SQL that is only a comment', () => {
    const result = validateScenarioSql('-- just a comment')
    expect(result.ok).toBe(false)
  })

  it('rejects SQL that is only a block comment', () => {
    const result = validateScenarioSql('/* only a block comment */')
    expect(result.ok).toBe(false)
  })

  it('accepts SELECT that follows a line comment', () => {
    // comment is stripped, underlying SQL is still valid
    const sql = `-- preamble\n${VALID_AUDIENCE_SQL}`
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Multi-statement prevention
// ---------------------------------------------------------------------------
describe('validateScenarioSql — multi-statement prevention', () => {
  it('rejects two statements separated by semicolons', () => {
    const result = validateScenarioSql(`${VALID_AUDIENCE_SQL}; SELECT 1 FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Multiple statements/)
  })

  it('accepts a single trailing semicolon', () => {
    const result = validateScenarioSql(VALID_AUDIENCE_SQL.trim() + ';')
    expect(result.ok).toBe(true)
  })

  it('rejects double trailing semicolons (semiCount > 1 branch)', () => {
    // semiCount = 2, trailing after removing last ; still contains ;
    // covers the semiCount > 1 side of the || condition
    const result = validateScenarioSql(VALID_AUDIENCE_SQL.trim() + ';;')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Multiple statements/)
  })
})

// ---------------------------------------------------------------------------
// 4. Must start with SELECT (or WITH … SELECT)
// ---------------------------------------------------------------------------
describe('validateScenarioSql — must start with SELECT', () => {
  it('rejects query not starting with SELECT', () => {
    const result = validateScenarioSql(`FROM users u WHERE u.id = '1' LIMIT $3`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/SELECT/)
  })

  it('accepts a WITH … SELECT (CTE)', () => {
    const sql = `
      WITH base AS (
        SELECT id FROM users WHERE is_active = TRUE
      )
      SELECT DISTINCT b.id
      FROM base b
      JOIN users u ON u.id = b.id
      WHERE NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = $1
          AND ecs.user_id = b.id
          AND ecs.sent_at > NOW() - ($2 || ' days')::interval
      )
      LIMIT $3
    `
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Banned keywords
// ---------------------------------------------------------------------------
describe('validateScenarioSql — banned DDL/DML keywords', () => {
  const banned = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE']
  for (const kw of banned) {
    it(`rejects query containing ${kw}`, () => {
      const result = validateScenarioSql(`SELECT id FROM users WHERE id IS NOT NULL -- ${kw}`)
      // The keyword is in a comment so should be stripped — try in the body instead
      const result2 = validateScenarioSql(`SELECT id FROM users; ${kw} TABLE users`)
      expect(result2.ok).toBe(false)
    })
  }

  it('rejects SET keyword', () => {
    const result = validateScenarioSql(`SET search_path = public; SELECT id FROM users`)
    expect(result.ok).toBe(false)
  })

  it('rejects BEGIN keyword', () => {
    const result = validateScenarioSql(`BEGIN; SELECT id FROM users`)
    expect(result.ok).toBe(false)
  })

  it('rejects RETURNING keyword', () => {
    // RETURNING appears after DML but we guard it independently
    const sql = `SELECT id FROM users WHERE id = $1 RETURNING id LIMIT $3`
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.matched).toMatch(/RETURNING/i)
  })
})

// ---------------------------------------------------------------------------
// 6. Banned functions
// ---------------------------------------------------------------------------
describe('validateScenarioSql — banned functions', () => {
  it('rejects pg_sleep()', () => {
    const result = validateScenarioSql(`SELECT pg_sleep(5), id FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pg_sleep/)
  })

  it('rejects pg_read_file()', () => {
    const result = validateScenarioSql(`SELECT pg_read_file('/etc/passwd') FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
  })

  it('rejects any pg_* function call via the catch-all pattern', () => {
    const result = validateScenarioSql(`SELECT pg_unknown_func() FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pg_\*/)
  })

  it('rejects dblink_exec()', () => {
    const result = validateScenarioSql(`SELECT dblink_exec('host=evil','SELECT 1') FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
  })

  it('rejects current_setting()', () => {
    const result = validateScenarioSql(`SELECT current_setting('is_superuser') FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. Function-body / dollar-quote literals
// ---------------------------------------------------------------------------
describe('validateScenarioSql — function-body literals', () => {
  it('rejects $$ dollar-quote literals', () => {
    const result = validateScenarioSql(`SELECT $$hack$$ FROM users LIMIT $3`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Function-body/)
  })

  it('rejects LANGUAGE plpgsql', () => {
    const result = validateScenarioSql(`SELECT id FROM users WHERE LANGUAGE plpgsql IS NOT NULL LIMIT $3`)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8. Table allowlist
// ---------------------------------------------------------------------------
describe('validateScenarioSql — table allowlist', () => {
  it('rejects a query against an unknown table', () => {
    const sql = `
      SELECT id FROM pg_shadow
      WHERE NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = $1 AND ecs.user_id = id
          AND ecs.sent_at > NOW() - ($2 || ' days')::interval
      )
      LIMIT $3
    `
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/allowlist/)
  })

  it('rejects information_schema tables', () => {
    const sql = `
      SELECT id FROM information_schema.tables
      WHERE NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = $1 AND ecs.user_id = id
          AND ecs.sent_at > NOW() - ($2 || ' days')::interval
      )
      LIMIT $3
    `
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(false)
  })

  it('accepts all allowed tables in a valid audience query', () => {
    // Verifies the known-good query works
    const result = validateScenarioSql(VALID_AUDIENCE_SQL)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tablesReferenced).toContain('users')
      expect(result.tablesReferenced).toContain('email_campaigns_sent')
    }
  })

  it('returns tablesReferenced in the ok result', () => {
    const result = validateScenarioSql(VALID_AUDIENCE_SQL)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Array.isArray(result.tablesReferenced)).toBe(true)
      expect(result.tablesReferenced.length).toBeGreaterThan(0)
    }
  })

  it('allows CTE names that shadow real table names without double-counting as disallowed', () => {
    const sql = `
      WITH shadow AS (
        SELECT id FROM users WHERE is_active = TRUE
      )
      SELECT DISTINCT s.id
      FROM shadow s
      JOIN users u ON u.id = s.id
      WHERE NOT EXISTS (
        SELECT 1 FROM email_campaigns_sent ecs
        WHERE ecs.campaign_kind = $1
          AND ecs.user_id = s.id
          AND ecs.sent_at > NOW() - ($2 || ' days')::interval
      )
      LIMIT $3
    `
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 9. Audience intent — SELECT clause must return only user id
// ---------------------------------------------------------------------------
describe('validateScenarioSql — audience SELECT clause', () => {
  it('rejects SELECT * for audience intent', () => {
    const sql = VALID_AUDIENCE_SQL.replace('SELECT DISTINCT u.id', 'SELECT *')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/user id/)
  })

  it('rejects SELECT with extra columns for audience intent', () => {
    const sql = VALID_AUDIENCE_SQL.replace('SELECT DISTINCT u.id', 'SELECT u.id, u.email')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
  })

  it('accepts SELECT id (bare) for audience intent', () => {
    const sql = VALID_AUDIENCE_SQL.replace('SELECT DISTINCT u.id', 'SELECT id')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(true)
  })

  it('accepts SELECT user_id for audience intent', () => {
    const sql = VALID_AUDIENCE_SQL.replace('SELECT DISTINCT u.id', 'SELECT user_id')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(true)
  })

  it('accepts SELECT DISTINCT u.id for audience intent', () => {
    const result = validateScenarioSql(VALID_AUDIENCE_SQL, 'audience')
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 10. Audience intent — required placeholders $1, $2, $3
// ---------------------------------------------------------------------------
describe('validateScenarioSql — audience placeholder requirements', () => {
  it('rejects audience SQL missing $1', () => {
    const sql = VALID_AUDIENCE_SQL.replace('$1', "'abandoned_cart'")
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/\$1/)
  })

  it('rejects audience SQL missing $2', () => {
    const sql = VALID_AUDIENCE_SQL.replace('$2', "'7'")
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/\$2/)
  })

  it('rejects audience SQL missing $3 / LIMIT $3', () => {
    const sql = VALID_AUDIENCE_SQL.replace('LIMIT $3', 'LIMIT 100')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/\$3/)
  })

  it('rejects audience SQL with extra placeholder $4', () => {
    const sql = VALID_AUDIENCE_SQL.replace('LIMIT $3', 'LIMIT $3 OFFSET $4')
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/\$4/)
  })
})

// ---------------------------------------------------------------------------
// 11. Audience intent — frequency-cap clause required
// ---------------------------------------------------------------------------
describe('validateScenarioSql — frequency-cap clause', () => {
  it('rejects audience SQL without the email_campaigns_sent cooldown clause', () => {
    // All three placeholders are present and LIMIT $3 is present, but there
    // is no frequency-cap NOT EXISTS clause at all.
    const sql = `
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.is_active = TRUE
        AND u.some_col = $1
        AND u.other_col > NOW() - ($2 || ' days')::interval
      LIMIT $3
    `
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/frequency-cap/)
  })

  it('rejects audience SQL without sent_at cooldown even if table is present', () => {
    // $1, $2, $3 all present, LIMIT $3 present, email_campaigns_sent referenced,
    // but the sent_at > NOW() - ($2 || ' days')::interval expression is missing.
    const sql = `
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($2 || ' hours')::interval
        )
      LIMIT $3
    `
    // The regex in source requires  sent_at > NOW() - ($2 || ' days')::interval
    // (with 'days' not 'hours') — using 'hours' fails the check.
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/frequency-cap/)
  })
})

// ---------------------------------------------------------------------------
// 12. Products intent — SELECT clause validation
// ---------------------------------------------------------------------------
describe('validateScenarioSql — products intent', () => {
  it('accepts a valid products query', () => {
    const result = validateScenarioSql(VALID_PRODUCTS_SQL, 'products')
    expect(result.ok).toBe(true)
  })

  it('rejects products query with placeholders', () => {
    const sql = `SELECT id AS product_id, name FROM products WHERE id = $1`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/placeholders/)
  })

  it('rejects products query with disallowed columns', () => {
    const sql = `SELECT id AS product_id, name, email FROM products`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Product SELECT/)
  })

  it('accepts slug and image_url in products query', () => {
    const sql = `SELECT p.id AS product_id, p.name, p.slug, p.base_price AS price, pi.image_url FROM products p LEFT JOIN product_images pi ON pi.product_id = p.id`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 13. SQL injection — classic patterns
// ---------------------------------------------------------------------------
describe('validateScenarioSql — SQL injection patterns', () => {
  it('rejects UNION-based injection attempt via banned table', () => {
    const sql = `
      SELECT DISTINCT u.id
      FROM users u
      UNION SELECT username FROM pg_shadow
    `
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
  })

  it('rejects stacked query injection via semicolon', () => {
    const result = validateScenarioSql(`SELECT id FROM users LIMIT $3; DROP TABLE users`)
    expect(result.ok).toBe(false)
  })

  it('rejects time-based blind injection via pg_sleep', () => {
    const sql = `SELECT id FROM users WHERE 1=1 AND pg_sleep(5) IS NOT NULL LIMIT $3`
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(false)
  })

  it('returns the matched token in the fail result for banned keywords', () => {
    const result = validateScenarioSql(`SELECT id FROM users; DROP TABLE users`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.matched).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 14. Default intent (no argument) behaves as audience
// ---------------------------------------------------------------------------
describe('validateScenarioSql — default intent', () => {
  it('default intent is audience — valid query passes', () => {
    const result = validateScenarioSql(VALID_AUDIENCE_SQL)
    expect(result.ok).toBe(true)
  })

  it('default intent is audience — missing placeholder fails', () => {
    const sql = VALID_AUDIENCE_SQL.replace('LIMIT $3', 'LIMIT 50')
    const result = validateScenarioSql(sql)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 15. normalized output
// ---------------------------------------------------------------------------
describe('validateScenarioSql — normalized output', () => {
  it('returns stripped, trimmed SQL in normalized field', () => {
    const result = validateScenarioSql(VALID_AUDIENCE_SQL)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.normalized).toBeTruthy()
      expect(result.normalized).not.toMatch(/^\s/)
    }
  })
})

// ---------------------------------------------------------------------------
// 16. No tables referenced (line 137) — SELECT with no FROM clause
// ---------------------------------------------------------------------------
describe('validateScenarioSql — no tables referenced', () => {
  it('rejects SELECT with no FROM clause (no tables extracted)', () => {
    // extractTables uses /\b(?:from|join)\s+tableName/gi — a bare SELECT 1
    // has no FROM so tables.length === 0 → line 137
    const result = validateScenarioSql('SELECT 1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/No tables referenced/)
  })

  it('rejects SELECT with only a subexpression and no FROM keyword', () => {
    const result = validateScenarioSql('SELECT (1 + 1)')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/No tables referenced/)
  })

  it('rejects SELECT NOW() with no table reference', () => {
    const result = validateScenarioSql('SELECT NOW()')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/No tables referenced/)
  })
})

// ---------------------------------------------------------------------------
// 17. Could not locate SELECT clause (line 149)
//     extractTables finds a table via JOIN but there is no SELECT...FROM
//     that the lazy regex can match against.
// ---------------------------------------------------------------------------
describe('validateScenarioSql — could not locate SELECT clause', () => {
  it('rejects SQL where select...from regex cannot match (JOIN-only table reference)', () => {
    // This is a degenerate query: it passes all earlier guards (starts with SELECT,
    // no banned keywords, allowed table via JOIN) but the regex
    //   /select\s+([\s\S]+?)\s+from\s/i
    // requires whitespace before FROM — a query with no FROM keyword after SELECT
    // but a JOIN forces extractTables to find the table without a matchable FROM clause.
    // Construct: SELECT id JOIN users u ON u.id = id
    // extractTables finds 'users' via JOIN → passes table check
    // select regex needs "SELECT <cols> FROM" — no FROM present → line 149
    const result = validateScenarioSql('SELECT id JOIN users u ON u.id = id')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Could not locate SELECT clause/)
  })
})

// ---------------------------------------------------------------------------
// 18. Products intent — placeholder check (source ~line 223)
//     Columns must all be valid AND a $N placeholder must appear to hit this
//     branch. The existing test already covers this but ensure it stays covered.
// ---------------------------------------------------------------------------
describe('validateScenarioSql — products placeholder guard (explicit)', () => {
  it('rejects products query that has valid columns but uses $1 placeholder', () => {
    // product_id and name are both ALLOWED_PRODUCT_COLS — column check passes
    // then placeholder check fires
    const sql = `SELECT p.id AS product_id, p.name FROM products p WHERE p.id = $1`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/placeholders/)
    }
  })

  it('rejects products query with price column and $2 placeholder', () => {
    const sql = `SELECT p.id AS product_id, p.base_price AS price FROM products p WHERE p.category_id = $2`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/placeholders/)
  })

  it('accepts products query with valid columns and no placeholders', () => {
    const sql = `SELECT p.id AS product_id, p.name, p.slug FROM products p WHERE p.is_active = TRUE`
    const result = validateScenarioSql(sql, 'products')
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 19. LIMIT $3 guard (source line 189-193)
//     $3 IS present as a placeholder but NOT in a LIMIT $3 position —
//     so the missing-placeholder check passes but the LIMIT $3 pattern fails.
// ---------------------------------------------------------------------------
describe('validateScenarioSql — LIMIT $3 required (line 189)', () => {
  it('rejects when $3 is bound but used as OFFSET $3 rather than LIMIT $3', () => {
    // $1, $2, $3 all present → missing-placeholder check passes
    // No "LIMIT $3" in the SQL → line 189 fires
    const sql = `
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($2 || ' days')::interval
        )
      LIMIT 100 OFFSET $3
    `
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/LIMIT \$3/)
  })

  it('rejects when $3 appears in WHERE but LIMIT $3 is absent', () => {
    const sql = `
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.segment_id = $3
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($2 || ' days')::interval
        )
      LIMIT 500
    `
    const result = validateScenarioSql(sql, 'audience')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/LIMIT \$3/)
  })
})
