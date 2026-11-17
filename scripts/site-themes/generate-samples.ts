/* eslint-disable no-console */
// The sample catalogues ready-made themes preview with, one per onboarding selling category
// (packages/store-core/src/lib/site/themes/samples/<slug>.json, SampleCatalog shape): categories, brands, products
// with prices, reviews and offers from the studio's own sampleCatalog (the cheap text model), then six product photos
// from the gateway's cheapest image quality (`draft`, kept out of every gallery). The store part is left empty: a
// theme fills it with the owner's own details.
//
//   npx tsx --tsconfig scripts/site-themes/tsconfig.json scripts/site-themes/generate-samples.ts --dry-run
//   npx tsx --tsconfig scripts/site-themes/tsconfig.json scripts/site-themes/generate-samples.ts --budget=300
//
//   --category="Pet Supplies",Automotive   only these categories (default: all fourteen)
//   --images=6                             photos per category (default 6; 0 for text only)
//   --budget=<₹>                           AI spend cap for this run (default 300)
//   --force                                write the catalogue again (its photos too)
//   --dry-run                              list what would be made; no AI, nothing written
//
// Resumable: a category whose file exists keeps its catalogue and only gets the photos it still lacks.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SAMPLES_DIR, arg, loadEnv, writeSampleIndex } from './registry'

// What shoppers of each category look for, so the catalogue reads like that kind of store.
const CATEGORY: Record<string, { words: string[]; tier: 'value' | 'mid' | 'premium' | 'luxury' }> = {
  'Electronics & Gadgets': { words: ['earbuds', 'power bank', 'smartwatch', 'fast charger', 'bluetooth speaker', 'USB-C hub', 'mechanical keyboard', 'webcam'], tier: 'mid' },
  'Fashion & Apparel': { words: ['kurta', 'cotton t-shirt', 'denim jacket', 'sneakers', 'co-ord set', 'linen shirt', 'dupatta', 'tote bag'], tier: 'mid' },
  'Home & Kitchen': { words: ['cookware', 'dinner set', 'storage jars', 'bedsheet', 'cushion cover', 'table lamp', 'bath towels', 'electric kettle'], tier: 'mid' },
  'Health & Beauty': { words: ['face serum', 'moisturiser', 'sunscreen', 'face wash', 'hair oil', 'lip balm', 'body lotion', 'shampoo'], tier: 'mid' },
  'Books & Stationery': { words: ['notebook', 'fountain pen', 'planner', 'gel pens', 'sketchbook', 'desk organiser', 'paperback', 'bookmarks'], tier: 'value' },
  'Sports & Fitness': { words: ['yoga mat', 'dumbbells', 'resistance bands', 'running shoes', 'cricket bat', 'badminton racquet', 'gym bag', 'shaker bottle'], tier: 'mid' },
  'Toys & Games': { words: ['building blocks', 'board game', 'jigsaw puzzle', 'soft toy', 'remote control car', 'art kit', 'STEM kit', 'wooden toys'], tier: 'mid' },
  'Industrial & B2B': { words: ['safety gloves', 'cordless drill', 'fasteners', 'measuring tape', 'packaging tape', 'safety shoes', 'spanner set', 'cable ties'], tier: 'mid' },
  'Food & Groceries': { words: ['basmati rice', 'cold-pressed oil', 'masala', 'dry fruits', 'tea', 'millets', 'ghee', 'pickles'], tier: 'value' },
  'Jewellery & Watches': { words: ['silver earrings', 'gold-plated necklace', 'bangles', 'analogue watch', 'pendant', 'rings', 'anklets', 'jhumkas'], tier: 'premium' },
  'Pet Supplies': { words: ['dog food', 'cat litter', 'chew toys', 'pet bed', 'leash', 'grooming brush', 'pet treats', 'food bowl'], tier: 'mid' },
  Automotive: { words: ['car vacuum', 'phone mount', 'seat covers', 'microfibre cloth', 'tyre inflator', 'dash cam', 'helmet', 'car perfume'], tier: 'mid' },
  'Agriculture & Gardening': { words: ['vegetable seeds', 'organic fertiliser', 'planters', 'pruning shears', 'drip irrigation kit', 'potting mix', 'garden gloves', 'pressure sprayer'], tier: 'value' },
  Other: { words: ['gifts', 'home decor', 'handmade', 'everyday essentials', 'accessories', 'gift hampers'], tier: 'mid' },
}

async function main() {
  await loadEnv()
  const [{ runStudioFunded, studioSpentInr, StudioAiDownError, StudioBudgetError, newSeed }, { sampleCatalog, addPictures }, { sampleSlug }, { SELLING_CATEGORIES }] = await Promise.all([
    import('@/lib/site/studio/ai'),
    import('@/lib/site/studio/catalog'),
    import('@/lib/site/themes/sample'),
    import('@controller/lib/catalog/compliance'),
  ])
  type Catalog = Awaited<ReturnType<typeof sampleCatalog>>
  type Brief = Parameters<typeof sampleCatalog>[0]

  const dryRun = arg('dry-run') !== undefined
  const force = arg('force') !== undefined
  const images = Math.max(0, Math.min(12, Number(arg('images') ?? 6)))
  const budget = Number(arg('budget') ?? 300)
  const wanted = arg('category')?.split(',').map(s => s.trim()).filter(Boolean)
  const categories = SELLING_CATEGORIES.filter(c => !wanted || wanted.some(w => w.toLowerCase() === c.toLowerCase() || sampleSlug(w) === sampleSlug(c)))
  if (!categories.length) throw new Error(`No such category. Categories: ${SELLING_CATEGORIES.join(', ')}`)
  if (!dryRun && !(budget > 0)) throw new Error('Give a --budget in ₹ above 0')

  let spent = 0
  async function funded<T>(fn: () => Promise<T>): Promise<T> {
    const left = budget - spent
    if (left <= 0) throw new StudioBudgetError()
    let used = 0
    try {
      return await runStudioFunded(
        async () => {
          try {
            return await fn()
          } finally {
            used = studioSpentInr()
          }
        },
        left,
        'site-theme-samples'
      )
    } finally {
      spent += used
    }
  }

  const briefFor = (category: string): Brief => {
    const c = CATEGORY[category] ?? CATEGORY.Other
    return {
      storeName: 'Sample store',
      summary: `A new Indian online store selling ${category === 'Other' ? 'a little of everything' : category.toLowerCase()}.`,
      category: category === 'Other' ? 'gifts and everyday goods' : category.toLowerCase(),
      vocabulary: c.words,
      audience: 'shoppers across India',
      priceTier: c.tier,
      voice: 'warm and clear',
      mood: 'clean and inviting',
      artDirection: 'A clean product photograph on a soft neutral background, natural light, true-to-life colour, the product centred',
      references: [],
      uiStyle: null,
      logoUrl: null,
      seed: newSeed(),
    }
  }
  const photos = (c: Catalog) => c.products.filter(p => p.images?.length).length

  console.log(`${dryRun ? 'Dry run: ' : ''}${categories.length} categories, ${images} photos each${dryRun ? '' : `; budget ₹${budget}`}\n`)
  for (const category of categories) {
    const file = path.join(SAMPLES_DIR, `${sampleSlug(category)}.json`)
    const have = existsSync(file) && !force ? (JSON.parse(readFileSync(file, 'utf8')) as Catalog) : null
    const label = `${category} → ${path.relative(process.cwd(), file)}`
    if (have && photos(have) >= Math.min(images, have.products.length)) {
      console.log(`${label}: kept (${have.products.length} products, ${photos(have)} photos)`)
      continue
    }
    if (dryRun) {
      console.log(`${label}: ${have ? `add ${images - photos(have)} photos` : `catalogue + ${images} photos`}`)
      continue
    }
    if (spent >= budget) {
      console.warn(`Budget of ₹${budget} reached; run again to continue.`)
      break
    }
    const brief = briefFor(category)
    try {
      const catalog = have ?? (await funded(() => sampleCatalog(brief, { images: 0 })))
      catalog.store = { name: '' }
      writeFileSync(file, `${JSON.stringify(catalog, null, 1)}\n`)
      writeSampleIndex()
      const need = images - photos(catalog)
      if (need > 0) {
        const r = await funded(() => addPictures(catalog, brief, need))
        writeFileSync(file, `${JSON.stringify(catalog, null, 1)}\n`)
        if (r.error) console.warn(`${label}: ${r.made} photos, then ${r.error}`)
      }
      console.log(`${label}: ${catalog.products.length} products, ${catalog.categories.length} categories, ${catalog.brands.length} brands, ${photos(catalog)} photos (₹${spent.toFixed(2)} so far)`)
    } catch (err) {
      if (err instanceof StudioBudgetError || err instanceof StudioAiDownError) {
        console.warn(`Stopped at ${category}: ${(err as Error).message}`)
        break
      }
      console.warn(`${category} failed: ${(err as Error).message}`)
    }
  }
  if (!dryRun) writeSampleIndex()
  console.log(`\nDone.${dryRun ? '' : ` Spent ₹${spent.toFixed(2)} of ₹${budget}.`}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
