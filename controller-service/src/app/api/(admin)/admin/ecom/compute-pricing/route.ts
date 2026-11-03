import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'
import { clearCatalogCache, computePlans, getCatalog } from '@controller/lib/compute/catalog'
import { PRESETS, presetSpec } from '@/lib/compute/presets'
import { PRESET_RANK } from '@/lib/compute/validate'
import { monthlyTotal, quoteSpec, UnknownPriceError } from '@controller/lib/compute/pricing'
import type { PresetKey, PricingSettings } from '@/lib/compute/spec'

export const dynamic = 'force-dynamic'

// Compute price list and the settings the store calculator prices with. Platform admin only; writes need ecom_billing:write.

function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

// The sizes a plan offers: Basic only its fixed size, the others theirs from the plan's minimum up.
const rankOf = (k: PresetKey) => (k === 'shared' ? -1 : PRESET_RANK[k])
const offers = (minPreset: PresetKey | undefined, key: PresetKey) =>
  minPreset === 'basic' ? key === 'basic' : key !== 'basic' && key !== 'shared' && rankOf(key) >= Math.max(1, minPreset ? rankOf(minPreset) : 1)

async function view() {
  const catalog = await getCatalog()
  const plans = await computePlans()
  const presets = Object.values(PRESETS)
    .map(p => {
      const spec = presetSpec(p.key)
      // Each plan's price for the size: infra at its margin, GST on that, plus its fee.
      const byPlan = Object.fromEntries(
        plans.map(pl => {
          if (!offers(pl.minPreset, p.key)) return [pl.slug, null]
          try {
            const q = quoteSpec(spec, catalog, { infraMargin: pl.infraMargin })
            return [pl.slug, { infraInrMonth: q.inrMonth, totalInrMonth: monthlyTotal(q, pl.monthlyPriceInr, catalog.settings.gstRate).total }]
          } catch (e) {
            if (e instanceof UnknownPriceError) return [pl.slug, null]
            throw e
          }
        })
      )
      let awsInrMonth: number | null = null
      try {
        awsInrMonth = quoteSpec(spec, catalog, { infraMargin: 0 }).awsInrMonth
      } catch (e) {
        if (!(e instanceof UnknownPriceError)) throw e
      }
      return { key: p.key, label: p.label, awsInrMonth, plans: byPlan }
    })
    .filter(p => Object.values(p.plans).some(Boolean))
  return {
    ...catalog,
    plans: plans.map(p => ({ slug: p.slug, name: p.name, tier: p.tier, monthlyPriceInr: p.monthlyPriceInr, infraMargin: p.infraMargin ?? 0, minPreset: p.minPreset ?? null })),
    presets,
  }
}

export async function GET(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:read'))
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await view())
}

const PRICE_FIELDS = ['usd_hourly', 'usd_hourly_multi_az', 'usd_gb_month', 'usd_gb_month_multi_az'] as const
const SETTING_BOUNDS: Partial<Record<keyof PricingSettings, [number, number]>> = {
  usdInr: [1, 1000],
  margin: [0, 5],
  gstRate: [0, 1],
  platformShareUsd: [0, 1000],
  rootVolumeGb: [8, 500],
  poolCapacity: [1, 50],
  sharedDbCapacity: [1, 100],
  sharedDbStorageGb: [1, 1000],
  sharedDbMaxConnections: [20, 5000],
  minPrepayDays: [0, 365],
  graceDays: [0, 60],
  ipv4UsdHour: [0, 1],
  ebsGp3UsdGbMonth: [0, 10],
  snapshotUsdGbMonth: [0, 10],
  s3UsdGbMonth: [0, 10],
}

/** { code, usd_hourly?, …, sellable? } edits one price; { settings: {...} } the pricing settings; { plan, infraMargin?, monthlyPriceInr? } a plan's margin and fee. */
export async function PATCH(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  const pool = controlPlanePool()

  if (b.settings && typeof b.settings === 'object') {
    const next: Record<string, number> = {}
    for (const [k, [lo, hi]] of Object.entries(SETTING_BOUNDS) as [string, [number, number]][]) {
      if (b.settings[k] === undefined) continue
      const n = Number(b.settings[k])
      if (!Number.isFinite(n) || n < lo || n > hi) return NextResponse.json({ error: `${k} must be between ${lo} and ${hi}` }, { status: 400 })
      next[k] = n
    }
    const { settings } = await getCatalog()
    await pool.query(
      `INSERT INTO platform_infra (key, value) VALUES ('compute_pricing', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ ...settings, ...next })]
    )
  } else if (typeof b.plan === 'string' && (b.infraMargin !== undefined || b.monthlyPriceInr !== undefined)) {
    const sets: string[] = []
    const vals: unknown[] = [b.plan]
    if (b.infraMargin !== undefined) {
      const n = Number(b.infraMargin)
      if (!Number.isFinite(n) || n < 0 || n > 3) return NextResponse.json({ error: 'infraMargin must be between 0 and 3' }, { status: 400 })
      vals.push(n)
      sets.push(`infra_margin = $${vals.length}`)
    }
    if (b.monthlyPriceInr !== undefined) {
      // The plan's flat monthly fee, GST included.
      const n = Number(b.monthlyPriceInr)
      if (b.monthlyPriceInr === null || !Number.isFinite(n) || n < 0 || n > 1_000_000) {
        return NextResponse.json({ error: 'monthlyPriceInr must be a rupee amount of 0 or more' }, { status: 400 })
      }
      vals.push(Math.round(n * 100) / 100)
      sets.push(`monthly_price_inr = $${vals.length}`)
    }
    const r = await pool.query(`UPDATE plans SET ${sets.join(', ')}, updated_at = now() WHERE slug = $1 AND product = 'store'`, vals)
    if (!r.rowCount) return NextResponse.json({ error: 'Unknown plan' }, { status: 404 })
  } else {
    const code = typeof b.code === 'string' ? b.code : ''
    const sets: string[] = []
    const vals: unknown[] = [code]
    for (const f of PRICE_FIELDS) {
      if (b[f] === undefined) continue
      const n = b[f] === null ? null : Number(b[f])
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000)) return NextResponse.json({ error: `${f} must be a USD amount` }, { status: 400 })
      vals.push(n)
      sets.push(`${f} = $${vals.length}`)
    }
    if (typeof b.sellable === 'boolean') {
      vals.push(b.sellable)
      sets.push(`sellable = $${vals.length}`)
    }
    if (!code || !sets.length) return NextResponse.json({ error: 'code and a field to change are required' }, { status: 400 })
    const r = await pool.query(`UPDATE compute_prices SET ${sets.join(', ')}, updated_at = now() WHERE code = $1`, vals)
    if (!r.rowCount) return NextResponse.json({ error: 'Unknown price' }, { status: 404 })
  }
  clearCatalogCache()
  return NextResponse.json(await view())
}
