import { api } from './client'
import type { HomeModel } from '../types/home'

export function getHome(): Promise<HomeModel> {
  return api<HomeModel>('/api/home')
}
