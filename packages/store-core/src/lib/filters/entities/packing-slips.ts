import { buildVectorSearchClause, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { NEEDS_SHIP_SQL } from '@/lib/overviews/orders'
import { PACKING_DEFAULT_DAYS, PACKING_FIELDS } from '../fields/packing-slips'

// Orders with at least one physical item (what a packing slip is printed for).

type PackingKey = FieldKeys<typeof PACKING_FIELDS>

const shipTo = (key: string, col: string) =>
  `COALESCE(NULLIF(btrim(o.shipping_address_snapshot->>'${key}'), ''), (SELECT a.${col} FROM addresses a WHERE a.id = o.shipping_address_id))`
const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

export const PHYSICAL_ITEMS_SQL =
  'EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital IS NOT TRUE)'

const SQL: Record<PackingKey, FieldSql> = {
  status: { kind: 'enum', expr: 'o.status' },
  source: { kind: 'enum', expr: 'o.source' },
  created: { kind: 'date', expr: 'o.created_at' },
  customer: { kind: 'text', expr: ['o.customer_name', 'o.customer_email', 'o.customer_phone'] },
  digital: { kind: 'bool', expr: 'EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital)' },
  awb: { kind: 'bool', expr: 'o.awb_number IS NOT NULL' },
  shipment_status: { kind: 'enum', expr: 'o.shipment_status', virtual: { none: 'o.shipment_status IS NULL' } },
  late_to_ship: {
    kind: 'flag',
    expr: (ctx, bind) => `o.status IN ('confirmed', 'processing') AND o.shipped_at IS NULL AND ${NEEDS_SHIP_SQL}
      AND COALESCE(o.confirmed_at, o.created_at) < NOW() - make_interval(days => ${bind(Number(ctx.handlingDays ?? 3))}::int)`,
  },
  state: { kind: 'values', expr: shipTo('state', 'state') },
}

export const PACKING_ENTITY: FilterEntity<PackingKey> = {
  key: 'packing_slips',
  scope: 'packing_slips:read',
  noun: 'Orders',
  root: 'orders',
  alias: 'o',
  base: ["o.status IS DISTINCT FROM 'draft'", PHYSICAL_ITEMS_SQL],
  fields: PACKING_FIELDS,
  sql: SQL,
  period: 'created',
  search: {
    build: (q, idx) =>
      buildVectorSearchClause(q, 'o.search_vector', ['o.customer_name'], ['o.order_number', 'o.invoice_number'], idx, 'simple'),
  },
  facets: true,
  defaultWindowDays: PACKING_DEFAULT_DAYS,
  context: async q => {
    if (!q.late_to_ship) return {}
    const [{ getBusinessValues }, { eddSettingsFromValues }] = await Promise.all([
      import('@/lib/catalog/site-controls'),
      import('@/lib/shipping/edd'),
    ])
    return { handlingDays: eddSettingsFromValues(await getBusinessValues().catch(() => null)).handlingDays }
  },
  export: {
    columns: [
      { key: 'order_number', label: 'Order no', sql: 'o.order_number' },
      { key: 'created_at', label: 'Order date', sql: IST('o.created_at') },
      { key: 'status', label: 'Status', sql: 'o.status' },
      { key: 'source', label: 'Source', sql: 'o.source' },
      { key: 'customer', label: 'Customer', sql: 'o.customer_name' },
      { key: 'phone', label: 'Phone', sql: 'o.customer_phone' },
      { key: 'city', label: 'City', sql: shipTo('city', 'city') },
      { key: 'state', label: 'State', sql: shipTo('state', 'state') },
      { key: 'pincode', label: 'Pincode', sql: shipTo('postal_code', 'postal_code') },
      {
        key: 'units',
        label: 'Units',
        sql: '(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital IS NOT TRUE)',
      },
      { key: 'total', label: 'Order total', sql: 'o.total_amount' },
      { key: 'awb', label: 'AWB', sql: 'o.awb_number' },
      { key: 'shipment_status', label: 'Courier status', sql: 'o.shipment_status' },
    ],
    keyset: ['o.created_at', 'o.id'],
  },
}
