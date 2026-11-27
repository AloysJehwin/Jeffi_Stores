import 'server-only'
import { FILTER_ENTITIES } from '@/lib/filters/registry'
import type { ExportDefinition } from './define'
import { entityExport } from './entity'
import { ENTITY_OVERRIDES } from './definitions/entities'
import { REPORT_EXPORTS } from './definitions'

// Every export by key: one per filter-registry list that has export columns, plus the reports.

let cache: Map<string, ExportDefinition> | null = null

function build(): Map<string, ExportDefinition> {
  const m = new Map<string, ExportDefinition>()
  for (const [key, entity] of Object.entries(FILTER_ENTITIES)) {
    if (!entity.export?.columns.length) continue
    m.set(key, entityExport(entity, ENTITY_OVERRIDES[key]))
  }
  for (const def of REPORT_EXPORTS) {
    if (m.has(def.key)) throw new Error(`Duplicate export key ${def.key}`)
    m.set(def.key, def)
  }
  return m
}

export function getExport(key: string): ExportDefinition | null {
  cache ??= build()
  return cache.get(key) ?? null
}

export function exportKeys(): string[] {
  cache ??= build()
  return [...cache.keys()]
}
