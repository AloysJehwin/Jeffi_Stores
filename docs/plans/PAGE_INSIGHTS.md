# Page insights: the 3D pop-over on any Overview

The dashboard's "Orders shipped" sheet (3D isometric weeks x weekdays chart, Grid fallback, stats, breakdowns) is a reusable framework. Any page's Overview tab can open the same sheet for its own data in three steps.

Reference: the dashboard. `ActivityDrawer` (`packages/store-core/src/components/admin/dashboard/ActivityDrawer.tsx`) is a thin config over `InsightsDrawer`, fed by `GET /api/admin/dashboard/activity` and opened from the "Orders shipped" card in `AnalyticsDashboardClient.tsx`.

## Pieces

| Piece | Path |
| --- | --- |
| Series shape, maths, `parseInsightsQuery`, CSV | `packages/store-core/src/lib/insights/series.ts` |
| Server helper `getInsightsSeries(spec)` | `packages/store-core/src/lib/queries/insights-series.ts` (also exported from `@/lib/queries`) |
| `InsightsDrawer`, `InsightsButton`, `PageInsights`, `insightsLoader`, `weekdaySection`, `weeklySection` | `packages/store-core/src/components/admin/insights/` (import from `@/components/admin/insights`) |
| `SegmentedControl` (the overview segmented look) | `packages/store-core/src/components/admin/kit/segmented.tsx` (exported from the kit) |

A series is `weeks * 7` Monday-aligned store-local days (Asia/Kolkata), each with one value per stacked series. The drawer draws their sum as the 3D column / grid dot and splits the tooltip by series (or by a day's `top` list); the stat strip reads `totals`, which the helper computes.

## Step 1: series route

`admin-service/src/app/api/(admin)/admin/<page>/insights/route.ts`, gated by the page's read scope:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'
const TYPES = ['all', 'refund', 'replacement']

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'returns:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const q = parseInsightsQuery(request.nextUrl.searchParams, TYPES) // weeks 13/26/52 (default 26), filter default TYPES[0]
    if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
    const series = await getInsightsSeries({
      table: 'return_requests',
      alias: 'rr',
      dateColumn: 'created_at', // timestamptz; pass dateKind: 'date' for date columns
      where: q.filter === 'all' ? undefined : 'rr.type = $1',
      params: q.filter === 'all' ? [] : [q.filter],
      series: [
        { key: 'open', label: 'Open', where: "rr.status NOT IN ('completed', 'rejected')" },
        { key: 'closed', label: 'Closed', where: "rr.status IN ('completed', 'rejected')" },
      ],
      top: { label: 'rr.reason' }, // optional per-day tooltip list (top 3)
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
```

Spec rules: `table`, `alias` (default `t`) and `dateColumn` must be plain identifiers (checked). `where`, `joins`, `series[].where`, `series[].value` (default `COUNT(*)`, e.g. `SUM(o.total_amount)`) and `top.label` are SQL written in code, never user input; user values go in `params` as `$1`, `$2`… (the helper appends its date bounds after them). Queries run on the request's tenant pool. Don't use the stacked total for mixed units (a count and a sum in one series list); use two routes or one series.

Add the route test in `admin-service/tests/api/admin/<page>/insights/route.test.ts` (mirror `dashboard/activity/route.test.ts`), then `npm run cli:manifest` and commit the manifest.

## Step 2: config

Next to the page's Overview component:

```ts
import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'

export const RETURNS_INSIGHTS: InsightsConfig = {
  title: 'Return requests',
  copy: { subject: 'Return requests', unit: 'requests', noun: 'returns', empty: 'No return requests in this range.' },
  load: insightsLoader('/api/admin/returns/insights'), // GETs ?weeks=&filter=, reads { series }
  filter: { label: 'Type', options: [{ value: 'all', label: 'All types' }, { value: 'refund', label: 'Refunds' }, { value: 'replacement', label: 'Replacements' }] },
  sections: [weekdaySection(), weeklySection({ title: 'Open vs closed · weekly' })],
}
```

`InsightsConfig<E>`:

- `title`: sheet heading (and CSV name slug).
- `copy`: `subject` ("Return requests per day over 26 weeks"), `unit` ("12 requests"), `noun` (under the period total), `empty`.
- `load(q: { weeks, filter }) => Promise<InsightsSeries<E> | null>`: null or a throw shows "Insights are unavailable right now." with Try again. Responses for an older query are dropped.
- `periods?` (default `[13, 26, 52]`), `filter?` (`{ label, options, initial? }`, one AdminSelect).
- `stats?(s, copy)`: default `N-week total`, Busiest day, Longest and Current streak from `s.totals`.
- `sections?`: `{ title, render(s, copy), half? }[]`; two `half` sections in a row share a line. Built-ins: `weekdaySection()` (WeekdayRhythm, half), `weeklySection()` (ThroughputLines: one series one line, two series solid + dashed, more the stacked total). For page-specific charts return extra data from the route as `series.extra` and render any dashboard piece in a custom section: `CompareArea` (this vs previous), `FlowStream`, `WeekdayBars`, `DotCalendar`, `TimeToShip`, `ProductShippedTable` (all in `@/components/admin/dashboard`).
- `exportName?` (`false` hides Export), `toCsv?(s)` (default: date, one column per series, total, top).

## Step 3: button in the Overview

Pass `PageInsights` to the Overview's `PeriodBar` `actions` slot (right-aligned, before Refresh):

```tsx
import { PageInsights } from '@/components/admin/insights'

<PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} actions={<PageInsights config={RETURNS_INSIGHTS} />} />
```

`PageInsights` props: `config`, `subtitle?` (header prefix, e.g. store name), `button?` (`{ label?: string; iconOnly?: boolean; className?: string }`, default an "Insights" button with a cube icon). The series loads on first open; focus returns to the button on close.

To open from a card instead (the dashboard way), render `InsightsDrawer` yourself: `<InsightsDrawer {...config} open={open} onClose={close} initial={serverSeries} subtitle={storeName} />` with a `DashCard onClick` that sets `open`. `initial` (a series already fetched on the server) skips the first load.

## What the sheet does for free

Right-hand 560px sheet from md up, full screen on phones (opens in Grid below 640px); Esc (an open select closes first), X and backdrop close it; focus is trapped and returned; page scroll locks; reduced motion respected. Controls are the kit's `SegmentedControl` (3D / Grid) and `AdminSelect` (period, filter). The 3D chart orbits with drag or Left/Right, grid cells move with the arrow keys, and a hidden table carries the data for screen readers.

## Tests

Component tests in `integration-tests` (see `packages/store-core/integration-tests/ui/admin/insights/`), a unit test for any new query code, a route test for the route. Pick AdminSelect options by clicking the combobox (`{ name: 'Period' }` / your filter label) and then the option.
