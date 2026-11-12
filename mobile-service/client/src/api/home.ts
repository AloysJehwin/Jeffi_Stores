import { api } from './client'
import { useHomeLayoutStore } from '../stores/homeLayoutStore'
import type { HomeAudience, HomeModel, HomePage } from '../types/home'

// The app's own layout; the server falls back to the website layout until the app has sections of its own.
// A listing page's layout holds the sections placed between its products. The business audience gets the
// business homepage once one is published, the store's until then.
export async function getHome(page: HomePage = 'home', audience: HomeAudience = 'store'): Promise<HomeModel> {
  const q = `${page === 'home' ? '' : `&page=${page}`}${audience === 'business' ? '&audience=business' : ''}`
  const model = await api<HomeModel>(`/api/home?surface=app${q}`)
  // The next launch's skeleton follows this layout.
  useHomeLayoutStore.getState().remember(page, audience, model.sections)
  return model
}
