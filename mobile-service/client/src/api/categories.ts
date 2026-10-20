import { api } from './client'
import type { Category } from '../types'

export async function listCategories(): Promise<Category[]> {
  const data = await api<{ categories: Category[] }>('/api/categories', { token: null })
  return data.categories
}

/** A category with the storefront extras the home model carries for top-level categories. */
export type CategoryDetail = Category & { description?: string | null; icon_name?: string | null }

/** /api/categories rows merged with the description / icon_name the home model has for main categories. */
export function withDetails(categories: Category[], homeMain: Record<string, any>[] | undefined): CategoryDetail[] {
  const extra = new Map((homeMain ?? []).map(c => [String(c.id), c]))
  return categories.map(c => {
    const e = extra.get(c.id)
    return e ? { ...c, description: e.description ?? null, icon_name: e.icon_name ?? null } : c
  })
}
