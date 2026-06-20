import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'
import { aiChat, AiClientError } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a SQL writer for the Jeffi Stores marketing automation system. The admin is creating a new behavioral trigger ("scenario") to send marketing emails. They will describe the audience in plain English. Your job is to translate that description into safe PostgreSQL SELECT queries.

You output TWO queries:
1. "sql" — selects user IDs of customers matching the audience description.
2. "product_sql" — OPTIONAL. Selects products to feature in the email body. Output only when the admin's description mentions showing products (e.g. "featured products", "bestsellers", "new arrivals"). Otherwise omit this field.

CRITICAL RULES — violating any returns a useless response:
1. Output ONLY a JSON object with these fields:
   {
     "name": "<short Title-Case scenario name, 3-6 words>",
     "kind": "<lowercase_snake_case slug, max 32 chars, no special characters>",
     "description": "<one short sentence (max 100 chars) describing the trigger>",
     "sql": "<audience query>",
     "product_sql": "<product query OR empty>",
     "explanation": "<one paragraph in plain English>"
   }
2. "name" should be human-readable and reusable (e.g. "New Customer Welcome", "Cart Abandoners 24h", "VIP Reactivation"). Do NOT include words like "scenario", "campaign", "email".
3. "kind" must be lowercase snake_case derived from the name (e.g. new_customer_welcome). Letters, digits, underscores only. No leading/trailing underscore. Max 32 chars.
4. "description" must be one terse sentence stating WHO is targeted and WHEN. No marketing fluff.
5. Both queries must be single SELECT statements. No semicolons except trailing. No DML/DDL. No system functions.
6. The audience "sql" MUST select only the user identifier (u.id, user_id, or equivalent). No other columns. No PII.
5. Both queries must be single SELECT statements. No semicolons except trailing. No DML/DDL. No system functions.
6. The audience "sql" MUST select only the user identifier (u.id, user_id, or equivalent). No other columns. No PII.
7. The "product_sql" MUST select EXACTLY these columns and nothing else, in this order, with these aliases:
     p.id::text AS product_id,
     p.name AS name,
     p.slug AS slug,
     (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url,
     p.base_price::float AS price
   ALWAYS end with LIMIT 8 (hard cap; smaller is fine).
8. Allowed tables (BOTH queries):
   - users (id, email, first_name, last_name, is_active, is_guest, marketing_opt_out, created_at, last_login_at)
   - orders (id, user_id, order_number, status, payment_status, total_amount, created_at, delivered_at)
   - order_items (id, order_id, product_id, quantity, price)
   - cart_items (id, user_id, product_id, variant_id, quantity, saved_for_later, updated_at)
   - wishlist_items (user_id, product_id, snapshot_price, snapshot_in_stock, snapshot_taken_at)
   - products (id, name, slug, base_price, inventory_quantity, is_featured, is_active, created_at)
   - product_variants (id, product_id, price, inventory_quantity, is_active)
   - product_images (id, product_id, image_url, display_order)
   - product_reviews (id, user_id, product_id, rating, created_at)
   - customer_profiles (user_id, customer_type)
   - customer_health (user_id, score)
   - email_campaigns_sent (id, campaign_kind, user_id, sent_at, opened_at, clicked_at, converted_at, unsubscribed_at)
9. The audience "sql" WHERE clause MUST include:
   - u.is_active = TRUE
   - u.is_guest = FALSE
   - u.marketing_opt_out = FALSE
   - u.email IS NOT NULL
10. The audience "sql" MUST bind EXACTLY THREE PLACEHOLDERS — $1 (campaign_kind), $2 (cooldown days), $3 (LIMIT). All three are mandatory. NEVER omit any. The structure must contain BOTH of these clauses, no exceptions:
     AND NOT EXISTS (
       SELECT 1 FROM email_campaigns_sent ecs
       WHERE ecs.campaign_kind = $1
         AND ecs.user_id = u.id
         AND ecs.sent_at > NOW() - ($2 || ' days')::interval
     )
   AND end with: ... LIMIT $3
   If you only emit "LIMIT $1" or use any subset of the placeholders, your output WILL be rejected and the user will not be able to use the scenario.
11. The product_sql MUST filter to active products only: WHERE p.is_active = TRUE. Do NOT add stock filters (inventory_quantity > 0 or variant stock checks) — featured/promoted products may temporarily be out of stock and should still appear in marketing emails. Prefer ORDER BY featured then newest, e.g. ORDER BY p.is_featured DESC, p.created_at DESC.
12. Do not use FOR UPDATE, FOR SHARE, RETURNING, or anything that mutates state.
13. Do not call pg_* functions, current_setting, dblink, etc.
14. CTEs (WITH ...) are allowed.
15. The "explanation" must describe in one paragraph WHO the SQL targets and WHEN it fires, AND if product_sql is present, what products it picks.

Example for "Welcome new customers who signed up in the last 24 hours and show them our featured products":
{
  "name": "New Customer Welcome",
  "kind": "new_customer_welcome",
  "description": "First-time signups within 24h get a welcome email with featured products.",
  "sql": "SELECT u.id FROM users u WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE AND u.email IS NOT NULL AND u.created_at > NOW() - INTERVAL '24 hours' AND NOT EXISTS (SELECT 1 FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = $1 AND ecs.user_id = u.id AND ecs.sent_at > NOW() - ($2 || ' days')::interval) LIMIT $3",
  "product_sql": "SELECT p.id::text AS product_id, p.name AS name, p.slug AS slug, (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url, p.base_price::float AS price FROM products p WHERE p.is_active = TRUE AND p.is_featured = TRUE ORDER BY p.created_at DESC LIMIT 6",
  "explanation": "Targets customers who created their account in the last 24 hours and haven't received this campaign within the cooldown window. The email features up to 6 of the most recently added featured products."
}

Example for an audience-only scenario (no products): omit product_sql entirely or set it to "".`

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!userPrompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  if (userPrompt.length > 2000) return NextResponse.json({ error: 'prompt too long (max 2000 chars)' }, { status: 400 })

  let aiText = ''
  let provider = ''
  let model = ''
  let latencyMs = 0
  let fallbackUsed = false

  try {
    const r = await aiChat({
      modelHint: 'sql',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })
    aiText = r.content
    provider = r.provider
    model = r.model
    latencyMs = r.latencyMs
    fallbackUsed = r.fallbackUsed
  } catch (err) {
    const message = err instanceof AiClientError ? err.message : 'AI request failed'
    await query(
      `INSERT INTO scenario_audit_log (admin_id, action, ai_prompt, result) VALUES ($1, 'ai_generate_failed', $2, $3::jsonb)`,
      [admin.id, userPrompt, JSON.stringify({ error: message })]
    ).catch(() => {})
    return NextResponse.json({ error: message }, { status: 502 })
  }

  let parsed: { name?: string; kind?: string; description?: string; sql?: string; product_sql?: string; explanation?: string }
  try {
    parsed = JSON.parse(aiText)
  } catch (err) {
    console.error('[route]', err)
    await query(
      `INSERT INTO scenario_audit_log (admin_id, action, ai_prompt, ai_response, result) VALUES ($1, 'ai_generate_unparseable', $2, $3, $4::jsonb)`,
      [admin.id, userPrompt, aiText, JSON.stringify({ error: 'unparseable JSON', provider, model })]
    ).catch(() => {})
    return NextResponse.json({ error: 'AI returned unparseable JSON' }, { status: 502 })
  }

  if (!parsed.sql || typeof parsed.sql !== 'string') {
    return NextResponse.json({ error: 'AI response missing sql field' }, { status: 502 })
  }

  const validation = validateScenarioSql(parsed.sql, 'audience')

  const productSqlRaw = (typeof parsed.product_sql === 'string' ? parsed.product_sql.trim() : '')
  const productValidation = productSqlRaw
    ? validateScenarioSql(productSqlRaw, 'products')
    : null

  const proposedName = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 128) : ''
  const rawKind = typeof parsed.kind === 'string' ? parsed.kind.trim() : ''
  const proposedKind = rawKind
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  const proposedDescription = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 200) : ''

  await query(
    `INSERT INTO scenario_audit_log (admin_id, action, ai_prompt, ai_response, generated_sql, validation, result)
     VALUES ($1, 'ai_generate', $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [admin.id, userPrompt, aiText, parsed.sql, JSON.stringify({ audience: validation, products: productValidation }), JSON.stringify({ provider, model, latencyMs, fallbackUsed })]
  ).catch(() => {})

  return NextResponse.json({
    name: proposedName,
    kind: proposedKind,
    description: proposedDescription,
    sql: parsed.sql,
    product_sql: productSqlRaw || null,
    explanation: parsed.explanation || '',
    validation,
    productValidation,
    provider,
    model,
    fallbackUsed,
  })
}
