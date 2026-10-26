import 'server-only'
import type { FilterEntity } from '@jeffi/list-filters'
import { ORDERS_ENTITY } from './entities/orders'

// Every filterable admin list, by key. Field definitions (client-safe) live in ./fields.
export const FILTER_ENTITIES: Record<string, FilterEntity> = {
  orders: ORDERS_ENTITY as unknown as FilterEntity,
}

export function getEntity(key: string): FilterEntity | null {
  return Object.hasOwn(FILTER_ENTITIES, key) ? FILTER_ENTITIES[key] : null
}
