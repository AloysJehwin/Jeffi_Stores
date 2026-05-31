import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'
import { aiChat, AiClientError } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are a SQL writer for the Jeffi Stores marketing automation system. The admin is creating a new behavioral trigger ("scenario") to send marketing emails. They will describe the audience in plain English. Your job is to translate that description into a single safe PostgreSQL SELECT query that returns the user IDs of customers matching the description.

CRITICAL RULES — violating any of these returns a useless response:
1. Output ONLY a JSON object: {"sql": "<query>", "explanation": "<one paragraph in plain English>"}.
2. The "sql" field must be a single SELECT statement. No semicolons except at the very end (optional). No multi-statement queries. No DML (INSERT/UPDATE/DELETE/MERGE). No DDL. No system functions.
3. The query MUST select only the user identifier — either "u.id", "user_id", or equivalent. No other columns. No PII.
4. The query may use these tables ONLY:
   - users (id, email, first_name, last_name, is_active, is_guest, marketing_opt_out, created_at, last_login_at)
   - orders (id, user_id, order_number, status, payment_status, total_amount, created_at, delivered_at)
   - order_items (id, order_id, product_id, quantity, price)
   - cart_items (id, user_id, product_id, variant_id, quantity, saved_for_later, updated_at)
   - wishlist_items (user_id, product_id, snapshot_price, snapshot_in_stock, snapshot_taken_at)
   - products (id, name, slug, base_price, inventory_quantity)
   - product_reviews (id, user_id, product_id, rating, created_at)
   - customer_profiles (user_id, customer_type)
   - customer_health (user_id, score)
   - email_campaigns_sent (id, campaign_kind, user_id, sent_at, opened_at, clicked_at, converted_at, unsubscribed_at)
5. Always include these eligibility filters in the WHERE clause:
   - u.is_active = TRUE
   - u.is_guest = FALSE
   - u.marketing_opt_out = FALSE
   - u.email IS NOT NULL
6. ALWAYS include a frequency-cap NOT EXISTS clause that prevents sending the same campaign twice in a configurable window. Use the placeholder $1 for the campaign_kind and $2 for the cooldown days, like:
     AND NOT EXISTS (
       SELECT 1 FROM email_campaigns_sent ecs
       WHERE ecs.campaign_kind = $1
         AND ecs.user_id = u.id
         AND ecs.sent_at > NOW() - ($2 || ' days')::interval
     )
7. ALWAYS include LIMIT $3 at the end so the runner can cap recipients per sweep.
8. Do not use FOR UPDATE, FOR SHARE, RETURNING, or anything that mutates state.
9. Do not call pg_* functions, current_setting, dblink, lo_* functions, etc.
10. CTEs (WITH ...) are allowed.
11. The "explanation" must describe in one paragraph WHO the SQL targets and WHEN it fires, in plain English a non-technical admin can understand.

Example for the description "customers who haven't ordered in 90+ days and have at least 2 lifetime orders":
{
  "sql": "SELECT u.id FROM users u WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE AND u.email IS NOT NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid' GROUP BY o.user_id HAVING COUNT(*) >= 2 AND MAX(o.created_at) < NOW() - INTERVAL '90 days') AND NOT EXISTS (SELECT 1 FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = $1 AND ecs.user_id = u.id AND ecs.sent_at > NOW() - ($2 || ' days')::interval) LIMIT $3",
  "explanation": "Targets active, non-guest customers who have placed at least 2 paid orders, with their most recent order more than 90 days ago. Skips anyone who already received this campaign within the cooldown window."
}`

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
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

  let parsed: { sql?: string; explanation?: string }
  try {
    parsed = JSON.parse(aiText)
  } catch {
    await query(
      `INSERT INTO scenario_audit_log (admin_id, action, ai_prompt, ai_response, result) VALUES ($1, 'ai_generate_unparseable', $2, $3, $4::jsonb)`,
      [admin.id, userPrompt, aiText, JSON.stringify({ error: 'unparseable JSON', provider, model })]
    ).catch(() => {})
    return NextResponse.json({ error: 'AI returned unparseable JSON' }, { status: 502 })
  }

  if (!parsed.sql || typeof parsed.sql !== 'string') {
    return NextResponse.json({ error: 'AI response missing sql field' }, { status: 502 })
  }

  const validation = validateScenarioSql(parsed.sql)

  await query(
    `INSERT INTO scenario_audit_log (admin_id, action, ai_prompt, ai_response, generated_sql, validation, result)
     VALUES ($1, 'ai_generate', $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [admin.id, userPrompt, aiText, parsed.sql, JSON.stringify(validation), JSON.stringify({ provider, model, latencyMs, fallbackUsed })]
  ).catch(() => {})

  return NextResponse.json({
    sql: parsed.sql,
    explanation: parsed.explanation || '',
    validation,
    provider,
    model,
    fallbackUsed,
  })
}
