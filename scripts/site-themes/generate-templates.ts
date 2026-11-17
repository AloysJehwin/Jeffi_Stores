/* eslint-disable no-console */
// The ready-made themes' pages (packages/store-core/src/lib/site/themes): every page the studio plans for a store, its
// product card, and a Showcase's one page, written once per style by the studio's own section writer in template mode
// (themes/template-rules.ts: the theme rules in every prompt, placeholder and colour checks in the repair loop) from a
// neutral brief, then saved as section sources in templates/<style>.json and templates/showcase-<style>.json.
//
//   npx tsx --tsconfig scripts/site-themes/tsconfig.json scripts/site-themes/generate-templates.ts --dry-run
//   npx tsx --tsconfig scripts/site-themes/tsconfig.json scripts/site-themes/generate-templates.ts --budget=1500
//
//   --style=minimalist,glass   only these styles (default: all five)
//   --product=store|showcase   only one product (default: both)
//   --pages=store:home,…       only these pages
//   --budget=<₹>               AI spend cap for this run (default 600); the run stops cleanly when it is reached
//   --plan=pool                plan the pages from the seeded pool instead of asking the AI (a fresh file only)
//   --force                    write pages again even when the file has them
//   --dry-run                  print the pages each style would get and check the palettes; no AI, nothing written
//
// Resumable: each page is saved as soon as it is written, and a page already in the file is skipped, so a run that
// stops (budget, AI down, Ctrl-C) carries on where it left off. A page whose sections still name the placeholder
// business is not saved (the next run writes it again). Runs against the AI gateway in .env.local(.overrides).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TEMPLATES_DIR, arg, loadEnv, writeTemplateIndex } from './registry'

type Product = 'store' | 'showcase'

async function main() {
  await loadEnv()
  const [{ runStudioFunded, studioSpentInr, StudioAiDownError, StudioBudgetError }, { plan: planStore, planShowcase }, { generateCard, generatePage }, rules, catalog, { CARD_KEY }] = await Promise.all([
    import('@/lib/site/studio/ai'),
    import('@/lib/site/studio/plan'),
    import('@/lib/site/studio/generate'),
    import('@/lib/site/themes/template-rules'),
    import('@/lib/site/themes/catalog'),
    import('@/lib/site/card'),
  ])
  type Plan = Awaited<ReturnType<typeof planStore>>
  type File = import('@/lib/site/themes/pages').ThemeTemplateFile

  const dryRun = arg('dry-run') !== undefined
  const force = arg('force') !== undefined
  const budget = Number(arg('budget') ?? 600)
  const styles = (arg('style')?.split(',').map(s => s.trim()).filter(Boolean) ?? [...catalog.THEME_STYLES]).filter(catalog.isThemeStyle)
  const products: Product[] = arg('product') === 'store' ? ['store'] : arg('product') === 'showcase' ? ['showcase'] : ['store', 'showcase']
  const onlyPages = arg('pages')?.split(',').map(s => s.trim()).filter(Boolean)
  if (!styles.length) throw new Error(`No such style. Styles: ${catalog.THEME_STYLES.join(', ')}`)
  if (!dryRun && !(budget > 0)) throw new Error('Give a --budget in ₹ above 0')

  let spent = 0
  /** fn on what is left of the run's budget; what it spent is added up even when it fails. */
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
        'site-theme-templates'
      )
    } finally {
      spent += used
    }
  }

  // Home first, then the chrome every page wears, then the rest in plan order (as the studio builds).
  const RANK: Record<string, number> = { 'store:home': 0, 'store:header': 1, 'store:footer': 2, 'store:announcement': 3 }
  const order = (p: Plan) => p.pages.filter(x => x.enabled).sort((a, b) => (RANK[a.key] ?? 10) - (RANK[b.key] ?? 10))
  // One seed per style: the same pool choices on every run.
  const seedOf = (style: string) => [...style].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 2 ** 31

  console.log(`${dryRun ? 'Dry run: ' : ''}styles ${styles.join(', ')}; products ${products.join(', ')}${dryRun ? '' : `; budget ₹${budget}`}\n`)
  outer: for (const product of products) {
    for (const style of styles) {
      const file = path.join(TEMPLATES_DIR, `${product === 'showcase' ? 'showcase-' : ''}${style}.json`)
      const data: File = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as File) : { version: 1, style, product, generatedAt: '', plan: null, pages: {} }
      data.pages ??= {}
      const save = () => {
        data.generatedAt = new Date().toISOString()
        writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`)
        writeTemplateIndex()
      }
      const mode = { style, product }
      const brief = rules.templateBrief(style, product, seedOf(style))
      const direction = catalog.themeDirection(style, catalog.THEME_PALETTES[style][0])
      console.log(`── ${catalog.themeStyle(style).name} (${product}) → ${path.relative(process.cwd(), file)}`)
      if (product === 'store') {
        for (const p of catalog.THEME_PALETTES[style]) {
          const issues = catalog.paletteIssues(style, p)
          if (issues.length) console.warn(`   palette ${p.name} under AA: ${issues.join('; ')}`)
        }
      }

      let plan = (data.plan as Plan | null) ?? null
      if (!plan) {
        const make = () => (product === 'showcase' ? planShowcase(brief) : planStore(brief, ['store']))
        try {
          plan = dryRun || arg('plan') === 'pool' ? await runStudioFunded(make, 0, 'site-theme-templates') : await funded(() => rules.runTemplateMode(mode, make))
        } catch (err) {
          if (err instanceof StudioBudgetError || err instanceof StudioAiDownError) {
            console.warn(`   stopped: ${(err as Error).message}`)
            break outer
          }
          throw err
        }
        if (!dryRun) {
          data.plan = plan
          save()
        }
      }

      const pages = order(plan)
      const keys = [...pages.map(p => p.key), ...(product === 'store' ? [CARD_KEY] : [])]
      for (const key of keys) {
        if (onlyPages && !onlyPages.includes(key)) continue
        const planned = pages.find(p => p.key === key)
        const label = planned?.label ?? 'Product card'
        if (data.pages[key] && !force) {
          console.log(`   ${key}: kept (${data.pages[key].sections.length} sections)`)
          continue
        }
        if (dryRun) {
          console.log(`   ${key}: ${label}, ${planned ? `${planned.sections.length} sections: ${planned.sections.map(s => s.label).join(' · ')}` : '1 section'}`)
          continue
        }
        if (spent >= budget) {
          console.warn(`   budget of ₹${budget} reached; run again to continue`)
          break outer
        }
        const ctx = { brief, plan, direction }
        const skipped: string[] = []
        let doc: Awaited<ReturnType<typeof generateCard>>
        try {
          doc = await funded(() =>
            rules.runTemplateMode(mode, () =>
              key === CARD_KEY
                ? generateCard(ctx)
                : generatePage(ctx, planned!, e => {
                    if (e.type === 'section' && e.status === 'repairing') process.stdout.write('r')
                    else if (e.type === 'section' && e.status === 'done') process.stdout.write('.')
                    else if (e.type === 'done') skipped.push(...e.skipped.map(s => `${s.label}: ${s.reason}`))
                  })
            )
          )
        } catch (err) {
          process.stdout.write('\n')
          if (err instanceof StudioBudgetError || err instanceof StudioAiDownError) {
            console.warn(`   stopped at ${key}: ${(err as Error).message}`)
            break outer
          }
          console.warn(`   ${key} failed: ${(err as Error).message}`)
          continue
        }
        process.stdout.write('\n')
        const sections = doc.order
          .map(id => doc.blocks[id])
          .filter(b => b?.type === 'code_section' && typeof b.props.source === 'string')
          .map(b => ({ label: String(b.props.label ?? 'Section'), source: String(b.props.source) }))
        const dirty = sections.filter(s => rules.carriesPlaceholder(s.source))
        if (!sections.length || dirty.length) {
          console.warn(`   ${key}: not saved (${sections.length ? `still names the placeholder in ${dirty.map(s => s.label).join(', ')}` : 'no section came out'})`)
          continue
        }
        data.pages[key] = { label, sections }
        save()
        console.log(`   ${key}: ${sections.length} sections${skipped.length ? `; skipped ${skipped.join(' | ')}` : ''} (₹${spent.toFixed(2)} so far)`)
      }
    }
  }
  if (!dryRun) writeTemplateIndex()
  console.log(`\nDone.${dryRun ? '' : ` Spent ₹${spent.toFixed(2)} of ₹${budget}.`}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
