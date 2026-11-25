import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import MarketplaceAdsConsole from '@/components/admin/marketplace/MarketplaceAdsConsole'
import { renderAs, res, routeFetch, callsTo } from './marketplace-kit'

// MarketplaceAdsConsole (Myntra / AJIO / Flipkart Ads): no ads API, so numbers come from imported reports.
// Overview / Campaigns / Products load from the console route for the chosen range; Import previews a report,
// asks for column mapping and commits it. fetch, router, charts and the alerts panel are stubbed.
const push = vi.fn()
const showToast = vi.fn<(...a: any[]) => any>()
let tabParam: string | null = null
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/myntra-ads',
  useSearchParams: () => new URLSearchParams(tabParam ? `tab=${tabParam}` : ''),
}))
vi.mock('@/components/admin/kit/charts', () => ({ TrendChart: ({ ariaLabel }: any) => <div role="img" aria-label={ariaLabel} /> }))

const kpis = { cost: 1000, sales: 4000, acos: 25, roas: 4, ctr: 1.5, cpc: 5, orders: 12, units: 15, clicks: 200, impressions: 13000 }
const overview = (over: Record<string, unknown> = {}) => ({
  data: {
    coverage: { from: '2026-01-01', to: '2026-01-30' },
    kpis,
    previous: { ...kpis, cost: 800, sales: 3000 },
    daily: [{ date: '2026-01-01', cost: 10, sales: 40, clicks: 3 }],
    lastImport: { imported_at: '2026-01-31T10:00:00.000Z', file_name: 'jan.csv', date_from: '2026-01-01', date_to: '2026-01-30' },
    ...over,
  },
})

const preview = (over: Record<string, unknown> = {}) => ({
  data: {
    kind: 'product',
    sheet: 'Sheet1',
    headerRow: 1,
    mappingSource: 'suggested',
    headers: ['Day', 'SKU', 'Spend', 'Sales'],
    mapping: { date: 'Day', sku: 'SKU', spend: 'Spend', sales: 'Sales' },
    samples: {},
    problems: [],
    errors: [],
    errorCount: 0,
    rowCount: 2,
    skipped: 0,
    hasDate: true,
    range: { from: '2026-01-01', to: '2026-01-02' },
    existingRows: 0,
    totals: { cost: 300, sales: 1200, acos: 25 },
    rows: [
      { line: 2, date: '2026-01-01', productKey: 'SKU-1', productName: 'Drill', impressions: 100, clicks: 5, spend: 100, orders: 1, units: 1, sales: 400 },
      { line: 3, date: '2026-01-02', productKey: 'SKU-2', productName: null, impressions: 200, clicks: 9, spend: 200, orders: 2, units: 2, sales: 800 },
    ],
    ...over,
  },
})

const API = '/api/admin/myntra-ads'

describe('MarketplaceAdsConsole', () => {
  beforeEach(() => {
    push.mockClear()
    showToast.mockClear()
    tabParam = null
  })

  it('shows the import prompt on an empty overview and sends a writer to the Import tab', async () => {
    routeFetch([[/tab=overview/, res({ data: { coverage: null } })]])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    expect(await screen.findByText('Import a report from the Myntra Partner Portal')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Myntra Partner Portal/ })[0]).toHaveAttribute('href', 'https://partners.myntrainfo.com')
    fireEvent.click(screen.getByRole('button', { name: /Import a report/ }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('tab=import'), { scroll: false })
  })

  it('does not offer a read-only admin the import button', async () => {
    routeFetch([[/tab=overview/, res({ data: { coverage: null } })]])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />, 'reader')
    await screen.findByText('Import a report from the Myntra Partner Portal')
    expect(screen.queryByRole('button', { name: /Import a report/ })).toBeNull()
  })

  it('renders KPIs, the by-day chart and the coverage line', async () => {
    const f = routeFetch([[/tab=overview/, res(overview())]])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    await waitFor(() => expect(document.body.textContent).toContain('ROAS'), { timeout: 2000 }).catch(e => { throw new Error(String(document.body.textContent).slice(0, 600) + e) })
    expect(screen.getByText('4.00x')).toBeInTheDocument()
    expect(screen.getByText('spend / ad sales')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Myntra Ads spend and sales by day' })).toBeInTheDocument()
    expect(screen.getByText(/Reports cover 2026-01-01 to 2026-01-30/)).toBeInTheDocument()
    expect(screen.getByText(/Last import .*jan\.csv/)).toBeInTheDocument()
    expect(callsTo(f, /console\?/)[0][0]).toMatch(/tab=overview&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d/)
  })

  it('shows an empty chart message when the period has no rows', async () => {
    routeFetch([[/tab=overview/, res(overview({ daily: [] }))]])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    expect(await screen.findByText('No report rows in this period.')).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    routeFetch([[/tab=overview/, res({ error: 'Report store offline' }, false)]])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    expect(await screen.findByText('Report store offline')).toBeInTheDocument()
  })

  it('lists campaigns on the Campaigns tab', async () => {
    tabParam = 'campaigns'
    routeFetch([
      [
        /tab=campaigns/,
        res({ data: { rows: [{ campaignKey: 'c1', name: 'Diwali push', adGroups: 3, cost: 500, sales: 2000, acos: 25, clicks: 90, ctr: 1.2, cpc: 5.5, orders: 7, units: 8 }] } }),
      ],
    ])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    expect(await screen.findByText('Diwali push')).toBeInTheDocument()
    expect(screen.getByText('Ad groups')).toBeInTheDocument()
  })

  it('lists advertised products with match and profit state', async () => {
    tabParam = 'products'
    routeFetch([
      [
        /tab=products/,
        res({
          data: {
            rows: [
              { productKey: 'SKU-1', name: 'Drill', sku: 'SKU-1', matched: true, stockStatus: 'Out of stock', profitAfterAds: -50, cost: 1, sales: 2, acos: 1, clicks: 1, ctr: 1, cpc: 1, orders: 1, units: 1 },
              { productKey: 'STY-9', name: null, styleId: 'STY-9', matched: false, stockStatus: null, profitAfterAds: null, cost: 1, sales: 2, acos: 1, clicks: 1, ctr: 1, cpc: 1, orders: 1, units: 1 },
            ],
          },
        }),
      ],
    ])
    renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
    expect(await screen.findByText('Out of stock')).toBeInTheDocument()
    expect(screen.getByText(/not matched to the catalogue/)).toBeInTheDocument()
    expect(screen.getAllByText('Profit after ads').length).toBeGreaterThan(0)
  })

  it('switches tabs through the router', async () => {
    routeFetch([[/tab=overview/, res({ data: { coverage: null } })]])
    renderAs(<MarketplaceAdsConsole channel="ajio_ads" />)
    await screen.findByText(/Import a report from the AJIO Seller Central/)
    fireEvent.click(screen.getByRole('tab', { name: 'Campaigns' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/ajio-ads?tab=campaigns'), { scroll: false })
  })

  describe('Import tab', () => {
    beforeEach(() => {
      tabParam = 'import'
    })

    const history = [{ id: 'h1', imported_at: '2026-01-31T10:00:00.000Z', file_name: 'jan.csv', kind: 'product', date_from: '2026-01-01', date_to: '2026-01-30', row_count: 40, replaced_count: 0, totals: { cost: 900 }, imported_by_email: 'a@b.in' }]

    it('shows the import history', async () => {
      routeFetch([[/tab=imports/, res({ data: { rows: history } })]])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      expect(await screen.findByText('jan.csv')).toBeInTheDocument()
      expect(screen.getAllByText('Products').length).toBeGreaterThan(1)
      expect(screen.getByText('a@b.in')).toBeInTheDocument()
      expect(screen.getByText('Choose a file')).toBeInTheDocument()
    })

    it('tells a read-only admin that importing needs write access', async () => {
      routeFetch([[/tab=imports/, res({ data: { rows: [] } })]])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />, 'reader')
      expect(await screen.findByText('Nothing imported yet.')).toBeInTheDocument()
      expect(screen.getByText(/importing needs Myntra Ads write access/)).toBeInTheDocument()
      expect(screen.queryByText('Choose a file')).toBeNull()
    })

    function chooseFile(name = 'ads.csv') {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['a,b'], name, { type: 'text/csv' })] } })
    }

    it('previews a chosen report and imports it, toasting the result', async () => {
      const f = routeFetch([
        [/tab=imports/, res({ data: { rows: [] } })],
        [/step=preview/, res(preview())],
        [/step=commit/, res({ ok: true, result: { rows: 2, range: { from: '2026-01-01', to: '2026-01-02' }, replaced: 5 } })],
      ])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      await screen.findByText('Nothing imported yet.')
      chooseFile()
      expect(await screen.findByText('Product report')).toBeInTheDocument()
      expect(screen.getByText('ads.csv')).toBeInTheDocument()
      expect(screen.getByText(/Columns matched automatically/)).toBeInTheDocument()
      expect(screen.getByText('SKU-2')).toBeInTheDocument()
      const button = screen.getByRole('button', { name: 'Import 2 rows' })
      expect(button).toBeEnabled()
      fireEvent.click(button)
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith('Imported 2 rows (2026-01-01 to 2026-01-02), replacing 5 earlier rows.', 'success')
      )
      const commitBody = callsTo(f, /step=commit/)[0][1]!.body as FormData
      expect((commitBody.get('file') as File).name).toBe('ads.csv')
      expect(JSON.parse(String(commitBody.get('mapping')))).toMatchObject({ date: 'Day', sku: 'SKU' })
      await waitFor(() => expect(screen.getByText('Choose a file')).toBeInTheDocument())
    })

    it('blocks the import when the report has problems, and shows them', async () => {
      routeFetch([
        [/tab=imports/, res({ data: { rows: [] } })],
        [/step=preview/, res(preview({ problems: ['No spend column mapped.'], rowCount: 0 }))],
      ])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      await screen.findByText('Nothing imported yet.')
      chooseFile()
      expect(await screen.findByText('No spend column mapped.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Import 0 rows' })).toBeDisabled()
    })

    it('needs a tick to import around rows with errors', async () => {
      routeFetch([
        [/tab=imports/, res({ data: { rows: [] } })],
        [/step=preview/, res(preview({ errorCount: 1, errors: [{ line: 7, message: 'Bad date' }] }))],
      ])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      await screen.findByText('Nothing imported yet.')
      chooseFile()
      expect(await screen.findByText('Row 7: Bad date')).toBeInTheDocument()
      const button = screen.getByRole('button', { name: 'Import 2 rows' })
      expect(button).toBeDisabled()
      fireEvent.click(screen.getByLabelText('Import the other rows and leave these out'))
      expect(button).toBeEnabled()
    })

    it('shows the server problems when the commit fails, and Start over resets', async () => {
      routeFetch([
        [/tab=imports/, res({ data: { rows: [] } })],
        [/step=preview/, res(preview())],
        [/step=commit/, res({ ok: false, problems: ['Period overlaps a locked import.'] }, false)],
      ])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      await screen.findByText('Nothing imported yet.')
      chooseFile()
      fireEvent.click(await screen.findByRole('button', { name: 'Import 2 rows' }))
      expect(await screen.findByText('Period overlaps a locked import.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
      expect(screen.getByText('Choose a file')).toBeInTheDocument()
      expect(within(document.body).queryByText('Product report')).toBeNull()
    })

    it('shows the error when the report cannot be read', async () => {
      routeFetch([
        [/tab=imports/, res({ data: { rows: [] } })],
        [/step=preview/, res({ error: 'Unsupported file' }, false)],
      ])
      renderAs(<MarketplaceAdsConsole channel="myntra_ads" />)
      await screen.findByText('Nothing imported yet.')
      chooseFile('bad.pdf')
      expect(await screen.findByText('Unsupported file')).toBeInTheDocument()
    })
  })
})
