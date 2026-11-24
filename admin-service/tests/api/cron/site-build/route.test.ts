import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/site/onboarding-build', () => ({ getOnboardingBuild: vi.fn(), startOnboardingBuild: vi.fn(), startStudioInstall: vi.fn() }))
vi.mock('@/lib/site/styles', () => ({ SITE_STYLE_IDS: ['minimal', 'bold'] }))

import { GET, POST } from '@admin/app/api/(internal)/cron/site-build/route'
import { getOnboardingBuild, startOnboardingBuild, startStudioInstall } from '@/lib/site/onboarding-build'

const OK = 'Bearer test-cron-secret'
const url = 'http://localhost/api/cron/site-build'
const get = (auth?: string) => GET(new NextRequest(url, { headers: auth ? { authorization: auth } : {} }))
const post = (body: unknown, auth: string | null = OK) =>
  POST(new NextRequest(url, { method: 'POST', headers: auth ? { authorization: auth } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const BRIEF = { description: 'A shop selling handmade leather shoes' }

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/site-build', () => {
  it('401 without or with a wrong cron secret', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('Bearer wrong')).status).toBe(401)
    expect(getOnboardingBuild).not.toHaveBeenCalled()
  })

  it('reports the store site build progress', async () => {
    vi.mocked(getOnboardingBuild).mockResolvedValue({ status: 'running', pct: 40 } as any)
    const res = await get(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ build: { status: 'running', pct: 40 } })
  })
})

describe('POST /api/cron/site-build', () => {
  it('401 without or with a wrong cron secret and starts nothing', async () => {
    expect((await post(BRIEF, null)).status).toBe(401)
    expect((await post(BRIEF, 'Bearer wrong')).status).toBe(401)
    expect(startOnboardingBuild).not.toHaveBeenCalled()
    expect(startStudioInstall).not.toHaveBeenCalled()
  })

  it('400 for a brief that is too short, malformed or has a bad style or reference', async () => {
    for (const body of ['not json', {}, { description: 'short' }, { ...BRIEF, style: 'neon' }, { ...BRIEF, references: ['http://insecure.example'] }, { ...BRIEF, budgetInr: 5000 }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(startOnboardingBuild).not.toHaveBeenCalled()
  })

  it('starts the AI-built first site from the brief with the defaults and the platform budget', async () => {
    vi.mocked(startOnboardingBuild).mockResolvedValue({ status: 'queued' } as any)
    const res = await post(BRIEF)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ build: { status: 'queued' } })
    expect(startOnboardingBuild).toHaveBeenCalledWith({ description: BRIEF.description, style: 'auto', references: [], images: true }, 200, expect.anything())
  })

  it('passes a chosen style, references and budget through', async () => {
    vi.mocked(startOnboardingBuild).mockResolvedValue({ status: 'queued' } as any)
    await post({ ...BRIEF, style: 'bold', references: ['https://ref.example'], images: false, budgetInr: 50 })
    expect(startOnboardingBuild).toHaveBeenCalledWith({ description: BRIEF.description, style: 'bold', references: ['https://ref.example'], images: false }, 50, expect.anything())
  })

  it('400 for a studio site with no pages, too many pages or a bad shape', async () => {
    const pages = Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`p${i}`, {}]))
    for (const body of [{ studio: {} }, { studio: { pages: {} } }, { studio: { pages } }]) {
      const res = await post(body)
      expect(res.status).toBe(400)
    }
    expect(startStudioInstall).not.toHaveBeenCalled()
    expect(startOnboardingBuild).not.toHaveBeenCalled()
  })

  it('installs the owner studio site instead of building from a brief', async () => {
    vi.mocked(startStudioInstall).mockResolvedValue({ status: 'installing' } as any)
    const studio = { pages: { 'public:home': { title: 'Home' } }, theme: null }
    const res = await post({ studio })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ build: { status: 'installing' } })
    expect(startStudioInstall).toHaveBeenCalledWith(studio, expect.anything())
    expect(startOnboardingBuild).not.toHaveBeenCalled()
  })
})
