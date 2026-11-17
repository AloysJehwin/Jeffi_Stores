import type { SiteData } from '@/lib/site/data/types'
import { studioPreview } from '@/lib/site/portal'

// Sample lines for the cart and checkout parts where there is no shopper's cart: the onboarding studio's preview,
// which renders the pages over its sample catalogue. A store page never shows them (its parts read the real cart).

export interface DemoLine {
  id: string
  name: string
  url: string
  image: string | null
  price: number
  mrp: number | null
  qty: number
  brand: string | null
}

const memo = new WeakMap<SiteData, Promise<DemoLine[]>>()

/** Up to three lines from the catalogue, read once per catalogue source. */
export function demoLines(data: SiteData): Promise<DemoLine[]> {
  let lines = memo.get(data)
  if (!lines) {
    lines = data
      .products({ sort: 'featured', limit: 3 })
      .then(list =>
        list.slice(0, 3).map((p, i) => ({
          id: p.id,
          name: p.name,
          url: p.url,
          image: p.image,
          price: p.price.value,
          mrp: p.mrp?.value ?? null,
          qty: i === 0 ? 2 : 1,
          brand: p.brand,
        }))
      )
      .catch(() => [])
    memo.set(data, lines)
  }
  return lines
}

export const demoTotal = (lines: DemoLine[]) => lines.reduce((s, l) => s + l.price * l.qty, 0)

/**
 * The sample lines where a page can have no cart of its own: the studio preview (its sample catalogue, or the store's
 * own under `catalog=live`, rendered by the control plane). A store page reads its real cart: none, and no query.
 */
export function previewLines(data: SiteData): Promise<DemoLine[]> {
  return studioPreview(data) ? demoLines(data) : Promise.resolve([])
}
