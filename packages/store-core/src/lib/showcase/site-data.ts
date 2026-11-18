import type { SiteData } from '../site/data/types'
import type { ShowcaseView } from './types'
import { businessView } from './views'

// What a Showcase page's code sections read: no catalogue (a Showcase sells nothing), the business as the "store" (for
// the shared parts that read it, such as SocialLinks) and the view itself for the Showcase parts. showcase-service
// renders live pages with it, the studio preview over the owner's draft (leadEndpoint null, so forms are inert).

export function showcaseSiteData(view: ShowcaseView): SiteData {
  const none = async () => []
  return {
    products: none,
    product: async () => null,
    categories: none,
    brands: none,
    reviews: none,
    offers: none,
    category: async () => null,
    brand: async () => null,
    allCategories: none,
    allBrands: none,
    card: null,
    async store() {
      const b = businessView(view.business)
      return {
        name: b.name,
        tagline: b.tagline,
        logo: b.logo,
        email: b.email,
        phone: b.phone,
        address: b.fullAddress,
        about: b.about,
        year: b.year,
        ...(b.whatsapp ? { whatsapp: b.whatsapp } : {}),
        ...(b.socials.length ? { socials: Object.fromEntries(b.socials.map(s => [s.network, s.href])) } : {}),
      }
    },
    showcase: async () => view,
  }
}
