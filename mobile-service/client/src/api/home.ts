import { api } from './client'
import type { HomeModel, HomePage } from '../types/home'

// The app's own layout; the server falls back to the website layout until the app has sections of its own.
// A listing page's layout holds the sections placed between its products.
export function getHome(page: HomePage = 'home'): Promise<HomeModel> {
  return api<HomeModel>(page === 'home' ? '/api/home?surface=app' : `/api/home?surface=app&page=${page}`)
}
