import {
  canonicalQuery,
  listParamNames,
  normalizeParams,
  type FilterAlias,
  type FilterField,
  type ParamSource,
} from '@jeffi/list-filters/client'

// Overview / List tab URLs for filterable lists. The period params (from, to) belong to both tabs.

const PERIOD = ['from', 'to']
const LIST_ONLY = ['sort', 'dir', 'page']

type SP = Record<string, string | string[] | undefined>
const get = (sp: SP, k: string) => {
  const v = sp[k]
  return Array.isArray(v) ? v[0] : v
}

/** The list tab: asked for, or (no tab given) any list param set. Old links carrying filters land on the list. */
export function isListUrl(
  sp: SP,
  fields: FilterField[],
  opts: { aliases?: FilterAlias[]; search?: string | false } = {}
): boolean {
  const tab = get(sp, 'tab')
  if (tab === 'list') return true
  if (tab) return false
  const names = [...listParamNames(fields, opts), ...LIST_ONLY].filter(n => !PERIOD.includes(n))
  return names.some(n => !!get(sp, n))
}

/** `path?tab=<tab>&<this list's filters>`, so switching tabs keeps the filters (and the period). */
export function tabHref(
  path: string,
  tab: string,
  sp: ParamSource,
  fields: FilterField[],
  opts: { aliases?: FilterAlias[]; search?: string | false } = {}
): string {
  const qs = canonicalQuery(normalizeParams(sp, opts.aliases).params, fields, opts)
  return `${path}?tab=${encodeURIComponent(tab)}${qs ? `&${qs}` : ''}`
}
