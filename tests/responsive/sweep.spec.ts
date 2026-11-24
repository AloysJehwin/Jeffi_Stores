// One test per pack × page: the page loads once per layout (phone UA for mobile, desktop for the rest) through the
// draft's preview token and is audited at every width (audit.ts). Findings go to output/findings.jsonl; summary.ts
// turns them into the report.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, devices, type Browser, type Page } from '@playwright/test'
import { auditInPage, installVitals, vitalsInPage, type Finding } from './audit'
import { FINDINGS_PATH, MANIFEST_PATH, MIN_TAP, OUTPUT_DIR, SCREENSHOT_WIDTHS, TAP_MAX_WIDTH, VITALS, WARN_TAP, WIDTHS, layoutFor, vitalsStrict, type Manifest, type ManifestDraft, type SweepPage } from './pages'

export interface FindingsLine {
  archetype: string
  pack: string
  page: string
  width: number
  url: string
  blocks: number
  docWidth: number
  findings: (Finding & { blockType: string | null })[]
  skipped?: string
}

const manifest: Manifest | null = fs.existsSync(MANIFEST_PATH) ? (JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest) : null
const businessCookie = process.env.SWEEP_BUSINESS_COOKIE || ''
const onlyWidths = process.env.SWEEP_WIDTHS?.split(',').map(Number).filter(w => WIDTHS.includes(w as (typeof WIDTHS)[number]))
const widths = onlyWidths?.length ? onlyWidths : [...WIDTHS]
const PHONE_UA = devices['Pixel 7'].userAgent
const DESKTOP_UA = devices['Desktop Chrome'].userAgent

const record = (line: FindingsLine) => fs.appendFileSync(FINDINGS_PATH, JSON.stringify(line) + '\n')

async function newContext(browser: Browser, layout: 'mobile' | 'desktop', width: number) {
  const context = await browser.newContext({
    viewport: { width, height: layout === 'mobile' ? 800 : 1000 },
    deviceScaleFactor: 1,
    userAgent: layout === 'mobile' ? PHONE_UA : DESKTOP_UA,
    hasTouch: layout === 'mobile',
  })
  await context.addInitScript(installVitals)
  if (businessCookie) {
    await context.addCookies([{ name: 'business_sid', value: businessCookie, domain: new URL(manifest!.baseUrl).hostname, path: '/' }])
  }
  return context
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 40))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(200)
}

test.describe('responsive sweep', () => {
  test.skip(!manifest, 'no manifest: global setup (prepare.ts) did not run')

  for (const draft of manifest?.drafts ?? []) {
    for (const p of draft.pages) {
      test(`${draft.name} · ${p.page}`, async ({ browser }, testInfo) => {
        if (p.businessSession && !businessCookie) {
          for (const w of widths) record(line(draft, p, w, p.path, 0, 0, [], 'needs SWEEP_BUSINESS_COOKIE (a business_sid cookie value)'))
          test.skip(true, 'business pages need SWEEP_BUSINESS_COOKIE')
        }
        const errors: string[] = []
        const lines: FindingsLine[] = []
        try {
          for (const layout of ['mobile', 'desktop'] as const) {
            const group = widths.filter(w => layoutFor(w) === layout)
            if (group.length === 0) continue
            const url = pageUrl(manifest!, draft, p, layout)
            const context = await newContext(browser, layout, group[0])
            try {
              const page = await context.newPage()
              const resp = await page.goto(url, { waitUntil: 'load' })
              const status = resp?.status() ?? 0
              const landed = new URL(page.url()).pathname
              if (/\/(signin|login)\b/.test(landed) && !/\/login$/.test(p.path)) {
                for (const w of group) lines.push(line(draft, p, w, url, 0, 0, [], `redirected to ${landed}`))
                continue
              }
              if (status >= 400) {
                errors.push(`${p.page} ${layout}: HTTP ${status}`)
                for (const w of group) lines.push(line(draft, p, w, url, 0, 0, [{ kind: 'render', severity: 'error', element: 'document', blockId: null, detail: `HTTP ${status}` }]))
                continue
              }
              // A server render that threw: Next falls back to client rendering and hydration removes the trace.
              const ssr = (await resp?.text().catch(() => '')) ?? ''
              const threw = ssr.match(/Switched to client rendering because the server rendering errored:(?:\\n|\s)*(?:error: )?([^"\\]{1,200})/)
              const ssrError: Finding[] = threw ? [{ kind: 'render', severity: 'error', element: 'document', blockId: null, detail: `server render errored: ${threw[1].trim().slice(0, 200)}` }] : []
              // Load budgets, as the page first paints at this layout's first width: before any scrolling or resizing.
              await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
              await page.waitForTimeout(500)
              const vitals = await page.evaluate(vitalsInPage, { ...VITALS, strict: vitalsStrict() }).catch(() => [] as Finding[])
              await settle(page)
              for (const w of group) {
                await page.setViewportSize({ width: w, height: layout === 'mobile' ? 800 : 1000 })
                await page.waitForTimeout(150)
                await settle(page)
                const result = await page.evaluate(auditInPage, { width: w, minTap: MIN_TAP, warnTap: WARN_TAP, taps: w <= TAP_MAX_WIDTH })
                const findings: Finding[] = [...ssrError, ...(w === group[0] ? vitals : []), ...result.findings]
                if (result.blocks === 0 && !threw) findings.push({ kind: 'render', severity: 'error', element: 'document', blockId: null, detail: 'no Site Builder blocks rendered (preview token not honoured?)' })
                lines.push(line(draft, p, w, url, result.blocks, result.docWidth, findings))
                if (p.page === 'home' && SCREENSHOT_WIDTHS.includes(w as (typeof WIDTHS)[number])) {
                  const dir = path.join(OUTPUT_DIR, 'screenshots', draft.archetype)
                  fs.mkdirSync(dir, { recursive: true })
                  const file = path.join(dir, `${p.page}-${w}.png`)
                  await page.screenshot({ path: file, fullPage: true }).catch(() => {})
                  await testInfo.attach(`${draft.archetype} ${p.page} @${w}`, { path: file, contentType: 'image/png' }).catch(() => {})
                }
                for (const f of findings) {
                  if (f.severity === 'error') errors.push(`@${w} ${f.kind} ${blockLabel(draft, f.blockId)}${f.element}: ${f.detail}`)
                }
              }
            } finally {
              await context.close()
            }
          }
        } finally {
          for (const l of lines) record(l)
        }
        await testInfo.attach('findings', { body: JSON.stringify(lines, null, 2), contentType: 'application/json' })
        expect(errors, `${draft.name} ${p.page}:\n  ${errors.join('\n  ')}`).toEqual([])
      })
    }
  }
})

function pageUrl(m: Manifest, draft: ManifestDraft, p: SweepPage, layout: 'mobile' | 'desktop') {
  const pathname = p.path.replace('{product}', m.productSlug ?? '')
  return `${m.baseUrl}${pathname}${pathname.includes('?') ? '&' : '?'}preview=${encodeURIComponent(draft.token)}&layout=${layout}`
}

const blockLabel = (draft: ManifestDraft, id: string | null) => (id && draft.blocks[id] ? `[${draft.blocks[id]}] ` : id ? '[block] ' : '')

function line(draft: ManifestDraft, p: SweepPage, width: number, url: string, blocks: number, docWidth: number, findings: Finding[], skipped?: string): FindingsLine {
  return {
    archetype: draft.archetype,
    pack: draft.packId,
    page: p.page,
    width,
    url: url.replace(/preview=[^&]+/, 'preview=…'),
    blocks,
    docWidth,
    findings: findings.map(f => ({ ...f, blockType: f.blockId ? (draft.blocks[f.blockId] ?? null) : null })),
    ...(skipped ? { skipped } : {}),
  }
}
