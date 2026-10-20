import { api } from './client'
import type { Brand } from '../types'

export async function listBrands(): Promise<Brand[]> {
  const data = await api<{ brands: Brand[] }>('/api/brands', { token: null })
  return data.brands || []
}
