import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, readJson, withPlan } from '@/lib/channels/route'
import { runChange } from '@/lib/channels/change-log'

export const dynamic = 'force-dynamic'

const Rule = z
  .object({
    sku: z.string().trim().min(1).max(200).nullable(),
    strategy: z.enum(['match_buybox', 'beat_buybox', 'hold']),
    beatBy: z.number().min(0).max(100_000).default(0),
    minPrice: z.number().positive().nullable().default(null),
    maxPrice: z.number().positive().nullable().default(null),
    minMarginPct: z.number().min(0).max(90).default(5),
    autoApply: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .refine(r => r.minPrice == null || r.maxPrice == null || r.minPrice <= r.maxPrice, 'The minimum price is above the maximum')

/** Create or replace the repricer rule for a SKU (or the default rule when sku is null). */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_pricing:write'), 'amazon_pricing:write', 'Amazon pricing')
  if (admin instanceof NextResponse) return admin
  const parsed = Rule.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })
  const r = parsed.data
  const before = await queryOne(`SELECT strategy, beat_by, min_price, max_price, min_margin_pct, auto_apply, enabled FROM amazon_repricer_rules WHERE COALESCE(sku, '') = COALESCE($1, '')`, [r.sku])
  const out = await runChange(
    {
      channel: 'amazon',
      action: 'repricer.rule',
      entityType: 'repricer_rule',
      entityId: r.sku ?? 'default',
      summary: `${before ? 'Changed' : 'Added'} the repricer rule for ${r.sku ?? 'all SKUs'}: ${r.strategy.replace('_', ' ')}${r.autoApply ? ', applied automatically' : ''}`,
      before,
      after: r,
      apply: async () => {
        await query(
          `INSERT INTO amazon_repricer_rules (sku, strategy, beat_by, min_price, max_price, min_margin_pct, auto_apply, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (COALESCE(sku, '')) DO UPDATE SET strategy=EXCLUDED.strategy, beat_by=EXCLUDED.beat_by, min_price=EXCLUDED.min_price,
             max_price=EXCLUDED.max_price, min_margin_pct=EXCLUDED.min_margin_pct, auto_apply=EXCLUDED.auto_apply, enabled=EXCLUDED.enabled, updated_at=now()`,
          [r.sku, r.strategy, r.beatBy, r.minPrice, r.maxPrice, r.minMarginPct, r.autoApply, r.enabled]
        )
      },
    },
    actorOf(admin),
    false
  )
  return NextResponse.json(out, { status: out.ok ? 200 : 400 })
}

export async function DELETE(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_pricing:write'), 'amazon_pricing:write', 'Amazon pricing')
  if (admin instanceof NextResponse) return admin
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid rule' }, { status: 400 })
  const out = await runChange(
    {
      channel: 'amazon',
      action: 'repricer.rule_delete',
      entityType: 'repricer_rule',
      entityId: id,
      summary: `Removed repricer rule ${id}`,
      apply: async () => {
        await query(`DELETE FROM amazon_repricer_rules WHERE id = $1::bigint`, [id])
      },
    },
    actorOf(admin),
    false
  )
  return NextResponse.json(out, { status: out.ok ? 200 : 400 })
}
