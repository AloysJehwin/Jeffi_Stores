import { api } from './client'
import type { Category } from '../types'

export async function listCategories(): Promise<Category[]> {
  const data = await api<{ categories: Category[] }>('/api/categories', { token: null })
  return data.categories
}
