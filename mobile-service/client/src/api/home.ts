import { api } from './client'
import type { HomeModel } from '../types/home'

// The app's own layout; the server falls back to the website layout until the app has sections of its own.
export function getHome(): Promise<HomeModel> {
  return api<HomeModel>('/api/home?surface=app')
}
